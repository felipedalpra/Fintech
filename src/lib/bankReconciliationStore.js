import { supabase } from './supabase.js'
import { statementMovementFingerprint } from './statementParser.js'
import { describeImportFailure } from './supabaseErrorMessage.js'

const PAGE_SIZE = 500

export function isBankReconciliationSchemaMissing(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code === '42P01' || code === 'PGRST202' || code === 'PGRST205'
    || message.includes('bank_statement_') && message.includes('schema cache')
    || message.includes('review_status')
    || message.includes('review_claim_token')
    || message.includes('movement_fingerprint')
    || message.includes('statement_metadata')
    || message.includes('verification_status')
    || message.includes('institution_code')
    || message.includes('provider_transaction_id')
    || message.includes('create_financial_bank_account')
    || message.includes('set_bank_statement_lines_review')
    || message.includes('claim_bank_statement_lines_for_creation')
    || message.includes('release_bank_statement_line_claims')
    || message.includes('recover_bank_statement_line_claim')
}

async function fetchAll(makeQuery) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

export async function fetchFinancialAccounts(ownerId) {
  if (!ownerId) return []
  const { data, error } = await supabase
    .from('financial_accounts')
    .select('id,name,account_type,opening_balance,opening_balance_date,institution_code,institution_name,branch_code,account_number_masked,account_number_suffix,holder_name,holder_document_suffix,currency,source,external_account_id,connection_id,verification_status,verified_at,last_synced_at,active,archived_at')
    .eq('user_id', ownerId)
    .eq('active', true)
    .is('archived_at', null)
    .order('name', { ascending:true })
  if (error) throw error
  return data || []
}

export async function createFinancialAccount(ownerId, {
  name,
  accountType = 'checking',
  institutionCode = null,
  institutionName = null,
  branchCode = null,
  accountNumberSuffix = null,
  holderName = null,
  holderDocumentSuffix = null,
}) {
  const cleanName = String(name || '').trim()
  if (!ownerId || !cleanName) throw new Error('Informe o nome da conta financeira.')
  const { data, error } = await supabase.rpc('create_financial_bank_account', {
    p_name:cleanName,
    p_account_type:accountType,
    p_institution_code:String(institutionCode || '').trim() || null,
    p_institution_name:String(institutionName || '').trim() || null,
    p_branch_code:String(branchCode || '').trim() || null,
    p_account_number_suffix:String(accountNumberSuffix || '').replace(/\D/g, '').slice(-4) || null,
    p_holder_name:String(holderName || '').trim() || null,
    p_holder_document_suffix:String(holderDocumentSuffix || '').replace(/\D/g, '').slice(-4) || null,
  })
  if (error) throw error
  if (!data?.id) throw new Error('A conta não foi confirmada pelo sistema.')
  return data
}

export async function fetchBankStatementImports(ownerId) {
  if (!ownerId) return []
  return fetchAll(() => supabase
    .from('bank_statement_imports')
    .select('id,user_id,financial_account_id,connection_id,file_name,file_hash,source_format,source_type,expected_line_count,line_count,status,period_start,period_end,declared_period_start,declared_period_end,institution_code,statement_account_masked,statement_account_fingerprint,currency,closing_balance,available_balance,balance_date,net_movement,control_difference,verification_status,verification_notes,imported_by,created_at,ready_at,archived_at')
    .eq('user_id', ownerId)
    .is('archived_at', null)
    .order('created_at', { ascending:false }))
}

function toLineRow(ownerId, accountId, importId, line) {
  const metadata = line.sourceMetadata || {}
  return {
    user_id:ownerId,
    import_id:importId,
    financial_account_id:accountId,
    source_line_key:line.sourceLineKey,
    external_id:line.externalId || null,
    provider_transaction_id:metadata.providerTransactionId || null,
    end_to_end_id:metadata.endToEndId || null,
    txid:metadata.txid || null,
    booking_status:metadata.transactionStatus || 'booked',
    counterparty_name:metadata.counterpartyName || null,
    counterparty_document_suffix:metadata.counterpartyDocumentSuffix || null,
    posted_date:line.postedDate,
    amount:Number(line.amount),
    currency:'BRL',
    description:String(line.description || ''),
    normalized_description:String(line.normalizedDescription || ''),
    movement_fingerprint:statementMovementFingerprint(line),
    source_metadata:metadata,
    line_index:Number(line.lineIndex),
  }
}

function assertReadBack(expected, persisted) {
  const returned = new Set((persisted || []).map(row => row.source_line_key))
  const missing = expected.filter(row => !returned.has(row.source_line_key))
  if (missing.length) throw new Error(`${missing.length} linha(s) do extrato não foram confirmadas pelo sistema.`)
}

