// api/_lib/whatsapp.js
// Funções puras (sem I/O) da integração de WhatsApp — testáveis em unidade.
// A lógica crítica de fidedignidade vive aqui: normalização de telefone,
// parse do webhook do provider e matching estrito telefone→paciente.

// Mantém só os dígitos do telefone (ex.: "(11) 98888-7777" → "11988887777").
export function normalizePhone(raw) {
  if (raw == null) return ''
  return String(raw).replace(/\D/g, '')
}

// Núcleo comparável do número: os últimos 8 dígitos (ignora país/DDI, DDD e o 9º dígito,
// que variam entre formatos). Ex.: "5511988887777" e "11988887777" → "88887777".
export function phoneCore(raw) {
  const digits = normalizePhone(raw)
  return digits.slice(-8)
}

// Normaliza o payload de uma mensagem RECEBIDA do provider (cobre Z-API).
// Retorna { phone, text, providerMessageId } ou null quando deve ser ignorada
// (mensagem nossa de saída ecoada, evento de status, ou sem conteúdo).
export function parseIncomingMessage(body) {
  if (!body || typeof body !== 'object') return null
  // Z-API ecoa as mensagens que NÓS enviamos com fromMe=true — não gravar como recebida.
  if (body.fromMe === true) return null

  const phoneRaw = body.phone || body.from || body?.sender?.phone || ''
  const text = body?.text?.message || body?.message?.conversation || body?.body || ''
  const providerMessageId = body?.messageId || body?.id || null

  const phone = normalizePhone(phoneRaw)
  if (!phone || !text) return null

  return { phone, text: String(text), providerMessageId: providerMessageId ? String(providerMessageId) : null }
}

// Casa um telefone a um paciente pela lista de pacientes da clínica.
// Estrito: só retorna um id se houver EXATAMENTE um paciente com o mesmo núcleo
// (últimos 8 dígitos). Zero ou múltiplos (ambíguo) → null — nunca atribui ao paciente errado.
export function matchPatientId(patients, phone) {
  const core = phoneCore(phone)
  if (!core || core.length < 8 || !Array.isArray(patients)) return null

  const matches = patients.filter(p => p && phoneCore(p.phone) === core)
  return matches.length === 1 ? matches[0].id : null
}
