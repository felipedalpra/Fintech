// api/_lib/whatsappClient.js
// Cliente HTTP do provider de WhatsApp (Z-API). Multi-número: as credenciais vêm por
// parâmetro (da tabela whatsapp_numbers, lidas no servidor), não mais de env vars.
//   instanceUrl — base da instância Z-API, ex: https://api.z-api.io/instances/{id}/token/{token}
//   apiToken    — Client-Token (token de segurança da conta Z-API)
// A interface é a mesma para Evolution API; para Twilio/Meta, ajustar só este arquivo.

// A tela aceita tanto a URL-base quanto uma URL copiada da documentação com
// `/send-text` no fim. Internamente guardamos/usamos sempre a base canônica.
// Restringir o host também impede que o teste autenticado de conexão vire SSRF.
export function normalizeZApiInstanceUrl(raw) {
  let url
  try { url = new URL(String(raw || '').trim()) } catch { throw new Error('URL da instância Z-API inválida.') }
  if (url.protocol !== 'https:' || url.hostname !== 'api.z-api.io') {
    throw new Error('Use uma URL HTTPS oficial da Z-API (api.z-api.io).')
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'instances' || !parts[1] || parts[2] !== 'token' || !parts[3]) {
    throw new Error('A URL deve seguir o formato /instances/ID/token/TOKEN.')
  }
  return `${url.origin}/instances/${parts[1]}/token/${parts[3]}`
}

async function readZApiResponse(res) {
  const raw = await res.text().catch(() => '')
  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { data = {} }
  const providerError = data?.error || data?.message
  if (!res.ok || data?.error) {
    const detail = typeof providerError === 'string' ? providerError : (raw || `HTTP ${res.status}`)
    throw new Error(`Z-API: ${detail}`)
  }
  return data
}

function confirmedMessageId(data) {
  const id = data?.messageId ?? data?.id ?? data?.zaapId
  if (!id) throw new Error('A Z-API não confirmou o envio da mensagem. Verifique a URL e o Client-Token.')
  return String(id)
}

export async function testWhatsAppConnection(instanceUrl, apiToken) {
  if (!instanceUrl || !apiToken) throw new Error('Informe a URL da instância e o Client-Token.')
  const baseUrl = normalizeZApiInstanceUrl(instanceUrl)
  const res = await fetch(`${baseUrl}/me`, { headers: { 'Client-Token': apiToken } })
  const data = await readZApiResponse(res)
  if (data.connected !== true) throw new Error('A instância Z-API está desconectada do WhatsApp.')
  return { connected: true, instanceUrl: baseUrl }
}

// Mantém o histórico completo mesmo quando alguém responde pelo aplicativo do
// WhatsApp. A Z-API envia essas mensagens no webhook de recebimento com fromMe=true.
export async function enableZApiSentByMe(instanceUrl, apiToken) {
  if (!instanceUrl || !apiToken) throw new Error('Informe a URL da instância e o Client-Token.')
  const baseUrl = normalizeZApiInstanceUrl(instanceUrl)
  const res = await fetch(`${baseUrl}/update-notify-sent-by-me`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Client-Token': apiToken },
    body: JSON.stringify({ notifySentByMe: true }),
  })
  const data = await readZApiResponse(res)
  if (data.value !== true) throw new Error('A Z-API não confirmou a sincronização das mensagens enviadas pelo WhatsApp.')
  return { enabled: true, instanceUrl: baseUrl }
}

// Regrava o webhook de recebimento pelo endpoint combinado da Z-API, que é o
// caminho específico para entregar também mensagens enviadas no celular. Em
// seguida lê /me para não apresentar sucesso quando a configuração não aderiu.
export async function configureZApiReceiveWebhook(instanceUrl, apiToken, webhookUrl) {
  if (!instanceUrl || !apiToken) throw new Error('Informe a URL da instância e o Client-Token.')
  let callbackUrl
  try { callbackUrl = new URL(String(webhookUrl || '').trim()) } catch { throw new Error('URL de webhook inválida.') }
  if (callbackUrl.protocol !== 'https:') throw new Error('A URL de webhook precisa usar HTTPS.')

  const baseUrl = normalizeZApiInstanceUrl(instanceUrl)
  const headers = { 'Content-Type': 'application/json', 'Client-Token': apiToken }
  const update = await fetch(`${baseUrl}/update-webhook-received-delivery`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ value: callbackUrl.toString() }),
  })
  const updated = await readZApiResponse(update)
  if (updated.value !== true) throw new Error('A Z-API não confirmou o webhook de mensagens enviadas pelo celular.')

  const check = await fetch(`${baseUrl}/me`, { headers: { 'Client-Token': apiToken } })
  const instance = await readZApiResponse(check)
  const configuredUrl = instance.receivedCallbackUrl || instance.receivedAndDeliveryCallbackUrl || ''
  if (instance.receiveCallbackSentByMe !== true || configuredUrl !== callbackUrl.toString()) {
    throw new Error('A Z-API não manteve ativa a sincronização das mensagens enviadas pelo celular.')
  }
  return { enabled: true, instanceUrl: baseUrl, webhookUrl: configuredUrl }
}

