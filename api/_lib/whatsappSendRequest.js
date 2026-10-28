import { createHash } from 'node:crypto'
import { normalizeWhatsAppAddress } from './whatsapp.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeWhatsAppRequestId(value) {
  const requestId = String(value || '').trim()
  if (!UUID_PATTERN.test(requestId)) throw new Error('Identificador idempotente de envio inválido.')
  return requestId.toLowerCase()
}

export function whatsappSendRequestFingerprint(payload) {
  const canonical = [
    payload.ownerId,
    payload.whatsappNumberId,
    payload.patientId || null,
    payload.phone,
    payload.chatLid || null,
    payload.contactPhone || null,
    payload.isGroup === true,
    payload.msgType || 'text',
    payload.bodyText || '',
    payload.mediaUrl || null,
    payload.mediaMime || null,
    payload.fileName || null,
  ]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function existingSendRequestAction(existing, payloadHash) {
  if (!existing || existing.payload_hash !== payloadHash) return 'conflict'
  if (existing.status === 'persisted' && existing.whatsapp_message_id) return 'reuse'
  if (existing.status === 'accepted' && existing.provider_message_id) return 'persist'
  if (existing.status === 'failed') return 'retry'
  return 'wait'
}

// Colisão pelo índice parcial (user_id, payload_hash): outra aba/clique já
// reservou o MESMO conteúdo com um request_id diferente e ainda está viva
// (pending/accepted). Nunca chama o provedor de novo aqui — só confere que a
// reserva viva pertence ao mesmo número antes de esperar ela resolver.
export function payloadCollisionAction(existing, whatsappNumberId) {
  if (!existing || existing.whatsapp_number_id !== whatsappNumberId) return 'conflict'
  return 'wait'
}

export function providerFailureIsDefinitive(statusCode) {
  const status = Number(statusCode)
  if (!Number.isInteger(status) || status < 400 || status >= 500) return false
  return ![408, 409, 425, 429].includes(status)
}

export function conversationReferenceMatches(reference, request) {
  if (!reference || reference.whatsapp_number_id !== request?.whatsappNumberId) return false
  const referenceIsGroup = reference.is_group === true || /(?:-group|@g\.us)$/i.test(String(reference.phone || ''))
  if (referenceIsGroup !== (request.isGroup === true)) return false

  if (referenceIsGroup) {
    return normalizeWhatsAppAddress(reference.phone, true) === normalizeWhatsAppAddress(request.phone, true)
  }

  const identities = values => new Set(values
    .map(value => normalizeWhatsAppAddress(value, false))
    .filter(Boolean))
  const referenceIdentities = identities([reference.phone, reference.chat_lid, reference.contact_phone])
  const requestIdentities = identities([request.phone, request.chatLid, request.contactPhone])
  return [...requestIdentities].some(identity => referenceIdentities.has(identity))
}
