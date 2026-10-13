import { normalizeChartAccount } from './chartOfAccounts.js'

const SECTION_DEFINITIONS = [
  {
    id:'gross_revenue',
    label:'Receita bruta',
    natures:['revenue'],
    detailKeys:['grossRevenue'],
    value:metrics => Number(metrics.grossRevenue || 0),
    tone:'revenue',
  },
  {
    id:'revenue_deductions',
    label:'Deduções da receita',
    natures:['revenue_deduction'],
    detailKeys:['revenueDeductions'],
    value:metrics => Number(metrics.revenueDeductions || 0),
    tone:'expense',
  },
  {
    id:'direct_costs',
    label:'Custos diretos e CMV',
    natures:['direct_cost'],
    detailKeys:['surgeryCostTotal', 'consultationCostTotal', 'productCostOfSales', 'additionalDirectCosts'],
    value:metrics => Number(metrics.surgeryCostTotal || 0)
      + Number(metrics.consultationCostTotal || 0)
      + Number(metrics.productCostOfSales || 0)
      + Number(metrics.additionalDirectCosts || 0),
    tone:'expense',
  },
  {
    id:'operating_expenses',
    label:'Despesas operacionais',
    natures:['operating_expense', 'depreciation'],
    detailKeys:['operationalExpenses'],
    value:metrics => Number(metrics.operationalExpenses || 0),
    tone:'expense',
  },
  {
    id:'financial_result',
    label:'Resultado financeiro',
    natures:['financial_revenue', 'financial_expense'],
    detailKeys:['financialRevenue', 'financialExpenses'],
    value:metrics => Number(metrics.financialRevenue || 0) - Number(metrics.financialExpenses || 0),
    tone:'result',
  },
  {
    id:'income_taxes',
    label:'Tributos sobre o lucro',
    natures:['income_tax'],
    detailKeys:['taxExpenses'],
    value:metrics => Number(metrics.taxExpenses || 0),
    tone:'expense',
  },
]

const normalizeText = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const number = value => Number(value || 0)

function signedFinancialValue(detail, account) {
  const nature = account?.nature || detail.accountNature || ''
  return number(detail.value) * (nature === 'financial_expense' || detail.direction === 'payable' ? -1 : 1)
}

function collectDetails(metrics, keys) {
  return keys.flatMap(key => metrics?.drilldowns?.[key] || [])
}

function createAccountTree(accounts, relevantAccountIds, detailsByAccount, sectionId) {
  const byId = new Map(accounts.map(account => [account.id, account]))
  const includedIds = new Set(relevantAccountIds)

  relevantAccountIds.forEach(accountId => {
    let current = byId.get(accountId)
    const seen = new Set()
    while (current?.parentId && !seen.has(current.parentId)) {
      seen.add(current.parentId)
      includedIds.add(current.parentId)
      current = byId.get(current.parentId)
    }
  })

  const childrenByParent = new Map()
  accounts.forEach(account => {
    if (!includedIds.has(account.id)) return
    const parentId = account.parentId && includedIds.has(account.parentId) ? account.parentId : '__root__'
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, [])
    childrenByParent.get(parentId).push(account)
  })

  const sortAccounts = rows => rows.sort((left, right) =>
    left.sortOrder - right.sortOrder
      || left.code.localeCompare(right.code, 'pt-BR', { numeric:true })
      || left.name.localeCompare(right.name, 'pt-BR'))

  function visit(parentId = '__root__') {
    return sortAccounts(childrenByParent.get(parentId) || []).map(account => {
      const children = visit(account.id)
      const ownDetails = detailsByAccount.get(account.id) || []
      const descendantDetails = children.flatMap(child => child.details)
      const details = [...ownDetails, ...descendantDetails]
      const value = sectionId === 'financial_result'
        ? details.reduce((sum, detail) => sum + signedFinancialValue(detail, byId.get(detail.chartAccountId)), 0)
        : details.reduce((sum, detail) => sum + number(detail.value), 0)
      return {
        key:`account:${account.id}`,
        type:account.nodeType,
        accountId:account.id,
        code:account.code,
        label:account.name,
        nature:account.nature,
        isActive:account.isActive,
        value,
        details,
        children,
      }
    })
  }

  return visit()
}

