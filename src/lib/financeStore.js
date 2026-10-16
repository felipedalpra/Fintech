import { createEmptyData, isDataEmpty, normalizeData } from '../dataModel.js'
import { computeIdsToDelete, computeRowsToUpsert, missingRowIds, mergeById } from './financeSync.js'
import { mapExtraRevenuesRows } from './financeStoreRows.js'
import { supabase } from './supabase.js'
import { syncFinancialLedger } from './ledgerPersistence.js'
import { isChartSchemaMissing } from './chartOfAccountsStore.js'

const LEGACY_APP_KEY = 'startupfinance_v1'
const LOCAL_USERS_KEY = 'startupfinance_users_v1'
const LOCAL_DATA_PREFIX = 'startupfinance_user_data_v1'
const MIGRATION_PREFIX = 'startupfinance_migrated_user_v1'
let relationalBackendAvailable = null
let relationalBackendCheckedAt = 0
const RELATIONAL_BACKEND_TTL = 5 * 60 * 1000 // 5 min

const RELATIONAL_TABLES = [
  'procedures',
  'products',
  'surgeries',
  'consultations',
  'product_sales',
  'product_purchases',
  'extra_revenues',
  'expenses',
  'assets',
  'liabilities',
  'goals',
]

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function migratedKey(userId) {
  return `${MIGRATION_PREFIX}:${userId}`
}

function getLocalUserDataByEmail(email) {
  const users = readJson(LOCAL_USERS_KEY, [])
  const matchedUser = users.find(user => user.email === email?.trim().toLowerCase())
  if (!matchedUser) return null
  return readJson(`${LOCAL_DATA_PREFIX}:${matchedUser.id}`, null)
}

async function canUseRelationalBackend() {
  const now = Date.now()
  if (relationalBackendAvailable !== null && (now - relationalBackendCheckedAt) < RELATIONAL_BACKEND_TTL) {
    return relationalBackendAvailable
  }
  const { error } = await supabase.from('procedures').select('id').limit(1)
  relationalBackendAvailable = !error
  relationalBackendCheckedAt = now
  return relationalBackendAvailable
}


async function fetchLegacyPayload(userId) {
  const { data, error } = await supabase
    .from('user_finance_data')
    .select('payload')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return createEmptyData()
  return normalizeData(data?.payload ?? createEmptyData())
}

