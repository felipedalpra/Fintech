import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import {
  billingProviderCatalog,
  getBillingProvider,
} from './billingProvider.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const appUrl = String(process.env.APP_URL || process.env.VITE_APP_URL || '').replace(/\/+$/, '')

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

function encryptionKey() {
  const secret = process.env.BILLING_DATA_ENCRYPTION_KEY || process.env.APP_DATA_ENCRYPTION_KEY
  if (!secret || secret.length < 24) throw new Error('BILLING_DATA_ENCRYPTION_KEY ou APP_DATA_ENCRYPTION_KEY não configurada com segurança.')
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptBillingSecret(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.')
}

export function decryptBillingSecret(payload) {
  const [ivRaw, tagRaw, encryptedRaw] = String(payload || '').split('.')
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error('Credencial de cobrança inválida.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64url')), decipher.final()]).toString('utf8')
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

async function authContext(req, { requireFinance = true, requireAdmin = false } = {}) {
  const token = bearer(req)
  if (!token) throw Object.assign(new Error('Sessão ausente.'), { statusCode:401 })
  const { admin, scoped } = clients(token)
  const { data:userData, error:userError } = await scoped.auth.getUser(token)
  if (userError || !userData?.user) throw Object.assign(new Error('Sessão inválida.'), { statusCode:401 })
  const { data:ownerId, error:ownerError } = await scoped.rpc('data_owner_id')
  if (ownerError || !ownerId) throw Object.assign(new Error('Não foi possível identificar a clínica.'), { statusCode:403 })
  if (requireFinance) {
    const { data:canManage, error:roleError } = await scoped.rpc('finance_role_can_manage')
    if (roleError || !canManage) throw Object.assign(new Error('Seu perfil não pode administrar cobranças.'), { statusCode:403 })
  }
  if (requireAdmin && userData.user.id !== ownerId) {
    const { data:membership } = await admin.from('clinic_members').select('role, clinics!inner(owner_id)')
      .eq('user_id', userData.user.id).eq('clinics.owner_id', ownerId).maybeSingle()
    if (membership?.role !== 'admin') throw Object.assign(new Error('Somente administradores configuram o provedor.'), { statusCode:403 })
  }
  return { token, user:userData.user, ownerId, admin, scoped }
}

async function loadConnection(admin, ownerId) {
  const { data, error } = await admin.from('billing_provider_connections').select('*').eq('user_id', ownerId).maybeSingle()
  if (error) throw error
  if (!data || data.status !== 'connected') throw Object.assign(new Error('Conecte e valide um provedor em Configurações → Cobranças.'), { statusCode:409 })
  const adapter = getBillingProvider(data.provider)
  let credentials
  if (data.encrypted_credentials) {
    try { credentials = JSON.parse(decryptBillingSecret(data.encrypted_credentials)) } catch { throw new Error('Credenciais do provedor estão inválidas.') }
  } else {
    credentials = { apiKey:decryptBillingSecret(data.encrypted_api_key) }
  }
  return {
    row:data,
    adapter,
    config:adapter.connectionConfig(credentials, data.environment),
  }
}

function publicCharge(row) {
  if (!row) return null
  return {
    id:row.id,
    provider:row.provider,
    billingType:row.billing_type,
    amount:Number(row.amount || 0),
    netAmount:row.net_amount == null ? null : Number(row.net_amount),
    feeAmount:Number(row.fee_amount || 0),
    dueDate:row.due_date,
    status:row.status,
    invoiceUrl:row.invoice_url,
    bankSlipUrl:row.bank_slip_url,
    boletoBarcode:row.boleto_barcode,
    pixPayload:row.pix_payload,
    paidAt:row.paid_at,
    description:row.description,
    lastError:row.last_error,
  }
}

async function handleStatus(req, res) {
  const { admin, ownerId } = await authContext(req, { requireAdmin:true })
  const { data, error } = await admin.from('billing_provider_connections')
    .select('provider,environment,api_key_last4,status,last_error,verified_at,updated_at,provider_webhook_id')
    .eq('user_id', ownerId).maybeSingle()
  if (error) throw error
  return res.status(200).json({
    providers:billingProviderCatalog(),
    configured:Boolean(data),
    connection:data ? {
      provider:data.provider,
      environment:data.environment,
      apiKeyLast4:data.api_key_last4,
      status:data.status,
      lastError:data.last_error,
      verifiedAt:data.verified_at,
      webhookConfigured:Boolean(data.provider_webhook_id),
    } : null,
  })
}

