import { encodePaymentMethod } from './paymentMethodCodec.js'

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({
      date:String(row?.date || '').trim(),
      amount:Math.max(0, round2(row?.amount)),
      method:String(row?.method || '').trim(),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function prepareProductSalePayment(form, totalRaw) {
  const total = Math.max(0, round2(totalRaw))
  const scheduled = ['duas_datas', 'parcelas'].includes(form.paymentScheduleMode)
  const source = form.paymentScheduleMode === 'parcelas'
    ? form.schedulePayments
    : form.paymentScheduleMode === 'duas_datas'
      ? [
        { date:form.payment1Date, amount:form.payment1Amount, method:form.payment1Method },
        { date:form.payment2Date, amount:form.payment2Amount, method:form.payment2Method },
      ]
      : []
  const payments = scheduled ? normalizeRows(source) : []
  const scheduledTotal = round2(payments.reduce((sum, row) => sum + row.amount, 0))
  const minimumRows = form.paymentScheduleMode === 'parcelas' ? 2 : scheduled ? 2 : 0
  const scheduleValid = !scheduled || (
    payments.length >= minimumRows
    && payments.every(row => row.date && row.method && row.amount > 0)
    && Math.abs(scheduledTotal - total) <= 0.01
  )
  const dueDate = payments[0]?.date || form.dueDate || form.saleDate

  return {
    payments,
    scheduled,
    scheduledTotal,
    scheduleValid,
    dueDate,
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

export { round2 as roundProductSalePayment }
