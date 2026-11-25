const MAX_PAYMENT_LINK_LENGTH = 2048

export function normalizePaymentLink(value) {
  const raw = String(value || '').trim()
  if (!raw) return { value:'', error:'Informe o link de pagamento.' }
  if (raw.length > MAX_PAYMENT_LINK_LENGTH) return { value:'', error:'O link de pagamento é muito longo.' }
  if (/[^\x20-\x7E]/.test(raw)) return { value:'', error:'O link contém caracteres inválidos.' }

  let parsed
  try { parsed = new URL(raw) } catch { return { value:'', error:'Informe uma URL válida.' } }
  if (parsed.protocol !== 'https:') return { value:'', error:'Use um link HTTPS para proteger o pagamento.' }
  if (!parsed.hostname || parsed.username || parsed.password) return { value:'', error:'O link de pagamento não é seguro.' }

  return { value:parsed.toString(), error:'' }
}

export function normalizeWhatsAppPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  const withCountryCode = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits
  return /^\d{12,15}$/.test(withCountryCode) ? withCountryCode : ''
}

export function buildPaymentWhatsAppMessage({ patientName, amount, dueDate, paymentLink }) {
  return `Olá${patientName ? ` ${patientName}` : ''}! Sua cobrança de ${amount} vence em ${dueDate}. Você pode pagar pelo link: ${paymentLink}`
}

export function buildWhatsAppPaymentHref(phone, message) {
  const normalizedPhone = normalizeWhatsAppPhone(phone)
  return normalizedPhone ? `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}` : ''
}
