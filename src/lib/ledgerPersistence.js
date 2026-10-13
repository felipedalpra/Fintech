import { buildLedger } from './financialLedger.js'

function entryKey(entry) {
  return `${entry.source_type}|${entry.source_id}|${entry.source_component}`
}

function asEntryRow(userId, entry) {
  return {
    user_id:userId,
    direction:entry.direction,
    source_type:entry.source_type,
    source_id:entry.source_id,
    source_component:entry.source_component,
    description:entry.description || entry.party_name_snapshot || null,
    party_type:entry.party_type || null,
    party_id:entry.party_id || null,
    party_name_snapshot:entry.party_name_snapshot || null,
    category:entry.category || null,
    cost_center:entry.cost_center || null,
    origin_label:entry.origin_label || null,
    ...(entry.chart_account_id ? { chart_account_id:entry.chart_account_id } : {}),
    competence_date:entry.competence_date || null,
    issue_date:entry.issue_date || null,
    total_amount:Number(entry.total_amount || 0),
    status:entry.status,
    archived_at:null,
    updated_at:new Date().toISOString(),
  }
}

function asInstallmentRow(userId, entryId, row) {
  const amount = Number(row.amount || 0)
  return {
    user_id:userId,
    financial_entry_id:entryId,
    installment_number:Number(row.installment_number || 1),
    amount,
    paid_amount:row.status === 'paid' ? amount : Number(row.paid_amount || 0),
    due_date:row.due_date || null,
    settlement_date:row.settlement_date || null,
    payment_method:row.payment_method || null,
    financial_account_id:row.financial_account_id || null,
    fees_amount:Number(row.fees_amount || 0),
    interest_amount:Number(row.interest_amount || 0),
    discount_amount:Number(row.discount_amount || 0),
    status:row.status,
    archived_at:null,
    updated_at:new Date().toISOString(),
  }
}

export function prepareFinancialEntryRows(userId, ledger) {
  return (ledger.entries || []).map(entry => asEntryRow(userId, entry))
}

export function prepareFinancialInstallmentRows(userId, ledger, persistedEntries) {
  const ids = new Map((persistedEntries || []).map(entry => [entryKey(entry), entry.id]))
  return (ledger.entries || []).flatMap((entry, index) => {
    const entryId = ids.get(entryKey(entry))
    if (!entryId) throw new Error(`Título não persistido: ${entryKey(entry)}`)
    return (ledger.installments[index] || []).map(row => asInstallmentRow(userId, entryId, row))
  })
}

async function archiveEntries(client, userId, entries) {
  if (!entries.length) return
  const archivedAt = new Date().toISOString()
  for (const entry of entries) {
    const { error } = await client.from('financial_entries')
      .update({ archived_at:archivedAt, updated_at:archivedAt })
      .eq('user_id', userId)
      .eq('source_type', entry.source_type)
      .eq('source_id', entry.source_id)
      .eq('source_component', entry.source_component)
    if (error) throw error
  }
}

export async function persistLedgerProjection(client, userId, ledger, { archive = [] } = {}) {
  const entryRows = prepareFinancialEntryRows(userId, ledger)
  let persistedEntries = []
  if (entryRows.length > 0) {
    const { data, error } = await client.from('financial_entries')
      .upsert(entryRows, { onConflict:'user_id,source_type,source_id,source_component' })
      .select('id,source_type,source_id,source_component')
    if (error) throw error
    persistedEntries = data || []
  }

  const ids = new Map(persistedEntries.map(entry => [entryKey(entry), entry.id]))
  for (let index = 0; index < ledger.entries.length; index += 1) {
    const entry = ledger.entries[index]
    const entryId = ids.get(entryKey(entry))
    if (!entryId) throw new Error(`Título não persistido: ${entryKey(entry)}`)
    const rows = ledger.installments[index] || []
    // Numeração é contígua (1..N). Se o cronograma encolher, parcelas excedentes são arquivadas.
    const archiveQuery = client.from('financial_installments')
      .update({ archived_at:new Date().toISOString(), updated_at:new Date().toISOString() })
      .eq('user_id', userId)
      .eq('financial_entry_id', entryId)
    const { error } = rows.length > 0
      ? await archiveQuery.gt('installment_number', rows.length)
      : await archiveQuery.gte('installment_number', 1)
    if (error) throw error
  }

  const installmentRows = prepareFinancialInstallmentRows(userId, ledger, persistedEntries)

  if (installmentRows.length > 0) {
    const { error } = await client.from('financial_installments')
      .upsert(installmentRows, { onConflict:'financial_entry_id,installment_number' })
    if (error) throw error
  }

  await archiveEntries(client, userId, archive)
  return { entries:entryRows.length, installments:installmentRows.length, archived:archive.length }
}

