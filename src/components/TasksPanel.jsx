import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Modal, Btn, FInput } from './UI.jsx'
import { PatientSelector } from './PatientSelector.jsx'
import { createTask, toggleTask, deleteTask } from '../lib/taskActions.js'
import { groupTasksByDue, GROUP_ORDER } from '../lib/taskGroups.js'
import { filterTasks, kanbanByStatus, urgencyOf, countDoneToday, dayKey } from '../lib/taskViews.js'
import { initials, avatarColor } from '../lib/avatar.js'

// Painel de tarefas da clínica (cross-oportunidade + avulsas). Agenda do dia da equipe.
// Duas visões: Lista (agrupada por vencimento) e Kanban (A fazer / Concluídas, arrastar conclui/reabre).
// Filtro por escopo (minhas/todas), múltiplos responsáveis e busca.

const VIEW_KEY = 'surgimetrics_tasks_view'

// Rótulo amigável do prazo (relativo para hoje/atraso, data curta no resto).
function relDue(due) {
  if (!due) return null
  const d = String(due).slice(0, 10)
  const now = new Date()
  const today = dayKey(now)
  if (d === today) return 'hoje'
  const t = new Date(d + 'T00:00:00')
  const diff = Math.round((t - new Date(today + 'T00:00:00')) / 86400000)
  if (diff === 1) return 'amanhã'
  if (diff === -1) return 'ontem'
  if (diff < -1) return `${Math.abs(diff)} dias atrás`
  try { return t.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) } catch { return d }
}
function urgColor(u) {
  return ({ atrasada: C.red || '#EF4444', hoje: C.accent, semana: C.yellow || '#F59E0B', futura: C.textDim, feita: C.green || '#10B981' })[u] || C.textDim
}

