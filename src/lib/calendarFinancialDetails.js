const SIMPLE_PAYMENT_METHODS = new Set(['pix', 'cartao', 'dinheiro', 'boleto', 'transferencia'])

function amount(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export function createCalendarFinancialDraft(type, record = {}, date = '') {
  const rawPaymentMethod = String(record.paymentMethod || 'pix')
  const hasAdvancedPaymentMethod = !SIMPLE_PAYMENT_METHODS.has(rawPaymentMethod)
  const dueDate = record.dueDate || record.forecastPaymentDate || date

  return {
    value:amount(record.value),
    totalValue:amount(record.totalValue),
    dueDate,
    paymentMethod:hasAdvancedPaymentMethod ? '__advanced__' : rawPaymentMethod,
    originalPaymentMethod:rawPaymentMethod,
    paymentMethodTouched:false,
    hasAdvancedPaymentMethod,
    paymentStatus:record.paymentStatus || 'pendente',
    paymentDate:record.paymentDate || '',
    invoiceIssuancePercent:amount(record.invoiceIssuancePercent),
    paymentType:record.paymentType || 'particular',
    insurance:record.insurance || '',
    hospitalCost:amount(record.hospitalCost),
    anesthesiaCost:amount(record.anesthesiaCost),
    materialCost:amount(record.materialCost),
    otherCosts:amount(record.otherCosts),
  }
}

export function buildCalendarFinancialPatch(type, draft) {
  const paymentMethod = draft.hasAdvancedPaymentMethod && !draft.paymentMethodTouched
    ? draft.originalPaymentMethod
    : draft.paymentMethod || 'pix'
  const common = {
    dueDate:draft.dueDate || draft.date || null,
    paymentMethod,
    paymentStatus:draft.paymentStatus || 'pendente',
    paymentDate:draft.paymentStatus === 'pago' ? (draft.paymentDate || '') : '',
    invoiceIssuancePercent:Math.min(100, amount(draft.invoiceIssuancePercent)),
  }

  if (type === 'surgery') {
    return {
      ...common,
      totalValue:amount(draft.totalValue),
      hospitalCost:amount(draft.hospitalCost),
      anesthesiaCost:amount(draft.anesthesiaCost),
      materialCost:amount(draft.materialCost),
      otherCosts:amount(draft.otherCosts),
    }
  }

  return {
    ...common,
    value:amount(draft.value),
    paymentType:draft.paymentType || 'particular',
    insurance:draft.paymentType === 'particular' ? '' : String(draft.insurance || '').trim(),
    forecastPaymentDate:draft.dueDate || draft.date || null,
  }
}