async function fetchRelationalData(userId) {
  const chartAccountsPromise = supabase.from('chart_accounts').select('*').eq('user_id', userId)
  const [
    proceduresResult,
    productsResult,
    surgeriesResult,
    consultationsResult,
    productSalesResult,
    productPurchasesResult,
    extraRevenuesResult,
    expensesResult,
    assetsResult,
    liabilitiesResult,
    goalsResult,
    chartAccountsResult,
  ] = await Promise.all([
    supabase.from('procedures').select('*').eq('user_id', userId),
    supabase.from('products').select('*').eq('user_id', userId),
    supabase.from('surgeries').select('*').eq('user_id', userId),
    supabase.from('consultations').select('*').eq('user_id', userId),
    supabase.from('product_sales').select('*').eq('user_id', userId),
    supabase.from('product_purchases').select('*').eq('user_id', userId),
    supabase.from('extra_revenues').select('*').eq('user_id', userId),
    supabase.from('expenses').select('*').eq('user_id', userId),
    supabase.from('assets').select('*').eq('user_id', userId),
    supabase.from('liabilities').select('*').eq('user_id', userId),
    supabase.from('goals').select('*').eq('user_id', userId),
    chartAccountsPromise,
  ])

  const results = [
    proceduresResult,
    productsResult,
    surgeriesResult,
    consultationsResult,
    productSalesResult,
    productPurchasesResult,
    extraRevenuesResult,
    expensesResult,
    assetsResult,
    liabilitiesResult,
    goalsResult,
  ]

  const failed = results.find(result => result.error)
  if (failed?.error) throw failed.error
  if (chartAccountsResult.error && !isChartSchemaMissing(chartAccountsResult.error)) throw chartAccountsResult.error

  // SOFT-DELETE: oculta registros arquivados (archived_at preenchido). Filtro em JS (tolerante:
  // se a coluna ainda não existe no banco, archived_at vem undefined e nada é ocultado).
  for (const result of results) {
    if (Array.isArray(result.data)) result.data = result.data.filter(row => !row.archived_at)
  }

  return normalizeData({
    procedures:(proceduresResult.data || []).map(item => ({
      id:item.id,
      name:item.name,
      price:Number(item.price || 0),
      durationHours:Number(item.duration_hours || 0),
      color:item.color || '',
      desc:item.description || '',
      checklist:Array.isArray(item.checklist) ? item.checklist : [],
      chartAccountId:item.chart_account_id || null,
    })),
    products:(productsResult.data || []).map(item => ({
      id:item.id,
      name:item.name,
      category:item.category,
      description:item.description || '',
      purchasePrice:Number(item.purchase_price || 0),
      salePrice:Number(item.sale_price || 0),
      stock:Number(item.opening_stock || 0),
      active:item.active !== false,
    })),
    surgeries:(surgeriesResult.data || []).map(item => ({
      id:item.id,
      procedureId:item.procedure_id || '',
      patient:item.patient || '',
      patientId:item.patient_id || null,
      totalValue:Number(item.total_value || 0),
      date:item.date || '',
      startTime:String(item.start_time || '').slice(0, 5),
      durationMinutes:Number(item.duration_minutes || 0),
      paymentMethod:item.payment_method || 'pix',
      paymentStatus:item.payment_status || 'pendente',
      surgeon:item.surgeon || '',
      paymentDate:item.payment_date || '',
      competenceDate:item.competence_date || item.date || '',
      dueDate:item.due_date || item.date || '',
      hospitalCost:Number(item.hospital_cost || 0),
      anesthesiaCost:Number(item.anesthesia_cost || 0),
      materialCost:Number(item.material_cost || 0),
      otherCosts:Number(item.other_costs || 0),
      invoiceIssuancePercent:Number(item.invoice_issuance_percent || 0),
      costSettlements:item.cost_settlements && typeof item.cost_settlements === 'object' ? item.cost_settlements : {},
      notes:item.notes || '',
    })),
    consultations:(consultationsResult.data || []).map(item => ({
      id:item.id,
      patient:item.patient || '',
      patientId:item.patient_id || null,
      date:item.date || '',
      startTime:String(item.start_time || '').slice(0, 5),
      durationMinutes:Number(item.duration_minutes || 0),
      consultationType:item.consultation_type || 'avaliacao',
      value:Number(item.value || 0),
      paymentType:item.payment_type || 'particular',
      paymentMethod:item.payment_method || 'pix',
      invoiceIssuancePercent:Number(item.invoice_issuance_percent || 0),
      costSettlements:item.cost_settlements && typeof item.cost_settlements === 'object' ? item.cost_settlements : {},
      insurance:item.insurance || '',
      paymentStatus:item.payment_status || 'pendente',
      forecastPaymentDate:item.forecast_payment_date || '',
      paymentDate:item.payment_date || '',
      competenceDate:item.competence_date || item.date || '',
      dueDate:item.due_date || item.forecast_payment_date || item.date || '',
    })),
    productSales:(productSalesResult.data || []).map(item => ({
      id:item.id,
      productId:item.product_id,
      patientName:item.patient_name || '',
      patientId:item.patient_id || null,
      paymentStatus:item.status || 'recebido',
      quantity:Number(item.quantity || 0),
      unitValue:Number(item.unit_value || 0),
      totalValue:Number(item.total_value || 0),
      saleDate:item.sale_date || '',
      dueDate:item.due_date || item.sale_date || '',
      receivedDate:item.received_date || '',
      paymentMethod:item.payment_method || 'pix',
      competenceDate:item.competence_date || item.sale_date || '',
    })),
    productPurchases:(productPurchasesResult.data || []).map(item => ({
      id:item.id,
      productId:item.product_id,
      quantity:Number(item.quantity || 0),
      totalValue:Number(item.total_value || 0),
      supplier:item.supplier || '',
      supplierId:item.supplier_id || null,
      status:item.status || 'pago',
      paymentDate:item.payment_date || '',
      documentNumber:item.document_number || '',
      purchaseDate:item.purchase_date || '',
      competenceDate:item.competence_date || item.purchase_date || '',
      dueDate:item.due_date || item.purchase_date || '',
    })),
    extraRevenues:(extraRevenuesResult.data || []).map(item => ({
      id:item.id,
      description:item.description || '',
      category:item.category || 'outras_receitas',
      value:Number(item.value || 0),
      date:item.date || '',
      receivedDate:item.received_date || '',
      patientId:item.patient_id || null,
      costCenter:item.cost_center || '',
      competenceDate:item.competence_date || item.date || '',
      dueDate:item.due_date || item.date || '',
      originLabel:item.origin_label || '',
      status:item.status || 'recebido',
      chartAccountId:item.chart_account_id || null,
    })),
    expenses:(expensesResult.data || []).map(item => ({
      id:item.id,
      description:item.description || '',
      category:item.category || 'outros',
      value:Number(item.value || 0),
      dueDate:item.due_date || '',
      paymentDate:item.payment_date || '',
      status:item.status || 'aberto',
      supplierId:item.supplier_id || null,
      costCenter:item.cost_center || '',
      competenceDate:item.competence_date || item.due_date || '',
      originLabel:item.origin_label || '',
      chartAccountId:item.chart_account_id || null,
    })),
    assets:(assetsResult.data || []).map(item => ({
      id:item.id,
      name:item.name || '',
      category:item.category || 'banco',
      value:Number(item.value || 0),
      notes:item.notes || '',
    })),
    liabilities:(liabilitiesResult.data || []).map(item => ({
      id:item.id,
      name:item.name || '',
      category:item.category || 'outros',
      value:Number(item.value || 0),
      notes:item.notes || '',
    })),
    goals:(goalsResult.data || []).map(item => ({
      id:item.id,
      name:item.name || '',
      metric:item.metric || 'faturamento',
      target:Number(item.target || 0),
      period:item.period || 'mensal',
      dueDate:item.due_date || '',
    })),
    chartAccounts:chartAccountsResult.error ? [] : (chartAccountsResult.data || []),
  })
}

