// Cliente server-side da Evolution API v2. A URL e a chave globais pertencem
// à infraestrutura do SurgiMetrics e nunca são recebidas do navegador.

const DEFAULT_TIMEOUT_MS = 15_000
const EVOLUTION_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'SEND_MESSAGE',
  'CONNECTION_UPDATE',
]

function env(name) {
  return String(process.env[name] || '').trim()
}

export function normalizeEvolutionBaseUrl(raw) {
  let url
  try { url = new URL(String(raw || '').trim()) } catch { throw new Error('URL da Evolution API inválida.') }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('A Evolution API precisa usar HTTPS.')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function evolutionConfig() {
  const baseUrl = normalizeEvolutionBaseUrl(env('EVOLUTION_API_BASE_URL'))
  const apiKey = env('EVOLUTION_API_KEY')
  if (!apiKey) throw new Error('EVOLUTION_API_KEY não configurada.')
  return { baseUrl, apiKey }
}

function safeInstanceName(raw) {
  const value = String(raw || '').trim()
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(value)) throw new Error('Nome de instância Evolution inválido.')
  return value
}

async function readResponse(response) {
  const raw = await response.text().catch(() => '')
  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { data = {} }
  if (!response.ok) {
    const detail = data?.response?.message || data?.message || data?.error || raw || `HTTP ${response.status}`
    throw new Error(`Evolution API: ${Array.isArray(detail) ? detail.join(', ') : detail}`)
  }
  return data
}

export async function evolutionRequest(path, { method = 'GET', body, timeoutMs } = {}) {
  const { baseUrl, apiKey } = evolutionConfig()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(timeoutMs || env('EVOLUTION_REQUEST_TIMEOUT_MS')) || DEFAULT_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        apikey: apiKey,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    return await readResponse(response)
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Evolution API não respondeu dentro do tempo esperado.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function webhookPayload(webhookUrl, webhookSecret) {
  let url
  try { url = new URL(String(webhookUrl || '').trim()) } catch { throw new Error('URL de webhook inválida.') }
  if (url.protocol !== 'https:') throw new Error('A URL de webhook precisa usar HTTPS.')
  return {
    enabled: true,
    url: url.toString(),
    headers: webhookSecret ? { 'x-webhook-token': webhookSecret } : {},
    byEvents: false,
    base64: false,
    events: EVOLUTION_EVENTS,
  }
}

function connectionState(data) {
  return String(data?.instance?.state || data?.instance?.connectionStatus || data?.state || data?.connectionStatus || '').toLowerCase()
}

function qrResult(data) {
  const qrcode = data?.qrcode || data
  return {
    code: qrcode?.code || data?.code || null,
    base64: qrcode?.base64 || data?.base64 || null,
    pairingCode: qrcode?.pairingCode || data?.pairingCode || null,
  }
}

export async function createEvolutionInstance(instanceName, { webhookUrl, webhookSecret } = {}) {
  const name = safeInstanceName(instanceName)
  const body = {
    instanceName: name,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    syncFullHistory: false,
    groupsIgnore: false,
  }
  if (webhookUrl) body.webhook = webhookPayload(webhookUrl, webhookSecret)
  const data = await evolutionRequest('/instance/create', { method: 'POST', body, timeoutMs: 30_000 })
  return { instanceName: name, state: connectionState(data) || 'connecting', ...qrResult(data) }
}

export async function connectEvolutionInstance(instanceName) {
  const name = safeInstanceName(instanceName)
  const data = await evolutionRequest(`/instance/connect/${encodeURIComponent(name)}`, { timeoutMs: 30_000 })
  return { instanceName: name, ...qrResult(data) }
}

export async function getEvolutionConnection(instanceName) {
  const name = safeInstanceName(instanceName)
  const data = await evolutionRequest(`/instance/connectionState/${encodeURIComponent(name)}`)
  const state = connectionState(data) || 'unknown'
  return { connected: state === 'open', state, instanceName: name }
}

export async function configureEvolutionWebhook(instanceName, webhookUrl, webhookSecret) {
  const name = safeInstanceName(instanceName)
  const expected = webhookPayload(webhookUrl, webhookSecret)
  await evolutionRequest(`/webhook/set/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: { webhook: expected },
  })
  const current = await evolutionRequest(`/webhook/find/${encodeURIComponent(name)}`)
  const actual = current?.webhook || current || {}
  const actualEvents = new Set(actual.events || [])
  const eventsOk = EVOLUTION_EVENTS.every(event => actualEvents.has(event))
  if (actual.enabled === false || actual.url !== expected.url || !eventsOk) {
    throw new Error('A Evolution API não manteve a configuração esperada do webhook.')
  }
  return { enabled: true, webhookUrl: actual.url, events: [...actualEvents] }
}

export function evolutionRecipient(raw) {
  const value = String(raw || '').trim()
  if (/^[0-9]+@(?:lid|s\.whatsapp\.net)$/i.test(value) || /^[0-9-]+@g\.us$/i.test(value)) return value
  if (/-group$/i.test(value)) return `${value.replace(/-group$/i, '').replace(/\D/g, '')}@g.us`
  const digits = value.replace(/\D/g, '')
  if (!digits) throw new Error('Destinatário do WhatsApp inválido.')
  return digits
}

function confirmedMessageId(data) {
  const id = data?.key?.id || data?.message?.key?.id || data?.messageId || data?.id
  if (!id) throw new Error('A Evolution API não confirmou o identificador da mensagem.')
  return String(id)
}

export async function sendEvolutionText(instanceName, to, text) {
  const name = safeInstanceName(instanceName)
  const data = await evolutionRequest(`/message/sendText/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: { number: evolutionRecipient(to), text: String(text || '') },
  })
  return confirmedMessageId(data)
}