export async function importBankStatement({ ownerId, accountId, parsed }) {
  if (!ownerId || !accountId) throw new Error('Selecione a conta financeira antes de importar.')
  if (!parsed?.lines?.length) throw new Error('O arquivo não possui linhas válidas para importar.')
  if (parsed.errors?.length) throw new Error('Corrija as linhas inválidas antes de importar.')
  const { data:started, error:startError } = await supabase.rpc('start_bank_statement_import', {
    p_account_id:accountId,
    p_file_name:parsed.fileName || 'extrato',
    p_file_hash:parsed.fileHash,
    p_format:parsed.format,
    p_expected_count:parsed.lines.length,
    p_statement_metadata:parsed.statementMetadata || {},
  })
  if (startError) throw startError
  if (!started?.id) throw new Error('A abertura da importação não foi confirmada pelo sistema.')

  try {
    const rows = parsed.lines.map(line => toLineRow(ownerId, accountId, started.id, line))
    for (let index = 0; index < rows.length; index += PAGE_SIZE) {
      const batch = rows.slice(index, index + PAGE_SIZE)
      const { data, error } = await supabase
        .from('bank_statement_lines')
        .insert(batch)
        .select('id,source_line_key')
      if (error) throw error
      assertReadBack(batch, data)
    }
    const { data:ready, error:finishError } = await supabase.rpc('finalize_bank_statement_import', { p_import_id:started.id })
    if (finishError) throw finishError
    if (ready?.status !== 'ready' || Number(ready.line_count) !== rows.length) {
      throw new Error('A importação não foi finalizada integralmente pelo sistema.')
    }
    return ready
  } catch (error) {
    // O rollback NAO pode falar mais alto que a falha que o motivou.
    //
    // Aqui havia `supabase.rpc(...).catch(...)`: o builder do supabase-js e
    // thenable, mas nao e Promise -- ele tem `.then`, nao tem `.catch`. O
    // rollback estourava `TypeError: rpc(...).catch is not a function` e essa
    // mensagem SUBSTITUIA o erro real na tela, escondendo a causa de quem
    // tenta importar. Agora a limpeza falha em silencio e o erro original
    // sempre chega ao usuario.
    try {
      await supabase.rpc('archive_bank_statement_import', { p_import_id:started.id })
    } catch {
      // Importacao parcial fica como 'importing' e e descartada depois; nao ha
      // nada util a dizer ao usuario sobre a limpeza em si.
    }
    throw describeImportFailure(error)
  }
}

export async function fetchStatementLines(ownerId, importId) {
  return fetchAll(() => supabase
    .from('bank_statement_lines')
    .select('id,user_id,import_id,financial_account_id,source_line_key,external_id,provider_transaction_id,end_to_end_id,txid,booking_status,counterparty_name,counterparty_document_suffix,posted_date,amount,currency,description,normalized_description,movement_fingerprint,source_metadata,line_index,review_status,review_reason,reviewed_by,reviewed_at,created_at,archived_at')
    .eq('user_id', ownerId)
    .eq('import_id', importId)
    .is('archived_at', null)
    .order('line_index', { ascending:true }))
}

export async function setBankStatementLinesReview({ lineIds, status, reason = null }) {
  const ids = [...new Set((lineIds || []).filter(Boolean))]
  if (!ids.length) throw new Error('Selecione ao menos uma linha para revisar.')
  if (!['pending', 'ignored'].includes(status)) throw new Error('Decisão de revisão inválida.')
  const { data, error } = await supabase.rpc('set_bank_statement_lines_review', {
    p_line_ids:ids,
    p_status:status,
    p_reason:reason ? String(reason).trim() : null,
  })
  if (error) throw error
  if (Number(data) !== ids.length) throw new Error('Nem todas as linhas tiveram a revisão confirmada pelo sistema.')
  return Number(data)
}

export async function claimBankStatementLinesForCreation(lineIds, claimToken, { allowOverlap = false } = {}) {
  const ids = [...new Set((lineIds || []).filter(Boolean))]
  if (!ids.length) throw new Error('Selecione ao menos uma linha nova para aprovar.')
  if (!claimToken) throw new Error('Não foi possível identificar esta tentativa de criação.')
  const { data, error } = await supabase.rpc('claim_bank_statement_lines_for_creation', {
    p_line_ids:ids,
    p_claim_token:claimToken,
    p_allow_overlap:Boolean(allowOverlap),
  })
  if (error) throw error
  if (Number(data) !== ids.length) throw new Error('As linhas não foram reservadas integralmente. Atualize a conciliação antes de tentar novamente.')
  return Number(data)
}

export async function recoverBankStatementLineClaim(lineId) {
  if (!lineId) throw new Error('Linha de extrato inválida.')
  const { data, error } = await supabase.rpc('recover_bank_statement_line_claim', { p_line_id:lineId })
  if (error) throw error
  if (Number(data) !== 1) throw new Error('A reserva ainda não pode ser recuperada.')
  return Number(data)
}

