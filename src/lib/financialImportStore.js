// Persistência do lote de importação financeira retroativa.
// Camada fina: a lógica vive em financialImportBatch.js (pura e testada).
//
// Spec: docs/superpowers/plans/2026-10-29-financial-import-review-persistence.md
//
// DEGRADAÇÃO EXPLÍCITA (refinamento da spec): se as tabelas ainda não existem (migration não
// rodada), as funções devolvem `schemaMissing` em vez de estourar. A tela bloqueia o início da
// revisão: nenhuma decisão pode existir só em memória. Foi exatamente a degradação silenciosa que
// custou a revisão da clínica.

import { supabase } from './supabase.js'
import { statementMovementFingerprint } from './statementParser.js'
import { isMissingRelationError } from './financeStoreErrors.js'
import { buildBatchLineRows, buildBatchRecord, lineDecisionPatch, missingConfirmedLineIds, validateApprovalConfirmation } from './financialImportBatch.js'

const BATCH_COLUMNS = 'id, file_name, file_hash, sheet_name, line_count, status, created_at, ready_at, canceled_at, cancellation_reason'
const LINE_COLUMNS = 'id, source_id, batch_id, source_line_key, line_index, posted_date, amount, description, normalized_description, movement_fingerprint, source_metadata, review_status, chart_account_id, archived_at'
// Gravação: 500 por bloco. Leitura: 1000 por página, que é o teto padrão do PostgREST — sem
// paginar, um lote de 1.500 linhas voltaria truncado em 1.000, SEM erro (o limite da tela é 50.000).
const WRITE_CHUNK = 500
const READ_PAGE = 1000
// Atualização por lista de ids vai na URL (~39 caracteres por UUID). Blocos de 120 para a URL nunca
// estourar o limite do gateway: "rejeitar todas pendentes" pode tocar milhares de linhas.
const ID_CHUNK = 120

const SCHEMA_MISSING = { schemaMissing:true }

function schemaMissing(error) {
  return isMissingRelationError(error) ? SCHEMA_MISSING : null
}

function chunked(items, size) {
  const blocks = []
  for (let offset = 0; offset < items.length; offset += size) blocks.push(items.slice(offset, offset + size))
  return blocks
}

// Subir o MESMO arquivo+aba de novo não cria lote novo: encontra o existente e retoma.
// Inclui `ready` de propósito: o índice único cobre tudo que não está arquivado, então ignorar
// `ready` faria o insert estourar com "duplicate key" cru — e antes desta feature esse upload
// funcionava, mostrando as linhas como já existentes. Um lote `ready` reaberto volta a `reviewing`.
export async function findActiveBatch(ownerId, fileHash, sheetName = null) {
  const { data, error } = await supabase
    .from('financial_import_batches')
    .select(BATCH_COLUMNS)
    .eq('user_id', ownerId)
    .eq('file_hash', fileHash)
    .eq('sheet_name', sheetName || '')
    // 'creating' entra na busca porque ele TAMBÉM ocupa o índice único: se ficasse invisível
    // aqui, o insert estouraria com "duplicate key" cru e o arquivo ficaria impossível de subir.
    .in('status', ['creating', 'reviewing', 'ready'])
    .is('archived_at', null)
    .order('created_at', { ascending:false })
    .limit(1)
  if (error) return schemaMissing(error) || { error }
  return { batch:data?.[0] || null }
}

// Lotes 'creating' nunca são oferecidos: podem estar sem todas as linhas.
export async function findResumableBatch(ownerId) {
  const { data, error } = await supabase
    .from('financial_import_batches')
    .select(BATCH_COLUMNS)
    .eq('user_id', ownerId)
    .eq('status', 'reviewing')
    .is('archived_at', null)
    .order('created_at', { ascending:false })
    .limit(1)
  if (error) return schemaMissing(error) || { error }
  return { batch:data?.[0] || null }
}

async function readAllPages(select, batchId) {
  const rows = []
  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from('financial_import_lines')
      .select(select)
      .eq('batch_id', batchId)
      .is('archived_at', null)
      .order('id', { ascending:true })
      .range(page * READ_PAGE, (page + 1) * READ_PAGE - 1)
    if (error) return { error }
    rows.push(...(data || []))
    if ((data?.length || 0) < READ_PAGE) break
  }
  return { rows }
}