async function handleConnect(req, res) {
  const { admin, ownerId, user } = await authContext(req, { requireAdmin:true })
  const body = readBody(req)
  const provider = String(body.provider || 'asaas')
  const adapter = getBillingProvider(provider)
  const apiKey = String(body.apiKey || '').trim()
  const environment = body.environment === 'production' ? 'production' : 'sandbox'
  if (!apiKey) return res.status(400).json({ error:'Informe a chave da API Asaas.' })
  if (!appUrl.startsWith('https://')) return res.status(500).json({ error:'APP_URL HTTPS é obrigatória para configurar o webhook.' })

  const credentials = { apiKey }
  const config = adapter.connectionConfig(credentials, environment)
  await adapter.validateConnection(config)
  const { data:previous } = await admin.from('billing_provider_connections').select('provider,environment,provider_webhook_id').eq('user_id', ownerId).maybeSingle()
  const authToken = crypto.randomBytes(36).toString('base64url')
  const webhookInput = {
    url:`${appUrl}/api/financial/analysis?action=billing-webhook&provider=${encodeURIComponent(provider)}`,
    email:user.email,
    authToken,
  }
  let webhook
  try {
    webhook = await adapter.configureWebhook(config, {
      ...webhookInput,
      webhookId:previous?.provider === provider && previous?.environment === environment ? previous.provider_webhook_id : '',
    })
  } catch (error) {
    if (!previous?.provider_webhook_id) throw error
    webhook = await adapter.configureWebhook(config, webhookInput)
  }
  if (!webhook?.id) throw new Error('O Asaas não confirmou a configuração do webhook.')

  const now = new Date().toISOString()
  const { error } = await admin.from('billing_provider_connections').upsert({
    user_id:ownerId,
    provider,
    environment,
    encrypted_api_key:null,
    encrypted_credentials:encryptBillingSecret(JSON.stringify(credentials)),
    api_key_last4:adapter.credentialLabel(credentials),
    capabilities:adapter.capabilities,
    webhook_token_hash:sha256(authToken),
    provider_webhook_id:webhook.id,
    status:'connected',
    last_error:null,
    verified_at:now,
    updated_at:now,
  }, { onConflict:'user_id' })
  if (error) throw error
  return res.status(200).json({ ok:true, provider, environment, webhookConfigured:true, apiKeyLast4:adapter.credentialLabel(credentials) })
}

async function ensureProviderCustomer(admin, connection, ownerId, patient) {
  if (connection.adapter.capabilities.customerRegistration === false) return null
  const provider = connection.adapter.id
  const { data:mapping, error:mappingError } = await admin.from('billing_provider_customers').select('provider_customer_id')
    .eq('user_id', ownerId).eq('patient_id', patient.id).eq('provider', provider).eq('environment', connection.row.environment).maybeSingle()
  if (mappingError) throw mappingError
  if (mapping?.provider_customer_id) return mapping.provider_customer_id

  let providerCustomer = await connection.adapter.findCustomer(connection.config, patient.id)
  if (!providerCustomer) providerCustomer = await connection.adapter.createCustomer(connection.config, patient)
  if (!providerCustomer?.id) throw new Error(`${connection.adapter.name} não confirmou o cadastro do paciente.`)
  const { error } = await admin.from('billing_provider_customers').upsert({
    user_id:ownerId,
    patient_id:patient.id,
    provider,
    environment:connection.row.environment,
    provider_customer_id:providerCustomer.id,
    updated_at:new Date().toISOString(),
  }, { onConflict:'user_id,patient_id,provider,environment' })
  if (error) throw error
  return providerCustomer.id
}

async function resolveInstallment(admin, ownerId, body) {
  const sourceType = String(body.sourceType || '')
  const sourceId = String(body.sourceId || '')
  const sourceComponent = String(body.sourceComponent || 'revenue')
  const installmentNumber = Number(body.installmentNumber || 1)
  if (!['surgery','consultation','product_sale','extra_revenue'].includes(sourceType)) {
    throw Object.assign(new Error('Esta origem ainda não permite emissão automática.'), { statusCode:400 })
  }
  const { data:entry, error:entryError } = await admin.from('financial_entries').select('*')
    .eq('user_id', ownerId).eq('source_type', sourceType).eq('source_id', sourceId)
    .eq('source_component', sourceComponent).eq('direction', 'receivable').is('archived_at', null).maybeSingle()
  if (entryError) throw entryError
  if (!entry) throw Object.assign(new Error('Título não encontrado no razão. Salve ou recarregue o financeiro antes de emitir.'), { statusCode:409 })
  const { data:installment, error:installmentError } = await admin.from('financial_installments').select('*')
    .eq('user_id', ownerId).eq('financial_entry_id', entry.id).eq('installment_number', installmentNumber)
    .is('archived_at', null).maybeSingle()
  if (installmentError) throw installmentError
  if (!installment || installment.status === 'paid' || installment.settlement_date) {
    throw Object.assign(new Error('A parcela já foi liquidada ou não está mais disponível.'), { statusCode:409 })
  }
  if (!entry.party_id) throw Object.assign(new Error('Vincule um paciente ao lançamento antes de emitir a cobrança.'), { statusCode:400 })
  return { entry, installment }
}

