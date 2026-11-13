const DAY_MS = 24 * 60 * 60 * 1000

export const CALENDAR_VIEWS = ['month', 'week', 'day', 'agenda']

export function padCalendarNumber(value) {
  return String(value).padStart(2, '0')
}

export function calendarDateFromIso(value) {
  const [year, month, day] = String(value || '').split('-').map(Number)
  if (!year || !month || !day) return new Date(NaN)
  return new Date(year, month - 1, day, 12)
}

export function calendarIsoFromDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ''
  return `${value.getFullYear()}-${padCalendarNumber(value.getMonth() + 1)}-${padCalendarNumber(value.getDate())}`
}

export function addCalendarDays(value, amount) {
  const date = typeof value === 'string' ? calendarDateFromIso(value) : new Date(value)
  date.setDate(date.getDate() + amount)
  return calendarIsoFromDate(date)
}

export function startOfCalendarWeek(value) {
  const date = typeof value === 'string' ? calendarDateFromIso(value) : new Date(value)
  date.setDate(date.getDate() - date.getDay())
  return calendarIsoFromDate(date)
}

export function calendarMonthCells(focusIso) {
  const focus = calendarDateFromIso(focusIso)
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1, 12)
  first.setDate(first.getDate() - first.getDay())
  return Array.from({ length:42 }, (_, index) => addCalendarDays(first, index))
}

export function calendarRange(view, focusIso) {
  const focus = calendarDateFromIso(focusIso)
  if (view === 'month') {
    const cells = calendarMonthCells(focusIso)
    return { start:cells[0], end:addCalendarDays(cells.at(-1), 1) }
  }
  if (view === 'week') {
    const start = startOfCalendarWeek(focusIso)
    return { start, end:addCalendarDays(start, 7) }
  }
  // O endpoint consolidado do Google aceita no máximo 62 dias por leitura.
  if (view === 'agenda') return { start:focusIso, end:addCalendarDays(focusIso, 60) }
  return { start:focusIso, end:addCalendarDays(focusIso, 1) }
}

export function moveCalendarFocus(focusIso, view, direction) {
  const focus = calendarDateFromIso(focusIso)
  if (view === 'month') focus.setMonth(focus.getMonth() + direction)
  else if (view === 'week') focus.setDate(focus.getDate() + (7 * direction))
  else if (view === 'agenda') focus.setDate(focus.getDate() + (30 * direction))
  else focus.setDate(focus.getDate() + direction)
  return calendarIsoFromDate(focus)
}

export function calendarMinutes(time, fallback = 9 * 60) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(time || ''))
  if (!match) return fallback
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return fallback
  return hours * 60 + minutes
}

export function calendarTimeFromMinutes(value) {
  const normalized = Math.max(0, Math.min(1439, Math.round(Number(value) || 0)))
  return `${padCalendarNumber(Math.floor(normalized / 60))}:${padCalendarNumber(normalized % 60)}`
}

export function calendarEventColor(type) {
  if (type === 'surgery') return '#3B82F6'
  if (type === 'google') return '#F59E0B'
  return '#06B6D4'
}

export function calendarEventLabel(type) {
  if (type === 'surgery') return 'Cirurgia'
  if (type === 'google') return 'Google Agenda'
  return 'Consulta'
}

// Spec: docs/superpowers/plans/2026-11-13-cidade-local-agenda.md
// Cidade estruturada da cirurgia/consulta — fonte da verdade da Agenda interna, não depende
// de cor do Google (que é por calendário, não por evento, no plano atual da clínica).
export const CITY_OPTIONS = [
  { value:'goiania', label:'Goiânia', color:'#22C55E' },
  { value:'brasilia', label:'Brasília', color:'#A855F7' },
]

export function calendarCityColor(city) {
  return CITY_OPTIONS.find(item => item.value === city)?.color || null
}

export function calendarCityLabel(city) {
  return CITY_OPTIONS.find(item => item.value === city)?.label || 'Cidade a definir'
}

const CONSULTATION_LABELS = {
  avaliacao:'Avaliação',
  retorno:'Retorno',
  pos_operatorio:'Pós-operatório',
  procedimento_estetico:'Procedimento estético',
}

