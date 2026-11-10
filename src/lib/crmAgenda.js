// src/lib/crmAgenda.js
// Agenda Comercial do CRM (Fase 5). É uma VISÃO dos registros que já existem — nada é copiado:
//   consultas e cirurgias  → data.consultations / data.surgeries (módulo Atendimentos)
//   tarefas                → tasks (gerenciador de Tarefas / subitens do CRM)
//   follow-ups             → tarefa de contato (ligar/WhatsApp/retorno) ligada a uma oportunidade,
//                            ou a "próxima ação" (next_action_due) de uma oportunidade aberta
//   orçamentos             → tarefa da categoria Orçamento, ou a próxima ação de uma oportunidade
//                            na etapa Orçamento Enviado
// Cada evento guarda { source, recordId } do registro original; reagendar grava NO registro
// original. PURO: sem I/O, sem tema, "hoje" sempre recebido por parâmetro.

// A clínica não tem fuso configurável no cadastro; a operação é em Brasília (mesmo fuso usado nos
// relatórios e no prontuário). Centralizado aqui para virar configuração sem caçar strings.
export const CLINIC_TIME_ZONE = 'America/Sao_Paulo'

export const AGENDA_TYPES = [
  { key: 'consultation', label: 'Consultas',  single: 'Consulta',  color: '#579bfc' },
  { key: 'followup',     label: 'Follow-ups', single: 'Follow-up', color: '#a25ddc' },
  { key: 'task',         label: 'Tarefas',    single: 'Tarefa',    color: '#00c875' },
  { key: 'budget',       label: 'Orçamentos', single: 'Orçamento', color: '#fdab3d' },
  { key: 'surgery',      label: 'Cirurgias',  single: 'Cirurgia',  color: '#e2445c' },
]
export const AGENDA_TYPE_KEYS = AGENDA_TYPES.map(t => t.key)
export const AGENDA_TYPE_BY_KEY = Object.fromEntries(AGENDA_TYPES.map(t => [t.key, t]))

export const AGENDA_STATUSES = [
  { key: 'open',    label: 'Em aberto / agendado', color: '#579bfc' },
  { key: 'overdue', label: 'Atrasado',             color: '#e2445c' },
  { key: 'done',    label: 'Concluído / realizado', color: '#00c875' },
]
export const AGENDA_STATUS_KEYS = AGENDA_STATUSES.map(s => s.key)

export const AGENDA_PERIODS = [
  { key: 'all',        label: 'Todo o período' },
  { key: 'this_week',  label: 'Esta semana' },
  { key: 'next_7',     label: 'Próximos 7 dias' },
  { key: 'this_month', label: 'Este mês' },
  { key: 'custom',     label: 'Personalizado' },
]

// Categorias de tarefa que são contato com o paciente (follow-up) quando ligadas a uma oportunidade.
export const FOLLOWUP_TASK_TYPES = ['ligar', 'whatsapp', 'retorno']

const CONSULTATION_LABELS = {
  avaliacao: 'Avaliação',
  retorno: 'Retorno',
  pos_operatorio: 'Pós-operatório',
  procedimento_estetico: 'Procedimento estético',
}

// ---------------------------------------------------------------------------
// Datas no fuso da clínica
// ---------------------------------------------------------------------------
// { date: 'YYYY-MM-DD', minutes } do instante informado no fuso da clínica.
export function clinicNow(date = new Date(), timeZone = CLINIC_TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

function pad(n) { return String(n).padStart(2, '0') }
function dayDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12))
}
function isoOf(date) { return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` }
export function addDays(iso, n) {
  const d = dayDate(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return isoOf(d)
}
export function weekStart(iso) {
  const d = dayDate(iso)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return isoOf(d)
}
export function monthStart(iso) { return `${String(iso).slice(0, 7)}-01` }
export function monthEnd(iso) {
  const d = dayDate(monthStart(iso))
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return isoOf(d)
}

export function isIsoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) }
function day(v) { const s = String(v || '').slice(0, 10); return isIsoDate(s) ? s : '' }
function hhmm(v) { const m = /^(\d{2}):(\d{2})/.exec(String(v || '')); return m ? `${m[1]}:${m[2]}` : '' }
export function minutesOf(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
export function timeOf(minutes) {
  const v = Math.max(0, Math.min(1439, Math.round(Number(minutes) || 0)))
  return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`
}

