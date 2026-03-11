import { useMemo } from 'react'
import { inRange, monthKey, onOrBefore, today } from './utils.js'

function surgeryCosts(item) {
  return (item.hospitalCost || 0) + (item.anesthesiaCost || 0) + (item.materialCost || 0) + (item.otherCosts || 0)
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

  const surgeriesInRange = surgeries.filter(item => item.date && inRange(item.date, startDate, endDate))
  const consultationsInRange = consultations.filter(item => item.date && inRange(item.date, startDate, endDate))
  const productSalesInRange = productSales.filter(item => item.saleDate && inRange(item.saleDate, startDate, endDate))
  const productPurchasesInRange = productPurchases.filter(item => item.purchaseDate && inRange(item.purchaseDate, startDate, endDate))
  const extraRevenuesInRange = extraRevenues.filter(item => item.date && inRange(item.date, startDate, endDate))
  const expensesInRange = expenses.filter(item => item.dueDate && inRange(item.dueDate, startDate, endDate))

  const surgeryRevenue = surgeriesInRange.reduce((acc, item) => acc + (item.totalValue || 0), 0)
  const surgeryCostTotal = surgeriesInRange.reduce((acc, item) => acc + surgeryCosts(item), 0)
  const surgeryNetRevenue = surgeryRevenue - surgeryCostTotal
  const consultationRevenue = consultationsInRange.reduce((acc, item) => acc + (item.value || 0), 0)
  const productSalesRevenue = productSalesInRange.reduce((acc, item) => acc + (item.totalValue || 0), 0)
  const productPurchaseTotal = productPurchasesInRange.reduce((acc, item) => acc + (item.totalValue || 0), 0)
  const extraRevenueTotal = extraRevenuesInRange.reduce((acc, item) => acc + (item.value || 0), 0)
  const grossRevenue = surgeryRevenue + consultationRevenue + productSalesRevenue + extraRevenueTotal

  const taxExpenses = expensesInRange.filter(item => item.category === 'impostos').reduce((acc, item) => acc + (item.value || 0), 0)
  const operationalExpenses = expensesInRange.filter(item => item.category !== 'impostos').reduce((acc, item) => acc + (item.value || 0), 0)
  const operatingProfit = grossRevenue - surgeryCostTotal - productPurchaseTotal - operationalExpenses
  const netProfit = operatingProfit - taxExpenses

  const surgeriesCompleted = surgeriesInRange.filter(item => item.paymentStatus !== 'cancelado').length
  const consultationsCompleted = consultationsInRange.filter(item => item.paymentStatus !== 'cancelado').length
  const averageTicket = surgeriesCompleted > 0 ? surgeryRevenue / surgeriesCompleted : 0

  const entriesFinancial = []
  const exitsFinancial = []

  surgeries.forEach(item => {
    if (item.paymentStatus === 'pago' && inRange(item.paymentDate || item.date, startDate, endDate)) {
      entriesFinancial.push({ id:`entry-surgery-${item.id}`, description:`Cirurgia - ${item.patient}`, category:'cirurgia', value:item.totalValue || 0, date:item.paymentDate || item.date, origin:'cirurgia', referenceId:item.id })
    }
    if (item.paymentStatus !== 'cancelado' && inRange(item.date, startDate, endDate)) {
      ;[
        ['hospital', item.hospitalCost || 0],
        ['anestesia', item.anesthesiaCost || 0],
        ['material', item.materialCost || 0],
        ['outros', item.otherCosts || 0],
      ].forEach(([category, value]) => {
        if (value > 0) exitsFinancial.push({ id:`exit-surgery-${item.id}-${category}`, description:`Custo cirúrgico - ${item.patient}`, category, value, date:item.date, origin:'custo_cirurgico', referenceId:item.id })
      })
    }
  })

  consultations.forEach(item => {
    if (item.paymentStatus === 'pago' && inRange(item.paymentDate || item.date, startDate, endDate)) {
      entriesFinancial.push({ id:`entry-consultation-${item.id}`, description:`Consulta - ${item.patient}`, category:'consulta', value:item.value || 0, date:item.paymentDate || item.date, origin:'consulta', referenceId:item.id })
    }
  })

  productSales.forEach(item => {
    if (inRange(item.saleDate, startDate, endDate)) {
      const product = mapProduct(products, item.productId)
      entriesFinancial.push({ id:`entry-product-sale-${item.id}`, description:`Venda de produto - ${product?.name || 'Produto'}`, category:'venda_produto', value:item.totalValue || 0, date:item.saleDate, origin:'venda_produto', referenceId:item.id })
    }
  })

  productPurchases.forEach(item => {
    if (inRange(item.purchaseDate, startDate, endDate)) {
      const product = mapProduct(products, item.productId)
      exitsFinancial.push({ id:`exit-product-purchase-${item.id}`, description:`Compra de produto - ${product?.name || 'Produto'}`, category:'compra_produto', value:item.totalValue || 0, date:item.purchaseDate, origin:'compra_produto', referenceId:item.id })
    }
  })

  extraRevenues.forEach(item => {
    if (inRange(item.date, startDate, endDate)) {
      entriesFinancial.push({ id:`entry-extra-${item.id}`, description:item.description, category:item.category || 'outras_receitas', value:item.value || 0, date:item.date, origin:'outra_receita', referenceId:item.id })
    }
  })

  expenses.forEach(item => {
    if (item.status === 'pago' && inRange(item.paymentDate || item.dueDate, startDate, endDate)) {
      exitsFinancial.push({ id:`exit-expense-${item.id}`, description:item.description, category:item.category, value:item.value || 0, date:item.paymentDate || item.dueDate, origin:'despesa', referenceId:item.id })
    }
  })

  const cashFlowEntries = [...entriesFinancial.map(item => ({ ...item, type:'entrada' })), ...exitsFinancial.map(item => ({ ...item, type:'saida' }))].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const cashIn = entriesFinancial.reduce((acc, item) => acc + item.value, 0)
  const cashOut = exitsFinancial.reduce((acc, item) => acc + item.value, 0)
  const cashBalance = cashIn - cashOut

  const accountsReceivable = [
    ...surgeries.filter(item => item.paymentStatus !== 'pago' && item.paymentStatus !== 'cancelado' && onOrBefore(item.date, balanceDate)).map(item => ({ id:`surgery-${item.id}`, source:'cirurgia', sourceId:item.id, patient:item.patient, category:'cirurgia', value:item.totalValue || 0, dueDate:item.date, status:item.paymentStatus, description:mapProcedureName(procedures, item.procedureId) })),
    ...consultations.filter(item => item.paymentStatus !== 'pago' && item.paymentStatus !== 'cancelado' && onOrBefore(item.date, balanceDate)).map(item => ({ id:`consultation-${item.id}`, source:'consulta', sourceId:item.id, patient:item.patient, category:item.paymentType || 'consulta', value:item.value || 0, dueDate:item.forecastPaymentDate || item.date, status:item.paymentStatus, description:item.consultationType })),
  ]

  const accountsPayable = expenses.filter(item => item.status !== 'pago' && item.status !== 'cancelado' && onOrBefore(item.dueDate, balanceDate)).map(item => ({ id:`expense-${item.id}`, source:'despesa', sourceId:item.id, supplier:item.description, category:item.category, value:item.value || 0, dueDate:item.dueDate, status:item.status }))

  const receivablesOpenTotal = accountsReceivable.reduce((acc, item) => acc + item.value, 0)
  const payablesOpenTotal = accountsPayable.reduce((acc, item) => acc + item.value, 0)

  const cumulativeEntries = []
  surgeries.filter(item => item.paymentStatus === 'pago' && onOrBefore(item.paymentDate || item.date, balanceDate)).forEach(item => cumulativeEntries.push({ type:'entrada', value:item.totalValue || 0 }))
  consultations.filter(item => item.paymentStatus === 'pago' && onOrBefore(item.paymentDate || item.date, balanceDate)).forEach(item => cumulativeEntries.push({ type:'entrada', value:item.value || 0 }))
  productSales.filter(item => onOrBefore(item.saleDate, balanceDate)).forEach(item => cumulativeEntries.push({ type:'entrada', value:item.totalValue || 0 }))
  extraRevenues.filter(item => onOrBefore(item.date, balanceDate)).forEach(item => cumulativeEntries.push({ type:'entrada', value:item.value || 0 }))
  expenses.filter(item => item.status === 'pago' && onOrBefore(item.paymentDate || item.dueDate, balanceDate)).forEach(item => cumulativeEntries.push({ type:'saida', value:item.value || 0 }))
  productPurchases.filter(item => onOrBefore(item.purchaseDate, balanceDate)).forEach(item => cumulativeEntries.push({ type:'saida', value:item.totalValue || 0 }))
  surgeries.filter(item => item.paymentStatus !== 'cancelado' && onOrBefore(item.date, balanceDate)).forEach(item => {
    if (item.hospitalCost) cumulativeEntries.push({ type:'saida', value:item.hospitalCost })
    if (item.anesthesiaCost) cumulativeEntries.push({ type:'saida', value:item.anesthesiaCost })
    if (item.materialCost) cumulativeEntries.push({ type:'saida', value:item.materialCost })
    if (item.otherCosts) cumulativeEntries.push({ type:'saida', value:item.otherCosts })
  })

  const cashAsset = cumulativeEntries.reduce((acc, item) => acc + (item.type === 'entrada' ? item.value : -item.value), 0)
  const bankAssets = assets.reduce((acc, item) => acc + (item.value || 0), 0)
  const liabilitiesTotal = liabilities.reduce((acc, item) => acc + (item.value || 0), 0) + payablesOpenTotal
  const assetsTotal = cashAsset + bankAssets + receivablesOpenTotal
  const equity = assetsTotal - liabilitiesTotal

  const byProcedure = procedures.map(procedure => {
    const items = surgeriesInRange.filter(item => item.procedureId === procedure.id)
    const revenue = items.reduce((acc, item) => acc + (item.totalValue || 0), 0)
    const costs = items.reduce((acc, item) => acc + surgeryCosts(item), 0)
    return { id:procedure.id, name:procedure.name, count:items.length, revenue, profit:revenue - costs }
  }).sort((a, b) => b.profit - a.profit)

  const productsByPerformance = products.map(product => {
    const sales = productSalesInRange.filter(item => item.productId === product.id)
    const purchases = productPurchasesInRange.filter(item => item.productId === product.id)
    const soldQty = sales.reduce((acc, item) => acc + (item.quantity || 0), 0)
    const purchaseQty = purchases.reduce((acc, item) => acc + (item.quantity || 0), 0)
    const revenue = sales.reduce((acc, item) => acc + (item.totalValue || 0), 0)
    const cost = purchases.reduce((acc, item) => acc + (item.totalValue || 0), 0)
    const stock = (product.stock || 0) + purchaseQty - soldQty
    return { id:product.id, name:product.name, revenue, cost, profit:revenue - cost, soldQty, stock }
  }).sort((a, b) => b.profit - a.profit)

  const expensesByCategory = expensesInRange.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + (item.value || 0)
    return acc
  }, {})

  const surgeriesByMonth = {}
  surgeriesInRange.forEach(item => {
    const key = monthKey(item.date)
    if (key) surgeriesByMonth[key] = (surgeriesByMonth[key] || 0) + 1
  })

  const consultationsByInsurance = consultationsInRange.reduce((acc, item) => {
    const key = item.paymentType === 'particular' ? 'Particular' : item.insurance || 'Outros convênios'
    acc[key] = (acc[key] || 0) + 1
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
    productSalesRevenue,
    productPurchaseTotal,
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
    liabilitiesTotal,
    equity,
    byProcedure,
    productsByPerformance,
    expensesByCategory,
    surgeriesByMonth,
    consultationsByInsurance,
    prediction:cashBalance + receivablesOpenTotal - payablesOpenTotal,
    goals,
  }
}

export function useMetrics(data, options = {}) {
  return useMemo(() => buildMetrics(data, options), [data, options.startDate, options.endDate, options.balanceDate])
}
