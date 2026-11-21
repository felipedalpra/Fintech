export const BILLING_CYCLES = [
  {
    id:'mensal',
    label:'Mensal',
    headline:'R$ 500',
    periodLabel:'/mês',
    displayPrice:'R$ 500',
    chargeAmountCents:50000,
    cadenceLabel:'Cobrança mensal recorrente',
    marketingLabel:'R$ 500,00 por mês',
    note:'Plano único do SurgiMetrics, direto no cartão.',
  },
]

export const BILLING_LABELS = BILLING_CYCLES.reduce((acc, cycle) => {
  acc[cycle.id] = cycle.label
  return acc
}, {})

export function getBillingCycle(cycleId = 'mensal') {
  return BILLING_CYCLES.find(item => item.id === cycleId) || BILLING_CYCLES[0]
}

export function buildSignupUrl(cycleId, email = '') {
  const params = new URLSearchParams({ cycle:cycleId })
  if (email) params.set('email', email)
  return `/signup?${params.toString()}`
}

export function buildCheckoutUrl(cycleId) {
  return buildSignupUrl(cycleId)
}