// Só a coluna de status: mostra o progresso no banner de retomada sem trazer as linhas inteiras.
export async function loadBatchStatuses(batchId) {
  const result = await readAllPages('id, review_status, archived_at', batchId)
  if (result.error) return schemaMissing(result.error) || { error:result.error }
  return { rows:result.rows }
}

export async function loadBatchLines(batchId) {
  const result = await readAllPages(LINE_COLUMNS, batchId)
  if (result.error) return schemaMissing(result.error) || { error:result.error }
  return { rows:result.rows }
}

export async function loadImportHistory(limit = 50) {
  const { data, error } = await supabase.rpc('list_financial_import_history', { p_limit:limit })
  if (error) return schemaMissing(error) || { error }
  return { batches:data || [] }
}

// Descarte de uma revisão que nunca entrou no financeiro. Passa por RPC de propósito: o guard de
// "nenhuma linha aprovada" tem que viver no banco. Arquivar pelo cliente um lote que já virou
// lançamento deixaria origens no financeiro sem lote cancelável para retirá-las depois.
export async function discardFinancialImportBatch(batchId, reason = null) {
  const { data, error } = await supabase.rpc('discard_financial_import_batch', {
    p_batch_id:batchId,
    p_reason:reason ? String(reason).trim() : null,
  })
  if (error) return schemaMissing(error) || { error }
  if (!data || data.batch_id !== batchId || data.status !== 'archived') {
    return { error:new Error('O banco não confirmou o descarte desta revisão.') }
  }
  return { result:data }
}

export async function cancelFinancialImportBatch(batchId, reason) {
  const { data, error } = await supabase.rpc('cancel_financial_import_batch', {
    p_batch_id:batchId,
    p_reason:String(reason || '').trim(),
  })
  if (error) return schemaMissing(error) || { error }
  if (!data || data.batch_id !== batchId || data.status !== 'canceled') {
    return { error:new Error('O banco não confirmou o cancelamento completo da importação.') }
  }
  return { result:data }
}

// Grava o lote e TODAS as linhas. O lote nasce 'creating' e só é promovido a 'reviewing' depois do
// read-back do último bloco: assim uma gravação interrompida no meio NUNCA fica retomável com
// linhas faltando. Em falha, lote e linhas já gravadas são descartados.
export async function createBatch({ ownerId, actorId, parsed }) {
  const { data: batch, error: batchError } = await supabase
    .from('financial_import_batches')
    .insert(buildBatchRecord({ ownerId, actorId, parsed }))
    .select(BATCH_COLUMNS)
    .single()
  if (batchError) return schemaMissing(batchError) || { error:batchError }

  const rows = buildBatchLineRows({ ownerId, batchId:batch.id, lines:parsed?.lines || [] })
  const persistedRows = []
  for (const chunk of chunked(rows, WRITE_CHUNK)) {
    const { data: saved, error } = await supabase
      .from('financial_import_lines')
      .insert(chunk)
      .select(LINE_COLUMNS)
    if (error || (saved?.length || 0) !== chunk.length) {
      await discardBatch(batch.id).catch(() => {})
      return { error:error || new Error('O banco nao confirmou todas as linhas da planilha.') }
    }
    persistedRows.push(...saved)
  }

  const { data: promoted, error: promoteError } = await supabase
    .from('financial_import_batches')
    .update({ status:'reviewing' })
    .eq('id', batch.id)
    .select(BATCH_COLUMNS)
    .single()
  if (promoteError) {
    await discardBatch(batch.id).catch(() => {})
    return { error:promoteError }
  }
  return { batch:promoted, rows:persistedRows }
}

// Aprova origem financeira + progresso da linha na MESMA transacao do Postgres. A tela so recebe
// sucesso depois que os dois lados foram confirmados; nao existe mais janela em que o lancamento
// aparece localmente como salvo mas a linha do lote (ou a origem) falhou.
export async function approveFinancialImportLines({ batchId, items = [] }) {
  if (!batchId || !items.length) return { rows:[] }
  const payload = items.map(item => ({
    line_id:item.line.id,
    source_id:item.proposal.record.id,
    collection:item.proposal.collection,
    record:item.proposal.record,
  }))
  const { data, error } = await supabase.rpc('approve_financial_import_lines', {
    p_batch_id:batchId,
    p_items:payload,
  })
  if (error) return { error }
  if (!validateApprovalConfirmation(items, data || [])) {
    return { error:new Error('O banco nao confirmou todas as linhas deste bloco de importacao.') }
  }
  return { rows:data }
}

