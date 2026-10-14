import { supabase } from './supabase.js'

const PAGE_SIZE = 500

export function isBankReconciliationSchemaMissing(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code === '42P01' || code === 'PGRST202' || code === 'PGRST205'
    || message.includes('bank_statement_') && message.includes('schema cache')
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
    .select('id,name,account_type,active,archived_at')
    .eq('user_id', ownerId)
    .eq('active', true)
    .is('archived_at', null)
    .order('name', { ascending:true })
  if (error) throw error
  return data || []
}

export async function createFinancialAccount(ownerId, { name, accountType = 'checking' }) {
  const cleanName = String(name || '').trim()
  if (!ownerId || !cleanName) throw new Error('Informe o nome da conta financeira.')
  const { data, error } = await supabase
    .from('financial_accounts')
    .insert({ user_id:ownerId, name:cleanName, account_type:accountType, active:true })
    .select('id,name,account_type,active,archived_at')
    .single()
  if (error) throw error
  if (!data?.id) throw new Error('A conta não foi confirmada pelo banco.')
  return data
}

export async function fetchBankStatementImports(ownerId) {
  if (!ownerId) return []
  return fetchAll(() => supabase
    .from('bank_statement_imports')
    .select('id,user_id,financial_account_id,file_name,file_hash,source_format,expected_line_count,line_count,status,period_start,period_end,imported_by,created_at,ready_at,archived_at')
    .eq('user_id', ownerId)
    .is('archived_at', null)
    .order('created_at', { ascending:false }))
}

function toLineRow(ownerId, accountId, importId, line) {
  return {
    user_id:ownerId,
    import_id:importId,
    financial_account_id:accountId,
    source_line_key:line.sourceLineKey,
    external_id:line.externalId || null,
    posted_date:line.postedDate,
    amount:Number(line.amount),
    currency:'BRL',
    description:String(line.description || ''),
    normalized_description:String(line.normalizedDescription || ''),
    source_metadata:line.sourceMetadata || {},
    line_index:Number(line.lineIndex),
  }
}

function assertReadBack(expected, persisted) {
  const returned = new Set((persisted || []).map(row => row.source_line_key))
  const missing = expected.filter(row => !returned.has(row.source_line_key))
  if (missing.length) throw new Error(`${missing.length} linha(s) do extrato não foram confirmadas pelo banco.`)
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
  })
  if (startError) throw startError
  if (!started?.id) throw new Error('A abertura da importação não foi confirmada pelo banco.')

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
      throw new Error('A importação não foi finalizada integralmente pelo banco.')
    }
    return ready
  } catch (error) {
    await supabase.rpc('archive_bank_statement_import', { p_import_id:started.id }).catch(() => null)
    throw error
  }
}

export async function fetchStatementLines(ownerId, importId) {
  return fetchAll(() => supabase
    .from('bank_statement_lines')
    .select('id,user_id,import_id,financial_account_id,source_line_key,external_id,posted_date,amount,currency,description,normalized_description,source_metadata,line_index,created_at,archived_at')
    .eq('user_id', ownerId)
    .eq('import_id', importId)
    .is('archived_at', null)
    .order('line_index', { ascending:true }))
}

export async function fetchBankReconciliations(ownerId, importId) {
  const lines = await fetchStatementLines(ownerId, importId)
  if (!lines.length) return { lines:[], reconciliations:[], reservedInstallmentIds:[] }
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
  return {
    lines,
    reconciliations,
    reservedInstallmentIds:[...new Set(activeReconciliations.map(item => item.financial_installment_id).filter(Boolean))],
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
    throw new Error('A conciliação não foi confirmada pelo banco.')
  }
  return data
}

export async function reverseBankReconciliation(reconciliationId, reason) {
  const { data, error } = await supabase.rpc('reverse_bank_reconciliation', {
    p_reconciliation_id:reconciliationId,
    p_reason:String(reason || '').trim(),
  })
  if (error) throw error
  if (!data?.id || !data.reversed_at) throw new Error('A desconciliação não foi confirmada pelo banco.')
  return data
}

export async function archiveBankStatementImport(importId) {
  const { data, error } = await supabase.rpc('archive_bank_statement_import', { p_import_id:importId })
  if (error) throw error
  if (!data?.id || data.status !== 'archived') throw new Error('O arquivamento não foi confirmado pelo banco.')
  return data
}
