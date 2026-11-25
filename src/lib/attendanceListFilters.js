export const ATTENDANCE_PERIODS = [
  { v:'todos', l:'Todos os períodos' },
  { v:'hoje', l:'Hoje' },
  { v:'proximos_7', l:'Próximos 7 dias' },
  { v:'este_mes', l:'Este mês' },
  { v:'mes_passado', l:'Mês passado' },
  { v:'personalizado', l:'Período personalizado' },
]

function parseDateKey(value) {
  const raw = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const date = new Date(`${raw}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthEnd(year, month) {
  return new Date(year, month + 1, 0)
}

export function getAttendancePeriodRange(period, todayKey, customFrom = '', customTo = '') {
  const todayDate = parseDateKey(todayKey)
  if (!todayDate || period === 'todos') return { from:'', to:'' }
  if (period === 'personalizado') return { from:customFrom || '', to:customTo || '' }
  if (period === 'hoje') return { from:todayKey, to:todayKey }
  if (period === 'proximos_7') {
    const end = new Date(todayDate)
    end.setDate(end.getDate() + 6)
    return { from:todayKey, to:dateKey(end) }
  }
  if (period === 'este_mes') {
    return { from:dateKey(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1)), to:dateKey(monthEnd(todayDate.getFullYear(), todayDate.getMonth())) }
  }
  if (period === 'mes_passado') {
    const previous = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1)
    return { from:dateKey(previous), to:dateKey(monthEnd(previous.getFullYear(), previous.getMonth())) }
  }
  return { from:'', to:'' }
}

export function matchesAttendancePeriod(item, range) {
  const value = String(item?.date || '')
  if (!range?.from && !range?.to) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  if (range.from && value < range.from) return false
  if (range.to && value > range.to) return false
  return true
}

export function attendanceDateTimeKey(item) {
  return `${String(item?.date || '')}T${String(item?.startTime || '00:00')}`
}

export function compareAttendanceDateTime(a, b) {
  return attendanceDateTimeKey(a).localeCompare(attendanceDateTimeKey(b))
}

export function uniqueAttendanceOptions(items, valueKey, label = value => value) {
  return [...new Set(items.map(item => String(item?.[valueKey] || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map(value => ({ v:value, l:label(value) }))
}