async function handleCreate(req, res) {
  const { admin, ownerId, user } = await authContext(req)
  const body = readBody(req)
  const billingType = String(body.billingType || '').toUpperCase()
  const idempotencyKey = String(body.idempotencyKey || '')
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return res.status(400).json({ error:'Identificador idempotente inválido.' })
  if (!['BOLETO','PIX'].includes(billingType)) return res.status(400).json({ error:'Escolha boleto ou Pix.' })
  const { entry, installment } = await resolveInstallment(admin, ownerId, body)

  const { data:idempotent } = await admin.from('billing_charges').select('*')
    .eq('user_id', ownerId).eq('idempotency_key', idempotencyKey).maybeSingle()
  if (idempotent && (idempotent.financial_installment_id !== installment.id || idempotent.billing_type !== billingType)) {
    return res.status(409).json({ error:'Esta tentativa já foi usada para outra cobrança. Reabra a emissão e tente novamente.' })
  }
  if (idempotent && !['creating','failed'].includes(idempotent.status)) {
    return res.status(200).json({ charge:publicCharge(idempotent), reused:true })
  }

  const { data:active } = await admin.from('billing_charges').select('*').eq('financial_installment_id', installment.id)
    .not('status', 'in', '("canceled","refunded","failed")').maybeSingle()
  if (active && active.id !== idempotent?.id) return res.status(200).json({ charge:publicCharge(active), reused:true })

  const { data:patient, error:patientError } = await admin.from('patients')
    .select('id,full_name,cpf,email,phone').eq('id', entry.party_id).eq('user_id', ownerId).maybeSingle()
  if (patientError) throw patientError
  if (!patient) return res.status(400).json({ error:'Paciente vinculado não encontrado.' })
  const connection = await loadConnection(admin, ownerId)
  connection.adapter.validatePatient(patient)
  const chargeId = idempotent?.id || crypto.randomUUID()
  const externalReference = idempotent?.external_reference || `surgimetrics:${ownerId}:${installment.id}:${chargeId}`
  const description = String(entry.description || entry.party_name_snapshot || 'Cobrança SurgiMetrics').slice(0, 500)
  const amount = Math.max(0, Number(installment.amount || 0) - Number(installment.paid_amount || 0))
  if (!(amount > 0) || !installment.due_date) return res.status(409).json({ error:'Parcela sem valor aberto ou vencimento válido.' })

  let created = idempotent
  if (created) {
    const { data:retryRow, error:retryError } = await admin.from('billing_charges').update({
      status:'creating', last_error:null, updated_at:new Date().toISOString(),
    }).eq('id', created.id).select('*').single()
    if (retryError) throw retryError
    created = retryRow
  } else {
    const { data:newRow, error:createError } = await admin.from('billing_charges').insert({
      id:chargeId,
      user_id:ownerId,
      created_by:user.id,
      patient_id:patient.id,
      financial_entry_id:entry.id,
      financial_installment_id:installment.id,
      provider:connection.adapter.id,
      environment:connection.row.environment,
      billing_type:billingType,
      idempotency_key:idempotencyKey,
      external_reference:externalReference,
      description,
      amount,
      due_date:installment.due_date,
      status:'creating',
    }).select('*').single()
    if (createError) {
      if (createError.code === '23505') {
        const { data:existing } = await admin.from('billing_charges').select('*')
          .eq('financial_installment_id', installment.id).not('status', 'in', '("canceled","refunded","failed")').maybeSingle()
        if (existing) return res.status(200).json({ charge:publicCharge(existing), reused:true })
      }
      throw createError
    }
    created = newRow
  }

  try {
    const customerId = await ensureProviderCustomer(admin, connection, ownerId, patient)
    let payment = await connection.adapter.findCharge(connection.config, externalReference)
    if (!payment) payment = await connection.adapter.createCharge(connection.config, {
      customerId,
      billingType,
      amount,
      dueDate:installment.due_date,
      description,
      externalReference,
    })
    if (!payment?.id) throw new Error(`${connection.adapter.name} não confirmou a criação da cobrança.`)
    let instructions = {}
    try { instructions = await connection.adapter.fetchInstructions(connection.config, payment) } catch { /* cobrança existe; instrução pode ser consultada depois */ }
    const { data:updated, error:updateError } = await admin.from('billing_charges').update({
      provider_charge_id:payment.id,
      status:'pending',
      invoice_url:instructions.invoiceUrl || payment.invoiceUrl || null,
      bank_slip_url:instructions.bankSlipUrl || payment.bankSlipUrl || null,
      boleto_barcode:instructions.boletoBarcode || null,
      pix_payload:instructions.pixPayload || null,
      provider_payload:{ id:payment.id, status:payment.status, billingType:payment.billingType },
      updated_at:new Date().toISOString(),
    }).eq('id', created.id).select('*').single()
    if (updateError) throw updateError
    return res.status(200).json({ charge:publicCharge(updated), reused:false })
  } catch (error) {
    await admin.from('billing_charges').update({ status:'failed', last_error:error.message, updated_at:new Date().toISOString() }).eq('id', created.id)
    throw error
  }
}

