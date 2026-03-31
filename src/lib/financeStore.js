import { createEmptyData, isDataEmpty, normalizeData } from '../dataModel.js'
import { supabase } from './supabase.js'

const LEGACY_APP_KEY = 'startupfinance_v1'
const LOCAL_USERS_KEY = 'startupfinance_users_v1'
const LOCAL_DATA_PREFIX = 'startupfinance_user_data_v1'
const MIGRATION_PREFIX = 'startupfinance_migrated_user_v1'
let relationalBackendAvailable = null
let consultationsPaymentMethodColumnAvailable = null
let surgeriesInvoiceIssuanceColumnAvailable = null
let consultationsInvoiceIssuanceColumnAvailable = null

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
  if (relationalBackendAvailable !== null) return relationalBackendAvailable
  const { error } = await supabase.from('procedures').select('id').limit(1)
  relationalBackendAvailable = !error
  return relationalBackendAvailable
}

async function canUseConsultationsPaymentMethodColumn() {
  if (consultationsPaymentMethodColumnAvailable !== null) return consultationsPaymentMethodColumnAvailable
  const { error } = await supabase.from('consultations').select('payment_method').limit(1)
  consultationsPaymentMethodColumnAvailable = !error
  return consultationsPaymentMethodColumnAvailable
}

async function canUseSurgeriesInvoiceIssuanceColumn() {
  if (surgeriesInvoiceIssuanceColumnAvailable !== null) return surgeriesInvoiceIssuanceColumnAvailable
  const { error } = await supabase.from('surgeries').select('invoice_issuance_percent').limit(1)
  surgeriesInvoiceIssuanceColumnAvailable = !error
  return surgeriesInvoiceIssuanceColumnAvailable
}

