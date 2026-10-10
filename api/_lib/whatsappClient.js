// api/_lib/whatsappClient.js
// Cliente HTTP do provider de WhatsApp. Provider escolhido: Z-API (não-oficial, hospedado).
// Configurar via env vars na Vercel:
//   WHATSAPP_API_URL  — base da instância Z-API, ex: https://api.z-api.io/instances/{id}/token/{token}
//   WHATSAPP_API_KEY  — o Client-Token (token de segurança da conta Z-API)
// A interface é a mesma para Evolution API; para Twilio/Meta, ajustar só este arquivo.

export async function sendWhatsAppText(to, text) {
  const apiUrl = process.env.WHATSAPP_API_URL
  const clientToken = process.env.WHATSAPP_API_KEY

  if (!apiUrl || !clientToken) {
    throw new Error('WhatsApp não configurado. Defina WHATSAPP_API_URL e WHATSAPP_API_KEY na Vercel.')
  }

  const res = await fetch(`${apiUrl}/send-text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': clientToken,
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