// Reabre um lote concluído, para que rejeições possam ser revistas depois de recarregar a página.
export async function reopenBatch(batchId) {
  const { data, error } = await supabase
    .from('financial_import_batches')
    .update({ status:'reviewing', ready_at:null })
    .eq('id', batchId)
    .select('id, status')
    .maybeSingle()
  if (error) return schemaMissing(error) || { error }
  if (!data || data.status !== 'reviewing') return { error:new Error('O banco nao confirmou a reabertura desta revisao.') }
  return { ok:true }
}

// Em LOTE de propósito: "rejeitar todas pendentes" pode tocar milhares de linhas, e uma requisição
// por linha derrubaria a tela. `neq approved` protege uma linha que outro usuário (ou outra aba) já
// aprovou: ela está no financeiro e não pode voltar a 'rejected'/'edited' no lote.
export async function saveLinesDecision({ batchId, lineIds = [], decision, actorId }) {
  if (!lineIds.length) return { ok:true }
  const patch = lineDecisionPatch({ decision, actorId })
  for (const chunk of chunked(lineIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from('financial_import_lines')
      .update(patch)
      .eq('batch_id', batchId)
      .in('id', chunk)
      .neq('review_status', 'approved')
      .select('id, review_status')
    if (error) return schemaMissing(error) || { error }
    const missing = missingConfirmedLineIds(chunk, data || [])
    if (missing.length) {
      return { error:new Error(`${missing.length} linha(s) mudaram em outra aba ou nao foram autorizadas; recarregue a revisao.`) }
    }
  }
  return { ok:true }
}

// A edição grava os campos revisados E marca a linha como `edited` — editar nunca aprova.
// O fingerprint e a chave de linha são RECALCULADOS sobre os valores editados: `updateStatementLine`
// não os recalcula, e manter o valor antigo fazia a detecção de duplicados divergir entre a revisão
// em memória e a MESMA revisão depois de retomada.
export async function saveLineEdit({ batchId, lineId, line, actorId }) {
  const metadata = line.sourceMetadata || {}
  const { data, error } = await supabase
    .from('financial_import_lines')
    .update({
      posted_date:line.postedDate,
      amount:line.amount,
      description:line.description || '',
      normalized_description:line.normalizedDescription || '',
      movement_fingerprint:statementMovementFingerprint(line),
      source_line_key:line.sourceLineKey || '',
      source_metadata:metadata,
      chart_account_id:metadata.chartAccountId || null,
      ...lineDecisionPatch({ decision:'edit', actorId }),
    })
    .eq('batch_id', batchId)
    .eq('id', lineId)
    .neq('review_status', 'approved')
    .select('id, review_status')
    .maybeSingle()
  if (error) return schemaMissing(error) || { error }
  if (!data || data.review_status !== 'edited') {
    return { error:new Error('A linha mudou em outra aba ou nao foi autorizada; recarregue a revisao.') }
  }
  return { ok:true }
}

export async function closeBatch(batchId) {
  const { data, error } = await supabase
    .from('financial_import_batches')
    .update({ status:'ready', ready_at:new Date().toISOString() })
    .eq('id', batchId)
    .select('id, status')
    .maybeSingle()
  if (error) return schemaMissing(error) || { error }
  if (!data || data.status !== 'ready') return { error:new Error('O banco nao confirmou o encerramento desta revisao.') }
  return { ok:true }
}

// Descarta um lote e TODAS as suas linhas. Arquivar só o lote deixaria as linhas vivas ocupando a
// chave (batch_id, id) e, na versão anterior com PK só em `id`, travava o arquivo para sempre.
export async function discardBatch(batchId) {
  const now = new Date().toISOString()
  const { error: linesError } = await supabase
    .from('financial_import_lines')
    .update({ archived_at:now })
    .eq('batch_id', batchId)
    .is('archived_at', null)
  if (linesError && !isMissingRelationError(linesError)) return { error:linesError }
  const { data, error } = await supabase
    .from('financial_import_batches')
    .update({ status:'archived', archived_at:now })
    .eq('id', batchId)
    .select('id, status, archived_at')
    .maybeSingle()
  if (error) return schemaMissing(error) || { error }
  if (!data || data.status !== 'archived' || !data.archived_at) {
    return { error:new Error('O banco nao confirmou o descarte desta revisao.') }
  }
  return { ok:true }
}
