import { onOrBefore } from '../utils.js'
import { decodePaymentMethod } from './paymentMethodCodec.js'

// Fluxo canônico de parcelas usado tanto pelo razão quanto pelas métricas.
// Mantê-lo fora dos dois módulos evita dependência circular na Fase 10.
export function paymentScheduleFlow(totalValueRaw, item) {
  const totalValue = Math.max(0, Number(totalValueRaw || 0))
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
      openInstallments:paid || totalValue <= 0 ? [] : [{ index:0, date:item?.forecastPaymentDate || item?.dueDate || item?.date, amount:totalValue }],
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