async function handleCancel(req, res) {
  const { admin, ownerId } = await authContext(req)
  const chargeId = String(readBody(req).chargeId || '')
  const { data:charge, error } = await admin.from('billing_charges').select('*').eq('id', chargeId).eq('user_id', ownerId).maybeSingle()
  if (error) throw error
  if (!charge) return res.status(404).json({ error:'Cobrança não encontrada.' })
  if (['confirmed','received'].includes(charge.status)) return res.status(409).json({ error:'Cobrança já recebida não pode ser cancelada por esta ação.' })
  const connection = await loadConnection(admin, ownerId)
  if (charge.provider !== connection.adapter.id) return res.status(409).json({ error:'A cobrança pertence a outro provedor conectado.' })
  if (charge.provider_charge_id) await connection.adapter.cancelCharge(connection.config, charge.provider_charge_id)
  const { data:updated, error:updateError } = await admin.from('billing_charges').update({
    status:'canceled', canceled_at:new Date().toISOString(), updated_at:new Date().toISOString(),
  }).eq('id', charge.id).select('*').single()
  if (updateError) throw updateError
  return res.status(200).json({ charge:publicCharge(updated) })
}

async function handleWebhook(req, res) {
  const provider = String(req.query?.provider || 'asaas')
  const adapter = getBillingProvider(provider)
  const token = adapter.webhookToken(req)
  if (token.length < 32) return res.status(401).json({ error:'Webhook não autenticado.' })
  const { admin } = clients()
  const { data:connection, error:connectionError } = await admin.from('billing_provider_connections')
    .select('user_id,environment').eq('provider', provider).eq('webhook_token_hash', sha256(token)).eq('status', 'connected').maybeSingle()
  if (connectionError) throw connectionError
  if (!connection) return res.status(401).json({ error:'Webhook não autenticado.' })

  const body = readBody(req)
  const normalized = adapter.normalizeWebhook(body)
  if (!normalized.providerChargeId || !normalized.eventType) return res.status(200).json({ ok:true, ignored:true })
  const payloadHash = sha256(JSON.stringify(body))
  const eventId = normalized.eventId || sha256(`${normalized.eventType}|${normalized.providerChargeId}|${payloadHash}`)
  if (!normalized.status) return res.status(200).json({ ok:true, ignored:true })

  const { error:payloadError } = await admin.from('billing_charges').update({
    provider_payload:{
      event:normalized.eventType,
      status:body?.payment?.status || null,
      billingType:body?.payment?.billingType || null,
      updatedAt:new Date().toISOString(),
    },
    updated_at:new Date().toISOString(),
  }).eq('user_id', connection.user_id).eq('provider', provider).eq('environment', connection.environment).eq('provider_charge_id', normalized.providerChargeId)
  if (payloadError) throw payloadError

  const { data, error } = await admin.rpc('apply_billing_webhook_event', {
    p_provider:provider,
    p_environment:connection.environment,
    p_user_id:connection.user_id,
    p_provider_event_id:eventId,
    p_event_type:normalized.eventType,
    p_provider_charge_id:normalized.providerChargeId,
    p_payload_hash:payloadHash,
    p_status:normalized.status,
    p_paid_at:normalized.paidAt,
    p_gross_amount:normalized.grossAmount,
    p_net_amount:normalized.netAmount,
    p_payment_method:normalized.paymentMethod,
  })
  if (error) {
    const errorMessage = String(error.message || 'Falha transacional na baixa.').slice(0, 1000)
    await admin.from('billing_webhook_events').upsert({
      user_id:connection.user_id,
      provider,
      environment:connection.environment,
      provider_event_id:eventId,
      event_type:normalized.eventType,
      provider_charge_id:normalized.providerChargeId,
      payload_hash:payloadHash,
      status:'failed',
      error_message:errorMessage,
      processed_at:new Date().toISOString(),
    }, { onConflict:'provider,environment,provider_event_id' })
    await admin.from('billing_charges').update({ last_error:errorMessage, updated_at:new Date().toISOString() })
      .eq('user_id', connection.user_id).eq('provider_charge_id', normalized.providerChargeId)
    throw error
  }
  return res.status(200).json({ ok:true, processed:Boolean(data) })
}

