import { supabase } from './supabase.js'

const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'

async function accessToken() {
  if (E2E_BYPASS_AUTH) return 'e2e-token'
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || ''
}

async function stripeAuthFetch(path, payload = {}) {
  const token = await accessToken()
  if (!token) throw new Error('Sessão inválida. Entre novamente.')
  const response = await fetch(path, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
    body:JSON.stringify(payload),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`)
  return json
}

async function billingFetch(action, { method = 'POST', body } = {}) {
  const token = await accessToken()
  if (!token) throw new Error('Sessão inválida. Entre novamente.')
  const response = await fetch(`/api/financial/analysis?action=${encodeURIComponent(action)}`, {
    method,
    headers:{
      Authorization:`Bearer ${token}`,
      ...(body ? { 'Content-Type':'application/json' } : {}),
    },
    ...(body ? { body:JSON.stringify(body) } : {}),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error || `Falha HTTP ${response.status}.`)
  return json
}

export const fetchBillingStatus = () => billingFetch('billing-status', { method:'GET' })
export const connectBillingProvider = payload => billingFetch('billing-connect', { body:payload })
export const createBillingCharge = payload => billingFetch('billing-create', { body:payload })
export const cancelBillingCharge = chargeId => billingFetch('billing-cancel', { body:{ chargeId } })
export const syncBillingCharge = chargeId => billingFetch('billing-sync', { body:{ chargeId } })

// Assinatura SaaS da plataforma (Stripe) permanece separada das cobranças clínicas.
export const createStripeCheckoutSession = planId => stripeAuthFetch('/api/stripe/create-checkout-session', { planId })
export const createStripePortalSession = () => stripeAuthFetch('/api/stripe/create-portal-session')
