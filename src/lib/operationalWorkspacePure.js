export function unreadCountForConversation(messages, state) {
  const sorted = [...(messages || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const latest = sorted.at(-1)
  const manualBoundary = state?.marked_unread_at

  // A manual mark is intentional and must remain visible until the user reads it.
  if (manualBoundary) {
    return sorted.filter(message => message.direction === 'inbound' && new Date(message.created_at) > new Date(manualBoundary)).length
  }

  // An outbound reply closes the pending inbound messages before it. This avoids
  // showing a conversation as unread after Summary or a team member has replied.
  if (latest?.direction === 'outbound') return 0

  const latestOutboundAt = sorted.reduce((latestAt, message) => {
    if (message.direction !== 'outbound') return latestAt
    if (!latestAt || new Date(message.created_at) > new Date(latestAt)) return message.created_at
    return latestAt
  }, null)
  const boundaries = [state?.last_read_at, latestOutboundAt].filter(Boolean)
  const boundary = boundaries.sort((a, b) => new Date(a) - new Date(b)).at(-1)
  return sorted.filter(message => message.direction === 'inbound' && (!boundary || new Date(message.created_at) > new Date(boundary))).length
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