function unwrapSectionRoot(nodes, sectionLabel) {
  const normalizedLabel = normalizeText(sectionLabel)
  return nodes.flatMap(node => {
    if (node.type === 'group' && normalizeText(node.label) === normalizedLabel) return node.children
    return [node]
  })
}

function buildSection(accounts, metrics, definition) {
  const details = collectDetails(metrics, definition.detailKeys)
  const detailsByAccount = new Map()
  const unlinkedDetails = []

  details.forEach(detail => {
    if (!detail.chartAccountId) {
      unlinkedDetails.push(detail)
      return
    }
    if (!detailsByAccount.has(detail.chartAccountId)) detailsByAccount.set(detail.chartAccountId, [])
    detailsByAccount.get(detail.chartAccountId).push(detail)
  })

  const expectedNatures = new Set(definition.natures)
  const accountIdsWithDetails = new Set(detailsByAccount.keys())
  const relevantAccountIds = new Set(accounts
    .filter(account => account.nodeType === 'account'
      && (expectedNatures.has(account.nature) || accountIdsWithDetails.has(account.id)))
    .map(account => account.id))

  const accountNodes = unwrapSectionRoot(
    createAccountTree(accounts, relevantAccountIds, detailsByAccount, definition.id),
    definition.label,
  )

  if (unlinkedDetails.length) {
    const value = definition.id === 'financial_result'
      ? unlinkedDetails.reduce((sum, detail) => sum + signedFinancialValue(detail), 0)
      : unlinkedDetails.reduce((sum, detail) => sum + number(detail.value), 0)
    accountNodes.push({
      key:`unlinked:${definition.id}`,
      type:'account',
      accountId:null,
      code:'',
      label:'Sem conta vinculada',
      nature:'unclassified',
      isActive:true,
      value,
      details:unlinkedDetails,
      children:[],
    })
  }

  return {
    key:`section:${definition.id}`,
    type:'section',
    sectionId:definition.id,
    label:definition.label,
    tone:definition.tone,
    value:definition.value(metrics),
    details,
    children:accountNodes,
  }
}

function signedDetails(rows, sign) {
  return (rows || []).map(row => ({ ...row, value:number(row.value) * sign }))
}

function subtotal(key, label, value, details, tone = 'subtotal') {
  return { key:`subtotal:${key}`, type:'subtotal', label, value, details, tone, children:[] }
}

export function buildDrePresentation(chartAccounts = [], metrics = {}) {
  const accounts = chartAccounts.map(normalizeChartAccount)
  if (!accounts.length) return []

  const sections = Object.fromEntries(SECTION_DEFINITIONS.map(definition => [
    definition.id,
    buildSection(accounts, metrics, definition),
  ]))
  const directCostDetails = sections.direct_costs.details
  const grossProfit = number(metrics.netRevenue) - sections.direct_costs.value
  const grossProfitDetails = [
    ...(metrics.drilldowns?.netRevenue || []),
    ...signedDetails(directCostDetails, -1),
  ]

  return [
    sections.gross_revenue,
    sections.revenue_deductions,
    subtotal('net_revenue', 'Receita líquida', number(metrics.netRevenue), metrics.drilldowns?.netRevenue || []),
    sections.direct_costs,
    subtotal('gross_profit', 'Lucro bruto', grossProfit, grossProfitDetails),
    sections.operating_expenses,
    subtotal('operating_profit', 'Lucro operacional', number(metrics.operatingProfit), metrics.drilldowns?.operatingProfit || []),
    sections.financial_result,
    subtotal('profit_before_tax', 'Lucro antes dos tributos', number(metrics.profitBeforeTax), metrics.drilldowns?.profitBeforeTax || []),
    sections.income_taxes,
    subtotal('net_profit', 'Lucro líquido', number(metrics.netProfit), metrics.drilldowns?.netProfit || [], 'net'),
  ]
}

export function flattenVisibleDreRows(rows = [], expandedKeys = new Set()) {
  const visible = []
  function visit(items, depth = 0, inheritedTone = '') {
    items.forEach(item => {
      const tone = item.tone || inheritedTone
      visible.push({ ...item, tone, depth })
      if (item.children?.length && expandedKeys.has(item.key)) visit(item.children, depth + 1, tone)
    })
  }
  visit(rows)
  return visible
}

export function defaultExpandedDreKeys(rows = []) {
  return rows.filter(row => row.type === 'section').map(row => row.key)
}
