import { useMemo } from 'react'
import { inRange, monthKey, onOrBefore, today } from './utils.js'

function surgeryCosts(item) {
  return (item.hospitalCost || 0) + (item.anesthesiaCost || 0) + (item.materialCost || 0) + (item.otherCosts || 0)
}

function mapProcedureName(procedures, id) {
  return procedures.find(item => item.id === id)?.name || 'Sem procedimento'
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
  const extraRevenuesInRange = extraRevenues.filter(item => item.date && inRange(item.date, startDate, endDate))
  const expensesInRange = expenses.filter(item => item.dueDate && inRange(item.dueDate, startDate, endDate))

  const surgeryRevenue = surgeriesInRange.reduce((acc, item) => acc + (item.totalValue || 0), 0)
  const surgeryCostTotal = surgeriesInRange.reduce((acc, item) => acc + surgeryCosts(item), 0)
  const surgeryNetRevenue = surgeryRevenue - surgeryCostTotal
  const consultationRevenue = consultationsInRange.reduce((acc, item) => acc + (item.value || 0), 0)
  const extraRevenueTotal = extraRevenuesInRange.reduce((acc, item) => acc + (item.value || 0), 0)
  const grossRevenue = surgeryRevenue + consultationRevenue + extraRevenueTotal

  const taxExpenses = expensesInRange.filter(item => item.category === 'impostos').reduce((acc, item) => acc + (item.value || 0), 0)
  const operationalExpenses = expensesInRange.filter(item => item.category !== 'impostos').reduce((acc, item) => acc + (item.value || 0), 0)
  const operatingProfit = grossRevenue - surgeryCostTotal - operationalExpenses
  const netProfit = operatingProfit - taxExpenses
  const margin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0

  const surgeriesPerformed = surgeriesInRange.filter(item => item.paymentStatus !== 'cancelado')
  const surgeriesCompleted = surgeriesPerformed.length
  const consultationsCompleted = consultationsInRange.filter(item => item.paymentStatus !== 'cancelado').length
  const averageTicket = surgeriesCompleted > 0 ? surgeryRevenue / surgeriesCompleted : 0

  const cashFlowEntries = []

  surgeries.forEach(item => {
    if (item.paymentStatus === 'pago' && inRange(item.paymentDate || item.date, startDate, endDate)) {
      cashFlowEntries.push({ date:item.paymentDate || item.date, type:'entrada', category:'cirurgia', value:item.totalValue || 0, origin:'cirurgia', referenceId:item.id, description:`Cirurgia - ${item.patient}` })
    }
    if (item.paymentStatus !== 'cancelado' && inRange(item.date, startDate, endDate)) {
      const costs = [
        ['hospital', item.hospitalCost || 0],
        ['anestesia', item.anesthesiaCost || 0],
        ['material', item.materialCost || 0],
        ['outros', item.otherCosts || 0],
      ]
      costs.forEach(([category, value]) => {
        if (value > 0) {
          cashFlowEntries.push({ date:item.date, type:'saida', category, value, origin:'custo_cirurgico', referenceId:item.id, description:`Custo cirúrgico - ${item.patient}` })
        }
      })
    }
  })

  consultations.forEach(item => {
    if (item.paymentStatus === 'pago' && inRange(item.paymentDate || item.date, startDate, endDate)) {
      cashFlowEntries.push({ date:item.paymentDate || item.date, type:'entrada', category:'consulta', value:item.value || 0, origin:'consulta', referenceId:item.id, description:`Consulta - ${item.patient}` })
    }
  })

  extraRevenues.forEach(item => {
    if (inRange(item.date, startDate, endDate)) {
      cashFlowEntries.push({ date:item.date, type:'entrada', category:item.category || 'outras_receitas', value:item.value || 0, origin:'outra_receita', referenceId:item.id, description:item.description })
    }
  })

  expenses.forEach(item => {
    if (item.status === 'pago' && inRange(item.paymentDate || item.dueDate, startDate, endDate)) {
      cashFlowEntries.push({ date:item.paymentDate || item.dueDate, type:'saida', category:item.category, value:item.value || 0, origin:'despesa', referenceId:item.id, description:item.description })
    }
  })

  cashFlowEntries.sort((a, b) => (a.date || '').localeCompare(b.date || ''))

  const cashIn = cashFlowEntries.filter(item => item.type === 'entrada').reduce((acc, item) => acc + item.value, 0)
  const cashOut = cashFlowEntries.filter(item => item.type === 'saida').reduce((acc, item) => acc + item.value, 0)
  const cashBalance = cashIn - cashOut

  const accountsReceivable = [
    ...surgeries
      .filter(item => item.paymentStatus !== 'pago' && item.paymentStatus !== 'cancelado' && onOrBefore(item.date, balanceDate))
      .map(item => ({ id:`surgery-${item.id}`, source:'cirurgia', sourceId:item.id, patient:item.patient, category:'cirurgia', value:item.totalValue || 0, dueDate:item.date, status:item.paymentStatus, description:mapProcedureName(procedures, item.procedureId) })),
    ...consultations
      .filter(item => item.paymentStatus !== 'pago' && item.paymentStatus !== 'cancelado' && onOrBefore(item.date, balanceDate))
      .map(item => ({ id:`consultation-${item.id}`, source:'consulta', sourceId:item.id, patient:item.patient, category:item.paymentType || 'consulta', value:item.value || 0, dueDate:item.forecastPaymentDate || item.date, status:item.paymentStatus, description:item.consultationType })),
  ]

  const accountsPayable = expenses
    .filter(item => item.status !== 'pago' && item.status !== 'cancelado' && onOrBefore(item.dueDate, balanceDate))
    .map(item => ({ id:`expense-${item.id}`, source:'despesa', sourceId:item.id, supplier:item.description, category:item.category, value:item.value || 0, dueDate:item.dueDate, status:item.status }))

  const receivablesOpenTotal = accountsReceivable.reduce((acc, item) => acc + item.value, 0)
  const payablesOpenTotal = accountsPayable.reduce((acc, item) => acc + item.value, 0)

  const cumulativeCashEntries = []
  ;[
    ...surgeries.filter(item => item.paymentStatus === 'pago' && onOrBefore(item.paymentDate || item.date, balanceDate)).map(item => ({ type:'entrada', value:item.totalValue || 0 })),
    ...consultations.filter(item => item.paymentStatus === 'pago' && onOrBefore(item.paymentDate || item.date, balanceDate)).map(item => ({ type:'entrada', value:item.value || 0 })),
    ...extraRevenues.filter(item => onOrBefore(item.date, balanceDate)).map(item => ({ type:'entrada', value:item.value || 0 })),
    ...expenses.filter(item => item.status === 'pago' && onOrBefore(item.paymentDate || item.dueDate, balanceDate)).map(item => ({ type:'saida', value:item.value || 0 })),
    ...surgeries.filter(item => item.paymentStatus !== 'cancelado' && onOrBefore(item.date, balanceDate)).flatMap(item => {
      const list = []
      if (item.hospitalCost) list.push({ type:'saida', value:item.hospitalCost })
      if (item.anesthesiaCost) list.push({ type:'saida', value:item.anesthesiaCost })
      if (item.materialCost) list.push({ type:'saida', value:item.materialCost })
      if (item.otherCosts) list.push({ type:'saida', value:item.otherCosts })
      return list
    }),
  ].forEach(item => cumulativeCashEntries.push(item))

  const cashAsset = cumulativeCashEntries.reduce((acc, item) => acc + (item.type === 'entrada' ? item.value : -item.value), 0)
  const bankAssets = assets.reduce((acc, item) => acc + (item.value || 0), 0)
  const liabilitiesTotal = liabilities.reduce((acc, item) => acc + (item.value || 0), 0) + payablesOpenTotal
  const assetsTotal = cashAsset + bankAssets + receivablesOpenTotal
  const equity = assetsTotal - liabilitiesTotal

  const byProcedure = procedures.map(procedure => {
    const items = surgeriesInRange.filter(item => item.procedureId === procedure.id)
    const revenue = items.reduce((acc, item) => acc + (item.totalValue || 0), 0)
    const costs = items.reduce((acc, item) => acc + surgeryCosts(item), 0)
    return {
      id:procedure.id,
      name:procedure.name,
      count:items.length,
      revenue,
      profit:revenue - costs,
    }
  }).sort((a, b) => b.profit - a.profit)

  const expensesByCategory = expensesInRange.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + (item.value || 0)
    return acc
  }, {})

  const surgeriesByMonth = {}
  surgeriesInRange.forEach(item => {
    const key = monthKey(item.date)
    if (!key) return
    surgeriesByMonth[key] = (surgeriesByMonth[key] || 0) + 1
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
    cashFlowEntries,
    revenueByMonth,
    expenseByMonth,
    assetsTotal,
    liabilitiesTotal,
    equity,
    byProcedure,
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
