import { encodePaymentMethod } from './paymentMethodCodec.js'

export const CONSULTATION_INSTALLMENT_FREQUENCIES = [
  { v:'mensal', l:'Mensal' },
  { v:'quinzenal', l:'Quinzenal' },
  { v:'semanal', l:'Semanal' },
]

export function roundPaymentAmount(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

export function shiftInstallmentDate(dateStr, periods, frequency) {
  const raw = String(dateStr || '').trim()
  const base = raw ? new Date(`${raw}T00:00:00`) : new Date()
  if (Number.isNaN(base.getTime())) return raw
  if (frequency === 'semanal') base.setDate(base.getDate() + periods * 7)
  else if (frequency === 'quinzenal') base.setDate(base.getDate() + periods * 14)
  else {
    const originalDay = base.getDate()
    const targetMonth = base.getMonth() + periods
    const targetYear = base.getFullYear() + Math.floor(targetMonth / 12)
    const normalizedMonth = ((targetMonth % 12) + 12) % 12
    const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate()
    base.setFullYear(targetYear, normalizedMonth, Math.min(originalDay, lastDay))
  }
  const year = base.getFullYear()
  const month = String(base.getMonth() + 1).padStart(2, '0')
  const day = String(base.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function generateConsultationInstallments({ total, count, firstDate, frequency, method }) {
  const normalizedCount = Math.max(2, Math.min(60, Math.floor(Number(count) || 2)))
  const totalValue = Math.max(0, Number(total) || 0)
  const baseAmount = Math.floor((totalValue / normalizedCount) * 100) / 100
  const rows = []
  let accumulated = 0
  for (let index = 0; index < normalizedCount; index += 1) {
    const amount = index === normalizedCount - 1
      ? roundPaymentAmount(totalValue - accumulated)
      : baseAmount
    accumulated = roundPaymentAmount(accumulated + amount)
    rows.push({
      date:shiftInstallmentDate(firstDate, index, frequency),
      amount,
      method:method || 'pix',
    })
  }
  return rows
}

function normalizedSchedule(form) {
  const source = form.paymentScheduleMode === 'parcelas'
    ? form.schedulePayments
    : form.paymentScheduleMode === 'duas_datas'
      ? [
        { date:form.payment1Date, amount:form.payment1Amount, method:form.payment1Method },
        { date:form.payment2Date, amount:form.payment2Amount, method:form.payment2Method },
      ]
      : []
  return (Array.isArray(source) ? source : [])
    .map(item => ({
      date:String(item?.date || '').trim(),
      amount:Math.max(0, roundPaymentAmount(item?.amount)),
      method:String(item?.method || '').trim(),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function prepareConsultationPayment(form, totalRaw) {
  const total = Math.max(0, roundPaymentAmount(totalRaw))
  const scheduled = ['duas_datas', 'parcelas'].includes(form.paymentScheduleMode)
  const payments = scheduled ? normalizedSchedule(form) : []
  const scheduledTotal = roundPaymentAmount(payments.reduce((sum, item) => sum + item.amount, 0))
  const minimumRows = form.paymentScheduleMode === 'parcelas' ? 2 : scheduled ? 2 : 0
  const explicitSettlementDates = payments.map((_, index) => form.receiptSettlements?.[String(index + 1)]?.receivedDate).filter(Boolean)
  const hasRealPaidDate = Boolean(String(form.paymentDate || '').trim()) || (payments.length > 0 && explicitSettlementDates.length === payments.length)
  const scheduleValid = (!scheduled || (
    payments.length >= minimumRows
    && payments.every(item => item.date && item.method && item.amount > 0)
    && Math.abs(scheduledTotal - total) <= 0.01
  )) && (!['pago', 'recebido'].includes(form.paymentStatus) || hasRealPaidDate)
  const dueDate = payments[0]?.date || form.forecastPaymentDate || form.dueDate || form.date
  const latestSettlementDate = explicitSettlementDates.sort().slice(-1)[0] || ''

  return {
    payments,
    scheduled,
    scheduledTotal,
    scheduleValid,
    competenceDate:form.date,
    dueDate,
    forecastPaymentDate:dueDate,
    paymentDate:['pago', 'recebido'].includes(form.paymentStatus) ? (form.paymentDate || latestSettlementDate) : '',
    paymentMethod:encodePaymentMethod({
      paymentMode:form.paymentMode,
      paymentMethod:form.paymentMethod,
      mixMethodA:form.mixMethodA,
      mixMethodB:form.mixMethodB,
      mixAmountA:form.mixAmountA,
      mixAmountB:form.mixAmountB,
      payments,
    }),
  }
}
