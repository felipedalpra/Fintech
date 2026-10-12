import { inRange, monthKey, onOrBefore, today } from './utils.js'
import { buildLedger } from './lib/financialLedger.js'
import { buildProductCosting } from './lib/inventoryCosting.js'
import { buildInventoryMovements, stockByProduct } from './lib/inventoryLedger.js'

export { paymentScheduleFlow } from './lib/paymentScheduleFlow.js'

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

function parseDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const date = new Date(`${raw}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfWeek(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = copy.getDay() || 7
  copy.setDate(copy.getDate() - (day - 1))
  return copy
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

export function generateRecurringOccurrences(recurrences, fromDate, toDate) {
  const from = parseDate(fromDate || '1900-01-01')
  const to = parseDate(toDate || '2999-12-31')
  if (!from || !to || from > to) return []

  const items = []
  recurrences.forEach(rec => {
    if (rec.ativo === false) return
    const startDate = parseDate(rec.dataInicio)
    if (!startDate) return
    const endDate = parseDate(rec.dataFim || '2999-12-31')
    const execDay = Math.max(1, Number(rec.diaExecucao || 1))
    const freq = rec.frequencia || 'mensal'
    const minDate = startDate > from ? startDate : from
    const maxDate = endDate < to ? endDate : to
    if (minDate > maxDate) return

    if (freq === 'mensal') {
      let cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1)
      const lastMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1)
      while (cursor <= lastMonth) {
        const day = Math.min(execDay, daysInMonth(cursor.getFullYear(), cursor.getMonth()))
        const due = new Date(cursor.getFullYear(), cursor.getMonth(), day)
        if (due >= minDate && due <= maxDate) {
          items.push({ ...rec, dueDate:formatDate(due) })
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      }
      return
    }

    if (freq === 'semanal') {
      const clampedDay = Math.min(7, execDay)
      let cursor = startOfWeek(minDate)
      while (cursor <= maxDate) {
        const due = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + (clampedDay - 1))
        if (due >= minDate && due <= maxDate) {
          items.push({ ...rec, dueDate:formatDate(due) })
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7)
      }
      return
    }

    let year = minDate.getFullYear()
    while (year <= maxDate.getFullYear()) {
      const month = startDate.getMonth()
      const day = Math.min(execDay, daysInMonth(year, month))
      const due = new Date(year, month, day)
      if (due >= minDate && due <= maxDate) {
        items.push({ ...rec, dueDate:formatDate(due) })
      }
      year += 1
    }
  })

  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

function matchesRecurringExpense(record, recurring) {
  return (record.description || '') === (recurring.descricao || '')
    && (record.category || 'outros') === (recurring.categoria || 'outros')
    && Number(record.value || 0) === Number(recurring.valor || 0)
    && (record.dueDate || '') === (recurring.dueDate || '')
}

function matchesRecurringRevenue(record, recurring) {
  return (record.description || '') === (recurring.descricao || '')
    && (record.category || 'outras_receitas') === (recurring.categoria || 'outras_receitas')
    && Number(record.value || 0) === Number(recurring.valor || 0)
    && (record.date || '') === (recurring.dueDate || '')
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
  return {
    origin:'despesa', source:'despesa', category:entry.category || source?.category || 'outros',
    description:source?.description || 'Despesa', accountDescription:source?.description || 'Despesa',
  }
}

function buildLedgerProjection(data, { startDate, endDate, balanceDate }) {
  const ledger = buildLedger(data)
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
        cumulativeEntries.push({ type:entry.direction === 'receivable' ? 'entrada' : 'saida', value:paidValue })
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

  return { ...ledger, competenceEntries, entriesFinancial, exitsFinancial, accountsReceivable, accountsPayable, cumulativeEntries }
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
  const recurrences = data.recurrences || []
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
  const recurringInRange = generateRecurringOccurrences(recurrences, recurringRangeStart, recurringRangeEnd)
  const recurringUntilBalance = generateRecurringOccurrences(recurrences, recurringBalanceStart, balanceDate)
  const recurringRevenueOpenInRange = recurringInRange.filter(item => item.tipo === 'receita' && !extraRevenues.some(entry => matchesRecurringRevenue(entry, item)))
  const recurringExpenseOpenInRange = recurringInRange.filter(item => item.tipo === 'despesa' && !expenses.some(entry => matchesRecurringExpense(entry, item)))
  const recurringRevenueTotal = recurringRevenueOpenInRange.reduce((acc, item) => acc + (Number(item.valor) || 0), 0)
  const recurringExpenseTotal = recurringExpenseOpenInRange.reduce((acc, item) => acc + (Number(item.valor) || 0), 0)

  // Fase 10: competência, caixa e obrigações passam a ler da projeção canônica do razão.
  // Recorrências continuam anexadas aqui até ganharem títulos próprios no razão.
  const ledger = buildLedgerProjection(data, { startDate, endDate, balanceDate })
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
  // Compatibilidade: consumidores antigos usam productPurchaseTotal como a linha de custo da DRE.
  // A partir da Fase 10, o campo representa CMV histórico; compras ficam em productPurchasesTotal.
  const productPurchaseTotal = productCostOfSales
  const extraRevenueTotal = sumLedger(entry => entry.source_type === 'extra_revenue' && entry.direction === 'receivable') + recurringRevenueTotal
  const grossRevenue = surgeryRevenue + consultationRevenue + productSalesRevenue + extraRevenueTotal

  const taxExpenses = sumLedger(entry => entry.source_type === 'expense' && entry.category === 'impostos')
  const operationalExpenses = sumLedger(entry => entry.source_type === 'expense' && entry.category !== 'impostos') + recurringExpenseTotal
  const operatingProfit = grossRevenue - surgeryCostTotal - consultationCostTotal - productPurchaseTotal - operationalExpenses
  const netProfit = operatingProfit - taxExpenses

  const surgeriesCompleted = surgeriesInRange.filter(item => item.paymentStatus !== 'cancelado').length
  const consultationsCompleted = consultationsInRange.filter(item => item.paymentStatus !== 'cancelado').length
  const averageTicket = surgeriesCompleted > 0 ? surgeryRevenue / surgeriesCompleted : 0

  const entriesFinancial = [...ledger.entriesFinancial]
  const exitsFinancial = [...ledger.exitsFinancial]

  recurringInRange.forEach(item => {
    const value = Number(item.valor || 0)
    if (value <= 0 || !item.autoMarkAsPaid) return
    if (item.tipo === 'receita' && extraRevenues.some(entry => matchesRecurringRevenue(entry, item))) return
    if (item.tipo === 'despesa' && expenses.some(entry => matchesRecurringExpense(entry, item))) return
    if (item.tipo === 'receita') {
      entriesFinancial.push({ id:`entry-recurring-${item.id}-${item.dueDate}`, description:item.descricao || 'Receita recorrente', category:item.categoria || 'outras_receitas', value, date:item.dueDate, origin:'recorrencia_receita', referenceId:item.id })
    } else {
      exitsFinancial.push({ id:`exit-recurring-${item.id}-${item.dueDate}`, description:item.descricao || 'Despesa recorrente', category:item.categoria || 'outros', value, date:item.dueDate, origin:'recorrencia_despesa', referenceId:item.id })
    }
  })

  const cashFlowEntries = [...entriesFinancial.map(item => ({ ...item, type:'entrada' })), ...exitsFinancial.map(item => ({ ...item, type:'saida' }))].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const cashIn = entriesFinancial.reduce((acc, item) => acc + item.value, 0)
  const cashOut = exitsFinancial.reduce((acc, item) => acc + item.value, 0)
  const cashBalance = cashIn - cashOut

  const accountsReceivable = [
    ...ledger.accountsReceivable,
    ...recurringUntilBalance.filter(item => item.tipo === 'receita' && !item.autoMarkAsPaid && onOrBefore(item.dueDate, balanceDate) && !extraRevenues.some(entry => matchesRecurringRevenue(entry, item))).map(item => ({ id:`recurrence-income-${item.id}-${item.dueDate}`, source:'recorrencia', sourceId:item.id, patient:'Recorrência', category:item.categoria || 'outras_receitas', value:Number(item.valor || 0), competenceDate:item.dueDate, dueDate:item.dueDate, status:'pendente', description:item.descricao || 'Receita fixa' })),
  ]

  const accountsPayable = [
    ...ledger.accountsPayable,
    ...recurringUntilBalance.filter(item => item.tipo === 'despesa' && !item.autoMarkAsPaid && onOrBefore(item.dueDate, balanceDate) && !expenses.some(entry => matchesRecurringExpense(entry, item))).map(item => ({ id:`recurrence-expense-${item.id}-${item.dueDate}`, source:'recorrencia', sourceId:item.id, supplier:item.descricao || 'Despesa fixa', category:item.categoria || 'outros', value:Number(item.valor || 0), competenceDate:item.dueDate, dueDate:item.dueDate, status:'pendente' })),
  ]

  const receivablesOpenTotal = accountsReceivable.reduce((acc, item) => acc + item.value, 0)
  const payablesOpenTotal = accountsPayable.reduce((acc, item) => acc + item.value, 0)

  const cumulativeEntries = [...ledger.cumulativeEntries]
  recurringUntilBalance.filter(item => item.autoMarkAsPaid).forEach(item => {
    const value = Number(item.valor || 0)
    if (value <= 0) return
    if (item.tipo === 'receita' && extraRevenues.some(entry => matchesRecurringRevenue(entry, item))) return
    if (item.tipo === 'despesa' && expenses.some(entry => matchesRecurringExpense(entry, item))) return
    cumulativeEntries.push({ type:item.tipo === 'receita' ? 'entrada' : 'saida', value })
  })

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
    .filter(entry => entry.source_type === 'expense')
    .reduce((acc, entry) => {
    const key = entry.category || 'outros'
    acc[key] = (acc[key] || 0) + Number(entry.total_amount || 0)
    return acc
  }, {})
  recurringInRange.filter(item => item.tipo === 'despesa').forEach(item => {
    const key = item.categoria || 'outros'
    expensesByCategory[key] = (expensesByCategory[key] || 0) + (Number(item.valor) || 0)
  })

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
    financialSource:'ledger_projection',
    goals,
  }
}