// Intervalo [start, end] (inclusive) do filtro de período. null = sem limite.
export function periodBounds(period = {}, today) {
  const key = period?.key || 'all'
  if (key === 'this_week') { const s = weekStart(today); return { start: s, end: addDays(s, 6) } }
  if (key === 'next_7') return { start: today, end: addDays(today, 6) }
  if (key === 'this_month') return { start: monthStart(today), end: monthEnd(today) }
  if (key === 'custom') {
    const start = isIsoDate(period.from) ? period.from : null
    const end = isIsoDate(period.to) ? period.to : null
    if (start && end && end < start) return { start: end, end: start }
    return { start, end }
  }
  return { start: null, end: null }
}

// ---------------------------------------------------------------------------
// Construção dos eventos
// ---------------------------------------------------------------------------
export function personOf(record) {
  return record?.patients?.full_name || record?.crm_contacts?.full_name || ''
}

// Responsável de uma consulta/cirurgia: elas não têm responsável próprio, então herdam o da
// oportunidade ABERTA mais recente do mesmo paciente (é quem conduz a negociação). Sem
// oportunidade aberta, a mais recente de qualquer situação. Sem paciente vinculado, nenhum.
export function responsibleByPatient(opps = []) {
  const best = new Map()
  for (const o of opps || []) {
    if (!o?.patient_id || o.status === 'arquivado') continue
    const cur = best.get(o.patient_id)
    const rank = o.status === 'aberto' ? 1 : 0
    const curRank = cur ? (cur.status === 'aberto' ? 1 : 0) : -1
    if (!cur || rank > curRank || (rank === curRank && String(o.created_at || '') > String(cur.created_at || ''))) best.set(o.patient_id, o)
  }
  const map = new Map()
  for (const [pid, o] of best) map.set(pid, { userId: o.responsible_user_id || null, oppId: o.id })
  return map
}

export function taskAgendaType(task) {
  if (task?.task_type === 'orcamento') return 'budget'
  if (task?.opportunity_id && FOLLOWUP_TASK_TYPES.includes(task.task_type)) return 'followup'
  return 'task'
}

function openStatus(date, today) {
  return date < today ? 'overdue' : 'open'
}

// Consultas/cirurgias não têm "concluída" no cadastro: data passada = realizada.
function appointmentStatus(date, today) {
  return date < today ? 'done' : 'open'
}

export function buildAgendaEvents({ consultations = [], surgeries = [], tasks = [], opps = [], procedures = [], today, include = {} } = {}) {
  const events = []
  const procName = new Map((procedures || []).map(p => [p.id, p.name]))
  const respByPatient = responsibleByPatient(opps)
  const oppById = new Map((opps || []).map(o => [o.id, o]))
  const showAppointments = include.appointments !== false
  const showSurgeries = include.surgeries !== false

  if (showAppointments) {
    for (const c of consultations || []) {
      const date = day(c?.date)
      if (!c?.id || !date) continue
      const time = hhmm(c.startTime)
      const resp = c.patientId ? respByPatient.get(c.patientId) : null
      events.push({
        id: `consultation:${c.id}`, type: 'consultation', source: 'consultation', recordId: c.id,
        date, startTime: time, durationMinutes: Math.max(15, Number(c.durationMinutes) || 60), allDay: !time,
        title: c.patient || 'Paciente', subtitle: CONSULTATION_LABELS[c.consultationType] || 'Consulta',
        patientName: c.patient || '', patientId: c.patientId || null,
        responsibleId: resp?.userId || null, responsibleDerived: true, opportunityId: resp?.oppId || null,
        status: appointmentStatus(date, today), record: c,
      })
    }
  }

  if (showSurgeries) {
    for (const s of surgeries || []) {
      const date = day(s?.date)
      if (!s?.id || !date) continue
      const time = hhmm(s.startTime)
      const resp = s.patientId ? respByPatient.get(s.patientId) : null
      events.push({
        id: `surgery:${s.id}`, type: 'surgery', source: 'surgery', recordId: s.id,
        date, startTime: time, durationMinutes: Math.max(15, Number(s.durationMinutes) || 180), allDay: !time,
        title: s.patient || 'Paciente', subtitle: procName.get(s.procedureId) || 'Cirurgia',
        patientName: s.patient || '', patientId: s.patientId || null,
        responsibleId: resp?.userId || null, responsibleDerived: true, opportunityId: resp?.oppId || null,
        status: appointmentStatus(date, today), record: s,
      })
    }
  }

  for (const t of tasks || []) {
    const date = day(t?.due_date)
    if (!t?.id || !date) continue // tarefa sem prazo não tem lugar no calendário
    const time = hhmm(t.due_time)
    const opp = t.opportunity_id ? oppById.get(t.opportunity_id) : null
    const person = personOf(t) || personOf(opp)
    const oppTitle = t.opportunities?.title || opp?.title || ''
    events.push({
      id: `task:${t.id}`, type: taskAgendaType(t), source: 'task', recordId: t.id,
      date, startTime: time, durationMinutes: 30, allDay: !time,
      title: t.title || 'Tarefa', subtitle: [person, oppTitle && oppTitle !== 'Oportunidade' ? oppTitle : ''].filter(Boolean).join(' · '),
      patientName: person, patientId: t.patient_id || opp?.patient_id || null,
      responsibleId: t.assigned_user_id || null, responsibleDerived: false, opportunityId: t.opportunity_id || null,
      status: t.status === 'feita' ? 'done' : openStatus(date, today), record: t,
    })
  }

  for (const o of opps || []) {
    const date = day(o?.next_action_due)
    // Só oportunidade ABERTA tem próxima ação pendente; ganha/perdida/arquivada sai da agenda.
    if (!o?.id || !date || o.status !== 'aberto') continue
    const person = personOf(o)
    events.push({
      id: `opportunity:${o.id}`, type: o.stage === 'orcamento_enviado' ? 'budget' : 'followup', source: 'opportunity', recordId: o.id,
      date, startTime: '', durationMinutes: 30, allDay: true,
      title: o.next_action || 'Próxima ação', subtitle: [person, o.title && o.title !== 'Oportunidade' ? o.title : ''].filter(Boolean).join(' · '),
      patientName: person, patientId: o.patient_id || null,
      responsibleId: o.responsible_user_id || null, responsibleDerived: false, opportunityId: o.id,
      status: openStatus(date, today), record: o,
    })
  }

  return events.sort(compareEvents)
}

