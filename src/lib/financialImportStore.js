// Persistência do lote de importação financeira retroativa.
// Camada fina: a lógica vive em financialImportBatch.js (pura e testada).
//
// Spec: docs/superpowers/plans/2026-10-29-financial-import-review-persistence.md
//
// DEGRADAÇÃO EXPLÍCITA (refinamento da spec): se as tabelas ainda não existem (migration não
// rodada), as funções devolvem `schemaMissing` em vez de estourar. A tela então continua
// funcionando em memória, mas AVISA que a revisão não está sendo salva. Nunca em silêncio — foi
// exatamente a degradação silenciosa que custou a revisão da clínica.

import { supabase } from './supabase.js'
import { isMissingRelationError } from './financeStoreErrors.js'
import { buildBatchLineRows, buildBatchRecord, lineDecisionPatch } from './financialImportBatch.js'

const LINE_CHUNK = 500
const LINE_COLUMNS = 'id, batch_id, source_line_key, line_index, posted_date, amount, description, normalized_description, movement_fingerprint, source_metadata, review_status, chart_account_id, archived_at'

const SCHEMA_MISSING = { schemaMissing:true }

function schemaMissing(error) {
  return isMissingRelationError(error) ? SCHEMA_MISSING : null
}

// Subir o MESMO arquivo de novo não cria lote novo: encontra o lote em revisão e retoma.
// A aba faz parte da identidade do lote: o mesmo arquivo tem o mesmo hash em todas as abas.
export async function findActiveBatch(ownerId, fileHash, sheetName = null) {
  const { data, error } = await supabase
    .from('financial_import_batches')
    .select('id, file_name, file_hash, sheet_name, line_count, status, created_at')
    .eq('user_id', ownerId)
    .eq('file_hash', fileHash)
    .eq('sheet_name', sheetName || '')
    .eq('status', 'reviewing')
    .is('archived_at', null)
    .order('created_at', { ascending:false })
    .limit(1)
  if (error) return schemaMissing(error) || { error }
  return { batch:data?.[0] || null }
}

// O lote em revisão mais recente, para oferecer retomada sem o arquivo em mãos.
export async function findResumableBatch(ownerId) {
  const { data, error } = await supabase
    .from('financial_import_batches')
    .select('id, file_name, file_hash, sheet_name, line_count, status, created_at')
    .eq('user_id', ownerId)
    .eq('status', 'reviewing')
    .is('archived_at', null)
    .order('created_at', { ascending:false })
    .limit(1)
  if (error) return schemaMissing(error) || { error }
  return { batch:data?.[0] || null }
}

// Só a coluna de status: serve para mostrar o progresso no banner de retomada sem trazer as
// linhas inteiras (o limite da tela é 50.000).
export async function loadBatchStatuses(batchId) {
  const { data, error } = await supabase
    .from('financial_import_lines')
    .select('review_status, archived_at')
    .eq('batch_id', batchId)
  if (error) return schemaMissing(error) || { error }
  return { rows:data || [] }
}

export async function loadBatchLines(batchId) {
  const { data, error } = await supabase
    .from('financial_import_lines')
    .select(LINE_COLUMNS)
    .eq('batch_id', batchId)
    .is('archived_at', null)
    .order('line_index', { ascending:true })
  if (error) return schemaMissing(error) || { error }
  return { rows:data || [] }
}

// Grava o lote e TODAS as linhas, com read-back por bloco. Se qualquer linha não voltar
// confirmada, o lote é arquivado para não deixar revisão pela metade no banco.
export async function createBatch({ ownerId, actorId, parsed }) {
  const { data: batch, error: batchError } = await supabase
    .from('financial_import_batches')
    .insert(buildBatchRecord({ ownerId, actorId, parsed }))
    .select('id, file_name, file_hash, sheet_name, line_count, status, created_at')
    .single()
  if (batchError) return schemaMissing(batchError) || { error:batchError }

  const rows = buildBatchLineRows({ ownerId, batchId:batch.id, lines:parsed?.lines || [] })
  for (let offset = 0; offset < rows.length; offset += LINE_CHUNK) {
    const chunk = rows.slice(offset, offset + LINE_CHUNK)
    const { data: saved, error } = await supabase
      .from('financial_import_lines')
      .insert(chunk)
      .select('id')
    if (error || (saved?.length || 0) !== chunk.length) {
      await archiveBatch(batch.id).catch(() => {})
      return { error:error || new Error('O banco nao confirmou todas as linhas da planilha.') }
    }
  }
  return { batch, rows }
}

// Em LOTE de propósito: "rejeitar todas pendentes" pode tocar milhares de linhas, e uma
// requisição por linha derrubaria a tela.
export async function saveLinesDecision({ lineIds = [], decision, actorId }) {
  if (!lineIds.length) return { ok:true }
  const patch = lineDecisionPatch({ decision, actorId })
  const { error } = await supabase.from('financial_import_lines').update(patch).in('id', lineIds)
  if (error) return schemaMissing(error) || { error }
  return { ok:true }
}

// A edição grava os campos revisados E marca a linha como `edited` — editar nunca aprova.
export async function saveLineEdit({ lineId, line, actorId }) {
  const metadata = line.sourceMetadata || {}
  const { error } = await supabase
    .from('financial_import_lines')
    .update({
      posted_date:line.postedDate,
      amount:line.amount,
      description:line.description || '',
      normalized_description:line.normalizedDescription || '',
      movement_fingerprint:line.movementFingerprint,
      source_metadata:metadata,
      chart_account_id:metadata.chartAccountId || null,
      ...lineDecisionPatch({ decision:'edit', actorId }),
    })
    .eq('id', lineId)
  if (error) return schemaMissing(error) || { error }
  return { ok:true }
}

// Chamada DEPOIS de cada bloco aprovado com sucesso pelo saveDataNow. É o que torna a retomada
// exata: uma confirmação que morre no bloco 2 de 4 encontra os blocos 1 e 2 como 'approved'.
//
// Não há coluna separada apontando para a origem criada porque ela seria redundante: o id da
// linha É o id da origem (UUID determinístico de financialImportUuid), por construção. Uma coluna
// extra também não poderia ser mantida com valor por linha num update em lote.
export async function markLinesApproved({ lineIds = [], actorId }) {
  if (!lineIds.length) return { ok:true }
  const { error } = await supabase
    .from('financial_import_lines')
    .update({ review_status:'approved', reviewed_by:actorId, reviewed_at:new Date().toISOString() })
    .in('id', lineIds)
  if (error) return schemaMissing(error) || { error }
  return { ok:true }
}

export async function closeBatch(batchId) {
  const { error } = await supabase
    .from('financial_import_batches')
    .update({ status:'ready', ready_at:new Date().toISOString() })
    .eq('id', batchId)
  if (error) return schemaMissing(error) || { error }
  return { ok:true }
}

export async function archiveBatch(batchId) {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('financial_import_batches')
    .update({ status:'archived', archived_at:now })
    .eq('id', batchId)
  if (error) return schemaMissing(error) || { error }
  return { ok:true }
}
