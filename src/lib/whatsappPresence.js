export function normalizeWhatsAppPresence(presenceState = {}, currentUserId = null) {
  const seen = new Set()
  return Object.values(presenceState)
    .flat()
    .filter(entry => entry?.user_id && entry.user_id !== currentUserId && entry.conversation_key)
    .map(entry => ({
      userId: entry.user_id,
      conversationKey: entry.conversation_key,
      name: entry.display_name || entry.email?.split('@')[0] || 'Outro atendente',
    }))
    .filter(entry => {
      const key = `${entry.userId}:${entry.conversationKey}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function whatsappPresenceLabel(viewers = []) {
  if (!viewers.length) return ''
  if (viewers.length === 1) return `${viewers[0].name} está nesta conversa`
  if (viewers.length === 2) return `${viewers[0].name} e ${viewers[1].name} estão nesta conversa`
  return `${viewers[0].name} e mais ${viewers.length - 1} estão nesta conversa`
}
