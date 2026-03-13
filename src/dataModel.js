export function createEmptyData() {
  return {
    procedures: [],
    surgeries: [],
    consultations: [],
    products: [],
    productSales: [],
    productPurchases: [],
    extraRevenues: [],
    expenses: [],
    assets: [],
    liabilities: [],
    goals: [],
  }
}

export function normalizeData(data) {
  const procedureIdMap = new Map()
  const productIdMap = new Map()

  const procedures = Array.isArray(data?.procedures)
    ? data.procedures.map(plan => ({
        ...plan,
        id:normalizeUuid(plan.id, 'procedure', procedureIdMap),
      }))
    : Array.isArray(data?.plans)
      ? data.plans.map(plan => ({
          id:normalizeUuid(plan.id, 'procedure', procedureIdMap),
          name:plan.name,
          price:plan.price || 0,
          durationHours:plan.durationHours || 3,
          color:plan.color,
          desc:plan.desc || '',
          checklist:Array.isArray(plan.features) ? plan.features : [],
        }))
      : []

  const surgeries = Array.isArray(data?.surgeries)
    ? data.surgeries.map(item => ({
        ...item,
        id:normalizeUuid(item.id, 'surgery'),
        procedureId:normalizeRelatedId(item.procedureId, 'procedure', procedureIdMap),
      }))
    : Array.isArray(data?.sales)
      ? data.sales.map(sale => ({
          id:normalizeUuid(sale.id, 'surgery'),
          patient:sale.client || '',
          procedureId:normalizeRelatedId(sale.plan, 'procedure', procedureIdMap),
          totalValue:sale.value || 0,
          date:sale.date || '',
          paymentMethod:sale.paymentMethod || 'pix',
          paymentStatus:sale.status === 'ativo' ? 'pago' : 'pendente',
          surgeon:sale.surgeon || '',
          hospitalCost:sale.hospitalCost || 0,
          anesthesiaCost:sale.anesthesiaCost || 0,
          materialCost:sale.materialCost || 0,
          otherCosts:sale.otherCosts || 0,
          notes:sale.notes || '',
        }))
      : []

  const products = Array.isArray(data?.products)
    ? data.products.map(item => ({
        ...item,
        id:normalizeUuid(item.id, 'product', productIdMap),
      }))
    : []

  return {
    procedures,
    surgeries,
    consultations: Array.isArray(data?.consultations) ? data.consultations.map(item => ({
      ...item,
      id:normalizeUuid(item.id, 'consultation'),
    })) : [],
    products,
    productSales: Array.isArray(data?.productSales) ? data.productSales.map(item => ({
      ...item,
      id:normalizeUuid(item.id, 'product_sale'),
      productId:normalizeRelatedId(item.productId, 'product', productIdMap),
    })) : [],
    productPurchases: Array.isArray(data?.productPurchases) ? data.productPurchases.map(item => ({
      ...item,
      id:normalizeUuid(item.id, 'product_purchase'),
      productId:normalizeRelatedId(item.productId, 'product', productIdMap),
    })) : [],
    extraRevenues: Array.isArray(data?.extraRevenues) ? data.extraRevenues.map(item => ({
      ...item,
      id:normalizeUuid(item.id, 'extra_revenue'),
    })) : [],
    expenses: Array.isArray(data?.expenses)
      ? data.expenses.map(expense => ({
          id:normalizeUuid(expense.id, 'expense'),
          description:expense.description || expense.desc || '',
          category:expense.category || 'outros',
          value:expense.value || 0,
          dueDate:expense.dueDate || expense.date || '',
          paymentDate:expense.paymentDate || expense.paidDate || '',
          status:expense.status || (expense.paymentDate ? 'pago' : 'aberto'),
        }))
      : [],
    assets: Array.isArray(data?.assets) ? data.assets.map(item => ({
      ...item,
      id:normalizeUuid(item.id, 'asset'),
    })) : [],
    liabilities: Array.isArray(data?.liabilities) ? data.liabilities.map(item => ({
      ...item,
      id:normalizeUuid(item.id, 'liability'),
    })) : [],
    goals: Array.isArray(data?.goals) ? data.goals.map(item => ({
      ...item,
      id:normalizeUuid(item.id, 'goal'),
    })) : [],
  }
}

export function isDataEmpty(data) {
  const normalized = normalizeData(data)
  return normalized.procedures.length === 0
    && normalized.surgeries.length === 0
    && normalized.consultations.length === 0
    && normalized.products.length === 0
    && normalized.productSales.length === 0
    && normalized.productPurchases.length === 0
    && normalized.extraRevenues.length === 0
    && normalized.expenses.length === 0
    && normalized.assets.length === 0
    && normalized.liabilities.length === 0
    && normalized.goals.length === 0
}

function normalizeRelatedId(value, namespace, map) {
  if (!value) return ''
  return normalizeUuid(value, namespace, map)
}

function normalizeUuid(value, namespace = 'id', cacheMap = null) {
  const raw = String(value || '').trim()
  if (!raw) return stableUuid(`${namespace}:empty:${Math.random()}`)
  if (UUID_RE.test(raw)) return raw.toLowerCase()
  if (cacheMap?.has(raw)) return cacheMap.get(raw)
  const next = stableUuid(`${namespace}:${raw}`)
  if (cacheMap) cacheMap.set(raw, next)
  return next
}

function stableUuid(seed) {
  const hex = [hashHex(`${seed}:a`), hashHex(`${seed}:b`), hashHex(`${seed}:c`), hashHex(`${seed}:d`)].join('').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function hashHex(input) {
  let hash = 2166136261
  const text = String(input)
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
