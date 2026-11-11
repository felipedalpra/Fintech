// CRM → Agenda (Fase 5): calendário comercial estilo Monday sobre os MESMOS registros do sistema.
// Consultas/cirurgias (Atendimentos), tarefas (gerenciador de Tarefas) e próximas ações das
// oportunidades aparecem juntas; nada é copiado (ver src/lib/crmAgenda.js).
// - Tarefas abrem o MESMO painel lateral da página Tarefas (TaskDrawer).
// - Follow-ups/orçamentos de oportunidade abrem um painel com link para a oportunidade.
// - Consultas/cirurgias são só consulta aqui: o reagendamento é feito em Atendimentos.
// - Arrastar reagenda tarefas e follow-ups gravando no registro original (com histórico).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Btn } from './UI.jsx'
import { Ico, ICONS, Popover } from './CrmCells.jsx'
import { TaskDrawer } from './TaskDrawer.jsx'
import { NewTaskModal } from './TasksPanel.jsx'
import { useTaskWorkspace } from '../lib/useTaskWorkspace.js'
import { initials, avatarColor } from '../lib/avatar.js'
import {
  AGENDA_TYPES, AGENDA_TYPE_BY_KEY, AGENDA_TYPE_KEYS, AGENDA_STATUSES, AGENDA_PERIODS, EMPTY_AGENDA_FILTERS,
  CLINIC_TIME_ZONE, clinicNow, buildAgendaEvents, applyAgendaFilters, normalizeAgendaFilters, activeAgendaFilterCount,
  countByType, groupByDate, canReschedule, reschedulePlan, layoutTimedEvents, visibleDays, shiftFocus,
  weekStart, addDays, monthStart, minutesOf, timeOf,
} from '../lib/crmAgenda.js'
import './CrmAgenda.css'

const PREFS_KEY = 'surgimetrics_crm_agenda_v1'
const VIEWS = [['month', 'Mês'], ['week', 'Semana'], ['day', 'Dia']]
const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
const FIRST_HOUR = 6
const LAST_HOUR = 22 // exclusivo
const HOUR_H = 52
const MONTH_LIMIT = 3
const DRAG_MIME = 'text/crm-agenda-event'

function readPrefs(userId) {
  try { return JSON.parse(window.localStorage.getItem(`${PREFS_KEY}:${userId || 'anon'}`) || '{}') || {} } catch { return {} }
}
function writePrefs(userId, prefs) {
  try { window.localStorage.setItem(`${PREFS_KEY}:${userId || 'anon'}`, JSON.stringify(prefs)) } catch { /* armazenamento indisponível */ }
}

function dateOf(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}
function fmt(iso, opts) {
  return new Intl.DateTimeFormat('pt-BR', opts).format(dateOf(iso))
}
function fmtShort(iso) { return fmt(iso, { day: '2-digit', month: '2-digit' }) }
// Só a primeira letra: "Novembro de 2026", nunca "Novembro De 2026".
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }
function viewTitle(view, focus) { return cap(rawViewTitle(view, focus)) }
function rawViewTitle(view, focus) {
  if (view === 'month') return fmt(focus, { month: 'long', year: 'numeric' })
  if (view === 'day') return fmt(focus, { weekday: 'long', day: 'numeric', month: 'long' })
  const s = weekStart(focus)
  const e = addDays(s, 6)
  return s.slice(5, 7) === e.slice(5, 7)
    ? `${Number(s.slice(8))}–${Number(e.slice(8))} de ${fmt(e, { month: 'long', year: 'numeric' })}`
    : `${fmt(s, { day: 'numeric', month: 'short' })} – ${fmt(e, { day: 'numeric', month: 'short', year: 'numeric' })}`
}
function timeRange(ev) {
  if (ev.allDay) return 'Dia inteiro'
  const start = minutesOf(ev.startTime)
  return ev.source === 'task' ? ev.startTime : `${ev.startTime}–${timeOf(start + ev.durationMinutes)}`
}
function statusLabel(ev) {
  if (ev.status === 'overdue') return 'Atrasado'
  if (ev.status === 'done') return ev.source === 'task' ? 'Concluído' : 'Realizado'
  return ev.source === 'consultation' || ev.source === 'surgery' ? 'Agendado' : 'Em aberto'
}