export function buildEvolutionMediaRequest(type, { to, mediaUrl, caption = '', fileName = '', mediaMime = '' }) {
  const number = evolutionRecipient(to)
  if (type === 'audio') {
    return { path: 'sendWhatsAppAudio', body: { number, audio: mediaUrl } }
  }
  if (!['image', 'video', 'document'].includes(type)) throw new Error(`tipo de mídia não suportado: ${type}`)
  return {
    path: 'sendMedia',
    body: {
      number,
      mediatype: type,
      media: mediaUrl,
      caption,
      ...(fileName ? { fileName } : {}),
      ...(mediaMime ? { mimetype: mediaMime } : {}),
    },
  }
}

export async function sendEvolutionMedia(instanceName, type, args) {
  const name = safeInstanceName(instanceName)
  const { path, body } = buildEvolutionMediaRequest(type, args)
  const data = await evolutionRequest(`/message/${path}/${encodeURIComponent(name)}`, { method: 'POST', body, timeoutMs: 30_000 })
  return confirmedMessageId(data)
}

export async function listEvolutionChats(instanceName) {
  const name = safeInstanceName(instanceName)
  const data = await evolutionRequest(`/chat/findChats/${encodeURIComponent(name)}`, { method: 'POST', body: {} })
  return Array.isArray(data) ? data : (Array.isArray(data?.chats) ? data.chats : [])
}

export async function downloadEvolutionMedia(instanceName, message) {
  const name = safeInstanceName(instanceName)
  if (!message?.key || !message?.message) throw new Error('Evento de mídia Evolution incompleto.')
  const data = await evolutionRequest(`/chat/getBase64FromMediaMessage/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: { message, convertToMp4: false },
    timeoutMs: 30_000,
  })
  const base64 = typeof data?.base64 === 'string'
    ? data.base64
    : (data?.base64?.type === 'Buffer' && Array.isArray(data.base64.data)
        ? Buffer.from(data.base64.data).toString('base64')
        : null)
  if (!base64) throw new Error('A Evolution API não devolveu o conteúdo da mídia.')
  return {
    base64,
    mimetype: data.mimetype || data.mimeType || null,
    fileName: data.fileName || null,
  }
}

export async function resolveEvolutionPhoneLids(instanceName, phones, { chats } = {}) {
  const wanted = new Set((phones || []).map(phone => String(phone || '').replace(/\D/g, '')).filter(Boolean))
  if (!wanted.size) return []
  const rows = chats || await listEvolutionChats(instanceName)
  const aliases = []
  for (const row of rows) {
    const primary = String(row?.remoteJid || row?.id || '')
    const alternate = String(row?.remoteJidAlt || row?.pnJid || '')
    const lid = [primary, alternate].find(value => /@lid$/i.test(value)) || ''
    const phoneJid = [primary, alternate].find(value => /@s\.whatsapp\.net$/i.test(value)) || ''
    const phone = phoneJid.replace(/\D/g, '')
    const lidDigits = lid.replace(/\D/g, '')
    if (!phone || !lidDigits || !wanted.has(phone)) continue
    aliases.push({ inputPhone: phone, outputPhone: phone, lid: `${lidDigits}@lid` })
  }
  return [...new Map(aliases.map(item => [`${item.outputPhone}:${item.lid}`, item])).values()]
}

export async function logoutEvolutionInstance(instanceName) {
  const name = safeInstanceName(instanceName)
  return evolutionRequest(`/instance/logout/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export { EVOLUTION_EVENTS }
