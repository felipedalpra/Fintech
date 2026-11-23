import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getBillingCycle } from '../../src/billing/plans.js'
import { enforceRateLimit, rateLimitResponse } from './securityControls.js'
import {
  findAsaasCustomer,
  createAsaasCustomer,
  findAsaasSubscription,
  createAsaasSubscription,
  findNextAsaasSubscriptionPayment,
} from './billingProvider.js'

// Assinatura SaaS: a Zentri Tech cobra a clínica pelo uso do SurgiMetrics.
// Não confundir com `api/_lib/billing.js`, onde a clínica cobra seus próprios pacientes.

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  try { return JSON.parse(req.body || '{}') } catch { return {} }
}

function bearer(req) {
  const value = req.headers.authorization || req.headers.Authorization || ''
  return value.startsWith('Bearer ') ? value.slice(7) : ''
}

function clients(token = '') {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) throw new Error('Supabase do servidor não configurado.')
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth:{ persistSession:false, autoRefreshToken:false } })
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    auth:{ persistSession:false, autoRefreshToken:false },
    ...(token ? { global:{ headers:{ Authorization:`Bearer ${token}` } } } : {}),
  })
  return { admin, scoped }
}

function isEnabled() {
  return String(process.env.SAAS_BILLING_ENABLED || '').toLowerCase() === 'true'
}

function asaasConfig() {
  const apiKey = String(process.env.SAAS_BILLING_ASAAS_API_KEY || '').trim()
  if (!apiKey) throw new Error('Cobrança por cartão ainda não está configurada. Fale com a Zentri Tech.')
  const environment = process.env.SAAS_BILLING_ASAAS_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
  return { apiKey, environment }
}

async function requireAdminOwner(req) {
  const token = bearer(req)
  if (!token) throw Object.assign(new Error('Sessão ausente.'), { statusCode:401 })
  const { admin, scoped } = clients(token)
  const { data:userData, error:userError } = await scoped.auth.getUser(token)
  if (userError || !userData?.user) throw Object.assign(new Error('Sessão inválida.'), { statusCode:401 })
  const { data:ownerId, error:ownerError } = await scoped.rpc('data_owner_id')
  if (ownerError || !ownerId) throw Object.assign(new Error('Não foi possível identificar a clínica.'), { statusCode:403 })
  if (userData.user.id !== ownerId) {
    const { data:membership } = await admin.from('clinic_members').select('role, clinics!inner(owner_id)')
      .eq('user_id', userData.user.id).eq('clinics.owner_id', ownerId).maybeSingle()
    if (membership?.role !== 'admin') throw Object.assign(new Error('Somente administradores configuram o pagamento da assinatura.'), { statusCode:403 })
  }
  return { admin, user:userData.user, ownerId }
}

function defaultNextDueDate() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function resolveFirstDueDate(value) {
  const raw = String(value || '').slice(0, 10)
  if (!raw) return defaultNextDueDate()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw Object.assign(new Error('Data da primeira cobrança inválida.'), { statusCode:400 })
  const todayKey = new Date().toISOString().slice(0, 10)
  if (raw < todayKey) throw Object.assign(new Error('A data da primeira cobrança não pode ser no passado.'), { statusCode:400 })
  return raw
}

async function resolveCoupon(admin, couponCode) {
  if (!couponCode) return null
  const { data, error } = await admin.from('saas_billing_coupons').select('*').eq('code', couponCode).maybeSingle()
  if (error) throw error
  if (!data || !data.active) throw Object.assign(new Error('Cupom inválido ou inativo.'), { statusCode:400 })
  if (data.expires_at && new Date(data.expires_at) < new Date()) throw Object.assign(new Error('Cupom expirado.'), { statusCode:400 })
  if (data.max_redemptions != null && data.redemptions >= data.max_redemptions) {
    throw Object.assign(new Error('Cupom já atingiu o limite de usos.'), { statusCode:400 })
  }
  return data
}

async function handleStatus(req, res) {
  return res.status(200).json({ enabled:isEnabled() })
}