async function canUseConsultationsInvoiceIssuanceColumn() {
  if (consultationsInvoiceIssuanceColumnAvailable !== null) return consultationsInvoiceIssuanceColumnAvailable
  const { error } = await supabase.from('consultations').select('invoice_issuance_percent').limit(1)
  consultationsInvoiceIssuanceColumnAvailable = !error
  return consultationsInvoiceIssuanceColumnAvailable
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

  return normalizeData({
    procedures:(proceduresResult.data || []).map(item => ({
      id:item.id,
      name:item.name,
      price:Number(item.price || 0),
      durationHours:Number(item.duration_hours || 0),
      color:item.color || '',
      desc:item.description || '',
      checklist:Array.isArray(item.checklist) ? item.checklist : [],
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
      totalValue:Number(item.total_value || 0),
      date:item.date || '',
      paymentMethod:item.payment_method || 'pix',
      paymentStatus:item.payment_status || 'pendente',
      surgeon:item.surgeon || '',
      paymentDate:item.payment_date || '',
      hospitalCost:Number(item.hospital_cost || 0),
      anesthesiaCost:Number(item.anesthesia_cost || 0),
      materialCost:Number(item.material_cost || 0),
      otherCosts:Number(item.other_costs || 0),
      invoiceIssuancePercent:Number(item.invoice_issuance_percent || 0),
      notes:item.notes || '',
    })),
    consultations:(consultationsResult.data || []).map(item => ({
      id:item.id,
      patient:item.patient || '',
      date:item.date || '',
      consultationType:item.consultation_type || 'avaliacao',
      value:Number(item.value || 0),
      paymentType:item.payment_type || 'particular',
      paymentMethod:item.payment_method || 'pix',
      invoiceIssuancePercent:Number(item.invoice_issuance_percent || 0),
      insurance:item.insurance || '',
      paymentStatus:item.payment_status || 'pendente',
      forecastPaymentDate:item.forecast_payment_date || '',
      paymentDate:item.payment_date || '',
    })),
    productSales:(productSalesResult.data || []).map(item => ({
      id:item.id,
      productId:item.product_id,
      patientName:item.patient_name || '',
      quantity:Number(item.quantity || 0),
      unitValue:Number(item.unit_value || 0),
      totalValue:Number(item.total_value || 0),
      saleDate:item.sale_date || '',
      paymentMethod:item.payment_method || 'pix',
    })),
    productPurchases:(productPurchasesResult.data || []).map(item => ({
      id:item.id,
      productId:item.product_id,
      quantity:Number(item.quantity || 0),
      totalValue:Number(item.total_value || 0),
      supplier:item.supplier || '',
      purchaseDate:item.purchase_date || '',
    })),
    extraRevenues:(extraRevenuesResult.data || []).map(item => ({
      id:item.id,
      description:item.description || '',
      category:item.category || 'outras_receitas',
      value:Number(item.value || 0),
      date:item.date || '',
    })),
    expenses:(expensesResult.data || []).map(item => ({
      id:item.id,
      description:item.description || '',
      category:item.category || 'outros',
      value:Number(item.value || 0),
      dueDate:item.due_date || '',
      paymentDate:item.payment_date || '',
      status:item.status || 'aberto',
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

function mapSurgeriesRows(userId, data, options = {}) {
  const includeInvoiceIssuancePercent = options.includeInvoiceIssuancePercent === true
  return data.surgeries.map(item => ({
    id:item.id,
    user_id:userId,
    procedure_id:item.procedureId || null,
    patient:item.patient || '',
    total_value:item.totalValue || 0,
    date:item.date,
    payment_method:item.paymentMethod || null,
    payment_status:item.paymentStatus || 'pendente',
    surgeon:item.surgeon || null,
    payment_date:item.paymentDate || null,
    hospital_cost:item.hospitalCost || 0,
    anesthesia_cost:item.anesthesiaCost || 0,
    material_cost:item.materialCost || 0,
    other_costs:item.otherCosts || 0,
    ...(includeInvoiceIssuancePercent ? { invoice_issuance_percent:item.invoiceIssuancePercent || 0 } : {}),
    notes:item.notes || null,
  }))
}

function mapConsultationsRows(userId, data, options = {}) {
  const includePaymentMethod = options.includePaymentMethod === true
  const includeInvoiceIssuancePercent = options.includeInvoiceIssuancePercent === true
  return data.consultations.map(item => ({
    id:item.id,
    user_id:userId,
    patient:item.patient || '',
    date:item.date,
    consultation_type:item.consultationType || 'avaliacao',
    value:item.value || 0,
    payment_type:item.paymentType || 'particular',
    ...(includePaymentMethod ? { payment_method:item.paymentMethod || null } : {}),
    ...(includeInvoiceIssuancePercent ? { invoice_issuance_percent:item.invoiceIssuancePercent || 0 } : {}),
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
    quantity:item.quantity || 0,
    unit_value:item.unitValue || 0,
    total_value:item.totalValue || 0,
    sale_date:item.saleDate,
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
    purchase_date:item.purchaseDate,
  }))
}

function mapExtraRevenuesRows(userId, data) {
  return data.extraRevenues.map(item => ({
    id:item.id,
    user_id:userId,
    description:item.description,
    category:item.category || 'outras_receitas',
    value:item.value || 0,
    date:item.date,
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
    payment_date:item.paymentDate || null,
    status:item.status || 'aberto',
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

async function syncTable(table, userId, rows) {
  const { data: existing, error: existingError } = await supabase.from(table).select('id').eq('user_id', userId)
  if (existingError) throw existingError

  const nextIds = new Set(rows.map(item => item.id))
  const idsToDelete = (existing || []).map(item => item.id).filter(id => !nextIds.has(id))

  if (idsToDelete.length > 0) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId).in('id', idsToDelete)
    if (error) throw error
  }

  if (rows.length > 0) {
    const { error } = await supabase.from(table).upsert(rows)
    if (error) throw error
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

export async function saveFinanceData(userId, financeData) {
  const payload = normalizeData(financeData)

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

  await syncTable('procedures', userId, mapProceduresRows(userId, payload))
  await syncTable('products', userId, mapProductsRows(userId, payload))
  const includeSurgeriesInvoiceIssuancePercent = await canUseSurgeriesInvoiceIssuanceColumn()
  await syncTable('surgeries', userId, mapSurgeriesRows(userId, payload, { includeInvoiceIssuancePercent:includeSurgeriesInvoiceIssuancePercent }))
  const includeConsultationsPaymentMethod = await canUseConsultationsPaymentMethodColumn()
  const includeConsultationsInvoiceIssuancePercent = await canUseConsultationsInvoiceIssuanceColumn()
  await syncTable('consultations', userId, mapConsultationsRows(userId, payload, { includePaymentMethod:includeConsultationsPaymentMethod, includeInvoiceIssuancePercent:includeConsultationsInvoiceIssuancePercent }))
  await syncTable('product_sales', userId, mapProductSalesRows(userId, payload))
  await syncTable('product_purchases', userId, mapProductPurchasesRows(userId, payload))
  await syncTable('extra_revenues', userId, mapExtraRevenuesRows(userId, payload))
  await syncTable('expenses', userId, mapExpensesRows(userId, payload))
  await syncTable('assets', userId, mapBalanceRows(userId, payload.assets))
  await syncTable('liabilities', userId, mapBalanceRows(userId, payload.liabilities))
  await syncTable('goals', userId, mapGoalsRows(userId, payload))
  await insertAuditLog(userId, 'sync_finance_data', { records:RELATIONAL_TABLES.length })
}

export async function importLegacyDataIfNeeded(user) {
  const alreadyMigrated = localStorage.getItem(migratedKey(user.id)) === '1'
  const remoteData = await fetchFinanceData(user.id)

  if (!isDataEmpty(remoteData) || alreadyMigrated) {
    return remoteData
  }

  const legacyRemote = await fetchLegacyPayload(user.id)
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

  await saveFinanceData(user.id, normalized)
  localStorage.setItem(migratedKey(user.id), '1')
  return normalized
}

function isIgnorableAuditLogError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code === '42P01'
    || code === 'PGRST204'
    || message.includes('audit_logs')
    || message.includes('schema cache')
}
