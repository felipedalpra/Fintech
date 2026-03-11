export const BILLING_CYCLES = [
  {
    id:'mensal',
    label:'Mensal',
    price:'R$ 297',
    note:'Comece agora com máxima flexibilidade.',
  },
  {
    id:'semestral',
    label:'Semestral',
    price:'R$ 249',
    note:'Melhor custo mensal para quem já quer consistência.',
    badge:'Mais econômico',
  },
  {
    id:'anual',
    label:'Anual',
    price:'R$ 197',
    note:'A melhor condição para clínicas que pensam crescimento de longo prazo.',
    badge:'Melhor valor',
  },
]

export const BILLING_LABELS = BILLING_CYCLES.reduce((acc, cycle) => {
  acc[cycle.id] = cycle.label
  return acc
}, {})

export function buildFreeSignupUrl(cycleId, email = '') {
  const params = new URLSearchParams({ cycle:cycleId, trial:'7', onboarding:'free' })
  if (email) params.set('email', email)
  return `/signup?${params.toString()}`
}

// Future Stripe hook point.
export function buildCheckoutUrl(cycleId) {
  return buildFreeSignupUrl(cycleId)
}