export function compareEvents(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  // Dia inteiro antes dos horários; depois pela hora; depois pelo título.
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  const at = a.startTime || ''
  const bt = b.startTime || ''
  if (at !== bt) return at < bt ? -1 : 1
  return String(a.title).localeCompare(String(b.title), 'pt-BR')
}

// ---------------------------------------------------------------------------
// Filtros (todos combináveis)
// ---------------------------------------------------------------------------
export const EMPTY_AGENDA_FILTERS = {
  types: AGENDA_TYPE_KEYS,   // categorias visíveis
  responsibles: [],          // user_id | 'me' | 'none'; vazio = todos
  statuses: [],              // vazio = todos
  patient: '',
  period: { key: 'all', from: '', to: '' },
}

export function normalizeAgendaFilters(f = {}) {
  const arr = (v, allowed) => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && (!allowed || allowed.includes(x))))] : [])
  const periodKey = AGENDA_PERIODS.some(p => p.key === f?.period?.key) ? f.period.key : 'all'
  return {
    types: Array.isArray(f.types) ? arr(f.types, AGENDA_TYPE_KEYS) : [...AGENDA_TYPE_KEYS],
    responsibles: arr(f.responsibles),
    statuses: arr(f.statuses, AGENDA_STATUS_KEYS),
    patient: typeof f.patient === 'string' ? f.patient.slice(0, 120) : '',
    period: { key: periodKey, from: isIsoDate(f?.period?.from) ? f.period.from : '', to: isIsoDate(f?.period?.to) ? f.period.to : '' },
  }
}

// Filtros que restringem (as categorias ocultas contam como 1).
export function activeAgendaFilterCount(f) {
  let n = 0
  if (f.types.length < AGENDA_TYPE_KEYS.length) n++
  if (f.responsibles.length) n++
  if (f.statuses.length) n++
  if (f.patient.trim()) n++
  if (f.period.key !== 'all') n++
  return n
}

export function foldText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function applyAgendaFilters(events, filters, { userId = null, today } = {}) {
  const f = normalizeAgendaFilters(filters)
  const types = new Set(f.types)
  const resp = new Set(f.responsibles.map(r => (r === 'me' ? userId : r)).filter(Boolean))
  const wantsNone = f.responsibles.includes('none')
  const statuses = new Set(f.statuses)
  const patient = foldText(f.patient)
  const { start, end } = periodBounds(f.period, today)
  return (events || []).filter(e => {
    if (!types.has(e.type)) return false
    if (f.responsibles.length) {
      const hit = e.responsibleId ? resp.has(e.responsibleId) : wantsNone
      if (!hit) return false
    }
    if (statuses.size && !statuses.has(e.status)) return false
    if (patient && !foldText(e.patientName).includes(patient)) return false
    if (start && e.date < start) return false
    if (end && e.date > end) return false
    return true
  })
}

