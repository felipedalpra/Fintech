const ASAAS_URLS = {
  sandbox:'https://api-sandbox.asaas.com/v3',
  production:'https://api.asaas.com/v3',
}

const PROVIDER_CATALOG = [
  {
    id:'asaas',
    name:'Asaas',
    available:true,
    connectionMode:'api_key',
    capabilities:{ chargeTypes:['PIX','BOLETO'], create:true, cancel:true, statusQuery:true, webhook:true, refunds:true, feeReporting:true, statementSync:false, customerRegistration:true },
  },
  {
    id:'direct_bank',
    name:'Banco direto',
    available:false,
    connectionMode:'bank_contract',
    capabilities:{ chargeTypes:['PIX','BOLETO'], create:true, cancel:true, statusQuery:true, webhook:true, refunds:true, feeReporting:true, statementSync:true, customerRegistration:false },
    unavailableReason:'Selecione o banco e conclua a contratação/homologação da API para ativar o conector correspondente.',
  },
]

export function asaasBaseUrl(environment) {
  const url = ASAAS_URLS[environment]
  if (!url) throw new Error('Ambiente Asaas inválido.')
  return url
}

function providerError(data, status) {
  const descriptions = Array.isArray(data?.errors)
    ? data.errors.map(item => item?.description || item?.code).filter(Boolean)
    : []
  const detail = descriptions.join(' · ') || data?.message || `HTTP ${status}`
  return `Asaas: ${detail}`
}