// ---- Átomos visuais ----
function Avatar({ label, size = 30, title }) {
  const s = size
  return (
    <span title={title || label} style={{
      width: s, height: s, borderRadius: '50%', display: 'grid', placeItems: 'center',
      fontSize: s <= 20 ? 9 : 11.5, fontWeight: 800, color: '#fff', flexShrink: 0,
      background: avatarColor(label), border: `2px solid ${C.card}`, boxShadow: '0 2px 6px -2px rgba(0,0,0,.4)',
    }}>{initials(label)}</span>
  )
}
function CheckIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
}
function Ico({ d, size = 15, sw = 2, fill = 'none' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
}
const ICON = {
  warn: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  cal: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M3 7l3-4h12l3 4M3 12h18" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  board: <><rect x="3" y="3" width="7" height="18" rx="1.5" /><rect x="14" y="3" width="7" height="11" rx="1.5" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
}

export function TasksPanel() {
  const { user } = useAuth()
  const { ownerId, role } = useUserRole()
  const effectiveUserId = ownerId || user?.id

  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [scope, setScope] = useState(role === 'admin' || role === 'gestao' ? 'todas' : 'minhas')
  const [responsibles, setResponsibles] = useState([])
  const [query, setQuery] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState(() => {
    try { return window.localStorage.getItem(VIEW_KEY) || 'lista' } catch { return 'lista' }
  })

  function changeView(v) {
    setView(v)
    try { window.localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ }
  }

  async function load() {
    setLoading(true); setError(null)
    const [taskRes, memRes] = await Promise.all([
      supabase.from('tasks')
        .select('id, title, due_date, status, assigned_user_id, done_at, created_at, opportunity_id, patient_id, patients(full_name), opportunities(title)')
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase.rpc('clinic_team'), // time completo da clínica (inclui o dono) — admin/gestão/equipe atribuem a qualquer um
    ])
    if (taskRes.error) { setError(taskRes.error.message); setLoading(false); return }
    setTasks(taskRes.data ?? [])
    setMembers((memRes.data ?? []).filter(m => m.user_id))
    setLoading(false)
  }
  useEffect(() => { if (effectiveUserId) load() }, [effectiveUserId])

  const memberLabel = useMemo(() => Object.fromEntries(members.map(m => [m.user_id, m.member_email || m.user_id])), [members])
  const filtered = useMemo(
    () => filterTasks(tasks, { scope, currentUserId: user?.id, responsibles, query }),
    [tasks, scope, user, responsibles, query],
  )
  const groups = useMemo(() => groupTasksByDue(filtered), [filtered])
  const kanban = useMemo(() => kanbanByStatus(filtered), [filtered])

  // Estatísticas do conjunto visível.
  const stats = useMemo(() => ({
    atrasadas: groups.atrasadas.length,
    hoje: groups.hoje.length,
    semana: groups.semana.length + groups.futuras.length,
    feitasHoje: countDoneToday(filtered),
  }), [groups, filtered])

  // Rollback por item (não desfaz mudanças concorrentes de outras tarefas).
  async function toggle(task) {
    setTasks(ts => ts.map(x => (x.id === task.id ? { ...x, status: x.status === 'feita' ? 'pendente' : 'feita', done_at: x.status === 'feita' ? null : new Date().toISOString() } : x)))
    const res = await toggleTask(task)
    if (res.error) { setTasks(ts => ts.map(x => (x.id === task.id ? task : x))); setError(res.error) }
  }
  async function remove(task) {
    setTasks(ts => ts.filter(x => x.id !== task.id))
    const res = await deleteTask(task.id)
    if (res.error) { setTasks(ts => (ts.some(x => x.id === task.id) ? ts : [...ts, task])); setError(res.error) }
  }
  // Drop no kanban: só alterna quando o status realmente muda.
  function dropToStatus(taskId, targetDone) {
    const t = tasks.find(x => x.id === taskId)
    if (!t) return
    if ((t.status === 'feita') !== targetDone) toggle(t)
  }

  if (loading) return <LoadingState />
  if (error) return <div style={{ color: C.red || '#ef4444', fontSize: 14, padding: 24 }}>Erro: {error}</div>

  return (
    <div>
      <Toolbar
        scope={scope} setScope={setScope}
        responsibles={responsibles} setResponsibles={setResponsibles}
        query={query} setQuery={setQuery}
        members={members} memberLabel={memberLabel}
        view={view} setView={changeView}
        onCreate={() => setCreating(true)}
      />

      <StatStrip stats={stats} />

      {view === 'kanban'
        ? <KanbanView kanban={kanban} memberLabel={memberLabel} onToggle={toggle} onRemove={remove} onDrop={dropToStatus} />
        : <ListView groups={groups} memberLabel={memberLabel} onToggle={toggle} onRemove={remove} showDone={showDone} setShowDone={setShowDone} />}

      {creating && (
        <NewTaskModal ownerId={effectiveUserId} userId={user?.id} members={members}
          onClose={() => setCreating(false)} onCreated={t => { setTasks(ts => [...ts, t]); setCreating(false) }} />
      )}
    </div>
  )
}

// ---- Toolbar (filtros + visão) ----
function Toolbar({ scope, setScope, responsibles, setResponsibles, query, setQuery, members, memberLabel, view, setView, onCreate }) {
  const seg = active => ({ padding: '7px 15px', borderRadius: 8, border: 'none', background: active ? C.card : 'transparent', color: active ? C.accent : C.textSub, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: active ? '0 6px 16px -10px rgba(0,0,0,.6)' : 'none' })
  const segWrap = { display: 'inline-flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11, padding: 4 }
  const field = { display: 'flex', alignItems: 'center', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', color: C.textSub, fontSize: 13 }
  const createBtn = { padding: '9px 15px', borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight || C.accent})`, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 7, boxShadow: `0 6px 18px -6px ${C.accent}88` }

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
      <div style={segWrap} role="group" aria-label="Escopo">
        <button type="button" style={seg(scope === 'minhas')} onClick={() => setScope('minhas')}>Minhas</button>
        <button type="button" style={seg(scope === 'todas')} onClick={() => setScope('todas')}>Todas</button>
      </div>

      <ResponsibleFilter members={members} memberLabel={memberLabel} value={responsibles} onChange={setResponsibles} />

      <label style={{ ...field, flex: '1 1 200px', minWidth: 150 }}>
        <span style={{ color: C.textDim, display: 'inline-flex' }}><Ico d={ICON.search} size={15} /></span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar tarefa ou paciente…"
          style={{ flex: 1, border: 'none', background: 'transparent', color: C.text, outline: 'none', fontFamily: 'inherit', fontSize: 13, minWidth: 0 }} />
      </label>

      <div style={segWrap} role="group" aria-label="Visão">
        <button type="button" style={{ ...seg(view === 'lista'), display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setView('lista')} title="Lista"><Ico d={ICON.list} size={15} />Lista</button>
        <button type="button" style={{ ...seg(view === 'kanban'), display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setView('kanban')} title="Kanban"><Ico d={ICON.board} size={15} />Kanban</button>
      </div>

      <button type="button" style={createBtn} onClick={onCreate}><Ico d={ICON.plus} size={16} sw={2.4} />Nova tarefa</button>
    </div>
  )
}

// Filtro de responsáveis com múltipla seleção (popover de checkboxes).
function ResponsibleFilter({ members, memberLabel, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const options = [{ id: 'none', label: 'Sem responsável' }, ...members.map(m => ({ id: m.user_id, label: memberLabel[m.user_id] || m.user_id }))]
  const toggle = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id])
  const count = value.length
  const summary = count === 0 ? 'Responsáveis: todos' : `${count} responsáve${count > 1 ? 'is' : 'l'}`

  const btn = { display: 'inline-flex', alignItems: 'center', gap: 8, background: count ? C.accent + '18' : C.surface, border: `1px solid ${count ? C.accent : C.border}`, borderRadius: 10, padding: '8px 12px', color: count ? C.accent : C.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
  const pop = { position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 40, minWidth: 230, maxHeight: 300, overflowY: 'auto', background: C.card, border: `1px solid ${C.borderBright || C.border}`, borderRadius: 12, padding: 6, boxShadow: '0 18px 44px -14px rgba(0,0,0,.6)' }
  const opt = sel => ({ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: C.text, background: sel ? C.accent + '12' : 'transparent' })

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" style={btn} onClick={() => setOpen(o => !o)}>
        <span style={{ display: 'inline-flex' }}><Ico d={ICON.user} size={14} /></span>
        {summary}
        <span style={{ display: 'inline-flex', opacity: 0.7 }}><Ico d={ICON.chevron} size={13} /></span>
      </button>
      {open && (
        <div style={pop}>
          {count > 0 && (
            <button type="button" onClick={() => onChange([])}
              style={{ width: '100%', textAlign: 'left', padding: '7px 9px', border: 'none', background: 'none', color: C.textSub, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Limpar seleção</button>
          )}
          {options.map(o => {
            const sel = value.includes(o.id)
            return (
              <div key={o.id} style={opt(sel)} onClick={() => toggle(o.id)}>
                <span style={{ width: 17, height: 17, borderRadius: 5, border: `2px solid ${sel ? C.accent : C.borderBright || C.border}`, background: sel ? C.accent : 'transparent', display: 'grid', placeItems: 'center', color: '#fff', flexShrink: 0 }}>{sel && <Ico d={ICON.check} size={11} sw={3.5} />}</span>
                {o.id !== 'none' && <Avatar label={o.label} size={20} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---- Faixa de estatísticas ----
function StatStrip({ stats }) {
  const items = [
    { n: stats.atrasadas, l: 'Atrasadas', color: C.red || '#EF4444', d: ICON.warn },
    { n: stats.hoje, l: 'Para hoje', color: C.accent, d: ICON.clock },
    { n: stats.semana, l: 'Próximas', color: C.textSub, d: ICON.cal },
    { n: stats.feitasHoje, l: 'Concluídas hoje', color: C.green || '#10B981', d: ICON.check },
  ]
  const wrap = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, margin: '0 0 22px' }
  return (
    <div style={wrap}>
      {items.map((it, i) => (
        <div key={i} style={{ position: 'relative', overflow: 'hidden', background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: it.color }} />
          <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', marginBottom: 10, background: it.color + '22', color: it.color }}><Ico d={it.d} size={18} sw={2} /></div>
          <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: it.n > 0 ? it.color : C.text }}>{it.n}</div>
          <div style={{ fontSize: 12, color: C.textSub, fontWeight: 600, marginTop: 5 }}>{it.l}</div>
        </div>
      ))}
    </div>
  )
}

// ---- Cartão de tarefa (compartilhado entre lista e kanban) ----
function TaskCard({ t, memberLabel, onToggle, onRemove, draggable }) {
  const done = t.status === 'feita'
  const u = done ? 'feita' : urgencyOf(t)
  const bar = urgColor(u)
  const dueTxt = relDue(t.due_date)
  const who = t.assigned_user_id ? (memberLabel[t.assigned_user_id] || '—') : null
  const patient = t.patients?.full_name
  const oppTitle = t.opportunities?.title && t.opportunities.title !== 'Oportunidade' ? t.opportunities.title : null
  const avulsa = !patient && !t.opportunity_id

  const [hover, setHover] = useState(false)
  const dueStyle = {
    atrasada: { color: C.red || '#EF4444', background: (C.red || '#EF4444') + '22' },
    hoje: { color: C.accent, background: C.accent + '22' },
    semana: { color: C.yellow || '#F59E0B', background: (C.yellow || '#F59E0B') + '22' },
    futura: { color: C.textSub, background: C.surface },
    feita: { color: C.textSub, background: C.surface },
  }[u]

  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? e => e.dataTransfer.setData('text/plain', t.id) : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 13, position: 'relative', overflow: 'hidden',
        background: hover ? (C.cardHover || C.card) : C.card, border: `1px solid ${hover ? (C.borderBright || C.border) : C.border}`,
        borderRadius: 13, padding: '12px 14px', marginBottom: 9, opacity: done ? 0.62 : 1,
        transform: hover ? 'translateY(-2px)' : 'none', boxShadow: hover ? '0 16px 40px -16px rgba(0,0,0,.6)' : 'none',
        transition: 'transform .16s, box-shadow .16s, background .16s, border-color .16s', cursor: draggable ? 'grab' : 'default',
      }}>
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3.5, background: bar }} />

      <button type="button" onClick={() => onToggle()} aria-label={done ? 'Reabrir' : 'Concluir'}
        style={{ width: 24, height: 24, borderRadius: '50%', border: `2px solid ${done ? (C.green || '#10B981') : (C.borderBright || C.border)}`, background: done ? (C.green || '#10B981') : 'transparent', color: '#fff', flexShrink: 0, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0, transition: '.16s' }}>
        <span style={{ opacity: done ? 1 : 0, transform: done ? 'scale(1)' : 'scale(.4)', transition: '.18s' }}><CheckIcon /></span>
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: done ? C.textSub : C.text, textDecoration: done ? 'line-through' : 'none', marginBottom: (patient || oppTitle || avulsa) ? 5 : 0, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {patient && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: C.text, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: '3px 8px' }}>
              <Avatar label={patient} size={18} /> {patient}
            </span>
          )}
          {oppTitle && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: C.purple || '#8B5CF6', background: (C.purple || '#8B5CF6') + '1e', border: `1px solid ${(C.purple || '#8B5CF6')}44`, borderRadius: 7, padding: '3px 8px' }}>
              <Ico d={ICON.briefcase} size={12} /> {oppTitle}
            </span>
          )}
          {avulsa && <span style={{ fontSize: 11.5, fontWeight: 600, color: C.textSub, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: '3px 8px' }}>avulsa</span>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {dueTxt && <span style={{ ...dueStyle, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8, whiteSpace: 'nowrap' }}>
          {u === 'atrasada' && <Ico d={ICON.warn} size={12} sw={2.2} />}{dueTxt}
        </span>}
        {who && <Avatar label={who} size={30} />}
        <button type="button" onClick={() => onRemove()} title="Excluir"
          style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: hover ? C.surface : 'transparent', color: C.textDim, cursor: 'pointer', display: 'grid', placeItems: 'center', transition: '.15s', padding: 0 }}>
          <Ico d={ICON.x} size={14} sw={2} />
        </button>
      </div>
    </div>
  )
}

// ---- Visão em LISTA (agrupada por vencimento) ----
function ListView({ groups, memberLabel, onToggle, onRemove, showDone, setShowDone }) {
  const empty = GROUP_ORDER.every(g => !groups[g.key].length)
  const headColor = { atrasadas: C.red || '#EF4444', hoje: C.accent, semana: C.textSub, futuras: C.textSub }
  const headBg = { atrasadas: (C.red || '#EF4444') + '22', hoje: C.accent + '22', semana: C.surface, futuras: C.surface }
  const headIcon = { atrasadas: ICON.warn, hoje: ICON.clock, semana: ICON.cal, futuras: ICON.cal }

  return (
    <div>
      {GROUP_ORDER.map(g => {
        const items = groups[g.key]
        if (!items.length) return null
        return (
          <div key={g.key} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', background: headBg[g.key], color: headColor[g.key] }}><Ico d={headIcon[g.key]} size={15} sw={2.2} /></span>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, letterSpacing: '0.02em', textTransform: 'uppercase', color: headColor[g.key] }}>{g.label}</h3>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: C.textSub, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: '2px 9px', fontVariantNumeric: 'tabular-nums' }}>{items.length}</span>
              <span style={{ flex: 1, height: 1, background: C.border }} />
            </div>
            {items.map(t => <TaskCard key={t.id} t={t} memberLabel={memberLabel} onToggle={() => onToggle(t)} onRemove={() => onRemove(t)} />)}
          </div>
        )
      })}

      {empty && <EmptyState />}

      {groups.concluidas.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={() => setShowDone(v => !v)}
            style={{ background: 'none', border: 'none', color: C.textSub, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: '8px 0', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-flex', transform: showDone ? 'none' : 'rotate(-90deg)', transition: '.15s' }}><Ico d={ICON.chevron} size={13} sw={2.4} /></span>
            Concluídas ({groups.concluidas.length})
          </button>
          {showDone && <div style={{ marginTop: 8 }}>{groups.concluidas.map(t => <TaskCard key={t.id} t={t} memberLabel={memberLabel} onToggle={() => onToggle(t)} onRemove={() => onRemove(t)} />)}</div>}
        </div>
      )}
    </div>
  )
}

// ---- Visão em KANBAN (A fazer / Concluídas; arrastar conclui/reabre) ----
function KanbanView({ kanban, memberLabel, onToggle, onRemove, onDrop }) {
  const cols = [
    { key: 'afazer', label: 'A fazer', items: kanban.afazer, done: false, color: C.accent },
    { key: 'concluidas', label: 'Concluídas', items: kanban.concluidas, done: true, color: C.green || '#10B981' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 15, alignItems: 'start' }}>
      {cols.map(col => <KanbanColumn key={col.key} col={col} memberLabel={memberLabel} onToggle={onToggle} onRemove={onRemove} onDrop={onDrop} />)}
    </div>
  )
}
function KanbanColumn({ col, memberLabel, onToggle, onRemove, onDrop }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) }}
      onDrop={e => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData('text/plain'); if (id) onDrop(id, col.done) }}
      style={{ background: over ? col.color + '10' : C.surface, border: `1px solid ${over ? col.color : C.border}`, borderRadius: 15, padding: 12, minHeight: 140, transition: 'background .12s, border-color .12s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: col.color }} />
        <span style={{ fontSize: 13, fontWeight: 800, color: C.text, flex: 1 }}>{col.label}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.textSub, background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: '1px 9px', fontVariantNumeric: 'tabular-nums' }}>{col.items.length}</span>
      </div>
      {col.items.length === 0
        ? <div style={{ textAlign: 'center', color: C.textDim, fontSize: 12, padding: '26px 0', border: `1.5px dashed ${C.border}`, borderRadius: 11 }}>{over ? 'Soltar aqui' : 'Arraste tarefas pra cá'}</div>
        : col.items.map(t => <TaskCard key={t.id} t={t} memberLabel={memberLabel} onToggle={() => onToggle(t)} onRemove={() => onRemove(t)} draggable />)}
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0' }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 14px', display: 'grid', placeItems: 'center', background: (C.green || '#10B981') + '1e', color: C.green || '#10B981' }}><Ico d={ICON.check} size={28} sw={2.4} /></div>
      <div style={{ color: C.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Tudo em dia! 🎉</div>
      <div style={{ color: C.textSub, fontSize: 13 }}>Nenhuma tarefa pendente com os filtros atuais.</div>
    </div>
  )
}

function LoadingState() {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 22 }}>
        {[1, 2, 3, 4].map(i => <div key={i} style={{ height: 92, borderRadius: 14, background: C.border, opacity: 0.4 }} />)}
      </div>
      {[1, 2, 3].map(i => <div key={i} style={{ height: 62, borderRadius: 13, background: C.border, opacity: 0.3, marginBottom: 9 }} />)}
    </div>
  )
}

function NewTaskModal({ ownerId, userId, members, onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', due: '', assigned: '', patient_id: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.title.trim() || saving) return
    setSaving(true); setError(null)
    const res = await createTask(ownerId, {
      title: form.title, dueDate: form.due || null, assignedUserId: form.assigned || null,
      patientId: form.patient_id || null, createdBy: userId,
    })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onCreated(res.task)
  }

  return (
    <Modal open onClose={onClose} title="Nova tarefa avulsa" width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FInput label="Tarefa" value={form.title} onChange={v => set('title', v)} placeholder="O que precisa ser feito?" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <FInput label="Vencimento" type="date" value={form.due} onChange={v => set('due', v)} />
          <FInput label="Responsável" value={form.assigned} onChange={v => set('assigned', v)}
            options={[{ v: '', l: 'Sem responsável' }, ...(members || []).map(m => ({ v: m.user_id, l: m.member_email || m.user_id }))]} />
        </div>
        <PatientSelector userId={ownerId} value={form.patient_id} onChange={id => set('patient_id', id)} />
        {error && <div style={{ color: C.red || '#ef4444', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={save} disabled={saving || !form.title.trim()}>{saving ? 'Salvando…' : 'Criar tarefa'}</Btn>
        </div>
      </div>
    </Modal>
  )
}
