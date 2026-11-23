import { createClient } from '@supabase/supabase-js'
import { getBillingCycle } from '../../src/billing/plans.js'
import { updateAsaasSubscriptionValue } from './billingProvider.js'

// Ferramenta operacional da Zentri Tech (não de uma clínica): ajustar o valor
// contratado da assinatura SaaS de qualquer clínica, independente do preço padrão
// em src/billing/plans.js. Usado para preços de entrada enquanto partes da
// plataforma ainda não estão prontas (ex.: financeiro), reajustando depois por marco.
// Acesso restrito por e-mail (ZENTRI_PLATFORM_ADMIN_EMAILS), fora do sistema de
// papéis por clínica — este endpoint enxerga contas de TODAS as clínicas.

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

function allowedEmails() {
  return String(process.env.ZENTRI_PLATFORM_ADMIN_EMAILS || '')
    .split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
}

async function resolveUserEmail(req) {
  const token = bearer(req)
  if (!token || !supabaseUrl || !supabaseAnonKey) return ''
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    auth:{ persistSession:false, autoRefreshToken:false },
    global:{ headers:{ Authorization:`Bearer ${token}` } },
  })
  const { data:userData, error } = await scoped.auth.getUser(token)
  if (error || !userData?.user) return ''
  return String(userData.user.email || '').trim().toLowerCase()
}

async function requirePlatformAdmin(req) {
  const token = bearer(req)
  if (!token) throw Object.assign(new Error('Sessão ausente.'), { statusCode:401 })
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) throw new Error('Supabase do servidor não configurado.')
  const email = await resolveUserEmail(req)
  if (!email) throw Object.assign(new Error('Sessão inválida.'), { statusCode:401 })
  const allowed = allowedEmails()
  if (!allowed.length || !allowed.includes(email)) {
    throw Object.assign(new Error('Acesso restrito a administradores da plataforma.'), { statusCode:403 })
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth:{ persistSession:false, autoRefreshToken:false } })
  return { admin }
}

// Checagem leve para o frontend decidir rota (ex.: mandar a conta da Zentri direto para
// /zentri-admin em vez do app da clínica) sem nunca expor a lista de e-mails ao navegador.
// Nunca lança erro: sessão ausente/inválida/não autorizada são todas `isPlatformAdmin:false`.
async function handleStatus(req, res) {
  const email = await resolveUserEmail(req)
  const allowed = allowedEmails()
  return res.status(200).json({ isPlatformAdmin:Boolean(email) && allowed.includes(email) })
}

function publicAccount(row) {
  return {
    userId:row.user_id,
    email:row.email,
    status:row.status,
    provider:row.provider,
    selectedPlan:row.selected_plan,
    defaultMonthlyValueCents:getBillingCycle(row.selected_plan).chargeAmountCents,
    contractedMonthlyValueCents:row.contracted_monthly_value_cents,
    asaasSubscriptionId:row.asaas_subscription_id,
    nextDueDate:row.next_due_date,
    couponCode:row.coupon_code,
    billingContactName:row.billing_contact_name,
    createdAt:row.created_at,
  }
}

async function handleListAccounts(req, res) {
  const { admin } = await requirePlatformAdmin(req)
  const { data, error } = await admin.from('billing_accounts').select('*').order('created_at', { ascending:false })
  if (error) throw error
  return res.status(200).json({ accounts:(data || []).map(publicAccount) })
}

async function handleSetValue(req, res) {
  const { admin } = await requirePlatformAdmin(req)
  const body = readBody(req)
  const userId = String(body.userId || '')
  if (!userId) return res.status(400).json({ error:'Informe a conta a ajustar.' })
  const monthlyValueReais = body.monthlyValueReais === null ? null : Number(body.monthlyValueReais)
  if (monthlyValueReais !== null && !(monthlyValueReais > 0)) {
    return res.status(400).json({ error:'Informe um valor maior que zero, ou deixe em branco para voltar ao preço padrão.' })
  }

  const { data:account, error:accountError } = await admin.from('billing_accounts').select('*').eq('user_id', userId).maybeSingle()
  if (accountError) throw accountError
  if (!account) return res.status(404).json({ error:'Conta não encontrada.' })

  const contractedMonthlyValueCents = monthlyValueReais === null ? null : Math.round(monthlyValueReais * 100)

  if (account.provider === 'asaas' && account.asaas_subscription_id) {
    const apiKey = String(process.env.SAAS_BILLING_ASAAS_API_KEY || '').trim()
    if (!apiKey) throw new Error('Cobrança por cartão ainda não está configurada. Fale com a Zentri Tech.')
    const environment = process.env.SAAS_BILLING_ASAAS_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
    const effectiveValue = monthlyValueReais ?? getBillingCycle(account.selected_plan).chargeAmountCents / 100
    await updateAsaasSubscriptionValue({ apiKey, environment }, account.asaas_subscription_id, effectiveValue)
  }

  const { data:updated, error:updateError } = await admin.from('billing_accounts').update({
    contracted_monthly_value_cents:contractedMonthlyValueCents,
    updated_at:new Date().toISOString(),
  }).eq('user_id', userId).select('*').single()
  if (updateError) throw updateError
  return res.status(200).json({ account:publicAccount(updated) })
}

export async function handlePlatformAdminRequest(req, res, action) {
  try {
    if (action === 'platform-admin-status' && req.method === 'GET') return await handleStatus(req, res)
    if (action === 'platform-admin-list-accounts' && req.method === 'GET') return await handleListAccounts(req, res)
    if (action === 'platform-admin-set-value' && req.method === 'POST') return await handleSetValue(req, res)
    res.setHeader('Allow', action === 'platform-admin-list-accounts' ? 'GET' : 'POST')
    return res.status(405).json({ error:'Método não permitido.' })
  } catch (error) {
    const status = Number(error?.statusCode || 0) || (/Asaas|valor|conta/i.test(error?.message || '') ? 400 : 500)
    return res.status(status).json({ error:error?.message || 'Não foi possível processar a solicitação.' })
  }
}