export async function asaasRequest({ environment, apiKey, path, method = 'GET', body, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('Chave da API Asaas não configurada.')
  const response = await fetchImpl(`${asaasBaseUrl(environment)}${path}`, {
    method,
    headers:{
      accept:'application/json',
      access_token:apiKey,
      'User-Agent':'SurgiMetrics/1.0 billing-integration',
      ...(body ? { 'Content-Type':'application/json' } : {}),
    },
    ...(body ? { body:JSON.stringify(body) } : {}),
  })
  const raw = await response.text().catch(() => '')
  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { data = {} }
  if (!response.ok) throw new Error(providerError(data, response.status))
  return data
}

export async function validateAsaasConnection(config) {
  await asaasRequest({ ...config, path:'/customers?limit=1&offset=0' })
  return true
}

export async function configureAsaasWebhook(config, { webhookId = '', url, email, authToken }) {
  const payload = {
    name:'SurgiMetrics - cobranças',
    url,
    email,
    enabled:true,
    interrupted:false,
    apiVersion:3,
    authToken,
    sendType:'SEQUENTIALLY',
    events:[
      'PAYMENT_CREATED',
      'PAYMENT_UPDATED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_RECEIVED',
      'PAYMENT_OVERDUE',
      'PAYMENT_DELETED',
      'PAYMENT_REFUNDED',
      'PAYMENT_BANK_SLIP_CANCELLED',
    ],
  }
  return asaasRequest({
    ...config,
    path:webhookId ? `/webhooks/${encodeURIComponent(webhookId)}` : '/webhooks',
    method:webhookId ? 'PUT' : 'POST',
    body:payload,
  })
}

export async function findAsaasCustomer(config, externalReference) {
  const params = new URLSearchParams({ externalReference, limit:'1', offset:'0' })
  const data = await asaasRequest({ ...config, path:`/customers?${params}` })
  return Array.isArray(data?.data) ? (data.data[0] || null) : null
}

export async function createAsaasCustomer(config, patient) {
  return asaasRequest({
    ...config,
    path:'/customers',
    method:'POST',
    body:{
      name:patient.full_name,
      cpfCnpj:String(patient.cpf || '').replace(/\D/g, ''),
      ...(patient.email ? { email:patient.email } : {}),
      ...(patient.phone ? { mobilePhone:String(patient.phone).replace(/\D/g, '') } : {}),
      externalReference:patient.id,
      notificationDisabled:true,
    },
  })
}

export async function findAsaasPayment(config, externalReference) {
  const params = new URLSearchParams({ externalReference, limit:'1', offset:'0' })
  const data = await asaasRequest({ ...config, path:`/payments?${params}` })
  return Array.isArray(data?.data) ? (data.data[0] || null) : null
}

export function buildAsaasPaymentPayload({ customerId, billingType, amount, dueDate, description, externalReference }) {
  if (!['BOLETO', 'PIX'].includes(billingType)) throw new Error('Escolha boleto ou Pix.')
  const normalizedAmount = Math.round(Number(amount || 0) * 100) / 100
  if (!(normalizedAmount > 0)) throw new Error('O valor da cobrança precisa ser maior que zero.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate || ''))) throw new Error('Vencimento inválido.')
  return {
    customer:customerId,
    billingType,
    value:normalizedAmount,
    dueDate,
    description:String(description || '').slice(0, 500),
    externalReference,
  }
}

export async function createAsaasPayment(config, input) {
  return asaasRequest({
    ...config,
    path:'/payments',
    method:'POST',
    body:buildAsaasPaymentPayload(input),
  })
}

export async function fetchAsaasPaymentInstructions(config, payment) {
  const result = {
    invoiceUrl:payment?.invoiceUrl || null,
    bankSlipUrl:payment?.bankSlipUrl || null,
    boletoBarcode:null,
    pixPayload:null,
  }
  if (!payment?.id) return result
  if (payment.billingType === 'BOLETO') {
    const line = await asaasRequest({ ...config, path:`/payments/${encodeURIComponent(payment.id)}/identificationField` })
    result.boletoBarcode = line.identificationField || line.barCode || null
  }
  if (payment.billingType === 'PIX') {
    const pix = await asaasRequest({ ...config, path:`/payments/${encodeURIComponent(payment.id)}/pixQrCode` })
    result.pixPayload = pix.payload || null
  }
  return result
}

export async function cancelAsaasPayment(config, providerChargeId) {
  return asaasRequest({
    ...config,
    path:`/payments/${encodeURIComponent(providerChargeId)}`,
    method:'DELETE',
  })
}

export function canonicalChargeStatus(eventType, providerStatus = '') {
  const event = String(eventType || '').toUpperCase()
  const status = String(providerStatus || '').toUpperCase()
  if (event === 'PAYMENT_RECEIVED' || status === 'RECEIVED') return 'received'
  if (event === 'PAYMENT_CONFIRMED' || status === 'CONFIRMED') return 'confirmed'
  if (event === 'PAYMENT_REFUNDED' || status === 'REFUNDED') return 'refunded'
  if (event === 'PAYMENT_OVERDUE' || status === 'OVERDUE') return 'overdue'
  if (event === 'PAYMENT_DELETED' || event === 'PAYMENT_BANK_SLIP_CANCELLED' || ['DELETED','CANCELLED'].includes(status)) return 'canceled'
  if (['PENDING','AWAITING_RISK_ANALYSIS','AUTHORIZED'].includes(status) || ['PAYMENT_CREATED','PAYMENT_UPDATED'].includes(event)) return 'pending'
  return null
}

function validDate(value) {
  const date = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

export function normalizeAsaasWebhook(body = {}) {
  const payment = body?.payment || {}
  const eventType = String(body?.event || '')
  const status = canonicalChargeStatus(eventType, payment.status)
  const paidDate = validDate(payment.paymentDate)
    || validDate(payment.clientPaymentDate)
    || validDate(payment.confirmedDate)
  return {
    eventId:String(body?.id || '').trim(),
    eventType,
    providerChargeId:String(payment?.id || '').trim(),
    status,
    paidAt:paidDate ? `${paidDate}T12:00:00-03:00` : null,
    grossAmount:Number(payment?.value || 0) || null,
    netAmount:Number(payment?.netValue || 0) || null,
    paymentMethod:String(payment?.billingType || '').toLowerCase() || null,
  }
}

export function normalizeAsaasPayment(payment = {}, eventType = 'PAYMENT_STATUS_SYNCED') {
  const normalized = normalizeAsaasWebhook({ event:eventType, payment })
  return {
    ...normalized,
    eventId:'',
    eventType,
  }
}

const asaasAdapter = {
  id:'asaas',
  name:'Asaas',
  capabilities:PROVIDER_CATALOG[0].capabilities,
  credentialLabel(credentials = {}) {
    return String(credentials.apiKey || '').slice(-4)
  },
  connectionConfig(credentials = {}, environment) {
    return { environment, apiKey:String(credentials.apiKey || '').trim() }
  },
  validateConnection:validateAsaasConnection,
  configureWebhook:configureAsaasWebhook,
  findCustomer:findAsaasCustomer,
  createCustomer:createAsaasCustomer,
  findCharge:findAsaasPayment,
  createCharge:createAsaasPayment,
  fetchInstructions:fetchAsaasPaymentInstructions,
  cancelCharge:cancelAsaasPayment,
  normalizeWebhook:normalizeAsaasWebhook,
  normalizeCharge:normalizeAsaasPayment,
  webhookToken(req) {
    return String(req.headers['asaas-access-token'] || '')
  },
  validatePatient(patient = {}) {
    const cpf = String(patient.cpf || '').replace(/\D/g, '')
    if (cpf.length !== 11) throw Object.assign(new Error('Cadastre um CPF válido no paciente antes de emitir pelo Asaas.'), { statusCode:400 })
  },
}

export function billingProviderCatalog() {
  return PROVIDER_CATALOG.map(item => ({ ...item, capabilities:{ ...item.capabilities, chargeTypes:[...item.capabilities.chargeTypes] } }))
}

export function getBillingProvider(providerId = 'asaas') {
  if (providerId === 'asaas') return asaasAdapter
  const catalogItem = PROVIDER_CATALOG.find(item => item.id === providerId)
  if (catalogItem) {
    throw Object.assign(new Error(catalogItem.unavailableReason || `O provedor ${catalogItem.name} ainda não está disponível.`), { statusCode:409 })
  }
  throw Object.assign(new Error('Provedor de cobrança inválido.'), { statusCode:400 })
}