function mapProceduresRows(userId, data) {
  return data.procedures.map(item => ({
    id:item.id,
    user_id:userId,
    name:item.name,
    price:item.price || 0,
    duration_hours:item.durationHours || 0,
    color:item.color || null,
    description:item.desc || null,
    checklist:item.checklist || [],
    ...(data.chartAccounts?.length ? { chart_account_id:item.chartAccountId || null } : {}),
  }))
}

function mapProductsRows(userId, data) {
  return data.products.map(item => ({
    id:item.id,
    user_id:userId,
    name:item.name,
    category:item.category || 'outros',
    description:item.description || null,
    purchase_price:item.purchasePrice || 0,
    sale_price:item.salePrice || 0,
    opening_stock:item.stock || 0,
    active:item.active !== false,
  }))
}

function mapSurgeriesRows(userId, data) {
  return data.surgeries.map(item => ({
    id:item.id,
    user_id:userId,
    procedure_id:item.procedureId || null,
    patient:item.patient || '',
    patient_id:item.patientId || null,
    total_value:item.totalValue || 0,
    date:item.date,
    competence_date:item.competenceDate || item.date || null,
    due_date:item.dueDate || item.date || null,
    start_time:item.startTime || null,
    duration_minutes:Number(item.durationMinutes) || null,
    payment_method:item.paymentMethod || null,
    payment_status:item.paymentStatus || 'pendente',
    surgeon:item.surgeon || null,
    payment_date:item.paymentDate || null,
    hospital_cost:item.hospitalCost || 0,
    anesthesia_cost:item.anesthesiaCost || 0,
    material_cost:item.materialCost || 0,
    other_costs:item.otherCosts || 0,
    invoice_issuance_percent:item.invoiceIssuancePercent || 0,
    cost_settlements:item.costSettlements || {},
    notes:item.notes || null,
  }))
}

