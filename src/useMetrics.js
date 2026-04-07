import { useMemo } from 'react'
import { inRange, monthKey, onOrBefore, today } from './utils.js'
import { decodePaymentMethod } from './lib/paymentMethodCodec.js'

function resolvePercent(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function invoiceIssuanceCost(baseValue, percentValue) {
  return (baseValue || 0) * (resolvePercent(percentValue) / 100)
}

function surgeryCosts(item) {
  return (item.hospitalCost || 0) + (item.anesthesiaCost || 0) + (item.materialCost || 0) + (item.otherCosts || 0) + invoiceIssuanceCost(item.totalValue || 0, item.invoiceIssuancePercent || 0)
}

function consultationCosts(item) {
  return invoiceIssuanceCost(item.value || 0, item.invoiceIssuancePercent || 0)
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

function patientLabel(value, fallback = '') {
  return value || fallback || 'Paciente não informado'
}

function consultationPaymentFlow(item, balanceDate) {
  const totalValue = Math.max(0, Number(item?.value || 0))
  const decoded = decodePaymentMethod(item?.paymentMethod)
  const schedule = decoded.paymentScheduleMode === 'duas_datas' && Array.isArray(decoded.payments)
    ? decoded.payments
      .map((entry, index) => ({
        index,
        date:String(entry?.date || '').trim(),
        amount:Math.max(0, Number(entry?.amount || 0)),
      }))
      .filter(entry => entry.date && entry.amount > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
    : []

  if (schedule.length === 0) {
    const paid = item?.paymentStatus === 'pago'
    return {
      hasSchedule:false,
      installments:[],
      paidInstallments:paid ? [{ index:0, date:item?.paymentDate || item?.date, amount:totalValue }] : [],
      openInstallments:paid || totalValue <= 0 ? [] : [{ index:0, date:item?.forecastPaymentDate || item?.date, amount:totalValue }],
      paidAmount:paid ? totalValue : 0,
      openAmount:paid ? 0 : totalValue,
    }
  }

  let remaining = totalValue
  const installments = schedule
    .map(entry => {
      const amount = Math.min(entry.amount, remaining)
      remaining = Math.max(0, remaining - amount)
      return { ...entry, amount }
    })
    .filter(entry => entry.amount > 0)

  if (remaining > 0) {
    installments.push({
      index:installments.length,
      date:item?.forecastPaymentDate || installments[installments.length - 1]?.date || item?.date,
      amount:remaining,
    })
    remaining = 0
  }

  const paymentDateCutoff = String(item?.paymentDate || '').trim()
  const paidByDate = item?.paymentStatus === 'pago'
    ? installments
    : (paymentDateCutoff ? installments.filter(entry => onOrBefore(entry.date, paymentDateCutoff)) : [])
  const paidIndexes = new Set(paidByDate.map(entry => entry.index))
  const openInstallments = installments.filter(entry => !paidIndexes.has(entry.index))
  const paidAmount = Math.min(totalValue, paidByDate.reduce((acc, entry) => acc + entry.amount, 0))
  const openAmount = Math.max(0, totalValue - paidAmount)

  return {
    hasSchedule:true,
    installments,
    paidInstallments:paidByDate,
    openInstallments,
    paidAmount,
    openAmount,
  }
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

function generateRecurringOccurrences(recurrences, fromDate, toDate) {
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

  const surgeriesInRange = surgeries.filter(item => item.date && inRange(item.date, startDate, endDate))
  const consultationsInRange = consultations.filter(item => item.date && inRange(item.date, startDate, endDate))
  const productSalesInRange = productSales.filter(item => item.saleDate && inRange(item.saleDate, startDate, endDate))
  const productPurchasesInRange = productPurchases.filter(item => item.purchaseDate && inRange(item.purchaseDate, startDate, endDate))
  const extraRevenuesInRange = extraRevenues.filter(item => item.date && inRange(item.date, startDate, endDate))
  const expensesInRange = expenses.filter(item => item.dueDate && inRange(item.dueDate, startDate, endDate))
  const recurringInRange = generateRecurringOccurrences(recurrences, recurringRangeStart, recurringRangeEnd)
  const recurringUntilBalance = generateRecurringOccurrences(recurrences, recurringBalanceStart, balanceDate)
  const recurringRevenueOpenInRange = recurringInRange.filter(item => item.tipo === 'receita' && !extraRevenues.some(entry => matchesRecurringRevenue(entry, item)))
  const recurringExpenseOpenInRange = recurringInRange.filter(item => item.tipo === 'despesa' && !expenses.some(entry => matchesRecurringExpense(entry, item)))
  const recurringRevenueTotal = recurringRevenueOpenInRange.reduce((acc, item) => acc + (Number(item.valor) || 0), 0)
  const recurringExpenseTotal = recurringExpenseOpenInRange.reduce((acc, item) => acc + (Number(item.valor) || 0), 0)

  const surgeryRevenue = surgeriesInRange.reduce((acc, item) => acc + (item.totalValue || 0), 0)
  const surgeryCostTotal = surgeriesInRange.reduce((acc, item) => acc + surgeryCosts(item), 0)
  const surgeryNetRevenue = surgeryRevenue - surgeryCostTotal
  const consultationRevenue = consultationsInRange.reduce((acc, item) => acc + (item.value || 0), 0)
  const consultationCostTotal = consultationsInRange.reduce((acc, item) => acc + consultationCosts(item), 0)
  const productSalesRevenue = productSalesInRange.reduce((acc, item) => acc + (item.totalValue || 0), 0)
  const productPurchaseTotal = productPurchasesInRange.reduce((acc, item) => acc + (item.totalValue || 0), 0)
  const extraRevenueTotal = extraRevenuesInRange.reduce((acc, item) => acc + (item.value || 0), 0) + recurringRevenueTotal
  const grossRevenue = surgeryRevenue + consultationRevenue + productSalesRevenue + extraRevenueTotal

  const taxExpenses = expensesInRange.filter(item => item.category === 'impostos').reduce((acc, item) => acc + (item.value || 0), 0)
  const operationalExpenses = expensesInRange.filter(item => item.category !== 'impostos').reduce((acc, item) => acc + (item.value || 0), 0) + recurringExpenseTotal
  const operatingProfit = grossRevenue - surgeryCostTotal - consultationCostTotal - productPurchaseTotal - operationalExpenses
  const netProfit = operatingProfit - taxExpenses

  const surgeriesCompleted = surgeriesInRange.filter(item => item.paymentStatus !== 'cancelado').length
  const consultationsCompleted = consultationsInRange.filter(item => item.paymentStatus !== 'cancelado').length
  const averageTicket = surgeriesCompleted > 0 ? surgeryRevenue / surgeriesCompleted : 0

  const entriesFinancial = []
  const exitsFinancial = []

  surgeries.forEach(item => {
    if (item.paymentStatus === 'pago' && inRange(item.paymentDate || item.date, startDate, endDate)) {
      entriesFinancial.push({ id:`entry-surgery-${item.id}`, description:`Cirurgia - ${patientLabel(item.patient, item.id)}`, category:'cirurgia', value:item.totalValue || 0, date:item.paymentDate || item.date, origin:'cirurgia', referenceId:item.id })
    }
    if (item.paymentStatus !== 'cancelado' && inRange(item.date, startDate, endDate)) {
      const surgeryInvoiceCost = invoiceIssuanceCost(item.totalValue || 0, item.invoiceIssuancePercent || 0)
      ;[
        ['hospital', item.hospitalCost || 0],
        ['anestesia', item.anesthesiaCost || 0],
        ['material', item.materialCost || 0],
        ['outros', item.otherCosts || 0],
        ['nota_fiscal_cirurgia', surgeryInvoiceCost],
      ].forEach(([category, value]) => {
        if (value > 0) exitsFinancial.push({ id:`exit-surgery-${item.id}-${category}`, description:`Custo cirúrgico - ${patientLabel(item.patient, item.id)}`, category, value, date:item.date, origin:'custo_cirurgico', referenceId:item.id })
      })
    }
  })

  consultations.forEach(item => {
    const flow = consultationPaymentFlow(item, balanceDate)
    flow.paidInstallments.forEach((payment, index) => {
      if (!payment.date || !inRange(payment.date, startDate, endDate)) return
      entriesFinancial.push({
        id:`entry-consultation-${item.id}-${index}`,
        description:flow.hasSchedule
          ? `Consulta - ${patientLabel(item.patient, item.id)} (pagamento ${index + 1}/${flow.installments.length})`
          : `Consulta - ${patientLabel(item.patient, item.id)}`,
        category:'consulta',
        value:payment.amount || 0,
        date:payment.date,
        origin:'consulta',
        referenceId:item.id,
      })
    })
    if (item.paymentStatus !== 'cancelado' && inRange(item.date, startDate, endDate)) {
      const nfCost = consultationCosts(item)
      if (nfCost > 0) {
        exitsFinancial.push({ id:`exit-consultation-${item.id}-nf`, description:`Custo NF consulta - ${patientLabel(item.patient, item.id)}`, category:'nota_fiscal_consulta', value:nfCost, date:item.date, origin:'custo_consulta', referenceId:item.id })
      }
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
    ...surgeries.filter(item => item.paymentStatus !== 'pago' && item.paymentStatus !== 'cancelado' && onOrBefore(item.date, balanceDate)).map(item => ({ id:`surgery-${item.id}`, source:'cirurgia', sourceId:item.id, patient:patientLabel(item.patient, item.id), category:'cirurgia', value:item.totalValue || 0, dueDate:item.date, status:item.paymentStatus, description:mapProcedureName(procedures, item.procedureId) })),
    ...consultations
      .filter(item => item.paymentStatus !== 'cancelado' && onOrBefore(item.date, balanceDate))
      .flatMap(item => {
        const flow = consultationPaymentFlow(item, balanceDate)
        if (flow.openAmount <= 0) return []
        const pendingDates = flow.openInstallments.map(entry => entry.date).filter(Boolean)
        const scheduleSummary = flow.hasSchedule
          ? `2 datas: ${flow.installments.map(entry => entry.date).join(' / ')} · recebido ${flow.paidInstallments.length}/${flow.installments.length}`
          : item.consultationType
        return [{
          id:`consultation-${item.id}`,
          source:'consulta',
          sourceId:item.id,
          patient:patientLabel(item.patient, item.id),
          category:item.paymentType || 'consulta',
          value:flow.openAmount,
          dueDate:pendingDates[0] || item.forecastPaymentDate || item.date,
          status:item.paymentStatus,
          description:flow.hasSchedule ? `${item.consultationType} (${scheduleSummary})` : item.consultationType,
        }]
      }),
    ...recurringUntilBalance.filter(item => item.tipo === 'receita' && !item.autoMarkAsPaid && onOrBefore(item.dueDate, balanceDate) && !extraRevenues.some(entry => matchesRecurringRevenue(entry, item))).map(item => ({ id:`recurrence-income-${item.id}-${item.dueDate}`, source:'recorrencia', sourceId:item.id, patient:'Recorrência', category:item.categoria || 'outras_receitas', value:Number(item.valor || 0), dueDate:item.dueDate, status:'pendente', description:item.descricao || 'Receita fixa' })),
  ]

  const accountsPayable = [
    ...expenses.filter(item => item.status !== 'pago' && item.status !== 'cancelado' && onOrBefore(item.dueDate, balanceDate)).map(item => ({ id:`expense-${item.id}`, source:'despesa', sourceId:item.id, supplier:item.description, category:item.category, value:item.value || 0, dueDate:item.dueDate, status:item.status })),
    ...recurringUntilBalance.filter(item => item.tipo === 'despesa' && !item.autoMarkAsPaid && onOrBefore(item.dueDate, balanceDate) && !expenses.some(entry => matchesRecurringExpense(entry, item))).map(item => ({ id:`recurrence-expense-${item.id}-${item.dueDate}`, source:'recorrencia', sourceId:item.id, supplier:item.descricao || 'Despesa fixa', category:item.categoria || 'outros', value:Number(item.valor || 0), dueDate:item.dueDate, status:'pendente' })),
  ]

  const receivablesOpenTotal = accountsReceivable.reduce((acc, item) => acc + item.value, 0)
  const payablesOpenTotal = accountsPayable.reduce((acc, item) => acc + item.value, 0)

  const cumulativeEntries = []
  surgeries.filter(item => item.paymentStatus === 'pago' && onOrBefore(item.paymentDate || item.date, balanceDate)).forEach(item => cumulativeEntries.push({ type:'entrada', value:item.totalValue || 0 }))
  consultations.forEach(item => {
    const flow = consultationPaymentFlow(item, balanceDate)
    flow.paidInstallments.filter(payment => onOrBefore(payment.date, balanceDate)).forEach(payment => {
      cumulativeEntries.push({ type:'entrada', value:payment.amount || 0 })
    })
  })
  productSales.filter(item => onOrBefore(item.saleDate, balanceDate)).forEach(item => cumulativeEntries.push({ type:'entrada', value:item.totalValue || 0 }))
  extraRevenues.filter(item => onOrBefore(item.date, balanceDate)).forEach(item => cumulativeEntries.push({ type:'entrada', value:item.value || 0 }))
  expenses.filter(item => item.status === 'pago' && onOrBefore(item.paymentDate || item.dueDate, balanceDate)).forEach(item => cumulativeEntries.push({ type:'saida', value:item.value || 0 }))
  productPurchases.filter(item => onOrBefore(item.purchaseDate, balanceDate)).forEach(item => cumulativeEntries.push({ type:'saida', value:item.totalValue || 0 }))
  surgeries.filter(item => item.paymentStatus !== 'cancelado' && onOrBefore(item.date, balanceDate)).forEach(item => {
    if (item.hospitalCost) cumulativeEntries.push({ type:'saida', value:item.hospitalCost })
    if (item.anesthesiaCost) cumulativeEntries.push({ type:'saida', value:item.anesthesiaCost })
    if (item.materialCost) cumulativeEntries.push({ type:'saida', value:item.materialCost })
    if (item.otherCosts) cumulativeEntries.push({ type:'saida', value:item.otherCosts })
    const surgeryInvoiceCost = invoiceIssuanceCost(item.totalValue || 0, item.invoiceIssuancePercent || 0)
    if (surgeryInvoiceCost > 0) cumulativeEntries.push({ type:'saida', value:surgeryInvoiceCost })
  })
  consultations.filter(item => item.paymentStatus !== 'cancelado' && onOrBefore(item.date, balanceDate)).forEach(item => {
    const consultationInvoiceCost = consultationCosts(item)
    if (consultationInvoiceCost > 0) cumulativeEntries.push({ type:'saida', value:consultationInvoiceCost })
  })
  recurringUntilBalance.filter(item => item.autoMarkAsPaid).forEach(item => {
    const value = Number(item.valor || 0)
    if (value <= 0) return
    if (item.tipo === 'receita' && extraRevenues.some(entry => matchesRecurringRevenue(entry, item))) return
    if (item.tipo === 'despesa' && expenses.some(entry => matchesRecurringExpense(entry, item))) return
    cumulativeEntries.push({ type:item.tipo === 'receita' ? 'entrada' : 'saida', value })
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
    consultationCostTotal,
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