// Metadados leves das conversas (nome e miniatura). Paginação limitada evita
// chamadas sem fim se o provider retornar uma página cheia repetidamente.
export async function listZApiChats(instanceUrl, apiToken, { pageSize = 1000, maxPages = 5 } = {}) {
  if (!instanceUrl || !apiToken) throw new Error('Informe a URL da instância e o Client-Token.')
  const baseUrl = normalizeZApiInstanceUrl(instanceUrl)
  const chats = []
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`${baseUrl}/chats`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('pageSize', String(pageSize))
    const response = await fetch(url, { headers: { 'Client-Token': apiToken } })
    const data = await readZApiResponse(response)
    const batch = Array.isArray(data) ? data : (Array.isArray(data?.chats) ? data.chats : [])
    chats.push(...batch)
    if (batch.length < pageSize) break
  }
  return chats
}

// Resolve, em uma única chamada, os aliases telefone ↔ Linked ID usados pelo
// WhatsApp. É utilizado apenas na sincronização manual do inbox para reunir o
// histórico que o provider alternou entre número real e `@lid`.
export async function resolveZApiPhoneLids(instanceUrl, apiToken, phones) {
  if (!instanceUrl || !apiToken) throw new Error('Informe a URL da instância e o Client-Token.')
  const normalized = [...new Set((phones || []).map(phone => String(phone || '').replace(/\D/g, '')).filter(Boolean))]
  if (!normalized.length) return []
  const baseUrl = normalizeZApiInstanceUrl(instanceUrl)
  const response = await fetch(`${baseUrl}/phone-exists-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': apiToken },
    body: JSON.stringify({ phones: normalized }),
  })
  const data = await readZApiResponse(response)
  if (!Array.isArray(data)) throw new Error('Z-API: resposta inválida ao reconciliar identificadores de contato.')
  return data.flatMap(item => {
    const inputPhone = String(item?.inputPhone || '').replace(/\D/g, '')
    const outputPhone = String(item?.outputPhone || item?.phone || '').replace(/\D/g, '')
    const lidDigits = /@lid$/i.test(String(item?.lid || '')) ? String(item.lid).replace(/\D/g, '') : ''
    if (item?.exists !== true || !lidDigits || !(outputPhone || inputPhone)) return []
    return [{ inputPhone, outputPhone: outputPhone || inputPhone, lid: `${lidDigits}@lid` }]
  })
}

// Monta (puro) o endpoint Z-API + corpo para enviar mídia por URL.
//   image    → /send-image      { phone, image, caption }
//   document → /send-document/<ext> { phone, document, fileName }
//   audio    → /send-ptt (nota de voz) { phone, audio }
export function buildMediaSendRequest(type, { to, mediaUrl, caption = '', fileName = '' }) {
  if (type === 'image') {
    return { path: 'send-image', body: { phone: to, image: mediaUrl, caption } }
  }
  if (type === 'document') {
    // Extensão sanitizada (a..z/0..9, 1-8 chars) e só se houver mesmo um ponto no nome.
    const raw = (fileName.split('.').pop() || '').toLowerCase()
    const ext = (raw !== fileName.toLowerCase() && /^[a-z0-9]{1,8}$/.test(raw)) ? raw : 'bin'
    return { path: `send-document/${ext}`, body: { phone: to, document: mediaUrl, fileName } }
  }
  if (type === 'audio') {
    return { path: 'send-ptt', body: { phone: to, audio: mediaUrl } }
  }
  throw new Error(`tipo de mídia não suportado: ${type}`)
}

// Envia mídia (por URL já hospedada, ex.: Supabase Storage). Retorna o messageId do provider.
export async function sendWhatsAppMedia(instanceUrl, apiToken, type, args) {
  if (!instanceUrl || !apiToken) {
    throw new Error('Número de WhatsApp sem credenciais configuradas.')
  }
  const { path, body } = buildMediaSendRequest(type, args)
  const baseUrl = normalizeZApiInstanceUrl(instanceUrl)
  const res = await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': apiToken },
    body: JSON.stringify(body),
  })
  const data = await readZApiResponse(res)
  return confirmedMessageId(data)
}

export async function sendWhatsAppText(instanceUrl, apiToken, to, text) {
  if (!instanceUrl || !apiToken) {
    throw new Error('Número de WhatsApp sem credenciais configuradas.')
  }

  const baseUrl = normalizeZApiInstanceUrl(instanceUrl)
  const res = await fetch(`${baseUrl}/send-text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': apiToken,
    },
    body: JSON.stringify({ phone: to, message: text }),
  })

  const data = await readZApiResponse(res)
  return confirmedMessageId(data)
}
