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
  // Um estorno continua no JSON para auditoria, mas deixa de ser fato de caixa.
  // A presença dele ainda torna o registro explícito, impedindo o fallback legado
  // de `paymentStatus = pago` de ressuscitar a parcela depois do estorno.
  const hasExplicitSettlements = Object.keys(settlements).length > 0

  const withSettlement = entry => {
    const settlement = settlements[String(entry.index + 1)]
    if (!settlement?.receivedDate || settlement?.status === 'reversed') return { ...entry, dueDate:entry.date, settlementDate:null }
    return {
      ...entry,
      dueDate:entry.date,
      settlementDate:String(settlement.receivedDate),
      amount:Math.max(0, Number(settlement.grossAmount ?? settlement.amount ?? entry.amount)),
      feesAmount:Math.max(0, Number(settlement.feesAmount || 0)),
      interestAmount:Math.max(0, Number(settlement.interestAmount || 0)),
      discountAmount:Math.max(0, Number(settlement.discountAmount || 0)),
      method:String(settlement.method || entry.method || ''),
      financialAccountId:settlement.financialAccountId || item?.financialAccountId || null,
    }
  }

  if (schedule.length === 0) {
    const explicit = settlements['1']
    const paid = Boolean(explicit?.receivedDate && explicit?.status !== 'reversed') || (!hasExplicitSettlements && ['pago', 'recebido'].includes(item?.paymentStatus))
    const dueDate = item?.forecastPaymentDate || item?.dueDate || item?.date
    const settlementDate = explicit?.receivedDate || item?.paymentDate || item?.receivedDate || dueDate
    return {
      hasSchedule:false,
      installments:[],
      paidInstallments:paid ? [{ index:0, date:dueDate, dueDate, settlementDate, amount:totalValue, feesAmount:Number(explicit?.feesAmount || 0), interestAmount:Number(explicit?.interestAmount || 0), discountAmount:Number(explicit?.discountAmount || 0), method:explicit?.method || decoded.paymentMethod || '', financialAccountId:explicit?.financialAccountId || item?.financialAccountId || null }] : [],
      openInstallments:paid || totalValue <= 0 ? [] : [{ index:0, date:dueDate, dueDate, settlementDate:null, amount:totalValue, method:decoded.paymentMethod || '', financialAccountId:item?.financialAccountId || null }],
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
  let remainingPaid = totalValue
  const balancedPaidInstallments = paidByDate
    .map(entry => {
      const amount = Math.min(entry.amount, remainingPaid)
      remainingPaid = Math.max(0, remainingPaid - amount)
      return { ...entry, amount }
    })
    .filter(entry => entry.amount > 0)
  const paidIndexes = new Set(paidByDate.map(entry => entry.index))
  const paidAmount = balancedPaidInstallments.reduce((acc, entry) => acc + entry.amount, 0)
  const openAmount = Math.max(0, totalValue - paidAmount)
  let remainingOpen = openAmount
  const openInstallments = normalizedInstallments
    .filter(entry => !paidIndexes.has(entry.index))
    .map(entry => {
      const amount = Math.min(entry.amount, remainingOpen)
      remainingOpen = Math.max(0, remainingOpen - amount)
      return { ...entry, amount }
    })
    .filter(entry => entry.amount > 0)
  if (remainingOpen > 0) {
    if (openInstallments.length > 0) {
      const last = openInstallments[openInstallments.length - 1]
      last.amount += remainingOpen
    } else {
      const fallback = normalizedInstallments[normalizedInstallments.length - 1]
      openInstallments.push({
        ...fallback,
        index:normalizedInstallments.length,
        settlementDate:null,
        amount:remainingOpen,
      })
    }
    remainingOpen = 0
  }
  const balancedInstallments = [...balancedPaidInstallments, ...openInstallments].sort((a, b) => a.index - b.index)

  return {
    hasSchedule:true,
    installments:balancedInstallments,
    paidInstallments:balancedPaidInstallments,
    openInstallments,
    paidAmount,
    openAmount,
  }
}