export function countByType(events) {
  const counts = Object.fromEntries(AGENDA_TYPE_KEYS.map(k => [k, 0]))
  for (const e of events || []) counts[e.type] = (counts[e.type] || 0) + 1
  return counts
}

export function groupByDate(events) {
  const map = new Map()
  for (const e of events || []) {
    if (!map.has(e.date)) map.set(e.date, [])
    map.get(e.date).push(e)
  }
  return map
}

// ---------------------------------------------------------------------------
// Reagendamento (regras de negócio)
// ---------------------------------------------------------------------------
// Pode arrastar? Tarefas e follow-ups abertos, sim. Consultas e cirurgias seguem as regras do
// módulo Atendimentos (valores, competência e vencimento acompanham a data) — não são movidas aqui.
export function canReschedule(event, { opportunityDatesReady = true } = {}) {
  if (!event) return { ok: false, reason: 'Evento inválido.' }
  if (event.source === 'consultation' || event.source === 'surgery') {
    return { ok: false, reason: `${AGENDA_TYPE_BY_KEY[event.type]?.single || 'Atendimento'}s são reagendadas em Atendimentos, onde valores e vencimentos acompanham a nova data.` }
  }
  if (event.status === 'done') return { ok: false, reason: 'Atividade concluída não é reagendada. Reabra-a antes.' }
  if (event.source === 'opportunity' && !opportunityDatesReady) return { ok: false, reason: 'O prazo da próxima ação depende da atualização do banco do CRM.' }
  if (event.source === 'task' || event.source === 'opportunity') return { ok: true }
  return { ok: false, reason: 'Este evento não pode ser reagendado.' }
}

// Valida o destino e devolve o patch do registro original.
// time: undefined = mantém a hora; null = sem hora (dia inteiro); 'HH:MM' = nova hora.
export function reschedulePlan(event, date, time, { today, opportunityDatesReady = true } = {}) {
  const allowed = canReschedule(event, { opportunityDatesReady })
  if (!allowed.ok) return { error: allowed.reason }
  if (!isIsoDate(date)) return { error: 'Data inválida.' }
  if (today && date < today) return { error: 'Não é possível reagendar para uma data que já passou.' }
  if (event.source === 'opportunity') {
    if (date === event.date) return { noop: true }
    return { patch: { next_action_due: date } } // a próxima ação só tem data
  }
  const patch = {}
  if (date !== event.date) patch.due_date = date
  if (time !== undefined) {
    const next = time ? hhmm(time) : null
    if (time && !next) return { error: 'Hora inválida.' }
    if ((next || '') !== (event.startTime || '')) patch.due_time = next
  }
  if (!Object.keys(patch).length) return { noop: true }
  return { patch }
}

// ---------------------------------------------------------------------------
// Layout da grade de horários: eventos sobrepostos lado a lado (como no Monday/Google).
// ---------------------------------------------------------------------------
export function layoutTimedEvents(events) {
  const timed = (events || [])
    .filter(e => !e.allDay && minutesOf(e.startTime) != null)
    .map(e => ({ e, start: minutesOf(e.startTime), end: minutesOf(e.startTime) + Math.max(15, e.durationMinutes || 30) }))
    .sort((a, b) => a.start - b.start || b.end - a.end)
  const out = []
  let cluster = []
  let clusterEnd = -1
  const flush = () => {
    const lanes = []
    for (const item of cluster) {
      let lane = lanes.findIndex(end => end <= item.start)
      if (lane < 0) { lane = lanes.length; lanes.push(item.end) } else lanes[lane] = item.end
      item.lane = lane
    }
    for (const item of cluster) out.push({ event: item.e, start: item.start, end: item.end, lane: item.lane, lanes: lanes.length })
    cluster = []
  }
  for (const item of timed) {
    if (cluster.length && item.start >= clusterEnd) { flush(); clusterEnd = -1 }
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.end)
  }
  if (cluster.length) flush()
  return out
}

// Dias exibidos em cada visualização.
export function visibleDays(view, focus) {
  if (view === 'day') return [focus]
  if (view === 'week') { const s = weekStart(focus); return Array.from({ length: 7 }, (_, i) => addDays(s, i)) }
  const first = weekStart(monthStart(focus))
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}

export function shiftFocus(focus, view, dir) {
  if (view === 'day') return addDays(focus, dir)
  if (view === 'week') return addDays(focus, 7 * dir)
  const d = dayDate(monthStart(focus))
  d.setUTCMonth(d.getUTCMonth() + dir)
  return isoOf(d)
}