function mapConsultationsRows(userId, data) {
  return data.consultations.map(item => ({
    id:item.id,
    user_id:userId,
    patient:item.patient || '',
    patient_id:item.patientId || null,
    date:item.date,
    competence_date:item.competenceDate || item.date || null,
    due_date:item.dueDate || item.forecastPaymentDate || item.date || null,
    start_time:item.startTime || null,
    duration_minutes:Number(item.durationMinutes) || null,
    consultation_type:item.consultationType || 'avaliacao',
    value:item.value || 0,
    payment_type:item.paymentType || 'particular',
    payment_method:item.paymentMethod || null,
    invoice_issuance_percent:item.invoiceIssuancePercent || 0,
    cost_settlements:item.costSettlements || {},
    insurance:item.insurance || null,
    payment_status:item.paymentStatus || 'pendente',
    forecast_payment_date:item.forecastPaymentDate || null,
    payment_date:item.paymentDate || null,
  }))
}

function mapProductSalesRows(userId, data) {
  return data.productSales.map(item => ({
    id:item.id,
    user_id:userId,
    product_id:item.productId,
    patient_name:item.patientName || null,
    patient_id:item.patientId || null,
    status:item.paymentStatus || 'recebido',
    quantity:item.quantity || 0,
    unit_value:item.unitValue || 0,
    total_value:item.totalValue || 0,
    sale_date:item.saleDate,
    competence_date:item.competenceDate || item.saleDate || null,
    due_date:item.dueDate || item.saleDate || null,
    received_date:item.receivedDate || null,
    payment_method:item.paymentMethod || null,
  }))
}

function mapProductPurchasesRows(userId, data) {
  return data.productPurchases.map(item => ({
    id:item.id,
    user_id:userId,
    product_id:item.productId,
    quantity:item.quantity || 0,
    total_value:item.totalValue || 0,
    supplier:item.supplier || null,
    supplier_id:item.supplierId || null,
    status:item.status || 'pago',
    payment_date:item.paymentDate || null,
    document_number:item.documentNumber || null,
    purchase_date:item.purchaseDate,
    competence_date:item.competenceDate || item.purchaseDate || null,
    due_date:item.dueDate || item.purchaseDate || null,
  }))
}

function mapExpensesRows(userId, data) {
  return data.expenses.map(item => ({
    id:item.id,
    user_id:userId,
    description:item.description,
    category:item.category || 'outros',
    value:item.value || 0,
    due_date:item.dueDate,
    competence_date:item.competenceDate || item.dueDate || null,
    payment_date:item.paymentDate || null,
    status:item.status || 'aberto',
    supplier_id:item.supplierId || null,
    cost_center:item.costCenter || null,
    origin_label:item.originLabel || null,
    ...(item.chartAccountId ? { chart_account_id:item.chartAccountId } : {}),
  }))
}

function mapBalanceRows(userId, items) {
  return items.map(item => ({
    id:item.id,
    user_id:userId,
    name:item.name,
    category:item.category || 'outros',
    value:item.value || 0,
    notes:item.notes || null,
  }))
}

function mapGoalsRows(userId, data) {
  return data.goals.map(item => ({
    id:item.id,
    user_id:userId,
    name:item.name,
    metric:item.metric || 'faturamento',
    target:item.target || 0,
    period:item.period || 'mensal',
    due_date:item.dueDate || null,
  }))
}

