// api/_lib/whatsappClient.js
// Cliente HTTP do provider de WhatsApp (Z-API). Multi-número: as credenciais vêm por
// parâmetro (da tabela whatsapp_numbers, lidas no servidor), não mais de env vars.
//   instanceUrl — base da instância Z-API, ex: https://api.z-api.io/instances/{id}/token/{token}
//   apiToken    — Client-Token (token de segurança da conta Z-API)
// A interface é a mesma para Evolution API; para Twilio/Meta, ajustar só este arquivo.

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
