import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../theme.js'
import { fmt, today, uid } from '../utils.js'
import { Btn, FInput, Modal } from './UI.jsx'
import { GoogleCalendarBar } from './GoogleCalendarBar.jsx'
import { CalendarFinancialFields } from './CalendarFinancialFields.jsx'
import { PatientSelector } from './PatientSelector.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { fetchGoogleEvents } from '../lib/googleCalendarClient.js'
import { applyExternalChanges } from '../lib/googleCalendarPayload.js'
import {
  addCalendarDays,
  buildClinicalCalendarEvents,
  calendarDateFromIso,
  calendarDaysBetween,
  calendarEventColor,
  calendarEventConflicts,
  calendarEventLabel,
  calendarMinutes,
  calendarMonthCells,
  calendarRange,
  calendarTimeFromMinutes,
  filterClinicalCalendarEvents,
  groupCalendarEventsByDate,
  moveCalendarFocus,
  startOfCalendarWeek,
} from '../lib/clinicalCalendar.js'
import { buildCalendarFinancialPatch, createCalendarFinancialDraft } from '../lib/calendarFinancialDetails.js'
import './Calendar.css'

const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
const WEEKDAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const VIEW_LABELS = { month:'Mês', week:'Semana', day:'Dia', agenda:'Agenda' }
const CONSULTATION_TYPES = [
  { v:'avaliacao', l:'Avaliação' },
  { v:'retorno', l:'Retorno' },
  { v:'pos_operatorio', l:'Pós-operatório' },
  { v:'procedimento_estetico', l:'Procedimento estético' },
]
const HOURS = Array.from({ length:15 }, (_, index) => index + 6)
const CALENDAR_VIEW_KEY = 'surgimetrics_calendar_view'