export async function releaseBankStatementLineClaims(lineIds, claimToken) {
  const ids = [...new Set((lineIds || []).filter(Boolean))]
  if (!ids.length || !claimToken) throw new Error('Reserva de criação inválida.')
  const { data, error } = await supabase.rpc('release_bank_statement_line_claims', {
    p_line_ids:ids,
    p_claim_token:claimToken,
  })
  if (error) throw error
  if (Number(data) !== ids.length) throw new Error('A reserva não pôde ser liberada porque a linha mudou ou já originou um lançamento.')
  return Number(data)
}

export async function fetchBankReconciliations(ownerId, importId) {
  const lines = await fetchStatementLines(ownerId, importId)
  if (!lines.length) return { lines:[], reconciliations:[], reservedInstallmentIds:[], overlappingFingerprints:[] }
  const lineIds = lines.map(line => line.id)
  const reconciliations = []
  for (let index = 0; index < lineIds.length; index += PAGE_SIZE) {
    const ids = lineIds.slice(index, index + PAGE_SIZE)
    const { data, error } = await supabase
      .from('bank_reconciliations')
      .select('id,user_id,statement_line_id,financial_installment_id,match_method,score,match_reasons,difference_amount,difference_days,justification,confirmed_by,confirmed_at,reversed_by,reversed_at,reversal_reason')
      .eq('user_id', ownerId)
      .in('statement_line_id', ids)
      .order('confirmed_at', { ascending:false })
    if (error) throw error
    reconciliations.push(...(data || []))
  }
  const activeReconciliations = await fetchAll(() => supabase
    .from('bank_reconciliations')
    .select('financial_installment_id')
    .eq('user_id', ownerId)
    .is('reversed_at', null))
  const accountId = lines[0]?.financial_account_id
  const currentFingerprints = new Set(lines.map(line => line.movement_fingerprint).filter(Boolean))
  const overlappingLines = accountId ? await fetchAll(() => supabase
    .from('bank_statement_lines')
    .select('movement_fingerprint')
    .eq('user_id', ownerId)
    .eq('financial_account_id', accountId)
    .neq('import_id', importId)
    .neq('review_status', 'ignored')
    .is('archived_at', null)) : []
  return {
    lines,
    reconciliations,
    reservedInstallmentIds:[...new Set(activeReconciliations.map(item => item.financial_installment_id).filter(Boolean))],
    overlappingFingerprints:[...new Set(overlappingLines.map(item => item.movement_fingerprint).filter(value => value && currentFingerprints.has(value)))],
  }
}

export async function fetchReconciliationInstallments(ownerId) {
  return fetchAll(() => supabase
    .from('financial_installments')
    .select(`id,user_id,financial_entry_id,installment_number,amount,paid_amount,due_date,settlement_date,payment_method,financial_account_id,status,archived_at,
      financial_entries!inner(id,user_id,direction,source_type,source_id,source_component,description,party_name_snapshot,category,origin_label,issue_date,competence_date,status,archived_at)`)
    .eq('user_id', ownerId)
    .eq('financial_entries.user_id', ownerId)
    .is('archived_at', null)
    .is('financial_entries.archived_at', null)
    .not('status', 'in', '(canceled,refunded)')
    .not('financial_entries.status', 'in', '(canceled,refunded)')
    .order('due_date', { ascending:false }))
}

export async function confirmBankReconciliation({ lineId, installmentId, method, score, reasons, justification, windowDays }) {
  const { data, error } = await supabase.rpc('confirm_bank_reconciliation', {
    p_line_id:lineId,
    p_installment_id:installmentId,
    p_method:method,
    p_score:score ?? null,
    p_reasons:reasons || [],
    p_justification:justification || null,
    p_window_days:Number(windowDays ?? 3),
  })
  if (error) throw error
  if (!data?.id || data.statement_line_id !== lineId || data.financial_installment_id !== installmentId) {
    throw new Error('A conciliação não foi confirmada pelo sistema.')
  }
  return data
}

export async function reverseBankReconciliation(reconciliationId, reason) {
  const { data, error } = await supabase.rpc('reverse_bank_reconciliation', {
    p_reconciliation_id:reconciliationId,
    p_reason:String(reason || '').trim(),
  })
  if (error) throw error
  if (!data?.id || !data.reversed_at) throw new Error('A desconciliação não foi confirmada pelo sistema.')
  return data
}

export async function archiveBankStatementImport(importId) {
  const { data, error } = await supabase.rpc('archive_bank_statement_import', { p_import_id:importId })
  if (error) throw error
  if (!data?.id || data.status !== 'archived') throw new Error('O arquivamento não foi confirmado pelo sistema.')
  return data
}