async function handleSync(req, res) {
  const { admin, ownerId } = await authContext(req)
  const chargeId = String(readBody(req).chargeId || '')
  const { data:charge, error } = await admin.from('billing_charges').select('*').eq('id', chargeId).eq('user_id', ownerId).maybeSingle()
  if (error) throw error
  if (!charge) return res.status(404).json({ error:'Cobrança não encontrada.' })
  if (!charge.provider_charge_id) return res.status(409).json({ error:'Cobrança ainda não possui identificação externa.' })
  const connection = await loadConnection(admin, ownerId)
  if (charge.provider !== connection.adapter.id) return res.status(409).json({ error:'A cobrança pertence a outro provedor conectado.' })
  const payment = await connection.adapter.findCharge(connection.config, charge.external_reference)
  if (!payment?.id || payment.id !== charge.provider_charge_id) return res.status(409).json({ error:'O provedor não retornou a cobrança esperada.' })
  const normalized = connection.adapter.normalizeCharge(payment)
  if (!normalized.status) return res.status(200).json({ charge:publicCharge(charge), ignored:true })
  const payloadHash = sha256(JSON.stringify(payment))
  const eventId = `sync:${charge.provider_charge_id}:${normalized.status}:${payloadHash}`
  const { error:payloadError } = await admin.from('billing_charges').update({
    provider_payload:{
      id:payment.id,
      status:payment.status || null,
      billingType:payment.billingType || null,
      synchronizedAt:new Date().toISOString(),
    },
    updated_at:new Date().toISOString(),
  }).eq('id', charge.id).eq('provider', charge.provider)
  if (payloadError) throw payloadError
  const { data:updated, error:applyError } = await admin.rpc('apply_billing_webhook_event', {
    p_provider:charge.provider,
    p_environment:charge.environment,
    p_user_id:ownerId,
    p_provider_event_id:eventId,
    p_event_type:normalized.eventType,
    p_provider_charge_id:charge.provider_charge_id,
    p_payload_hash:payloadHash,
    p_status:normalized.status,
    p_paid_at:normalized.paidAt,
    p_gross_amount:normalized.grossAmount,
    p_net_amount:normalized.netAmount,
    p_payment_method:normalized.paymentMethod,
  })
  if (applyError) {
    const errorMessage = String(applyError.message || 'Falha transacional na consulta.').slice(0, 1000)
    await admin.from('billing_webhook_events').upsert({
      user_id:ownerId,
      provider:charge.provider,
      environment:charge.environment,
      provider_event_id:eventId,
      event_type:normalized.eventType,
      provider_charge_id:charge.provider_charge_id,
      payload_hash:payloadHash,
      status:'failed',
      error_message:errorMessage,
      processed_at:new Date().toISOString(),
    }, { onConflict:'provider,environment,provider_event_id' })
    await admin.from('billing_charges').update({ last_error:errorMessage, updated_at:new Date().toISOString() }).eq('id', charge.id)
    throw applyError
  }
  return res.status(200).json({ charge:publicCharge(updated || charge), synced:true })
}

export async function handleBillingRequest(req, res, action) {
  try {
    if (action === 'billing-status' && req.method === 'GET') return handleStatus(req, res)
    if (action === 'billing-connect' && req.method === 'POST') return handleConnect(req, res)
    if (action === 'billing-create' && req.method === 'POST') return handleCreate(req, res)
    if (action === 'billing-cancel' && req.method === 'POST') return handleCancel(req, res)
    if (action === 'billing-sync' && req.method === 'POST') return handleSync(req, res)
    if (action === 'billing-webhook' && req.method === 'POST') return handleWebhook(req, res)
    res.setHeader('Allow', action === 'billing-status' ? 'GET' : 'POST')
    return res.status(405).json({ error:'Método não permitido.' })
  } catch (error) {
    const status = Number(error?.statusCode || 0) || (/Asaas|cobrança|CPF|parcela/i.test(error?.message || '') ? 400 : 500)
    return res.status(status).json({ error:error?.message || 'Não foi possível processar a cobrança.' })
  }
}