// computeIdsToDelete vem de ./financeSync.js (puro, testável). Apaga SOMENTE o que o cliente
// conhecia (baseline) e removeu — nunca por diferença contra o banco (concorrência/estado defasado).
async function syncTable(table, userId, rows, baselineRows) {
  const baselineIds = Array.isArray(baselineRows) ? new Set(baselineRows.map(row => row.id)) : null
  const idsToDelete = computeIdsToDelete(baselineIds, rows)
  const rowsToUpsert = computeRowsToUpsert(baselineRows, rows)

  if (idsToDelete.length > 0) {
    // SOFT-DELETE: nunca apaga fisicamente — marca archived_at. Exclusão fica reversível
    // (recuperável por SQL/admin), como já é em pacientes/prontuário. Se a coluna archived_at
    // ainda não existir, este UPDATE falha com segurança (a exclusão não propaga, mas NADA é perdido).
    const { error } = await supabase.from(table)
      .update({ archived_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('id', idsToDelete)
    if (error) throw error
  }

  if (rowsToUpsert.length > 0) {
    // READ-BACK (blindagem Fase 2): o upsert devolve os ids gravados; confirmamos que CADA linha
    // enviada voltou. Se alguma não voltar (ex.: rejeitada por RLS/escopo), erramos ALTO em vez de
    // dar a gravação como sucesso — o banner de erro aparece e o dado fica pendente para retry.
    // EM LOTES de 500: o PostgREST corta o retorno em ~1000 linhas; sem lotes, uma tabela grande
    // (>1000) devolveria ids truncados e o read-back acusaria perda FALSA, travando todo save.
    const CHUNK = 500
    for (let i = 0; i < rowsToUpsert.length; i += CHUNK) {
      const batch = rowsToUpsert.slice(i, i + CHUNK)
      const { data: saved, error } = await supabase.from(table).upsert(batch).select('id')
      if (error) throw error
      const missing = missingRowIds(batch, saved)
      if (missing.length > 0) {
        throw new Error(`Gravação não confirmada em ${table}: ${missing.length} registro(s) não persistiram.`)
      }
    }
  }
}

async function insertAuditLog(userId, action, details = {}) {
  const { error } = await supabase.from('audit_logs').insert({
    user_id:userId,
    actor_id:userId,
    action,
    entity_type:'finance_dataset',
    details,
  })

  if (error && !isIgnorableAuditLogError(error)) throw error
}

export async function fetchFinanceData(userId) {
  if (await canUseRelationalBackend()) {
    return fetchRelationalData(userId)
  }

  return fetchLegacyPayload(userId)
}

export async function saveFinanceData(userId, financeData, baselineData = null) {
  const payload = normalizeData(financeData)

  // 🔒 Trava de fidedignidade: um dataset TOTALMENTE vazio quase nunca é intencional e, no modo
  // relacional, o syncTable apagaria TODAS as linhas do usuário (delete-sync). Já causou perda de
  // lançamentos (carga falha/rascunho vazio -> autosave vazio -> wipe). Nunca persistir vazio.
  if (isDataEmpty(payload)) {
    return
  }

  if (!(await canUseRelationalBackend())) {
    const { error } = await supabase
      .from('user_finance_data')
      .upsert(
        {
          user_id:userId,
          payload,
          updated_at:new Date().toISOString(),
        },
        { onConflict:'user_id' },
      )

    if (error) throw error
    return
  }

  // baselineData = o que ESTE cliente tinha persistido/carregado antes desta gravação.
  // A deleção é calculada contra ele (não contra o banco), para nunca apagar linhas que o
  // cliente não conhecia (outro usuário da clínica, estado defasado). Sem baseline → só upsert.
  const base = baselineData ? normalizeData(baselineData) : null
  const tables = [
    ['procedures',        p => mapProceduresRows(userId, p)],
    ['products',          p => mapProductsRows(userId, p)],
    ['surgeries',         p => mapSurgeriesRows(userId, p)],
    ['consultations',     p => mapConsultationsRows(userId, p)],
    ['product_sales',     p => mapProductSalesRows(userId, p)],
    ['product_purchases', p => mapProductPurchasesRows(userId, p)],
    ['extra_revenues',    p => mapExtraRevenuesRows(userId, p)],
    ['expenses',          p => mapExpensesRows(userId, p)],
    ['assets',            p => mapBalanceRows(userId, p.assets)],
    ['liabilities',       p => mapBalanceRows(userId, p.liabilities)],
    ['goals',             p => mapGoalsRows(userId, p)],
  ]

  try {
    await Promise.all(tables.map(([table, mapRows]) => {
      const baselineRows = base ? mapRows(base) : null
      return syncTable(table, userId, mapRows(payload), baselineRows)
    }))
    // Write-through idempotente depois das origens operacionais. Títulos e parcelas removidos da
    // origem são apenas arquivados, nunca apagados fisicamente.
    await syncFinancialLedger(supabase, userId, payload, base)
  } catch (syncError) {
    relationalBackendAvailable = null
    relationalBackendCheckedAt = 0
    throw syncError
  }
  await insertAuditLog(userId, 'sync_finance_data', { records:RELATIONAL_TABLES.length })
}

export async function importLegacyDataIfNeeded(user, ownerId = user.id) {
  const alreadyMigrated = localStorage.getItem(migratedKey(user.id)) === '1'
  const remoteData = await fetchFinanceData(ownerId)

  if (!isDataEmpty(remoteData) || alreadyMigrated) {
    return remoteData
  }

  const legacyRemote = await fetchLegacyPayload(ownerId)
  const localUserData = getLocalUserDataByEmail(user.email)
  const legacyAppData = readJson(LEGACY_APP_KEY, null)
  const importCandidate = !isDataEmpty(normalizeData(legacyRemote))
    ? legacyRemote
    : !isDataEmpty(normalizeData(localUserData))
      ? localUserData
      : legacyAppData

  if (!importCandidate) {
    localStorage.setItem(migratedKey(user.id), '1')
    return remoteData
  }

  const normalized = normalizeData(importCandidate)
  if (isDataEmpty(normalized)) {
    localStorage.setItem(migratedKey(user.id), '1')
    return remoteData
  }

  await saveFinanceData(ownerId, normalized)
  localStorage.setItem(migratedKey(user.id), '1')
  return normalized
}

const IMPORTABLE_COLLECTIONS = ['procedures', 'products', 'surgeries', 'consultations', 'productSales', 'productPurchases', 'extraRevenues', 'expenses', 'assets', 'liabilities', 'goals']

// BLINDAGEM (Fase 2): importa, SOB DEMANDA, os dados que ficaram presos no localStorage DESTE
// navegador para a nuvem — MERGE por id (só adiciona o que falta; nunca apaga nem sobrescreve o
// que já está no servidor). Serve para recuperar lançamentos antigos que nunca subiram. Diferente
// do importLegacyDataIfNeeded, roda mesmo com a nuvem já tendo dados (não depende de estar vazia).
export async function forceImportBrowserData(user, ownerId = user?.id) {
  if (!user?.id || !ownerId) return { error: 'Clínica não identificada para importar.' }
  // SÓ o dado DESTE usuário (por e-mail). Não usa a chave legada global (LEGACY_APP_KEY) para não
  // importar lançamentos de OUTRA conta num navegador compartilhado.
  const localUserData = getLocalUserDataByEmail(user.email)
  const candidate = !isDataEmpty(normalizeData(localUserData)) ? localUserData : null
  if (!candidate) return { imported: 0, message: 'Nenhum dado antigo deste usuário encontrado neste navegador.' }

  const incoming = normalizeData(candidate)
  const current = normalizeData(await fetchFinanceData(ownerId))
  const merged = { ...current }
  let added = 0
  for (const key of IMPORTABLE_COLLECTIONS) {
    const res = mergeById(current[key], incoming[key])
    merged[key] = res.merged
    added += res.added
  }
  if (added === 0) return { imported: 0, message: 'Nada novo para importar — este navegador não tem lançamentos fora da nuvem.' }
  await saveFinanceData(ownerId, merged, current) // baseline = current → só upsert, nunca apaga
  return { imported: added, message: `${added} lançamento(s) importado(s) deste navegador para a nuvem.` }
}

function isIgnorableAuditLogError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code === '42P01'
    || code === 'PGRST204'
    || message.includes('audit_logs')
    || message.includes('schema cache')
}