export async function syncFinancialLedger(client, userId, financeData, baselineData = null) {
  const ledger = buildLedger(financeData)
  const currentKeys = new Set(ledger.entries.map(entryKey))
  const archive = baselineData
    ? buildLedger(baselineData).entries.filter(entry => !currentKeys.has(entryKey(entry)))
    : []
  return persistLedgerProjection(client, userId, ledger, { archive })
}

function normalizeRecurrence(row) {
  return {
    id:row.id,
    tipo:row.tipo,
    descricao:row.descricao,
    valor:Number(row.valor || 0),
    categoria:row.categoria || 'outros',
    frequencia:row.frequencia || 'mensal',
    diaExecucao:Number(row.dia_execucao || row.diaExecucao || 1),
    dataInicio:row.data_inicio || row.dataInicio,
    dataFim:row.data_fim || row.dataFim || '',
    autoMarkAsPaid:Boolean(row.auto_mark_as_paid ?? row.autoMarkAsPaid),
    ativo:row.ativo !== false,
    chartAccountId:row.chart_account_id || row.chartAccountId || null,
  }
}

export async function syncRecurringLedger(client, userId, recurrenceRows, fromDate, toDate) {
  const [{ data:revenueRows, error:revenueError }, { data:expenseRows, error:expenseError }, { data:chartAccounts, error:chartError }] = await Promise.all([
    client.from('extra_revenues').select('id,description,category,chart_account_id,value,date,received_date,due_date,competence_date,status').eq('user_id', userId),
    client.from('expenses').select('id,description,category,chart_account_id,value,due_date,payment_date,competence_date,status').eq('user_id', userId),
    client.from('chart_accounts').select('*').eq('user_id', userId),
  ])
  if (revenueError) throw revenueError
  if (expenseError) throw expenseError
  if (chartError) throw chartError

  const data = {
    recurrences:(recurrenceRows || []).map(normalizeRecurrence),
    extraRevenues:(revenueRows || []).map(row => ({ id:row.id, description:row.description, category:row.category, chartAccountId:row.chart_account_id || null, value:Number(row.value || 0), date:row.date || '', receivedDate:row.received_date || '', dueDate:row.due_date || row.date || '', competenceDate:row.competence_date || row.date || '', status:row.status || 'recebido' })),
    expenses:(expenseRows || []).map(row => ({ id:row.id, description:row.description, category:row.category, chartAccountId:row.chart_account_id || null, value:Number(row.value || 0), dueDate:row.due_date || '', paymentDate:row.payment_date || '', competenceDate:row.competence_date || row.due_date || '', status:row.status || 'aberto' })),
    chartAccounts:chartAccounts || [],
  }
  const ledger = buildLedger(data, { recurrenceFrom:fromDate, recurrenceTo:toDate })
  // Esta rotina persiste somente as ocorrências; os lançamentos operacionais são sincronizados pelo autosave.
  const recurringIndexes = ledger.entries.flatMap((entry, index) => entry.source_type === 'recurrence' ? [index] : [])
  const recurringLedger = {
    entries:recurringIndexes.map(index => ledger.entries[index]),
    installments:recurringIndexes.map(index => ledger.installments[index]),
  }

  const { data:existing, error } = await client.from('financial_entries')
    .select('source_type,source_id,source_component')
    .eq('user_id', userId)
    .eq('source_type', 'recurrence')
    .gte('competence_date', fromDate)
    .lte('competence_date', toDate)
    .is('archived_at', null)
  if (error) throw error
  const nextKeys = new Set(recurringLedger.entries.map(entryKey))
  const archive = (existing || []).filter(entry => !nextKeys.has(entryKey(entry)))
  return persistLedgerProjection(client, userId, recurringLedger, { archive })
}
