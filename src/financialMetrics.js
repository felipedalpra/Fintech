import { inRange, monthKey, onOrBefore, today } from './utils.js'
import { buildLedger } from './lib/financialLedger.js'
import { buildProductCosting } from './lib/inventoryCosting.js'
import { buildInventoryMovements, stockByProduct } from './lib/inventoryLedger.js'

export { paymentScheduleFlow } from './lib/paymentScheduleFlow.js'
export { generateRecurringOccurrences } from './lib/recurrenceSchedule.js'

function resolvePercent(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function invoiceIssuanceCost(baseValue, percentValue) {
  const base = Number.isFinite(Number(baseValue)) ? Number(baseValue) : 0
  return base * (resolvePercent(percentValue) / 100)
}

function surgeryCosts(item) {
  const invoiceTax = item.invoiceTaxAmount != null
    ? Number(item.invoiceTaxAmount || 0)
    : invoiceIssuanceCost(item.totalValue || 0, item.invoiceIssuancePercent || 0)
  return (item.hospitalCost || 0) + (item.anesthesiaCost || 0) + (item.materialCost || 0) + (item.otherCosts || 0) + invoiceTax
}

function consultationCosts(item) {
  return item.invoiceTaxAmount != null
    ? Number(item.invoiceTaxAmount || 0)
    : invoiceIssuanceCost(item.value || 0, item.invoiceIssuancePercent || 0)
}

function mapProcedureName(procedures, id) {
  return procedures.find(item => item.id === id)?.name || 'Sem procedimento'
}

function mapProduct(products, id) {
  return products.find(item => item.id === id)
}

function accumulateByMonth(target, date, value) {
  const key = monthKey(date)
  if (!key) return
  target[key] = (target[key] || 0) + (value || 0)
}

const LEDGER_COMPONENT_CATEGORY = {
  hospital_cost:'hospital',
  anesthesia_cost:'anestesia',
  material_cost:'material',
  other_cost:'outros',
  invoice_tax:'nota_fiscal',
}

function ledgerSourceMaps(data) {
  const asMap = rows => new Map((rows || []).map(item => [item.id, item]))
  return {
    surgery:asMap(data.surgeries),
    consultation:asMap(data.consultations),
    product_sale:asMap(data.productSales),
    product_purchase:asMap(data.productPurchases),
    extra_revenue:asMap(data.extraRevenues),
    expense:asMap(data.expenses),
    recurrence:asMap(data.recurrences),
  }
}

function ledgerPresentation(entry, source, data) {
  const products = data.products || []
  const procedures = data.procedures || []
  const cost = entry.source_component !== 'revenue'
  const type = entry.source_type
  const patient = entry.party_name_snapshot || source?.patient || source?.patientName || 'Paciente não informado'
  const product = mapProduct(products, source?.productId)

  if (cost && type === 'surgery') return {
    origin:'custo_cirurgico', source:'custo_cirurgico', category:LEDGER_COMPONENT_CATEGORY[entry.source_component] || 'outros',
    description:`Custo cirúrgico - ${patient}`, accountDescription:`Custo cirúrgico - ${patient}`,
  }
  if (cost && type === 'consultation') return {
    origin:'custo_consulta', source:'custo_consulta', category:'nota_fiscal_consulta',
    description:`Custo NF consulta - ${patient}`, accountDescription:`Custo NF consulta - ${patient}`,
  }
  if (type === 'surgery') return {
    origin:'cirurgia', source:'cirurgia', category:'cirurgia', description:`Cirurgia - ${patient}`,
    accountDescription:mapProcedureName(procedures, source?.procedureId),
  }
  if (type === 'consultation') return {
    origin:'consulta', source:'consulta', category:source?.paymentType || 'consulta', description:`Consulta - ${patient}`,
    accountDescription:source?.consultationType || 'Consulta',
  }
  if (type === 'product_sale') return {
    origin:'venda_produto', source:'venda_produto', category:'venda_produto',
    description:`Venda de produto - ${product?.name || 'Produto'}`, accountDescription:product?.name || 'Produto',
  }
  if (type === 'product_purchase') return {
    origin:'compra_produto', source:'compra_produto', category:'compra_produto',
    description:`Compra de produto - ${product?.name || 'Produto'}`, accountDescription:product?.name || 'Produto',
  }
  if (type === 'extra_revenue') return {
    origin:'outra_receita', source:'outra_receita', category:entry.category || source?.category || 'outras_receitas',
    description:source?.description || 'Receita', accountDescription:source?.description || 'Receita',
  }
  if (type === 'recurrence') {
    const isRevenue = entry.direction === 'receivable'
    return {
      origin:isRevenue ? 'recorrencia_receita' : 'recorrencia_despesa', source:'recorrencia',
      category:entry.category || (isRevenue ? 'outras_receitas' : 'outros'),
      description:source?.descricao || entry.party_name_snapshot || (isRevenue ? 'Receita recorrente' : 'Despesa recorrente'),
      accountDescription:source?.descricao || entry.party_name_snapshot || 'Recorrência',
    }
  }
  return {
    origin:'despesa', source:'despesa', category:entry.category || source?.category || 'outros',
    description:source?.description || 'Despesa', accountDescription:source?.description || 'Despesa',
  }
}

function buildLedgerProjection(data, { startDate, endDate, balanceDate, recurrenceFrom, recurrenceTo }) {
  const ledger = buildLedger(data, { recurrenceFrom, recurrenceTo })
  const sourceMaps = ledgerSourceMaps(data)
  const competenceEntries = ledger.entries.filter(entry =>
    entry.status !== 'canceled' && entry.competence_date && inRange(entry.competence_date, startDate, endDate))
  const entriesFinancial = []
  const exitsFinancial = []
  const accountsReceivable = []
  const accountsPayable = []
  const cumulativeEntries = []

  ledger.entries.forEach((entry, index) => {
    if (entry.status === 'canceled') return
    const rows = ledger.installments[index] || []
    const source = sourceMaps[entry.source_type]?.get(entry.source_id)
    const presentation = ledgerPresentation(entry, source, data)

    rows.forEach(row => {
      const paidValue = row.paid_amount != null ? Number(row.paid_amount || 0) : Number(row.amount || 0)
      const settledByBalance = row.status === 'paid' && row.settlement_date && onOrBefore(row.settlement_date, balanceDate)
      if (settledByBalance) {
        const cashRow = {
          id:`ledger-${entry.direction}-${entry.source_type}-${entry.source_id}-${entry.source_component}-${row.installment_number}`,
          description:rows.length > 1 ? `${presentation.description} (parcela ${row.installment_number}/${rows.length})` : presentation.description,
          category:presentation.category,
          value:paidValue,
          date:row.settlement_date,
          origin:presentation.origin,
          originLabel:source?.originLabel || '',
          referenceId:entry.source_id,
          sourceComponent:entry.source_component,
        }
        cumulativeEntries.push({ ...cashRow, type:entry.direction === 'receivable' ? 'entrada' : 'saida' })
        if (inRange(row.settlement_date, startDate, endDate)) {
          if (entry.direction === 'receivable') entriesFinancial.push(cashRow)
          else exitsFinancial.push(cashRow)
        }
      }
    })

    if (entry.issue_date && !onOrBefore(entry.issue_date, balanceDate)) return
    const openRows = rows.filter(row => !row.settlement_date || !onOrBefore(row.settlement_date, balanceDate))
    const openValue = openRows.reduce((sum, row) => {
      const paid = row.status === 'partially_paid' ? Number(row.paid_amount || 0) : 0
      return sum + Math.max(0, Number(row.amount || 0) - paid)
    }, 0)
    if (openValue <= 0) return
    const dueDates = openRows.map(row => row.due_date).filter(Boolean).sort()
    const rawStatus = source?.paymentStatus || source?.status
    const account = {
      id:`ledger-${entry.source_type}-${entry.source_id}-${entry.source_component}`,
      source:presentation.source,
      sourceId:entry.source_id,
      category:presentation.category,
      costCenter:entry.cost_center || '',
      value:openValue,
      competenceDate:entry.competence_date,
      dueDate:dueDates[0] || entry.issue_date,
      openInstallments:openRows.length,
      installmentsTotal:rows.length,
      status:rawStatus && !['pago', 'recebido'].includes(rawStatus) ? rawStatus : 'pendente',
      description:presentation.accountDescription,
    }
    if (entry.direction === 'receivable') {
      accountsReceivable.push({ ...account, patient:entry.party_name_snapshot || presentation.description })
    } else {
      accountsPayable.push({ ...account, supplier:entry.party_name_snapshot || presentation.description })
    }
  })

  const competenceDetails = competenceEntries.map(entry => {
    const source = sourceMaps[entry.source_type]?.get(entry.source_id)
    const presentation = ledgerPresentation(entry, source, data)
    return {
      id:`competence-${entry.source_type}-${entry.source_id}-${entry.source_component}`,
      date:entry.competence_date,
      competenceDate:entry.competence_date,
      dueDate:null,
      origin:presentation.origin,
      description:presentation.accountDescription || presentation.description,
      party:entry.party_name_snapshot || '',
      category:presentation.category || entry.category || '',
      status:entry.status,
      value:Number(entry.total_amount || 0),
      direction:entry.direction,
      sourceType:entry.source_type,
      sourceId:entry.source_id,
      sourceComponent:entry.source_component,
    }
  })

  return { ...ledger, competenceEntries, competenceDetails, entriesFinancial, exitsFinancial, accountsReceivable, accountsPayable, cumulativeEntries }
}

export function buildMetrics(rawData, options = {}) {
  const data = rawData || {}
  const procedures = data.procedures || []
  const surgeries = data.surgeries || []
  const consultations = data.consultations || []
  const products = data.products || []
  const productSales = data.productSales || []
  const productPurchases = data.productPurchases || []
  const extraRevenues = data.extraRevenues || []
  const expenses = data.expenses || []
  const assets = data.assets || []
  const liabilities = data.liabilities || []
  const goals = data.goals || []
  const startDate = options.startDate || ''
  const endDate = options.endDate || ''
  const balanceDate = options.balanceDate || endDate || today()
  const recurringRangeStart = startDate || endDate || today()
  const recurringRangeEnd = endDate || startDate || today()
  const recurringBalanceStart = startDate || `${new Date().getFullYear()}-01-01`

  // Regime de COMPETÊNCIA: a DRE/resultado reconhece o fato no mês de competência,
  // independente de quando o dinheiro entra (caixa) ou de quando vence (vencimento).
  const surgeriesInRange = surgeries.filter(item => item.paymentStatus !== 'cancelado' && (item.competenceDate || item.date) && inRange(item.competenceDate || item.date, startDate, endDate))
  const consultationsInRange = consultations.filter(item => item.paymentStatus !== 'cancelado' && (item.competenceDate || item.date) && inRange(item.competenceDate || item.date, startDate, endDate))
  const productSalesInRange = productSales.filter(item => item.paymentStatus !== 'cancelado' && (item.competenceDate || item.saleDate) && inRange(item.competenceDate || item.saleDate, startDate, endDate))
  const recurrenceFrom = [recurringRangeStart, recurringBalanceStart].filter(Boolean).sort()[0]
  const recurrenceTo = [recurringRangeEnd, balanceDate].filter(Boolean).sort().slice(-1)[0]

  // Fase 10: competência, caixa e obrigações passam a ler da projeção canônica do razão.
  // Recorrências também são títulos canônicos; ocorrências já materializadas são deduplicadas.
  const ledger = buildLedgerProjection(data, { startDate, endDate, balanceDate, recurrenceFrom, recurrenceTo })
  const sumLedger = predicate => ledger.competenceEntries
    .filter(predicate)
    .reduce((acc, entry) => acc + Number(entry.total_amount || 0), 0)
  const surgeryRevenue = sumLedger(entry => entry.source_type === 'surgery' && entry.source_component === 'revenue')
  const surgeryCostTotal = sumLedger(entry => entry.source_type === 'surgery' && entry.direction === 'payable')
  const surgeryNetRevenue = surgeryRevenue - surgeryCostTotal
  const consultationRevenue = sumLedger(entry => entry.source_type === 'consultation' && entry.source_component === 'revenue')
  const consultationCostTotal = sumLedger(entry => entry.source_type === 'consultation' && entry.direction === 'payable')
  const productSalesRevenue = sumLedger(entry => entry.source_type === 'product_sale' && entry.direction === 'receivable')
  const productPurchasesTotal = sumLedger(entry => entry.source_type === 'product_purchase' && entry.direction === 'payable')
  const productCosting = buildProductCosting(data)
  const productCostOfSales = productSalesInRange.reduce((acc, sale) => acc + Number(productCosting.salesCost[sale.id]?.totalCost || 0), 0)
  const productCostOfSalesDetails = productSalesInRange
    .map(sale => {
      const product = mapProduct(products, sale.productId)
      return {
        id:`cmv-${sale.id}`,
        date:sale.competenceDate || sale.saleDate,
        competenceDate:sale.competenceDate || sale.saleDate,
        origin:'cmv_produto',
        description:`CMV - ${product?.name || 'Produto'}`,
        party:sale.patientName || '',
        category:'cmv_produto',
        status:sale.paymentStatus || 'a_conferir',
        value:Number(productCosting.salesCost[sale.id]?.totalCost || 0),
        direction:'payable',
        sourceType:'product_sale',
        sourceId:sale.id,
        sourceComponent:'cost_of_sales',
        productId:sale.productId,
      }
    })
    .filter(item => item.value > 0)
  // Compatibilidade: consumidores antigos usam productPurchaseTotal como a linha de custo da DRE.
  // A partir da Fase 10, o campo representa CMV histórico; compras ficam em productPurchasesTotal.
  const productPurchaseTotal = productCostOfSales
  const recurringRevenueTotal = sumLedger(entry => entry.source_type === 'recurrence' && entry.direction === 'receivable')
  const extraRevenueTotal = sumLedger(entry => entry.source_type === 'extra_revenue' && entry.direction === 'receivable') + recurringRevenueTotal
  const grossRevenue = surgeryRevenue + consultationRevenue + productSalesRevenue + extraRevenueTotal

  const taxExpenses = sumLedger(entry => ['expense', 'recurrence'].includes(entry.source_type) && entry.direction === 'payable' && entry.category === 'impostos')
  const operationalExpenses = sumLedger(entry => ['expense', 'recurrence'].includes(entry.source_type) && entry.direction === 'payable' && entry.category !== 'impostos')
  const operatingProfit = grossRevenue - surgeryCostTotal - consultationCostTotal - productPurchaseTotal - operationalExpenses
  const netProfit = operatingProfit - taxExpenses

  const surgeriesCompleted = surgeriesInRange.filter(item => item.paymentStatus !== 'cancelado').length
  const consultationsCompleted = consultationsInRange.filter(item => item.paymentStatus !== 'cancelado').length
  const averageTicket = surgeriesCompleted > 0 ? surgeryRevenue / surgeriesCompleted : 0

  const entriesFinancial = [...ledger.entriesFinancial]
  const exitsFinancial = [...ledger.exitsFinancial]

  const cashFlowEntries = [...entriesFinancial.map(item => ({ ...item, type:'entrada' })), ...exitsFinancial.map(item => ({ ...item, type:'saida' }))].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const cashIn = entriesFinancial.reduce((acc, item) => acc + item.value, 0)
  const cashOut = exitsFinancial.reduce((acc, item) => acc + item.value, 0)
  const cashBalance = cashIn - cashOut

  const accountsReceivable = [...ledger.accountsReceivable]

  const accountsPayable = [...ledger.accountsPayable]

  const receivablesOpenTotal = accountsReceivable.reduce((acc, item) => acc + item.value, 0)
  const payablesOpenTotal = accountsPayable.reduce((acc, item) => acc + item.value, 0)

  const cumulativeEntries = [...ledger.cumulativeEntries]

  const cashAsset = cumulativeEntries.reduce((acc, item) => acc + (item.type === 'entrada' ? item.value : -item.value), 0)
  const bankAssets = assets.reduce((acc, item) => acc + (item.value || 0), 0)
  const inventoryDataAtBalance = {
    ...data,
    productPurchases:productPurchases.filter(item => onOrBefore(item.purchaseDate, balanceDate)),
    productSales:productSales.filter(item => onOrBefore(item.saleDate, balanceDate)),
  }
  const inventoryCostingAtBalance = buildProductCosting(inventoryDataAtBalance)
  const inventoryStockAtBalance = stockByProduct(buildInventoryMovements(inventoryDataAtBalance))
  const inventoryAsset = products.reduce((acc, product) => {
    const stock = Math.max(0, Number(inventoryStockAtBalance[product.id] || 0))
    return acc + stock * Number(inventoryCostingAtBalance.averageByProduct[product.id] || 0)
  }, 0)
  const liabilitiesTotal = liabilities.reduce((acc, item) => acc + (item.value || 0), 0) + payablesOpenTotal
  const assetsTotal = cashAsset + bankAssets + receivablesOpenTotal + inventoryAsset
  const equity = assetsTotal - liabilitiesTotal

  const byProcedure = procedures.map(procedure => {
    const items = surgeriesInRange.filter(item => item.procedureId === procedure.id)
    const revenue = items.reduce((acc, item) => acc + (item.totalValue || 0), 0)
    const costs = items.reduce((acc, item) => acc + surgeryCosts(item), 0)
    return { id:procedure.id, name:procedure.name, count:items.length, revenue, profit:revenue - costs }
  }).sort((a, b) => b.profit - a.profit)

  const productsByPerformance = products.map(product => {
    const sales = productSalesInRange.filter(item => item.productId === product.id)
    const soldQty = sales.reduce((acc, item) => acc + (item.quantity || 0), 0)
    const revenue = sales.reduce((acc, item) => acc + (item.totalValue || 0), 0)
    const cost = sales.reduce((acc, item) => acc + Number(productCosting.salesCost[item.id]?.totalCost || 0), 0)
    const stock = Number(inventoryStockAtBalance[product.id] || 0)
    return { id:product.id, name:product.name, revenue, cost, profit:revenue - cost, soldQty, stock }
  }).sort((a, b) => b.profit - a.profit)

  const expensesByCategory = ledger.competenceEntries
    .filter(entry => entry.source_type === 'expense' || (entry.source_type === 'recurrence' && entry.direction === 'payable'))
    .reduce((acc, entry) => {
    const key = entry.category || 'outros'
    acc[key] = (acc[key] || 0) + Number(entry.total_amount || 0)
    return acc
  }, {})

  const surgeriesByMonth = {}
  surgeriesInRange.forEach(item => {
    const key = monthKey(item.date)
    if (key) surgeriesByMonth[key] = (surgeriesByMonth[key] || 0) + 1
  })

  const consultationsByInsurance = consultationsInRange.reduce((acc, item) => {
    const key = item.paymentType === 'particular' ? 'Particular' : item.insurance || 'Outros convênios'
    if (!acc[key]) acc[key] = { count: 0, revenue: 0, cost: 0 }
    acc[key].count++
    acc[key].revenue += item.value || 0
    acc[key].cost += consultationCosts(item)
    return acc
  }, {})

  const revenueByMonth = {}
  const expenseByMonth = {}
  cashFlowEntries.forEach(item => {
    if (item.type === 'entrada') accumulateByMonth(revenueByMonth, item.date, item.value)
    if (item.type === 'saida') accumulateByMonth(expenseByMonth, item.date, item.value)
  })

  const detailRows = ledger.competenceDetails || []
  const pick = predicate => detailRows.filter(predicate)
  const signed = (rows, sign = 1) => rows.map(item => ({ ...item, value:Number(item.value || 0) * sign }))
  const revenueDetails = pick(entry => entry.direction === 'receivable')
  const surgeryRevenueDetails = pick(entry => entry.sourceType === 'surgery' && entry.sourceComponent === 'revenue')
  const surgeryCostDetails = pick(entry => entry.sourceType === 'surgery' && entry.direction === 'payable')
  const consultationRevenueDetails = pick(entry => entry.sourceType === 'consultation' && entry.sourceComponent === 'revenue')
  const consultationCostDetails = pick(entry => entry.sourceType === 'consultation' && entry.direction === 'payable')
  const productRevenueDetails = pick(entry => entry.sourceType === 'product_sale' && entry.direction === 'receivable')
  const productPurchaseDetails = pick(entry => entry.sourceType === 'product_purchase' && entry.direction === 'payable')
  const extraRevenueDetails = pick(entry => ['extra_revenue', 'recurrence'].includes(entry.sourceType) && entry.direction === 'receivable')
  const operationalExpenseDetails = pick(entry => ['expense', 'recurrence'].includes(entry.sourceType) && entry.direction === 'payable' && entry.category !== 'impostos')
  const taxExpenseDetails = pick(entry => ['expense', 'recurrence'].includes(entry.sourceType) && entry.direction === 'payable' && entry.category === 'impostos')
  const totalExpenseDetails = [...surgeryCostDetails, ...consultationCostDetails, ...productCostOfSalesDetails, ...operationalExpenseDetails, ...taxExpenseDetails]
  const operatingProfitDetails = [
    ...signed(revenueDetails),
    ...signed(surgeryCostDetails, -1),
    ...signed(consultationCostDetails, -1),
    ...signed(productCostOfSalesDetails, -1),
    ...signed(operationalExpenseDetails, -1),
  ]
  const netProfitDetails = [...operatingProfitDetails, ...signed(taxExpenseDetails, -1)]
  const cashInDetails = entriesFinancial.map(item => ({ ...item, party:'', status:'liquidado', direction:'receivable', sourceType:item.origin, sourceId:item.referenceId, sourceComponent:item.sourceComponent || 'revenue' }))
  const cashOutDetails = exitsFinancial.map(item => ({ ...item, party:'', status:'liquidado', direction:'payable', sourceType:item.origin, sourceId:item.referenceId, sourceComponent:item.sourceComponent || 'expense' }))
  const cashBalanceDetails = [...signed(cashInDetails), ...signed(cashOutDetails, -1)]
  const cumulativeCashDetails = cumulativeEntries.map(item => ({ ...item, party:'', status:'liquidado', direction:item.type === 'entrada' ? 'receivable' : 'payable', sourceType:item.origin, sourceId:item.referenceId, sourceComponent:item.sourceComponent || (item.type === 'entrada' ? 'revenue' : 'expense'), value:Number(item.value || 0) * (item.type === 'entrada' ? 1 : -1) }))
  const receivableDetails = accountsReceivable.map(item => ({ ...item, date:item.dueDate, party:item.patient || '', origin:item.source, direction:'receivable', sourceType:item.source, sourceId:item.sourceId, sourceComponent:'open', description:item.description || item.patient || 'Conta a receber' }))
  const payableDetails = accountsPayable.map(item => ({ ...item, date:item.dueDate, party:item.supplier || '', origin:item.source, direction:'payable', sourceType:item.source, sourceId:item.sourceId, sourceComponent:'open', description:item.description || item.supplier || 'Conta a pagar' }))
  const assetDetails = (assets || []).map(item => ({ id:`asset-${item.id}`, date:balanceDate, origin:'ativo', description:item.name || 'Ativo complementar', party:'', category:item.category || 'ativo', status:'ativo', value:Number(item.value || 0), direction:'receivable', sourceType:'asset', sourceId:item.id, sourceComponent:'balance' }))
  const liabilityDetails = (liabilities || []).map(item => ({ id:`liability-${item.id}`, date:balanceDate, origin:'passivo', description:item.name || 'Passivo complementar', party:'', category:item.category || 'passivo', status:'aberto', value:Number(item.value || 0), direction:'payable', sourceType:'liability', sourceId:item.id, sourceComponent:'balance' }))
  const inventoryDetails = products.map(product => {
    const stock = Math.max(0, Number(inventoryStockAtBalance[product.id] || 0))
    const unitCost = Number(inventoryCostingAtBalance.averageByProduct[product.id] || 0)
    return { id:`inventory-${product.id}`, date:balanceDate, origin:'estoque', description:product.name || 'Produto', party:'', category:product.category || 'estoque', status:'em_estoque', value:stock * unitCost, quantity:stock, direction:'receivable', sourceType:'inventory', sourceId:product.id, sourceComponent:'stock' }
  }).filter(item => item.value > 0)
  const balanceAssetDetails = [...cumulativeCashDetails, ...receivableDetails, ...assetDetails, ...inventoryDetails]
  const balanceLiabilityDetails = [...payableDetails, ...liabilityDetails]

  const drilldowns = {
    grossRevenue:revenueDetails,
    surgeryRevenue:surgeryRevenueDetails,
    surgeryCostTotal:surgeryCostDetails,
    surgeryNetRevenue:[...signed(surgeryRevenueDetails), ...signed(surgeryCostDetails, -1)],
    consultationRevenue:consultationRevenueDetails,
    consultationCostTotal:consultationCostDetails,
    consultationNetRevenue:[...signed(consultationRevenueDetails), ...signed(consultationCostDetails, -1)],
    productSalesRevenue:productRevenueDetails,
    productPurchasesTotal:productPurchaseDetails,
    productCostOfSales:productCostOfSalesDetails,
    extraRevenueTotal:extraRevenueDetails,
    operationalExpenses:operationalExpenseDetails,
    taxExpenses:taxExpenseDetails,
    totalExpenses:totalExpenseDetails,
    operatingProfit:operatingProfitDetails,
    netProfit:netProfitDetails,
    cashIn:cashInDetails,
    cashOut:cashOutDetails,
    cashBalance:cashBalanceDetails,
    receivablesOpenTotal:receivableDetails,
    payablesOpenTotal:payableDetails,
    prediction:[...cashBalanceDetails, ...receivableDetails, ...signed(payableDetails, -1)],
    inventoryAsset:inventoryDetails,
    bankAssets:assetDetails,
    complementaryLiabilities:liabilityDetails,
    assetsTotal:balanceAssetDetails,
    liabilitiesTotal:balanceLiabilityDetails,
    equity:[...balanceAssetDetails, ...signed(balanceLiabilityDetails, -1)],
    byExpenseCategory:Object.fromEntries(Object.keys(expensesByCategory).map(category => [category, operationalExpenseDetails.concat(taxExpenseDetails).filter(item => item.category === category)])),
    byProduct:Object.fromEntries(products.map(product => [product.id, {
      revenue:productRevenueDetails.filter(item => item.sourceId && productSalesInRange.some(sale => sale.id === item.sourceId && sale.productId === product.id)),
      cost:productCostOfSalesDetails.filter(item => item.productId === product.id),
    }])),
  }

  return {
    grossRevenue,
    surgeryRevenue,
    surgeryCostTotal,
    surgeryNetRevenue,
    consultationRevenue,
    consultationCostTotal,
    productSalesRevenue,
    productPurchaseTotal,
    productPurchasesTotal,
    productCostOfSales,
    extraRevenueTotal,
    operationalExpenses,
    taxExpenses,
    operatingProfit,
    netProfit,
    cashIn,
    cashOut,
    cashBalance,
    surgeriesCompleted,
    consultationsCompleted,
    averageTicket,
    receivablesOpenTotal,
    payablesOpenTotal,
    accountsReceivable,
    accountsPayable,
    entriesFinancial,
    exitsFinancial,
    cashFlowEntries,
    revenueByMonth,
    expenseByMonth,
    assetsTotal,
    inventoryAsset,
    liabilitiesTotal,
    equity,
    byProcedure,
    productsByPerformance,
    expensesByCategory,
    surgeriesByMonth,
    consultationsByInsurance,
    prediction:cashBalance + receivablesOpenTotal - payablesOpenTotal,
    drilldowns,
    financialSource:'ledger_projection',
    goals,
  }
}