export function buildClinicalCalendarEvents(data, googleEvents = []) {
  const procedures = new Map((data.procedures || []).map(item => [item.id, item]))
  const localIds = new Set()
  const events = []

  for (const record of data.surgeries || []) {
    if (!record.id || !record.date) continue
    localIds.add(record.id)
    const procedure = procedures.get(record.procedureId)
    events.push({
      id:`surgery:${record.id}`,
      recordId:record.id,
      type:'surgery',
      source:'local',
      date:record.date,
      startTime:record.startTime || '',
      durationMinutes:Math.max(15, Number(record.durationMinutes) || 180),
      title:record.patient || 'Paciente',
      subtitle:procedure?.name || record.customProcedureName || 'Cirurgia',
      patient:record.patient || '',
      patientId:record.patientId || '',
      value:Number(record.totalValue) || 0,
      status:record.paymentStatus || 'pendente',
      city:record.city || null,
      locationDetail:record.locationDetail || '',
      record,
    })
  }

  for (const record of data.consultations || []) {
    if (!record.id || !record.date) continue
    localIds.add(record.id)
    events.push({
      id:`consultation:${record.id}`,
      recordId:record.id,
      type:'consultation',
      source:'local',
      date:record.date,
      startTime:record.startTime || '',
      durationMinutes:Math.max(15, Number(record.durationMinutes) || 60),
      title:record.patient || 'Paciente',
      subtitle:CONSULTATION_LABELS[record.consultationType] || 'Consulta',
      patient:record.patient || '',
      patientId:record.patientId || '',
      value:Number(record.value) || 0,
      status:record.paymentStatus || 'pendente',
      city:record.city || null,
      locationDetail:record.locationDetail || '',
      record,
    })
  }

  for (const record of googleEvents || []) {
    if (!record.googleId || !record.date || record.cancelled) continue
    if (record.recordId && localIds.has(record.recordId)) continue
    events.push({
      id:`google:${record.googleId}`,
      recordId:record.googleId,
      type:'google',
      source:'google',
      date:record.date,
      startTime:record.startTime || '',
      durationMinutes:Math.max(15, Number(record.durationMinutes) || (record.startTime ? 60 : 1440)),
      title:record.title || 'Evento do Google',
      subtitle:'Google Agenda',
      value:0,
      status:'external',
      allDay:Boolean(record.allDay || !record.startTime),
      record,
    })
  }

  return events.sort((a, b) => {
    const date = a.date.localeCompare(b.date)
    if (date) return date
    const time = (a.startTime || '00:00').localeCompare(b.startTime || '00:00')
    return time || a.title.localeCompare(b.title, 'pt-BR')
  })
}

// visibleCities usa a chave 'sem_cidade' pra representar eventos sem cidade definida (city nulo) —
// nunca classifica errado por default, só esconde/mostra conforme o filtro escolhido.
export function filterClinicalCalendarEvents(events, { query = '', visibleTypes = [], visibleCities = [] } = {}) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase('pt-BR')
  const typeSet = new Set(visibleTypes)
  const citySet = new Set(visibleCities)
  return events.filter(event => {
    if (typeSet.size && !typeSet.has(event.type)) return false
    if (citySet.size && event.type !== 'google' && !citySet.has(event.city || 'sem_cidade')) return false
    if (!normalizedQuery) return true
    return `${event.title} ${event.subtitle} ${event.patient || ''}`.toLocaleLowerCase('pt-BR').includes(normalizedQuery)
  })
}

export function groupCalendarEventsByDate(events) {
  const grouped = new Map()
  for (const event of events) {
    if (!grouped.has(event.date)) grouped.set(event.date, [])
    grouped.get(event.date).push(event)
  }
  return grouped
}

export function calendarEventConflicts(events) {
  const conflicts = new Set()
  const timed = events.filter(event => event.startTime && !event.allDay)
  for (let index = 0; index < timed.length; index += 1) {
    const current = timed[index]
    const currentStart = calendarMinutes(current.startTime)
    const currentEnd = currentStart + current.durationMinutes
    for (let otherIndex = index + 1; otherIndex < timed.length; otherIndex += 1) {
      const other = timed[otherIndex]
      if (other.date !== current.date) continue
      const otherStart = calendarMinutes(other.startTime)
      const otherEnd = otherStart + other.durationMinutes
      if (currentStart < otherEnd && otherStart < currentEnd) {
        conflicts.add(current.id)
        conflicts.add(other.id)
      }
    }
  }
  return conflicts
}

export function calendarDaysBetween(startIso, endIso) {
  const start = calendarDateFromIso(startIso)
  const end = calendarDateFromIso(endIso)
  const count = Math.max(0, Math.round((end - start) / DAY_MS))
  return Array.from({ length:count }, (_, index) => addCalendarDays(start, index))
}