function Icon({ name, size = 18 }) {
  const paths = {
    plus:<><path d="M12 5v14M5 12h14" /></>,
    left:<path d="m15 18-6-6 6-6" />,
    right:<path d="m9 18 6-6-6-6" />,
    search:<><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    calendar:<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    clock:<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    close:<path d="m6 6 12 12M18 6 6 18" />,
    sliders:<><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
    alert:<><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v4M12 17h.01" /></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function prettyDate(iso, options = {}) {
  const date = calendarDateFromIso(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', options).format(date)
}

function titleForView(view, focusDate) {
  if (view === 'month') return prettyDate(focusDate, { month:'long', year:'numeric' })
  if (view === 'day') return prettyDate(focusDate, { weekday:'long', day:'numeric', month:'long', year:'numeric' })
  if (view === 'agenda') return `A partir de ${prettyDate(focusDate, { day:'numeric', month:'long' })}`
  const start = startOfCalendarWeek(focusDate)
  const end = addCalendarDays(start, 6)
  const startDate = calendarDateFromIso(start)
  const endDate = calendarDateFromIso(end)
  if (startDate.getMonth() === endDate.getMonth()) {
    return `${startDate.getDate()}–${endDate.getDate()} de ${prettyDate(end, { month:'long', year:'numeric' })}`
  }
  return `${prettyDate(start, { day:'numeric', month:'short' })} – ${prettyDate(end, { day:'numeric', month:'short', year:'numeric' })}`
}

function eventTimeLabel(event) {
  if (!event.startTime || event.allDay) return 'Dia inteiro'
  const end = calendarTimeFromMinutes(calendarMinutes(event.startTime) + event.durationMinutes)
  return `${event.startTime}–${end}`
}

function MiniCalendar({ focusDate, onSelect }) {
  const cells = calendarMonthCells(focusDate)
  const focus = calendarDateFromIso(focusDate)
  const todayIso = today()
  return (
    <div className="cal-mini">
      <div className="cal-mini__title">{prettyDate(focusDate, { month:'long', year:'numeric' })}</div>
      <div className="cal-mini__weekdays">{WEEKDAYS.map(day => <span key={day}>{day[0]}</span>)}</div>
      <div className="cal-mini__grid">
        {cells.map(iso => {
          const date = calendarDateFromIso(iso)
          const outside = date.getMonth() !== focus.getMonth()
          return (
            <button
              key={iso}
              type="button"
              className={`cal-mini__day${iso === focusDate ? ' is-selected' : ''}${iso === todayIso ? ' is-today' : ''}${outside ? ' is-outside' : ''}`}
              onClick={() => onSelect(iso)}
              aria-label={prettyDate(iso, { dateStyle:'full' })}
            >{date.getDate()}</button>
          )
        })}
      </div>
    </div>
  )
}

function CalendarEvent({ event, conflict, compact = false, onClick, draggable = false, onDragStart }) {
  const color = calendarEventColor(event.type)
  return (
    <button
      type="button"
      className={`cal-event cal-event--${event.type}${compact ? ' is-compact' : ''}`}
      style={{ '--event-color':color }}
      onClick={click => { click.stopPropagation(); onClick(event) }}
      draggable={draggable}
      onDragStart={dragEvent => onDragStart?.(dragEvent, event)}
      title={`${event.title} · ${event.subtitle} · ${eventTimeLabel(event)}`}
    >
      <span className="cal-event__time">{event.startTime || 'dia'}</span>
      <span className="cal-event__title">{event.title}</span>
      {!compact && <span className="cal-event__subtitle">{event.subtitle}</span>}
      {conflict && <span className="cal-event__conflict" title="Conflito de horário"><Icon name="alert" size={12} /></span>}
    </button>
  )
}

function MonthView({ focusDate, grouped, conflicts, onDay, onEvent, onMoveEvent, canEditEvent }) {
  const month = calendarDateFromIso(focusDate).getMonth()
  const todayIso = today()
  return (
    <div className="cal-month" data-testid="calendar-month-view">
      <div className="cal-month__weekdays">{WEEKDAYS.map(day => <div key={day}>{day}</div>)}</div>
      <div className="cal-month__grid">
        {calendarMonthCells(focusDate).map(iso => {
          const dayEvents = grouped.get(iso) || []
          const outside = calendarDateFromIso(iso).getMonth() !== month
          return (
            <div
              key={iso}
              className={`cal-month__cell${outside ? ' is-outside' : ''}${iso === todayIso ? ' is-today' : ''}`}
              onClick={() => onDay(iso)}
              onDragOver={event => event.preventDefault()}
              onDrop={event => onMoveEvent(event, iso)}
            >
              <button type="button" className="cal-month__number" onClick={event => { event.stopPropagation(); onDay(iso) }}>
                {calendarDateFromIso(iso).getDate()}
              </button>
              <div className="cal-month__events">
                {dayEvents.slice(0, 3).map(event => (
                  <CalendarEvent key={event.id} event={event} conflict={conflicts.has(event.id)} compact onClick={onEvent} draggable={canEditEvent(event)} onDragStart={(dragEvent, dragged) => dragEvent.dataTransfer.setData('text/calendar-event', dragged.id)} />
                ))}
                {dayEvents.length > 3 && <button type="button" className="cal-month__more" onClick={event => { event.stopPropagation(); onDay(iso) }}>+ {dayEvents.length - 3} outros</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TimeGridView({ focusDate, view, grouped, conflicts, onSlot, onEvent, onMoveEvent, canEditEvent }) {
  const days = view === 'day'
    ? [focusDate]
    : calendarDaysBetween(startOfCalendarWeek(focusDate), addCalendarDays(startOfCalendarWeek(focusDate), 7))
  const now = new Date()
  const todayIso = today()
  const nowTop = ((now.getHours() + now.getMinutes() / 60) - 6) * 64
  return (
    <div className={`cal-time-grid${view === 'day' ? ' cal-time-grid--day' : ''}`} data-testid={`calendar-${view}-view`}>
      <div className="cal-time-grid__header">
        <div className="cal-time-grid__zone">GMT−03</div>
        {days.map(iso => (
          <button type="button" key={iso} className={`cal-time-grid__day-head${iso === todayIso ? ' is-today' : ''}`} onClick={() => onSlot(iso, '09:00')}>
            <span>{WEEKDAYS[calendarDateFromIso(iso).getDay()]}</span>
            <strong>{calendarDateFromIso(iso).getDate()}</strong>
          </button>
        ))}
      </div>
      <div className="cal-time-grid__all-day">
        <div>Dia todo</div>
        {days.map(iso => (
          <div key={iso}>
            {(grouped.get(iso) || []).filter(event => !event.startTime || event.allDay).map(event => (
              <CalendarEvent key={event.id} event={event} conflict={conflicts.has(event.id)} compact onClick={onEvent} />
            ))}
          </div>
        ))}
      </div>
      <div className="cal-time-grid__scroller">
        <div className="cal-time-grid__hours">
          {HOURS.map(hour => <div key={hour} className="cal-time-grid__hour-label">{String(hour).padStart(2, '0')}:00</div>)}
        </div>
        <div className="cal-time-grid__days" style={{ '--day-count':days.length }}>
          {days.map(iso => {
            const events = (grouped.get(iso) || []).filter(event => event.startTime && !event.allDay)
            return (
              <div
                key={iso}
                className={`cal-time-grid__day${iso === todayIso ? ' is-today' : ''}`}
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  const bounds = event.currentTarget.getBoundingClientRect()
                  const minutes = 6 * 60 + Math.max(0, Math.min(14 * 60, ((event.clientY - bounds.top) / 64) * 60))
                  onMoveEvent(event, iso, calendarTimeFromMinutes(Math.round(minutes / 15) * 15))
                }}
              >
                {HOURS.map(hour => <button type="button" key={hour} className="cal-time-grid__slot" onClick={() => onSlot(iso, `${String(hour).padStart(2, '0')}:00`)} aria-label={`Criar em ${prettyDate(iso, { dateStyle:'long' })}, ${hour}:00`} />)}
                {iso === todayIso && nowTop >= 0 && nowTop <= HOURS.length * 64 && <div className="cal-time-grid__now" style={{ top:nowTop }}><span /></div>}
                {events.map(event => {
                  const start = calendarMinutes(event.startTime)
                  const top = Math.max(0, ((start - 6 * 60) / 60) * 64)
                  const height = Math.max(28, (event.durationMinutes / 60) * 64 - 3)
                  return (
                    <div key={event.id} className="cal-time-grid__event-wrap" style={{ top, height }}>
                      <CalendarEvent event={event} conflict={conflicts.has(event.id)} onClick={onEvent} draggable={canEditEvent(event)} onDragStart={(dragEvent, dragged) => dragEvent.dataTransfer.setData('text/calendar-event', dragged.id)} />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AgendaView({ events, conflicts, onEvent, onDay }) {
  const grouped = groupCalendarEventsByDate(events)
  const dates = [...grouped.keys()].sort()
  if (!dates.length) return (
    <div className="cal-empty">
      <span className="cal-empty__icon"><Icon name="calendar" size={26} /></span>
      <strong>Nenhum atendimento neste período</strong>
      <span>Clique em “Criar” para agendar uma consulta ou cirurgia.</span>
    </div>
  )
  return (
    <div className="cal-agenda" data-testid="calendar-agenda-view">
      {dates.map(iso => (
        <section key={iso} className="cal-agenda__day">
          <button type="button" className="cal-agenda__date" onClick={() => onDay(iso)}>
            <strong>{calendarDateFromIso(iso).getDate()}</strong>
            <span>{WEEKDAYS_LONG[calendarDateFromIso(iso).getDay()]}<small>{prettyDate(iso, { month:'long', year:'numeric' })}</small></span>
          </button>
          <div className="cal-agenda__events">
            {(grouped.get(iso) || []).map(event => (
              <button type="button" key={event.id} className="cal-agenda__event" onClick={() => onEvent(event)} style={{ '--event-color':calendarEventColor(event.type) }}>
                <span className="cal-agenda__bar" />
                <span className="cal-agenda__time"><Icon name="clock" size={15} />{eventTimeLabel(event)}</span>
                <span className="cal-agenda__body"><strong>{event.title}</strong><small>{event.subtitle} · {calendarEventLabel(event.type)}</small></span>
                {event.value > 0 && <span className="cal-agenda__value">{fmt(event.value)}</span>}
                {conflicts.has(event.id) && <span className="cal-agenda__warning"><Icon name="alert" size={15} /> conflito</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function EventEditor({ open, draft, setDraft, event, procedures, canCreateSurgery, canManageFinance, financeOpen, setFinanceOpen, onClose, onSave, busy }) {
  const isGoogle = event?.source === 'google'
  const editing = Boolean(event?.source === 'local')
  const isReadOnly = isGoogle || (event?.type === 'surgery' && !canCreateSurgery)
  return (
    <Modal open={open} onClose={onClose} title={isGoogle ? 'Evento do Google Agenda' : isReadOnly ? 'Detalhes do atendimento' : editing ? 'Editar atendimento' : 'Novo atendimento'} width={560} trackDirty={!isReadOnly}>
      {isReadOnly ? (
        <div className="cal-detail">
          <div className="cal-detail__type"><span style={{ background:calendarEventColor(event.type) }} />{calendarEventLabel(event.type)}</div>
          <h3>{event.title}</h3>
          <p><Icon name="calendar" size={17} /> {prettyDate(event.date, { dateStyle:'full' })}</p>
          <p><Icon name="clock" size={17} /> {eventTimeLabel(event)}</p>
          {!isGoogle && <div className="cal-editor__hint">Seu perfil pode visualizar este atendimento, mas não editar cirurgias.</div>}
          <div className="cal-editor__actions"><Btn variant="ghost" onClick={onClose}>Fechar</Btn></div>
        </div>
      ) : (
        <div className="cal-editor">
          <div className="cal-editor__types" role="group" aria-label="Tipo de atendimento">
            <button type="button" disabled={editing} className={draft.type === 'consultation' ? 'is-active' : ''} onClick={() => { setDraft(current => ({ ...current, ...createCalendarFinancialDraft('consultation', {}, current.date), type:'consultation', durationMinutes:current.type === 'surgery' ? 60 : current.durationMinutes })); setFinanceOpen(false) }}>Consulta</button>
            {canCreateSurgery && <button type="button" disabled={editing} className={draft.type === 'surgery' ? 'is-active' : ''} onClick={() => { setDraft(current => ({ ...current, ...createCalendarFinancialDraft('surgery', {}, current.date), type:'surgery', durationMinutes:current.type === 'consultation' ? 180 : current.durationMinutes })); setFinanceOpen(false) }}>Cirurgia</button>}
          </div>
          <PatientSelector
            value={draft.patientId}
            onChange={(patientId, patient) => setDraft(current => ({ ...current, patientId, patient }))}
          />
          {!draft.patientId && draft.patient && <div className="cal-editor__legacy-patient">Paciente atual: <strong>{draft.patient}</strong>. Selecione ou crie o cadastro para vinculá-lo.</div>}
          <div className="cal-editor__row">
            <FInput label="Data" type="date" value={draft.date} onChange={date => setDraft(current => ({ ...current, date }))} required />
            <FInput label="Horário" type="time" value={draft.startTime} onChange={startTime => setDraft(current => ({ ...current, startTime }))} required />
            <FInput label="Duração (min)" type="number" value={draft.durationMinutes} onChange={durationMinutes => setDraft(current => ({ ...current, durationMinutes }))} />
          </div>
          {draft.type === 'consultation' ? (
            <FInput label="Tipo de consulta" value={draft.consultationType} onChange={consultationType => setDraft(current => ({ ...current, consultationType }))} options={CONSULTATION_TYPES} />
          ) : (
            <FInput label="Procedimento" value={draft.procedureId} onChange={procedureId => setDraft(current => ({ ...current, procedureId }))} options={[{ v:'', l:'Selecione o procedimento' }, ...procedures.map(item => ({ v:item.id, l:item.name }))]} />
          )}
          {canManageFinance && <CalendarFinancialFields open={financeOpen} onToggle={() => setFinanceOpen(current => !current)} draft={draft} setDraft={setDraft} editing={editing} />}
          <div className="cal-editor__hint">O atendimento será salvo na clínica e, se a integração estiver ativa, sincronizado com o Google Agenda.</div>
          <div className="cal-editor__actions">
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn disabled={busy || (!draft.patientId && !draft.patient.trim()) || !draft.date || !draft.startTime || (draft.type === 'surgery' && !draft.procedureId)} onClick={onSave}>{busy ? 'Salvando…' : editing ? 'Salvar alterações' : canManageFinance && !financeOpen ? 'Salvar e preencher depois' : 'Criar atendimento'}</Btn>
          </div>
        </div>
      )}
    </Modal>
  )
}

export function Calendar({ data, setData, saveDataNow, google }) {
  const { toast } = useToast()
  const { canAccess } = useUserRole()
  const [view, setViewState] = useState(() => {
    if (typeof window === 'undefined') return 'month'
    const stored = window.localStorage.getItem(CALENDAR_VIEW_KEY)
    return ['month', 'week', 'day', 'agenda'].includes(stored) ? stored : (window.innerWidth < 720 ? 'agenda' : 'month')
  })
  const [focusDate, setFocusDate] = useState(today())
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 820)
  const [visibleTypes, setVisibleTypes] = useState(['consultation', 'surgery', 'google'])
  const [googleEvents, setGoogleEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [financeOpen, setFinanceOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({ type:'consultation', patient:'', patientId:'', date:today(), startTime:'09:00', durationMinutes:60, consultationType:'avaliacao', procedureId:'' })
  const searchRef = useRef(null)
  const dataRef = useRef(data)
  dataRef.current = data
  const googleConnected = Boolean(google?.status.connected)
  const canCreateSurgery = canAccess('sales')
  const canManageFinance = canAccess('finance')
  const range = useMemo(() => calendarRange(view, focusDate), [view, focusDate])

  function setView(nextView) {
    setViewState(nextView)
    if (typeof window !== 'undefined') window.localStorage.setItem(CALENDAR_VIEW_KEY, nextView)
  }

  useEffect(() => {
    if (!googleConnected) {
      setGoogleEvents([])
      return undefined
    }
    let active = true
    const from = calendarDateFromIso(range.start)
    const to = calendarDateFromIso(range.end)
    from.setHours(0, 0, 0, 0)
    to.setHours(0, 0, 0, 0)
    const timeMin = from.toISOString()
    const timeMax = to.toISOString()
    fetchGoogleEvents({ timeMin, timeMax, timeZone:google.timeZone })
      .then(({ events = [] }) => {
        if (!active) return
        setGoogleEvents(events)
        const { changed } = applyExternalChanges(dataRef.current, events)
        if (changed > 0) {
          setData(current => applyExternalChanges(current, events).data)
          toast(`${changed} atendimento(s) atualizado(s) a partir do Google Agenda.`, 'success')
        }
      })
      .catch(error => {
        if (active && error.needsReconnect) google.markNeedsReconnect()
      })
    return () => { active = false }
    // Os callbacks do workspace são recriados a cada render. O intervalo e o estado da
    // conexão são as únicas dependências que devem disparar uma nova leitura no Google.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleConnected, range.start, range.end])

  const allEvents = useMemo(() => buildClinicalCalendarEvents(data, googleEvents), [data, googleEvents])
  const filteredEvents = useMemo(() => filterClinicalCalendarEvents(allEvents, { query, visibleTypes }), [allEvents, query, visibleTypes])
  const visibleEvents = useMemo(() => filteredEvents.filter(event => event.date >= range.start && event.date < range.end), [filteredEvents, range])
  const grouped = useMemo(() => groupCalendarEventsByDate(visibleEvents), [visibleEvents])
  const conflicts = useMemo(() => calendarEventConflicts(allEvents), [allEvents])
  const counts = useMemo(() => ({
    consultation:allEvents.filter(event => event.type === 'consultation').length,
    surgery:allEvents.filter(event => event.type === 'surgery').length,
    google:allEvents.filter(event => event.type === 'google').length,
  }), [allEvents])

  useEffect(() => {
    function onKeyDown(event) {
      const target = event.target
      if (target?.matches?.('input, textarea, select') || editorOpen) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === '/') { event.preventDefault(); setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0) }
      else if (key === 'c') openCreate(focusDate, '09:00')
      else if (key === 't') setFocusDate(today())
      else if (key === 'm' || key === '3') setView('month')
      else if (key === 'w' || key === '2') setView('week')
      else if (key === 'd' || key === '1') setView('day')
      else if (key === 'a' || key === '5') setView('agenda')
      else if (key === 'n' || key === 'j') setFocusDate(current => moveCalendarFocus(current, view, 1))
      else if (key === 'p' || key === 'k') setFocusDate(current => moveCalendarFocus(current, view, -1))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editorOpen, focusDate, view])

  function toggleType(type) {
    setVisibleTypes(current => current.includes(type) ? current.filter(item => item !== type) : [...current, type])
  }

  function canEditEvent(event) {
    return event.source === 'local' && (event.type !== 'surgery' || canCreateSurgery)
  }

  function openCreate(date, startTime = '09:00') {
    setSelectedEvent(null)
    setFinanceOpen(false)
    setDraft({
      ...createCalendarFinancialDraft('consultation', {}, date),
      type:'consultation',
      patient:'',
      patientId:'',
      date,
      startTime,
      durationMinutes:60,
      consultationType:'avaliacao',
      procedureId:data.procedures?.[0]?.id || '',
    })
    setEditorOpen(true)
  }

  function openEvent(event) {
    setSelectedEvent(event)
    setFinanceOpen(false)
    setDraft({
      ...createCalendarFinancialDraft(event.type, event.record || {}, event.date),
      type:event.type,
      patient:event.patient || event.title || '',
      patientId:event.patientId || '',
      date:event.date,
      startTime:event.startTime || '09:00',
      durationMinutes:event.durationMinutes,
      consultationType:event.record?.consultationType || 'avaliacao',
      procedureId:event.record?.procedureId || data.procedures?.[0]?.id || '',
    })
    setEditorOpen(true)
  }

  async function persist(updater) {
    const result = (saveDataNow || setData)(updater)
    if (result?.then) await result
  }

  async function saveEvent() {
    if (!draft.patient.trim() || !draft.date || !draft.startTime) return
    if (financeOpen && draft.paymentStatus === 'pago' && !draft.paymentDate) {
      toast('Informe a data do recebimento para marcar como pago.', 'warning')
      return
    }
    setBusy(true)
    try {
      if (selectedEvent?.source === 'local') {
        const collection = selectedEvent.type === 'surgery' ? 'surgeries' : 'consultations'
        const financialPatch = financeOpen ? buildCalendarFinancialPatch(selectedEvent.type, draft) : {}
        await persist(current => ({
          ...current,
          [collection]:(current[collection] || []).map(item => item.id === selectedEvent.recordId ? {
            ...item,
            patient:draft.patient.trim(),
            patientId:draft.patientId || item.patientId || null,
            date:draft.date,
            competenceDate:item.competenceDate === item.date || !item.competenceDate ? draft.date : item.competenceDate,
            dueDate:item.dueDate === item.date || !item.dueDate ? draft.date : item.dueDate,
            startTime:draft.startTime,
            durationMinutes:Math.max(15, Number(draft.durationMinutes) || (selectedEvent.type === 'surgery' ? 180 : 60)),
            ...(selectedEvent.type === 'surgery' ? { procedureId:draft.procedureId } : { consultationType:draft.consultationType }),
            ...financialPatch,
          } : item),
        }))
        toast('Atendimento atualizado e salvo.', 'success')
      } else {
        const id = uid()
        const financialPatch = buildCalendarFinancialPatch(draft.type, draft)
        if (draft.type === 'surgery') {
          const record = {
            id,
            patient:draft.patient.trim(),
            patientId:draft.patientId || null,
            procedureId:draft.procedureId,
            // O valor só entra quando informado explicitamente; o fluxo "preencher depois" mantém zero.
            ...financialPatch,
            date:draft.date,
            competenceDate:draft.date,
            dueDate:financialPatch.dueDate || draft.date,
            startTime:draft.startTime,
            durationMinutes:Math.max(15, Number(draft.durationMinutes) || 180),
            surgeon:'',
            costSettlements:{},
            notes:'',
            referredBy:'',
          }
          await persist(current => ({ ...current, surgeries:[...(current.surgeries || []), record] }))
        } else {
          const record = {
            id,
            patient:draft.patient.trim(),
            patientId:draft.patientId || null,
            date:draft.date,
            competenceDate:draft.date,
            ...financialPatch,
            dueDate:financialPatch.dueDate || draft.date,
            startTime:draft.startTime,
            durationMinutes:Math.max(15, Number(draft.durationMinutes) || 60),
            consultationType:draft.consultationType,
            costSettlements:{},
          }
          await persist(current => ({ ...current, consultations:[...(current.consultations || []), record] }))
        }
        toast('Atendimento criado e salvo.', 'success')
      }
      setEditorOpen(false)
    } catch (error) {
      toast(error.message || 'Não foi possível salvar o atendimento.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function moveEvent(dropEvent, date, startTime) {
    dropEvent.preventDefault()
    const id = dropEvent.dataTransfer.getData('text/calendar-event')
    const event = allEvents.find(item => item.id === id)
    if (!event || !canEditEvent(event)) return
    const collection = event.type === 'surgery' ? 'surgeries' : 'consultations'
    try {
      await persist(current => ({
        ...current,
        [collection]:(current[collection] || []).map(item => item.id === event.recordId ? {
          ...item,
          date,
          competenceDate:item.competenceDate === item.date || !item.competenceDate ? date : item.competenceDate,
          dueDate:item.dueDate === item.date || !item.dueDate ? date : item.dueDate,
          ...(startTime ? { startTime } : {}),
        } : item),
      }))
      toast(`Atendimento movido para ${prettyDate(date, { day:'2-digit', month:'2-digit' })}${startTime ? ` às ${startTime}` : ''}.`, 'success')
    } catch (error) {
      toast(error.message || 'Não foi possível reagendar.', 'error')
    }
  }

  const upcoming = filteredEvents.filter(event => event.date >= range.start && event.date < range.end)

  return (
    <div className="clinical-calendar" style={{ '--cal-bg':C.bg, '--cal-surface':C.surface, '--cal-card':C.card, '--cal-hover':C.cardHover, '--cal-border':C.border, '--cal-border-bright':C.borderBright, '--cal-text':C.text, '--cal-sub':C.textSub, '--cal-dim':C.textDim, '--cal-accent':C.accent, '--cal-accent-light':C.accentLight, '--cal-green':C.green, '--cal-yellow':C.yellow, '--cal-red':C.red }}>
      <div className="cal-shell">
        <aside className={`cal-sidebar${sidebarOpen ? ' is-open' : ''}`}>
          <button type="button" className="cal-create" onClick={() => openCreate(focusDate, '09:00')}><Icon name="plus" size={22} /> Criar</button>
          <MiniCalendar focusDate={focusDate} onSelect={iso => {
            setFocusDate(iso)
            if (window.innerWidth < 820) setSidebarOpen(false)
            if (view === 'month' && window.innerWidth < 720) setView('agenda')
          }} />
          <div className="cal-filters">
            <strong>Minha clínica</strong>
            {[
              ['consultation', 'Consultas', counts.consultation, `${counts.consultation} consulta${counts.consultation === 1 ? '' : 's'}`],
              ['surgery', 'Cirurgias', counts.surgery, `${counts.surgery} cirurgia${counts.surgery === 1 ? '' : 's'}`],
              ['google', 'Google Agenda', counts.google, `${counts.google} evento${counts.google === 1 ? '' : 's'} do Google`],
            ].map(([type, label, count, countLabel]) => (
              <label key={type} className="cal-filter">
                <input type="checkbox" checked={visibleTypes.includes(type)} onChange={() => toggleType(type)} />
                <span className="cal-filter__check" style={{ '--filter-color':calendarEventColor(type) }}>✓</span>
                <span>{label}</span>
                <small title={`${count} item(ns)`}>{countLabel}</small>
              </label>
            ))}
          </div>
          <div className="cal-shortcuts"><strong>Atalhos</strong><span><kbd>C</kbd> criar</span><span><kbd>T</kbd> hoje</span><span><kbd>M</kbd> mês</span><span><kbd>W</kbd> semana</span><span><kbd>A</kbd> agenda</span></div>
        </aside>

        <section className="cal-main">
          <header className="cal-toolbar">
            <div className="cal-toolbar__navigation">
              <button type="button" className="cal-icon-button cal-sidebar-toggle" onClick={() => setSidebarOpen(open => !open)} aria-label="Mostrar filtros"><Icon name="sliders" /></button>
              <button type="button" className="cal-today" onClick={() => setFocusDate(today())}>Hoje</button>
              <button type="button" className="cal-icon-button" onClick={() => setFocusDate(current => moveCalendarFocus(current, view, -1))} aria-label="Período anterior"><Icon name="left" /></button>
              <button type="button" className="cal-icon-button" onClick={() => setFocusDate(current => moveCalendarFocus(current, view, 1))} aria-label="Próximo período"><Icon name="right" /></button>
              <h2>{titleForView(view, focusDate)}</h2>
            </div>
            <div className="cal-toolbar__actions">
              <div className={`cal-search${searchOpen || query ? ' is-open' : ''}`}>
                <Icon name="search" />
                <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onFocus={() => setSearchOpen(true)} placeholder="Buscar paciente ou procedimento" aria-label="Buscar na agenda" />
                {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar busca"><Icon name="close" size={15} /></button>}
              </div>
              <div className="cal-view-switch" role="group" aria-label="Visualização da agenda">
                {Object.entries(VIEW_LABELS).map(([id, label]) => <button type="button" key={id} className={view === id ? 'is-active' : ''} onClick={() => setView(id)}>{label}</button>)}
              </div>
              <GoogleCalendarBar google={google} />
            </div>
          </header>

          {conflicts.size > 0 && <div className="cal-conflict-banner"><Icon name="alert" size={17} /><span><strong>{conflicts.size} atendimentos com conflito de horário.</strong> Os itens estão sinalizados para você revisar.</span></div>}
          {query && <div className="cal-result-count">{visibleEvents.length} resultado{visibleEvents.length === 1 ? '' : 's'} para “{query}”</div>}

          <div className="cal-canvas">
            {view === 'month' && <MonthView focusDate={focusDate} grouped={grouped} conflicts={conflicts} onDay={iso => openCreate(iso, '09:00')} onEvent={openEvent} onMoveEvent={moveEvent} canEditEvent={canEditEvent} />}
            {(view === 'week' || view === 'day') && <TimeGridView focusDate={focusDate} view={view} grouped={grouped} conflicts={conflicts} onSlot={openCreate} onEvent={openEvent} onMoveEvent={moveEvent} canEditEvent={canEditEvent} />}
            {view === 'agenda' && <AgendaView events={upcoming} conflicts={conflicts} onEvent={openEvent} onDay={iso => { setFocusDate(iso); setView('day') }} />}
          </div>
        </section>
      </div>

      <EventEditor open={editorOpen} draft={draft} setDraft={setDraft} event={selectedEvent} procedures={data.procedures || []} canCreateSurgery={canCreateSurgery} canManageFinance={canManageFinance} financeOpen={financeOpen} setFinanceOpen={setFinanceOpen} onClose={() => setEditorOpen(false)} onSave={saveEvent} busy={busy} />
    </div>
  )
}
