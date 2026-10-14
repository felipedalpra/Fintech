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
