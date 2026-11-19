export function unreadCountForConversation(messages, state) {
  const sorted = [...(messages || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const manualBoundary = state?.marked_unread_at
  if (manualBoundary) {
    return sorted.filter(message => (
      message.direction === 'inbound'
      && message.status !== 'read'
      && new Date(message.created_at) > new Date(manualBoundary)
    )).length
  }
  const latestOutboundAt = sorted.reduce((latestAt, message) => {
    if (message.direction !== 'outbound') return latestAt
    if (!latestAt || new Date(message.created_at) > new Date(latestAt)) return message.created_at
    return latestAt
  }, null)
  const boundary = [state?.last_read_at, latestOutboundAt]
    .filter(Boolean)
    .sort((left, right) => new Date(left) - new Date(right))
    .at(-1)
  return sorted.filter(message => (
    message.direction === 'inbound'
    && message.status !== 'read'
    && (!boundary || new Date(message.created_at) > new Date(boundary))
  )).length
}

export function operationalConversationKey(message) {
  const numberId = message?.whatsapp_number_id || 'sem-numero'
  const address = String(message?.phone || '')
  const isGroup = message?.is_group === true || /(?:-group|@g\.us)$/i.test(address) || (!/@lid$/i.test(address) && address.replace(/\D/g, '').length > 15)
  if (isGroup) return `${numberId}:grupo:${address}`
  return `${numberId}:contato:${message?.chat_lid || message?.contact_phone || address}`
}

export function applyConversationFilters(conversations, mode) {
  const list = conversations || []
  if (mode === 'unread') return list.filter(item => item.unreadCount > 0 && !item.archived)
  if (mode === 'groups') return list.filter(item => item.isGroup && !item.archived)
  if (mode === 'leads') return list.filter(item => item.kind === 'lead' && !item.archived)
  if (mode === 'patients') return list.filter(item => item.kind === 'patient' && !item.archived)
  if (mode === 'archived') return list.filter(item => item.archived)
  return list.filter(item => !item.isGroup && !item.archived)
}
