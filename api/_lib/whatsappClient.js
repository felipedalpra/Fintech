// api/_lib/whatsappClient.js
// Cliente HTTP do provider de WhatsApp (Z-API). Multi-número: as credenciais vêm por
// parâmetro (da tabela whatsapp_numbers, lidas no servidor), não mais de env vars.
//   instanceUrl — base da instância Z-API, ex: https://api.z-api.io/instances/{id}/token/{token}
//   apiToken    — Client-Token (token de segurança da conta Z-API)
// A interface é a mesma para Evolution API; para Twilio/Meta, ajustar só este arquivo.

// Monta (puro) o endpoint Z-API + corpo para enviar mídia por URL.
//   image    → /send-image      { phone, image, caption }
//   document → /send-document/<ext> { phone, document, fileName }
//   audio    → /send-ptt (nota de voz) { phone, audio }
export function buildMediaSendRequest(type, { to, mediaUrl, caption = '', fileName = '' }) {
  if (type === 'image') {
    return { path: 'send-image', body: { phone: to, image: mediaUrl, caption } }
  }
  if (type === 'document') {
    const ext = (fileName.split('.').pop() || '').toLowerCase()
    return { path: `send-document/${ext && ext !== fileName.toLowerCase() ? ext : 'bin'}`, body: { phone: to, document: mediaUrl, fileName } }
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
  const res = await fetch(`${instanceUrl}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': apiToken },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => String(res.status))
    throw new Error(`Z-API error: ${errText}`)
  }
  const data = await res.json().catch(() => ({}))
  return data?.messageId ?? data?.id ?? data?.zaapId ?? null
}

export async function sendWhatsAppText(instanceUrl, apiToken, to, text) {
  if (!instanceUrl || !apiToken) {
    throw new Error('Número de WhatsApp sem credenciais configuradas.')
  }

  const res = await fetch(`${instanceUrl}/send-text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': apiToken,
    },
    body: JSON.stringify({ phone: to, message: text }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => String(res.status))
    throw new Error(`Z-API error: ${errText}`)
  }

  const data = await res.json().catch(() => ({}))
  return data?.messageId ?? data?.id ?? data?.zaapId ?? null
}
