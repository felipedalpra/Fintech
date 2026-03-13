export const FREE_TRIAL_DAYS = 30

export const BILLING_CYCLES = [
  {
    id:'mensal',
    label:'Mensal',
    headline:'R$ 197',
    periodLabel:'/mês',
    displayPrice:'R$ 197',
    chargeAmountCents:19700,
    cadenceLabel:'Cobrança mensal',
    marketingLabel:'R$ 197,00 por mês',
    note:'Flexibilidade máxima para começar sem travar caixa.',
  },
  {
    id:'semestral',
    label:'Semestral',
    headline:'6x de R$ 177',
    periodLabel:'/semestre',
    displayPrice:'R$ 1.062',
    chargeAmountCents:106200,
    cadenceLabel:'Cobrança recorrente a cada 6 meses',
    marketingLabel:'equivalente a 6x de R$ 177,00',
    note:'Melhor custo mensal para clínica que já quer previsibilidade.',
    badge:'Mais econômico',
  },
  {
    id:'anual',
    label:'Anual',
    headline:'12x de R$ 147',
    periodLabel:'/ano',
    displayPrice:'R$ 1.764',
    chargeAmountCents:176400,
    cadenceLabel:'Cobrança recorrente anual',
    marketingLabel:'equivalente a 12x de R$ 147,00',
    note:'Menor custo mensal para quem quer operar com visão de longo prazo.',
    badge:'Melhor valor',
  },
]

export const BILLING_LABELS = BILLING_CYCLES.reduce((acc, cycle) => {
  acc[cycle.id] = cycle.label
  return acc
}, {})

export function getBillingCycle(cycleId = 'mensal') {
  return BILLING_CYCLES.find(item => item.id === cycleId) || BILLING_CYCLES[0]
}

export function buildTrialSignupUrl(cycleId, email = '') {
  const params = new URLSearchParams({
    cycle:cycleId,
    trial:String(FREE_TRIAL_DAYS),
    onboarding:'trial',
  })
  if (email) params.set('email', email)
  return `/signup?${params.toString()}`
}

export function buildCheckoutUrl(cycleId) {
  return buildTrialSignupUrl(cycleId)
}

export function buildStripePriceMap() {
  return {
    mensal:process.env.STRIPE_PRICE_MENSAL || '',
    semestral:process.env.STRIPE_PRICE_SEMESTRAL || '',
    anual:process.env.STRIPE_PRICE_ANUAL || '',
  }
}