async function handleSaveContact(req, res) {
  const { admin, ownerId } = await requireAdminOwner(req)
  const body = readBody(req)
  const name = String(body.name || '').trim().slice(0, 200)
  const document = String(body.document || '').replace(/\D/g, '').slice(0, 14)
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254)
  const phone = String(body.phone || '').replace(/\D/g, '').slice(0, 13)
  if (!name) return res.status(400).json({ error:'Informe o nome do responsável pelo pagamento.' })
  if (![11, 14].includes(document.length)) return res.status(400).json({ error:'Informe um CPF ou CNPJ válido.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error:'Informe um e-mail válido.' })

  const { data, error } = await admin.from('billing_accounts').update({
    billing_contact_name:name,
    billing_contact_document:document,
    billing_contact_email:email,
    billing_contact_phone:phone || null,
    updated_at:new Date().toISOString(),
  }).eq('user_id', ownerId).select('*').single()
  if (error) throw error
  return res.status(200).json({ account:data })
}

async function handleCheckout(req, res) {
  if (!isEnabled()) {
    return res.status(409).json({ error:'Cobrança por cartão ainda não está disponível nesta clínica. A Zentri Tech está configurando o novo provedor.' })
  }
  const { admin, ownerId } = await requireAdminOwner(req)
  const body = readBody(req)
  const planId = 'mensal'
  const couponCode = String(body.couponCode || '').trim().toUpperCase()
  const firstDueDate = resolveFirstDueDate(body.firstDueDate)

  const { data:account, error:accountError } = await admin.from('billing_accounts').select('*').eq('user_id', ownerId).maybeSingle()
  if (accountError) throw accountError
  if (!account) return res.status(409).json({ error:'Conta de cobrança não encontrada.' })
  const { billing_contact_name:name, billing_contact_document:document, billing_contact_email:email, billing_contact_phone:phone } = account
  if (!name || !document || !email) {
    return res.status(400).json({ error:'Preencha nome, CPF/CNPJ e e-mail de cobrança antes de continuar.' })
  }

  const coupon = await resolveCoupon(admin, couponCode)
  if (coupon?.applicable_plans?.length && !coupon.applicable_plans.includes(planId)) {
    return res.status(400).json({ error:'Este cupom não é válido para o plano selecionado.' })
  }

  const cycle = getBillingCycle(planId)
  const amount = Number(cycle.chargeAmountCents || 0) / 100
  const config = asaasConfig()
  const externalReference = `saas:${ownerId}`

  let providerCustomerId = account.asaas_customer_id
  if (!providerCustomerId) {
    let customer = await findAsaasCustomer(config, externalReference)
    if (!customer) customer = await createAsaasCustomer(config, { id:ownerId, full_name:name, cpf:document, email, phone })
    if (!customer?.id) throw new Error('O Asaas não confirmou o cadastro do responsável pelo pagamento.')
    providerCustomerId = customer.id
  }

  let subscription = account.asaas_subscription_id ? null : await findAsaasSubscription(config, externalReference)
  if (!subscription && !account.asaas_subscription_id) {
    subscription = await createAsaasSubscription(config, {
      customerId:providerCustomerId,
      planId,
      amount,
      nextDueDate:firstDueDate,
      description:`Assinatura SurgiMetrics - ${cycle.label}`,
      externalReference,
      discount:coupon ? { value:Number(coupon.discount_value), type:coupon.discount_type } : null,
    })
    if (!subscription?.id) throw new Error('O Asaas não confirmou a criação da assinatura.')
  }

  const subscriptionId = subscription?.id || account.asaas_subscription_id
  // A assinatura em si nunca carrega link de pagamento; ele fica na cobrança (payment)
  // que o Asaas gera automaticamente para o ciclo atual.
  const payment = await findNextAsaasSubscriptionPayment(config, subscriptionId)
  const invoiceUrl = payment?.invoiceUrl || null

  const { data:updated, error:updateError } = await admin.from('billing_accounts').update({
    provider:'asaas',
    asaas_customer_id:providerCustomerId,
    asaas_subscription_id:subscriptionId,
    selected_plan:planId,
    coupon_code:coupon?.code || null,
    discount_type:coupon?.discount_type || null,
    discount_value:coupon ? Number(coupon.discount_value) : null,
    invoice_url:invoiceUrl,
    updated_at:new Date().toISOString(),
  }).eq('user_id', ownerId).select('*').single()
  if (updateError) throw updateError

  if (coupon && !account.coupon_code) {
    await admin.from('saas_billing_coupons').update({ redemptions:Number(coupon.redemptions || 0) + 1 }).eq('code', coupon.code)
  }

  if (!invoiceUrl) {
    // Assinatura criada mas a primeira cobrança ainda não tem link (raro): o Asaas
    // também envia o link de pagamento por e-mail/notificação ao responsável.
    return res.status(200).json({ account:updated, url:null })
  }
  return res.status(200).json({ account:updated, url:invoiceUrl })
}

async function handleWebhook(req, res) {
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth:{ persistSession:false, autoRefreshToken:false } })
  const rateLimitResult = await enforceRateLimit({ admin, req, scope:'saas-billing-webhook', limit:120, windowSeconds:60 })
  if (rateLimitResponse(res, rateLimitResult)) return

  const expectedToken = String(process.env.SAAS_BILLING_WEBHOOK_TOKEN || '')
  const receivedToken = String(req.headers['asaas-access-token'] || '')
  if (!expectedToken || receivedToken !== expectedToken) return res.status(401).json({ error:'Webhook não autenticado.' })

  const body = readBody(req)
  const payment = body?.payment || {}
  const externalReference = String(payment.externalReference || '')
  if (!externalReference.startsWith('saas:')) return res.status(200).json({ ok:true, ignored:true })
  const ownerId = externalReference.slice('saas:'.length)
  const status = String(payment.status || '').toUpperCase()
  const paid = ['RECEIVED', 'CONFIRMED'].includes(status)
  const overdue = status === 'OVERDUE'

  const { error } = await admin.from('billing_accounts').update({
    status:paid ? 'active' : overdue ? 'past_due' : 'pending',
    next_due_date:payment.dueDate || null,
    last_event_at:new Date().toISOString(),
  }).eq('user_id', ownerId)
  if (error) throw error
  return res.status(200).json({ ok:true })
}

export async function handleSaasBillingRequest(req, res, action) {
  try {
    if (action === 'saas-billing-status' && req.method === 'GET') return await handleStatus(req, res)
    if (action === 'saas-billing-save-contact' && req.method === 'POST') return await handleSaveContact(req, res)
    if (action === 'saas-billing-checkout' && req.method === 'POST') return await handleCheckout(req, res)
    if (action === 'saas-billing-webhook' && req.method === 'POST') return await handleWebhook(req, res)
    res.setHeader('Allow', action === 'saas-billing-status' ? 'GET' : 'POST')
    return res.status(405).json({ error:'Método não permitido.' })
  } catch (error) {
    const status = Number(error?.statusCode || 0) || (/Asaas|cupom|CPF|e-mail|assinatura/i.test(error?.message || '') ? 400 : 500)
    return res.status(status).json({ error:error?.message || 'Não foi possível processar a assinatura.' })
  }
}
