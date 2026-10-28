const UNAVAILABLE_CONNECTION_STATES = new Set(['close', 'closed', 'disconnected', 'error', 'connecting'])

export function isWhatsAppNumberAvailable(number) {
  if (!number?.active || number.archived_at) return false
  if (number.provider === 'evolution') return number.connection_state === 'open'
  return !UNAVAILABLE_CONNECTION_STATES.has(number.connection_state)
}

export function latestAvailableWhatsAppNumberId(messages, numbers) {
  const availableIds = new Set((numbers || []).filter(isWhatsAppNumberAvailable).map(number => number.id))
  return [...(messages || [])].reverse().find(message => availableIds.has(message.whatsapp_number_id))?.whatsapp_number_id || ''
}
