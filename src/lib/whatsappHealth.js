const CONNECTED_STATES = new Set(['open', 'connected', 'online'])
const CONNECTING_STATES = new Set(['connecting', 'opening', 'qr', 'pairing'])

function timestampOf(value) {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? time : null
}

export function buildWhatsAppNumberHealth(numbers = [], messages = [], now = Date.now()) {
  return numbers
    .filter(number => number.active && !number.archived_at)
    .map(number => {
      const state = String(number.connection_state || '').toLowerCase()
      const scoped = messages.filter(message => message.whatsapp_number_id === number.id)
      const lastInbound = scoped
        .filter(message => message.direction === 'inbound')
        .map(message => ({ ...message, _time:timestampOf(message.created_at) }))
        .filter(message => message._time !== null)
        .sort((a, b) => b._time - a._time)[0] || null
      const lastActivity = scoped
        .map(message => timestampOf(message.created_at))
        .filter(time => time !== null)
        .sort((a, b) => b - a)[0] || null
      const ageMinutes = lastInbound ? Math.max(0, Math.floor((now - lastInbound._time) / 60000)) : null
      const status = CONNECTED_STATES.has(state) ? 'connected' : CONNECTING_STATES.has(state) ? 'connecting' : 'disconnected'
      const freshness = status === 'disconnected' ? 'offline' : ageMinutes === null ? 'unknown' : ageMinutes > 60 ? 'stale' : 'fresh'
      return { number, status, freshness, lastInbound, lastActivity, ageMinutes }
    })
}

export function healthAgeLabel(ageMinutes) {
  if (ageMinutes === null || ageMinutes === undefined) return 'Nenhuma recebida no painel'
  if (ageMinutes < 1) return 'Agora'
  if (ageMinutes < 60) return `Há ${ageMinutes} min`
  const hours = Math.floor(ageMinutes / 60)
  if (hours < 24) return `Há ${hours} h`
  const days = Math.floor(hours / 24)
  return `Há ${days} ${days === 1 ? 'dia' : 'dias'}`
}
