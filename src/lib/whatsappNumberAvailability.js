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

export function resolveWhatsAppNumberSelection(configuredId, numbers) {
  const allNumbers = numbers || []
  const availableNumbers = allNumbers.filter(isWhatsAppNumberAvailable)
  const configuredNumber = allNumbers.find(number => number.id === configuredId) || null
  return {
    availableNumbers,
    configuredNumber,
    configuredAvailable:Boolean(configuredNumber && isWhatsAppNumberAvailable(configuredNumber)),
    // A conexão pode voltar sozinha. Preserve a configuração até o usuário
    // escolher explicitamente outro número ou limpar o campo.
    selectedId:configuredNumber?.id || '',
  }
}