export function CrmAgenda({ data, crm, ownerId, userId, canManage, onOpenOpp, registerTaskSync, toast }) {
  const { canAccess } = useUserRole()
  const navigate = useNavigate()
  const taskWs = useTaskWorkspace(ownerId, userId)

  // Mudanças em tarefas feitas no editor da oportunidade (aberto daqui) chegam sem recarregar.
  useEffect(() => {
    registerTaskSync?.(taskWs.syncTask)
    return () => registerTaskSync?.(null)
  }, [registerTaskSync, taskWs.syncTask])

  // "Hoje" e o marcador de agora no fuso da clínica; recalculados a cada minuto.
  const [now, setNow] = useState(() => clinicNow())
  useEffect(() => {
    const id = window.setInterval(() => setNow(clinicNow()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const today = now.date

  // ----- preferências (por navegador/usuário) -----
  const [prefs, setPrefs] = useState(() => readPrefs(userId))
  useEffect(() => { writePrefs(userId, prefs) }, [userId, prefs])
  const view = VIEWS.some(([k]) => k === prefs.view) ? prefs.view : (typeof window !== 'undefined' && window.innerWidth < 640 ? 'day' : 'month')
  const filters = useMemo(() => normalizeAgendaFilters(prefs.filters || EMPTY_AGENDA_FILTERS), [prefs.filters])
  const setView = v => setPrefs(p => ({ ...p, view: v }))
  const setFilters = useCallback(fn => setPrefs(p => ({ ...p, filters: normalizeAgendaFilters(fn(normalizeAgendaFilters(p.filters || EMPTY_AGENDA_FILTERS))) })), [])
  const [focus, setFocus] = useState(() => clinicNow().date)
  const [sideOpen, setSideOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 900)

  // ----- eventos -----
  const procedures = useMemo(() => crm.procedures || data?.procedures || [], [crm.procedures, data?.procedures])
  // Permissões do perfil: consultas/cirurgias só aparecem para quem acessa esses módulos.
  const showAppointments = canAccess('consultations')
  const showSurgeries = canAccess('calendar')
  const allEvents = useMemo(() => buildAgendaEvents({
    consultations: data?.consultations || [],
    surgeries: data?.surgeries || [],
    tasks: taskWs.tasks,
    opps: crm.opps,
    procedures,
    today,
    include: { appointments: showAppointments, surgeries: showSurgeries },
  }), [data?.consultations, data?.surgeries, taskWs.tasks, crm.opps, procedures, today, showAppointments, showSurgeries])
  const filtered = useMemo(() => applyAgendaFilters(allEvents, filters, { userId, today }), [allEvents, filters, userId, today])
  // Contagem por categoria considera os demais filtros (não a própria visibilidade da categoria).
  const counts = useMemo(() => countByType(applyAgendaFilters(allEvents, { ...filters, types: AGENDA_TYPE_KEYS }, { userId, today })), [allEvents, filters, userId, today])
  const days = useMemo(() => visibleDays(view, focus), [view, focus])
  const inView = useMemo(() => filtered.filter(e => e.date >= days[0] && e.date <= days[days.length - 1]), [filtered, days])
  const byDate = useMemo(() => groupByDate(inView), [inView])
  const eventDays = useMemo(() => new Set(filtered.map(e => e.date)), [filtered])
  const nFilters = activeAgendaFilterCount(filters)

  // ----- ações sobre tarefas (mesmas da página Tarefas) + espelho no estado do CRM -----
  const tasksRef = useRef(taskWs.tasks)
  tasksRef.current = taskWs.tasks
  const mirror = useCallback((id) => {
    const t = tasksRef.current.find(x => x.id === id)
    if (t) crm.syncTask({ type: 'updated', task: t })
  }, [crm])
  const after = useCallback((id, res, failMsg) => {
    if (res?.error) toast(failMsg ? `${res.error} ${failMsg}` : res.error, 'error')
    else window.setTimeout(() => mirror(id), 0)
    return res
  }, [toast, mirror])
  const [openTaskId, setOpenTaskId] = useState(null)
  const taskActions = useMemo(() => ({
    open: task => setOpenTaskId(task.id),
    toggle: task => taskWs.toggle(task).then(r => after(task.id, r)),
    remove: task => taskWs.remove(task).then(r => {
      if (!r.error) { crm.syncTask({ type: 'removed', task: { id: task.id } }); toast('Tarefa excluída.', 'success'); setOpenTaskId(id => (id === task.id ? null : id)) } else toast(r.error, 'error')
      return r
    }),
    setStage: (task, stageId) => taskWs.setStage(task.id, stageId).then(r => after(task.id, r)),
    setPriority: (task, priority) => taskWs.update(task.id, { priority }).then(r => after(task.id, r)),
    patch: (task, patch) => taskWs.update(task.id, patch).then(r => after(task.id, r, 'A alteração foi desfeita.')),
    outcome: (task, outcome) => taskWs.registerOutcome(task, outcome).then(r => after(task.id, r)),
  }), [taskWs, after, crm, toast])
  const openTask = taskWs.tasks.find(t => t.id === openTaskId) || null

  // ----- detalhes / criação -----
  const [panel, setPanel] = useState(null) // id do evento (não tarefa)
  const panelEvent = panel ? allEvents.find(e => e.id === panel) || null : null
  const [creating, setCreating] = useState(null) // { due, time }
  const openOpps = useMemo(() => crm.opps.filter(o => o.status === 'aberto'), [crm.opps])

  const onEvent = useCallback(ev => {
    if (ev.source === 'task') setOpenTaskId(ev.recordId)
    else setPanel(ev.id)
  }, [])
  const onCreateAt = useCallback((date, time = '') => {
    if (date < today) { toast('Escolha hoje ou uma data futura para criar uma atividade.', 'warning'); return }
    setCreating({ due: date, time })
  }, [today, toast])

  // ----- reagendar (arrastar ou painel) -----
  const opportunityDatesReady = Boolean(crm.features?.schema)
  const reschedule = useCallback(async (ev, date, time) => {
    const plan = reschedulePlan(ev, date, time, { today, opportunityDatesReady })
    if (plan.error) { toast(plan.error, 'warning', 4500); return plan }
    if (plan.noop) return plan
    const res = ev.source === 'opportunity'
      ? await crm.updateOpp(ev.recordId, plan.patch)
      : await taskWs.update(ev.recordId, plan.patch)
    if (res.error) { toast(`${res.error} O reagendamento foi desfeito.`, 'error'); return res }
    if (ev.source === 'task') window.setTimeout(() => mirror(ev.recordId), 0)
    const t = plan.patch.due_time
    toast(`Reagendado para ${fmtShort(date)}${t ? ` às ${t}` : ''}.`, 'success')
    return res
  }, [today, opportunityDatesReady, crm, taskWs, toast, mirror])

  const [dragId, setDragId] = useState(null)
  const dragProps = useCallback(ev => {
    const allowed = canReschedule(ev, { opportunityDatesReady }).ok
    if (!allowed) return {}
    return {
      draggable: true,
      onDragStart: e => { e.dataTransfer.setData(DRAG_MIME, ev.id); e.dataTransfer.effectAllowed = 'move'; setDragId(ev.id) },
      onDragEnd: () => setDragId(null),
    }
  }, [opportunityDatesReady])
  const onDropAt = useCallback((e, date, time) => {
    e.preventDefault()
    const id = e.dataTransfer.getData(DRAG_MIME)
    setDragId(null)
    const ev = allEvents.find(x => x.id === id)
    if (ev) reschedule(ev, date, time)
  }, [allEvents, reschedule])

  // ----- atalhos (como na agenda clínica) -----
  useEffect(() => {
    function onKey(e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target?.closest?.('input, textarea, select, [role="dialog"], [contenteditable="true"]')) return
      if (openTaskId || panel || creating) return
      const k = e.key.toLowerCase()
      if (k === 't') setFocus(today)
      else if (k === 'm') setView('month')
      else if (k === 'w' || k === 's') setView('week')
      else if (k === 'd') setView('day')
      else if (k === 'n' || k === 'arrowright') setFocus(f => shiftFocus(f, view, 1))
      else if (k === 'p' || k === 'arrowleft') setFocus(f => shiftFocus(f, view, -1))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [today, view, openTaskId, panel, creating]) // eslint-disable-line react-hooks/exhaustive-deps

  const memberLabel = crm.memberLabel
  const ctx = { memberLabel, dragProps, dragId, onEvent }

  const vars = {
    '--ag-bg': C.bg, '--ag-surface': C.surface, '--ag-card': C.card, '--ag-hover': C.cardHover, '--ag-border': C.border,
    '--ag-text': C.text, '--ag-sub': C.textSub, '--ag-dim': C.textDim, '--ag-accent': C.accent, '--ag-red': C.red, '--ag-yellow': C.yellow,
  }

  if (taskWs.loading) {
    return <div aria-busy="true" style={{ marginTop: 12, height: 480, borderRadius: 16, background: C.border, opacity: 0.3 }} />
  }

  return (
    <div className="crm-ag" style={vars} data-testid="crm-agenda">
      <div className="crm-ag__shell">
        <aside className={`crm-ag__side${sideOpen ? ' is-open' : ''}`} aria-label="Filtros da agenda">
          <Btn onClick={() => onCreateAt(focus < today ? today : focus, '')} style={{ padding: '8px 12px', fontSize: 13 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ico d={ICONS.plus} size={14} />Nova atividade</span>
          </Btn>
          <MiniMonth focus={focus} today={today} eventDays={eventDays} onPick={iso => { setFocus(iso); if (window.innerWidth <= 900) setSideOpen(false) }} />
          <div>
            <div className="crm-ag__side-title">Categorias</div>
            {AGENDA_TYPES.map(t => (
              <label key={t.key} className="crm-ag__cat" style={{ '--cat-color': t.color }} title={`Mostrar ou ocultar ${t.label.toLowerCase()}`}>
                <input type="checkbox" data-testid={`agenda-type-${t.key}`} checked={filters.types.includes(t.key)}
                  onChange={() => setFilters(f => ({ ...f, types: f.types.includes(t.key) ? f.types.filter(x => x !== t.key) : [...f.types, t.key] }))} />
                <span className="crm-ag__check">✓</span>
                <span>{t.label}</span>
                <small>{counts[t.key] || 0}</small>
              </label>
            ))}
          </div>
          <div>
            <div className="crm-ag__side-title">Responsáveis</div>
            <div className="crm-ag__people">
              {[{ id: 'me', label: 'Eu' }, ...crm.members.filter(m => m.user_id !== userId).map(m => ({ id: m.user_id, label: memberLabel[m.user_id] || m.user_id })), { id: 'none', label: 'Sem responsável' }].map(p => {
                const on = filters.responsibles.includes(p.id)
                return (
                  <button key={p.id} type="button" aria-pressed={on} className={`crm-ag__person${on ? ' is-on' : ''}`} data-testid={`agenda-person-${p.id}`}
                    onClick={() => setFilters(f => ({ ...f, responsibles: on ? f.responsibles.filter(x => x !== p.id) : [...f.responsibles, p.id] }))}>
                    <PersonDot id={p.id === 'me' ? userId : p.id} label={p.id === 'me' ? (memberLabel[userId] || 'Eu') : p.label} none={p.id === 'none'} />
                    <span>{p.id === 'me' ? 'Eu' : shortName(p.label)}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.5, padding: '0 6px' }}>
            Atalhos: <b>T</b> hoje · <b>M</b>/<b>S</b>/<b>D</b> mês, semana, dia · <b>←</b>/<b>→</b> navegar.<br />
            Horários no fuso da clínica ({CLINIC_TIME_ZONE.replace('_', ' ')}).
          </div>
        </aside>

        <section className="crm-ag__main">
          <header className="crm-ag__bar">
            <div className="crm-ag__nav">
              <button type="button" className="crm-ag__btn is-icon" aria-label={sideOpen ? 'Ocultar painel de filtros' : 'Mostrar painel de filtros'} onClick={() => setSideOpen(o => !o)}>
                <Ico d={ICONS.filter} size={15} />
              </button>
              <button type="button" className="crm-ag__btn" data-testid="agenda-today" onClick={() => setFocus(today)}>Hoje</button>
              <button type="button" className="crm-ag__btn is-icon" aria-label="Período anterior" data-testid="agenda-prev" onClick={() => setFocus(f => shiftFocus(f, view, -1))}><Ico d={<path d="m15 18-6-6 6-6" />} size={16} /></button>
              <button type="button" className="crm-ag__btn is-icon" aria-label="Próximo período" data-testid="agenda-next" onClick={() => setFocus(f => shiftFocus(f, view, 1))}><Ico d={<path d="m9 18 6-6-6-6" />} size={16} /></button>
              <h2 data-testid="agenda-title">{viewTitle(view, focus)}</h2>
            </div>
            <div className="crm-ag__actions">
              <FilterMenu filters={filters} setFilters={setFilters} nFilters={nFilters} patients={allEvents} />
              <div className="crm-ag__switch" role="group" aria-label="Visualização da agenda">
                {VIEWS.map(([k, l]) => <button key={k} type="button" data-testid={`agenda-view-${k}`} aria-pressed={view === k} className={view === k ? 'is-on' : ''} onClick={() => setView(k)}>{l}</button>)}
              </div>
            </div>
          </header>

          <ActiveChips filters={filters} setFilters={setFilters} memberLabel={memberLabel} count={inView.length} />

          {!opportunityDatesReady && canManage && (
            <div className="crm-ag__note">As próximas ações das oportunidades aparecem depois que a atualização do banco do CRM (<code>crm_workspace_phase1.sql</code>) for aplicada.</div>
          )}
          {taskWs.error && <div className="crm-ag__note" role="alert">Não foi possível carregar as tarefas: {taskWs.error} <button type="button" className="crm-ag__link" onClick={taskWs.reload}>Tentar novamente</button></div>}

          {view === 'month'
            ? <MonthGrid days={days} focus={focus} today={today} byDate={byDate} ctx={ctx} onCreateAt={onCreateAt} onDropAt={onDropAt} onDay={iso => { setFocus(iso); setView('day') }} />
            : <TimeGrid days={days} today={today} now={now} byDate={byDate} ctx={ctx} view={view} onCreateAt={onCreateAt} onDropAt={onDropAt} onDay={iso => { setFocus(iso); setView('day') }} />}
        </section>
      </div>

      {openTask && (
        <TaskDrawer task={openTask} ws={taskWs} ownerId={ownerId} userId={userId} today={today} actions={taskActions}
          onClose={() => setOpenTaskId(null)} toast={toast} />
      )}
      {panelEvent && (
        <EventPanel ev={panelEvent} crm={crm} today={today} memberLabel={memberLabel} onClose={() => setPanel(null)}
          onReschedule={reschedule} opportunityDatesReady={opportunityDatesReady}
          onOpenOpp={id => { const o = crm.opps.find(x => x.id === id); if (o) { setPanel(null); onOpenOpp(o) } }}
          onOpenAppointments={() => navigate('/app/calendar')} toast={toast} />
      )}
      {creating && (
        <NewTaskModal ws={taskWs} opportunities={openOpps}
          initial={{ due: creating.due, time: creating.time, assigned: userId || '' }}
          onClose={() => setCreating(null)}
          onCreated={task => { crm.syncTask({ type: 'created', task }); setCreating(null); toast('Atividade criada.', 'success') }} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function shortName(label) {
  const s = String(label || '')
  return s.includes('@') ? s.split('@')[0] : s
}

function PersonDot({ id, label, none, size = 18 }) {
  if (none) return <span style={{ width: size, height: size, borderRadius: '50%', border: `1.5px dashed ${C.textDim}`, flexShrink: 0 }} />
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 8.5, fontWeight: 800, color: '#fff', background: avatarColor(id || label) }}>
      {initials(label)}
    </span>
  )
}

function tooltip(ev, memberLabel) {
  const type = AGENDA_TYPE_BY_KEY[ev.type]?.single || ''
  const who = ev.responsibleId ? shortName(memberLabel[ev.responsibleId] || '') : 'Sem responsável'
  return [
    `${type}: ${ev.title}`,
    ev.subtitle,
    `${fmt(ev.date, { weekday: 'short', day: '2-digit', month: '2-digit' })} · ${timeRange(ev)}`,
    `Responsável: ${who}${ev.responsibleDerived && ev.responsibleId ? ' (da oportunidade)' : ''}`,
    `Status: ${statusLabel(ev)}`,
  ].filter(Boolean).join('\n')
}

function EventChip({ ev, ctx, block = false, showTime = true }) {
  const color = AGENDA_TYPE_BY_KEY[ev.type]?.color || C.accent
  const who = ev.responsibleId ? ctx.memberLabel[ev.responsibleId] || '' : ''
  const cls = `crm-ag__ev${block ? ' is-block' : ''}${ev.status === 'done' ? ' is-done' : ''}${ev.status === 'overdue' ? ' is-overdue' : ''}${ctx.dragId === ev.id ? ' is-dragging' : ''}`
  const av = who && <span className="crm-ag__ev-av" style={{ background: avatarColor(ev.responsibleId) }}>{initials(who)}</span>
  return (
    <button type="button" className={cls} style={{ '--ev-color': color }} title={tooltip(ev, ctx.memberLabel)}
      data-testid="agenda-event" data-event-id={ev.id} data-event-type={ev.type}
      aria-label={`${AGENDA_TYPE_BY_KEY[ev.type]?.single}: ${ev.title}, ${timeRange(ev)}`}
      onClick={e => { e.stopPropagation(); ctx.onEvent(ev) }} {...ctx.dragProps(ev)}>
      {block ? (
        <>
          <span className="crm-ag__ev-row"><span className="crm-ag__ev-title">{ev.title}</span>{av}</span>
          <span className="crm-ag__ev-sub">{timeRange(ev)}{ev.subtitle ? ` · ${ev.subtitle}` : ''}</span>
        </>
      ) : (
        <>
          {showTime && !ev.allDay && <span className="crm-ag__ev-time">{ev.startTime}</span>}
          <span className="crm-ag__ev-title">{ev.title}</span>
          {av}
        </>
      )}
    </button>
  )
}

function useDropTarget(onDrop) {
  const [over, setOver] = useState(false)
  return {
    over,
    handlers: {
      onDragOver: e => { if (Array.from(e.dataTransfer.types || []).includes(DRAG_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!over) setOver(true) } },
      onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) },
      onDrop: e => { setOver(false); onDrop(e) },
    },
  }
}

// ---------------------------------------------------------------------------
// Mês
// ---------------------------------------------------------------------------
function MonthGrid({ days, focus, today, byDate, ctx, onCreateAt, onDropAt, onDay }) {
  const month = focus.slice(0, 7)
  return (
    <div className="crm-ag__month" data-testid="agenda-month">
      <div className="crm-ag__wd">{WEEKDAYS.map(d => <div key={d}>{d}</div>)}</div>
      <div className="crm-ag__mgrid">
        {days.map(iso => <MonthCell key={iso} iso={iso} out={iso.slice(0, 7) !== month} today={today} events={byDate.get(iso) || []} ctx={ctx} onCreateAt={onCreateAt} onDropAt={onDropAt} onDay={onDay} />)}
      </div>
    </div>
  )
}

function MonthCell({ iso, out, today, events, ctx, onCreateAt, onDropAt, onDay }) {
  const drop = useDropTarget(e => onDropAt(e, iso, undefined))
  const moreRef = useRef(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const shown = events.slice(0, MONTH_LIMIT)
  const extra = events.length - shown.length
  return (
    <div className={`crm-ag__cell${out ? ' is-out' : ''}${iso === today ? ' is-today' : ''}${iso < today ? ' is-past' : ''}${drop.over ? ' is-drop' : ''}`}
      data-testid={`agenda-day-${iso}`} onClick={() => onCreateAt(iso, '')} {...drop.handlers}>
      <button type="button" className="crm-ag__num" aria-label={`Abrir ${fmt(iso, { dateStyle: 'full' })}`} onClick={e => { e.stopPropagation(); onDay(iso) }}>{Number(iso.slice(8))}</button>
      {shown.map(ev => <EventChip key={ev.id} ev={ev} ctx={ctx} />)}
      {extra > 0 && (
        <>
          <button ref={moreRef} type="button" className="crm-ag__more" data-testid="agenda-more" onClick={e => { e.stopPropagation(); setMoreOpen(o => !o) }}>+ {extra} {extra === 1 ? 'outro' : 'outros'}</button>
          <Popover anchorRef={moreRef} open={moreOpen} onClose={() => setMoreOpen(false)} width={270} label={`Atividades de ${fmtShort(iso)}`}>
            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 2 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.text, padding: '2px 4px 6px' }}>{cap(fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
              {events.map(ev => <EventChip key={ev.id} ev={ev} ctx={{ ...ctx, onEvent: x => { setMoreOpen(false); ctx.onEvent(x) } }} />)}
            </div>
          </Popover>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Semana / Dia
// ---------------------------------------------------------------------------
function TimeGrid({ days, today, now, byDate, ctx, view, onCreateAt, onDropAt, onDay }) {
  const scrollRef = useRef(null)
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i)
  // Abre perto do horário comercial (ou de agora), sem esconder a manhã.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = days.includes(today) ? Math.max(FIRST_HOUR, Math.floor(now.minutes / 60) - 2) : 8
    el.scrollTop = (target - FIRST_HOUR) * HOUR_H
  }, [view, days[0]]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`crm-ag__tg${view === 'day' ? ' is-day' : ''}`} data-testid={`agenda-${view}`} style={{ '--days': days.length, '--hour-h': `${HOUR_H}px` }}>
      <div className="crm-ag__tg-inner">
        <div className="crm-ag__tg-head">
          <div>GMT−03</div>
          {days.map(iso => (
            <button key={iso} type="button" className={`crm-ag__dayhead${iso === today ? ' is-today' : ''}`} onClick={() => onDay(iso)}>
              <span>{WEEKDAYS[dateOf(iso).getDay()]}</span><strong>{Number(iso.slice(8))}</strong>
            </button>
          ))}
        </div>
        <div className="crm-ag__allday">
          <div>dia todo</div>
          {days.map(iso => <AllDayCell key={iso} iso={iso} events={(byDate.get(iso) || []).filter(e => e.allDay)} ctx={ctx} onCreateAt={onCreateAt} onDropAt={onDropAt} />)}
        </div>
        <div className="crm-ag__scroll" ref={scrollRef}>
          <div className="crm-ag__tg-body">
            <div className="crm-ag__hours">{hours.map(h => <div key={h}>{h > FIRST_HOUR ? `${String(h).padStart(2, '0')}:00` : ''}</div>)}</div>
            {days.map(iso => <DayColumn key={iso} iso={iso} today={today} now={now} hours={hours} events={(byDate.get(iso) || []).filter(e => !e.allDay)} ctx={ctx} onCreateAt={onCreateAt} onDropAt={onDropAt} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

function AllDayCell({ iso, events, ctx, onCreateAt, onDropAt }) {
  const drop = useDropTarget(e => onDropAt(e, iso, null))
  return (
    <div className={`crm-ag__allday-cell${drop.over ? ' is-drop' : ''}`} onClick={() => onCreateAt(iso, '')} {...drop.handlers}>
      {events.map(ev => <EventChip key={ev.id} ev={ev} ctx={ctx} />)}
    </div>
  )
}

function DayColumn({ iso, today, now, hours, events, ctx, onCreateAt, onDropAt }) {
  const drop = useDropTarget(e => {
    const r = e.currentTarget.getBoundingClientRect()
    const raw = FIRST_HOUR * 60 + ((e.clientY - r.top) / HOUR_H) * 60
    const snapped = Math.round(raw / 15) * 15
    onDropAt(e, iso, timeOf(Math.max(FIRST_HOUR * 60, Math.min(LAST_HOUR * 60 - 15, snapped))))
  })
  const placed = useMemo(() => layoutTimedEvents(events), [events])
  const minTop = FIRST_HOUR * 60
  return (
    <div className={`crm-ag__slotcol${iso === today ? ' is-today' : ''}${drop.over ? ' is-drop' : ''}`} data-testid={`agenda-col-${iso}`} {...drop.handlers}>
      {hours.map(h => (
        <button key={h} type="button" className="crm-ag__slot" aria-label={`Criar atividade em ${fmt(iso, { dateStyle: 'long' })} às ${h}:00`}
          onClick={() => onCreateAt(iso, `${String(h).padStart(2, '0')}:00`)} />
      ))}
      {iso === today && now.minutes >= minTop && now.minutes < LAST_HOUR * 60 && (
        <div className="crm-ag__now" style={{ top: ((now.minutes - minTop) / 60) * HOUR_H }} />
      )}
      {placed.map(p => {
        // Eventos fora da janela visível ficam presos às bordas, sem sumir.
        const start = Math.max(minTop, Math.min(p.start, LAST_HOUR * 60 - 30))
        const top = ((start - minTop) / 60) * HOUR_H
        const height = Math.max(24, ((Math.min(p.end, LAST_HOUR * 60) - start) / 60) * HOUR_H - 2)
        const width = 100 / p.lanes
        return (
          <div key={p.event.id} className="crm-ag__place" style={{ top, height, left: `${p.lane * width}%`, width: `${width}%` }}>
            <EventChip ev={p.event} ctx={ctx} block={height >= 38} />
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mini calendário (navegação rápida)
// ---------------------------------------------------------------------------
function MiniMonth({ focus, today, eventDays, onPick }) {
  const [month, setMonth] = useState(monthStart(focus))
  useEffect(() => { setMonth(monthStart(focus)) }, [focus])
  const cells = visibleDays('month', month)
  return (
    <div>
      <div className="crm-ag__mini-head">
        <button type="button" className="crm-ag__btn is-icon" style={{ width: 24, height: 24 }} aria-label="Mês anterior" onClick={() => setMonth(m => shiftFocus(m, 'month', -1))}><Ico d={<path d="m15 18-6-6 6-6" />} size={13} /></button>
        <span>{cap(fmt(month, { month: 'long', year: 'numeric' }))}</span>
        <button type="button" className="crm-ag__btn is-icon" style={{ width: 24, height: 24 }} aria-label="Próximo mês" onClick={() => setMonth(m => shiftFocus(m, 'month', 1))}><Ico d={<path d="m9 18 6-6-6-6" />} size={13} /></button>
      </div>
      <div className="crm-ag__mini-grid">
        {WEEKDAYS.map(d => <span key={d}>{d[0]}</span>)}
        {cells.map(iso => (
          <button key={iso} type="button" onClick={() => onPick(iso)} aria-label={fmt(iso, { dateStyle: 'full' })}
            className={`crm-ag__mini-day${iso.slice(0, 7) !== month.slice(0, 7) ? ' is-out' : ''}${iso === today ? ' is-today' : ''}${iso === focus ? ' is-sel' : ''}${eventDays.has(iso) ? ' has-ev' : ''}`}>
            {Number(iso.slice(8))}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------
function FilterMenu({ filters, setFilters, nFilters, patients }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const names = useMemo(() => [...new Set(patients.map(e => e.patientName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [patients])
  const field = { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit', fontSize: 12.5 }
  const section = { fontSize: 10.5, fontWeight: 800, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.06em', margin: '8px 4px 5px' }
  const toggle = (key, value) => setFilters(f => ({ ...f, [key]: f[key].includes(value) ? f[key].filter(x => x !== value) : [...f[key], value] }))
  return (
    <>
      <button ref={ref} type="button" data-testid="agenda-filters" className={`crm-ag__btn${nFilters ? ' is-active' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Ico d={ICONS.filter} size={14} />Filtros{nFilters > 0 && <span className="crm-ag__badge">{nFilters}</span>}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={290} align="right" label="Filtros da agenda" testId="agenda-filter-panel">
        <div style={{ padding: '2px 4px 6px' }}>
          <div style={section}>Status</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {AGENDA_STATUSES.map(s => {
              const on = filters.statuses.includes(s.key)
              return (
                <button key={s.key} type="button" aria-pressed={on} data-testid={`agenda-status-${s.key}`} onClick={() => toggle('statuses', s.key)}
                  style={{ padding: '4px 9px', borderRadius: 999, border: `1px solid ${on ? s.color : C.border}`, background: on ? s.color + '22' : 'transparent', color: on ? C.text : C.textSub, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {s.label}
                </button>
              )
            })}
          </div>
          <div style={section}>Paciente</div>
          <input list="crm-agenda-patients" data-testid="agenda-patient" value={filters.patient} placeholder="Nome do paciente" style={field}
            onChange={e => setFilters(f => ({ ...f, patient: e.target.value }))} />
          <datalist id="crm-agenda-patients">{names.map(n => <option key={n} value={n} />)}</datalist>
          <div style={section}>Período</div>
          <select value={filters.period.key} data-testid="agenda-period" style={field} onChange={e => setFilters(f => ({ ...f, period: { ...f.period, key: e.target.value } }))}>
            {AGENDA_PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          {filters.period.key === 'custom' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
              <input type="date" aria-label="De" value={filters.period.from} style={field} onChange={e => setFilters(f => ({ ...f, period: { ...f.period, from: e.target.value } }))} />
              <input type="date" aria-label="Até" value={filters.period.to} style={field} onChange={e => setFilters(f => ({ ...f, period: { ...f.period, to: e.target.value } }))} />
            </div>
          )}
          <div style={{ fontSize: 11, color: C.textDim, margin: '10px 4px 0', lineHeight: 1.45 }}>Categorias e responsáveis ficam no painel à esquerda. Todos os filtros se combinam.</div>
          {nFilters > 0 && (
            <button type="button" className="crm-ag__link" style={{ marginTop: 8 }} onClick={() => setFilters(() => EMPTY_AGENDA_FILTERS)}>Limpar todos os filtros</button>
          )}
        </div>
      </Popover>
    </>
  )
}

function ActiveChips({ filters, setFilters, memberLabel, count }) {
  const chips = []
  const hidden = AGENDA_TYPES.filter(t => !filters.types.includes(t.key))
  if (hidden.length) chips.push({ key: 'types', label: `Ocultas: ${hidden.map(t => t.label).join(', ')}`, clear: f => ({ ...f, types: AGENDA_TYPE_KEYS }) })
  for (const r of filters.responsibles) {
    const label = r === 'me' ? 'Eu' : r === 'none' ? 'Sem responsável' : shortName(memberLabel[r] || 'Pessoa')
    chips.push({ key: `r-${r}`, label: `Responsável: ${label}`, clear: f => ({ ...f, responsibles: f.responsibles.filter(x => x !== r) }) })
  }
  for (const s of filters.statuses) chips.push({ key: `s-${s}`, label: AGENDA_STATUSES.find(x => x.key === s)?.label, clear: f => ({ ...f, statuses: f.statuses.filter(x => x !== s) }) })
  if (filters.patient.trim()) chips.push({ key: 'p', label: `Paciente: ${filters.patient.trim()}`, clear: f => ({ ...f, patient: '' }) })
  if (filters.period.key !== 'all') {
    const p = filters.period
    const label = p.key === 'custom' ? `${p.from ? fmtShort(p.from) : '…'} a ${p.to ? fmtShort(p.to) : '…'}` : AGENDA_PERIODS.find(x => x.key === p.key)?.label
    chips.push({ key: 'period', label: `Período: ${label}`, clear: f => ({ ...f, period: { key: 'all', from: '', to: '' } }) })
  }
  if (!chips.length) return null
  return (
    <div className="crm-ag__chips" data-testid="agenda-chips">
      <span>{count} {count === 1 ? 'atividade' : 'atividades'} no período exibido ·</span>
      {chips.map(c => (
        <span key={c.key} className="crm-ag__chip">{c.label}<button type="button" aria-label={`Remover filtro ${c.label}`} onClick={() => setFilters(c.clear)}>×</button></span>
      ))}
      <button type="button" className="crm-ag__link" onClick={() => setFilters(() => EMPTY_AGENDA_FILTERS)}>Limpar filtros</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Painel lateral de detalhes (consulta, cirurgia, próxima ação de oportunidade)
// ---------------------------------------------------------------------------
function EventPanel({ ev, crm, today, memberLabel, onClose, onReschedule, opportunityDatesReady, onOpenOpp, onOpenAppointments, toast }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !e.defaultPrevented) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const [busy, setBusy] = useState(false)
  if (typeof document === 'undefined') return null
  const type = AGENDA_TYPE_BY_KEY[ev.type]
  const isOpp = ev.source === 'opportunity'
  const isAppointment = ev.source === 'consultation' || ev.source === 'surgery'
  const movable = canReschedule(ev, { opportunityDatesReady })
  const field = { fontSize: 13, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit', boxSizing: 'border-box', width: '100%' }
  const who = ev.responsibleId ? memberLabel[ev.responsibleId] || 'Pessoa da equipe' : 'Sem responsável'
  const description = isOpp ? ev.record?.next_action : ev.record?.notes

  async function setResponsible(userId) {
    setBusy(true)
    const res = await crm.updateOpp(ev.recordId, { responsible_user_id: userId || null })
    setBusy(false)
    if (res.error) toast('Não foi possível salvar. A alteração foi desfeita.', 'error')
  }
  async function setDate(date) {
    if (!date) return
    setBusy(true)
    await onReschedule(ev, date, undefined)
    setBusy(false)
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)' }} />
      <aside role="dialog" aria-label={`${type?.single}: ${ev.title}`} data-testid="agenda-event-panel"
        style={{ position: 'relative', width: 'min(460px, 100vw)', height: '100%', background: C.bg || C.card, borderLeft: `1px solid ${C.border}`, boxShadow: '-20px 0 50px -20px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', '--ag-dim': C.textDim, '--ag-text': C.text }}>
        <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, padding: '3px 9px', borderRadius: 6, background: type?.color, color: '#fff' }}>{type?.single}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: ev.status === 'overdue' ? C.red : C.textSub }}>{statusLabel(ev)}</span>
            <span style={{ flex: 1 }} />
            <button type="button" aria-label="Fechar painel" data-testid="agenda-panel-close" onClick={onClose} style={{ border: 'none', background: 'transparent', color: C.textSub, cursor: 'pointer', padding: 4, display: 'grid' }}>
              <Ico d={ICONS.x} size={18} />
            </button>
          </div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text, lineHeight: 1.3 }}>{ev.title}</h3>
          {ev.subtitle && <div style={{ fontSize: 13, color: C.textSub }}>{ev.subtitle}</div>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="crm-ag__panel-row">
            <span>Paciente</span><span>{ev.patientName || '—'}</span>
            <span>Responsável</span>
            {isOpp ? (
              <select aria-label="Responsável" value={ev.responsibleId || ''} disabled={busy} onChange={e => setResponsible(e.target.value)} style={field}>
                <option value="">Sem responsável</option>
                {crm.members.map(m => <option key={m.user_id} value={m.user_id}>{memberLabel[m.user_id] || m.user_id}</option>)}
              </select>
            ) : (
              <span>{who}{ev.responsibleDerived && ev.responsibleId && <small style={{ color: C.textDim }}> · responsável pela oportunidade do paciente</small>}</span>
            )}
            <span>Data</span>
            {isOpp && movable.ok ? (
              <input type="date" aria-label="Data" data-testid="agenda-panel-date" value={ev.date} min={today} disabled={busy} onChange={e => setDate(e.target.value)} style={field} />
            ) : (
              <span>{cap(fmt(ev.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</span>
            )}
            <span>Horário</span><span>{timeRange(ev)}</span>
            <span>Tipo</span><span>{type?.single}{isOpp ? ' · próxima ação da oportunidade' : ''}</span>
            <span>Status</span><span>{statusLabel(ev)}</span>
          </div>

          {description && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Descrição</div>
              <div style={{ fontSize: 13, color: C.text, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{description}</div>
            </div>
          )}

          {isAppointment && (
            <div style={{ fontSize: 12.5, color: C.textSub, lineHeight: 1.5, padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface }}>
              {movable.reason}
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {isAppointment && <Btn onClick={onOpenAppointments}>Abrir em Atendimentos</Btn>}
            {ev.opportunityId && <Btn variant={isAppointment ? 'ghost' : 'primary'} onClick={() => onOpenOpp(ev.opportunityId)}>Abrir oportunidade</Btn>}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
