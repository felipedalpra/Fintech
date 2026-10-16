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
        method:String(entry?.method || '').trim(),
      }))
      .filter(entry => entry.date && entry.amount > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
    : []
  const settlements = item?.receiptSettlements && typeof item.receiptSettlements === 'object'
    ? item.receiptSettlements
    : {}
  const hasExplicitSettlements = Object.keys(settlements).length > 0

  const withSettlement = entry => {
    const settlement = settlements[String(entry.index + 1)]
    if (!settlement?.receivedDate) return { ...entry, dueDate:entry.date, settlementDate:null }
    return {
      ...entry,
      dueDate:entry.date,
      settlementDate:String(settlement.receivedDate),
      amount:entry.amount,
      method:String(settlement.method || entry.method || ''),
    }
  }

  if (schedule.length === 0) {
    const explicit = settlements['1']
    const paid = Boolean(explicit?.receivedDate) || (!hasExplicitSettlements && ['pago', 'recebido'].includes(item?.paymentStatus))
    const dueDate = item?.forecastPaymentDate || item?.dueDate || item?.date
    const settlementDate = explicit?.receivedDate || item?.paymentDate || item?.receivedDate || dueDate
    return {
      hasSchedule:false,
      installments:[],
      paidInstallments:paid ? [{ index:0, date:dueDate, dueDate, settlementDate, amount:totalValue, method:explicit?.method || decoded.paymentMethod || '' }] : [],
      openInstallments:paid || totalValue <= 0 ? [] : [{ index:0, date:dueDate, dueDate, settlementDate:null, amount:totalValue, method:decoded.paymentMethod || '' }],
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
      method:installments[installments.length - 1]?.method || decoded.paymentMethod || '',
    })
  }

  const normalizedInstallments = installments.map(withSettlement)
  const paymentDateCutoff = String(item?.paymentDate || '').trim()
  const paidByDate = hasExplicitSettlements
    ? normalizedInstallments.filter(entry => entry.settlementDate)
    : (item?.paymentStatus === 'pago'
      ? normalizedInstallments.map(entry => ({ ...entry, settlementDate:paymentDateCutoff || entry.date }))
      : (paymentDateCutoff
        ? normalizedInstallments.filter(entry => onOrBefore(entry.date, paymentDateCutoff)).map(entry => ({ ...entry, settlementDate:paymentDateCutoff }))
        : []))
  const paidIndexes = new Set(paidByDate.map(entry => entry.index))
  const openInstallments = normalizedInstallments.filter(entry => !paidIndexes.has(entry.index))
  const paidAmount = Math.min(totalValue, paidByDate.reduce((acc, entry) => acc + entry.amount, 0))
  const openAmount = Math.max(0, totalValue - paidAmount)

  return {
    hasSchedule:true,
    installments:normalizedInstallments,
    paidInstallments:paidByDate,
    openInstallments,
    paidAmount,
    openAmount,
  }
}
