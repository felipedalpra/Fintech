// Gerenciador de tarefas da clínica (estilo Monday). Duas visualizações dos MESMOS dados
// (useTaskWorkspace): Kanban com colunas configuráveis e Tabela interativa. Filtros combináveis
// valem para as duas. Clicar numa tarefa abre o painel lateral sem sair da página.
// As tarefas são as mesmas do CRM (subitens), Meu Dia e Sino.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { C } from '../theme.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { Modal, Btn, FInput } from './UI.jsx'
import { PatientSelector } from './PatientSelector.jsx'
import { Ico, ICONS, Popover, MenuItem, Avatar } from './CrmCells.jsx'
import { TaskKanban } from './TaskKanban.jsx'
import { TaskTable } from './TaskTable.jsx'
import { TaskDrawer } from './TaskDrawer.jsx'
import { TASK_TYPES } from '../lib/taskQueue.js'
import { useTaskWorkspace } from '../lib/useTaskWorkspace.js'
import {
  EMPTY_TASK_FILTERS, normalizeTaskFilters, activeTaskFilterCount, applyTaskFilters, sortTasks, groupTasks,
  resolveTaskColumns, serializeTaskColumns, moveColumn, TASK_GROUP_BY, PRIORITIES, CATEGORIES, DUE_PRESETS,
  opportunityOptions, taskStats, isoDay,
} from '../lib/taskWorkspace.js'

const VIEW_KEY = 'surgimetrics_tasks_view'
const PREFS_KEY = 'surgimetrics_tasks_prefs_v2'

function readPrefs(userId) {
  try { return JSON.parse(window.localStorage.getItem(`${PREFS_KEY}:${userId || 'anon'}`) || '{}') } catch { return {} }
}
function writePrefs(userId, prefs) {
  try { window.localStorage.setItem(`${PREFS_KEY}:${userId || 'anon'}`, JSON.stringify(prefs)) } catch { /* ignore */ }
}

export function TasksPanel() {
  const { user } = useAuth()
  const { ownerId, role, isOwner } = useUserRole()
  const { toast } = useToast()
  const effectiveOwner = ownerId || user?.id
  const canManage = Boolean(isOwner || role === 'admin' || role === 'gestao')
  const ws = useTaskWorkspace(effectiveOwner, user?.id)
  const [params, setParams] = useSearchParams()

  // ----- preferências (por navegador/usuário) -----
  const [view, setView] = useState(() => { try { return window.localStorage.getItem(VIEW_KEY) || 'lista' } catch { return 'lista' } })
  const [prefs, setPrefs] = useState(() => readPrefs(user?.id))
  useEffect(() => { setPrefs(readPrefs(user?.id)) }, [user?.id])
  useEffect(() => { writePrefs(user?.id, prefs) }, [user?.id, prefs])
  const defaultScope = role === 'admin' || role === 'gestao' ? 'todas' : 'minhas'
  const filters = useMemo(() => normalizeTaskFilters(prefs.filters || { ...EMPTY_TASK_FILTERS, scope: defaultScope }), [prefs.filters, defaultScope])
  const setFilters = useCallback(f => setPrefs(p => ({ ...p, filters: typeof f === 'function' ? f(normalizeTaskFilters(p.filters || { scope: defaultScope })) : f })), [defaultScope])
  const groupBy = TASK_GROUP_BY.some(g => g.id === prefs.groupBy) ? prefs.groupBy : 'status'
  const sort = prefs.sort?.col ? prefs.sort : null
  const columns = useMemo(() => resolveTaskColumns(prefs.columns), [prefs.columns])
  const collapsed = prefs.collapsed || {}

  function changeView(v) {
    setView(v)
    try { window.localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ }
  }

  // ----- dados derivados -----
  const today = useMemo(() => isoDay(new Date()), [])
  const ctx = useMemo(() => ({ userId: user?.id, today, stageIndex: ws.stageIndex, stages: ws.stages, memberLabel: ws.memberLabel }), [user?.id, today, ws.stageIndex, ws.stages, ws.memberLabel])
  const filtered = useMemo(() => applyTaskFilters(ws.tasks, filters, ctx), [ws.tasks, filters, ctx])
  const sorted = useMemo(() => sortTasks(filtered, sort, ctx), [filtered, sort, ctx])
  const groups = useMemo(() => groupTasks(sorted, groupBy, ctx), [sorted, groupBy, ctx])
  const stats = useMemo(() => taskStats(filtered, today), [filtered, today])
  const oppOptions = useMemo(() => opportunityOptions(ws.tasks), [ws.tasks])
  const nFilters = activeTaskFilterCount(filters)

  // ----- painel lateral -----
  const [openId, setOpenId] = useState(null)
  const [drawerTab, setDrawerTab] = useState('subtasks')
  const openTask = ws.tasks.find(t => t.id === openId) || null
  const onOpen = useCallback((task, tab = 'subtasks') => { setDrawerTab(tab); setOpenId(task.id) }, [])
  // Link direto (menção no sino): /app/tarefas?task=<id>&tab=comments
  const deepTask = params.get('task')
  useEffect(() => {
    if (!deepTask || ws.loading) return
    if (ws.tasks.some(t => t.id === deepTask)) { setDrawerTab(params.get('tab') || 'subtasks'); setOpenId(deepTask) }
    else toast('Tarefa não encontrada (pode ter sido excluída).', 'warning')
    const p = new URLSearchParams(params)
    p.delete('task'); p.delete('tab')
    setParams(p, { replace: true })
  }, [deepTask, ws.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // ----- ações (com aviso de erro) -----
  const [attemptFlash, setAttemptFlash] = useState(null)
  const report = useCallback(res => { if (res?.error) toast(res.error, 'error'); return res }, [toast])
  const actions = useMemo(() => ({
    open: task => onOpen(task),
    toggle: task => ws.toggle(task).then(report),
    remove: task => ws.remove(task).then(res => { report(res); if (!res.error) { toast('Tarefa excluída.', 'success'); setOpenId(id => (id === task.id ? null : id)) } }),
    setStage: (task, stageId) => ws.setStage(task.id, stageId).then(report),
    setPriority: (task, priority) => ws.update(task.id, { priority }).then(report),
    patch: (task, patch) => ws.update(task.id, patch).then(res => { if (res.error) toast(`${res.error} A alteração foi desfeita.`, 'error'); return res }),
    outcome: (task, outcome) => ws.registerOutcome(task, outcome).then(res => {
      report(res)
      if (!res.error && !res.closes) setAttemptFlash({ id: task.id, outcome })
    }),
  }), [ws, report, toast, onOpen])

  // ----- seleção (só o que está visível) -----
  const [selected, setSelected] = useState(() => new Set())
  const lastPick = useRef(null)
  const visibleIds = useMemo(() => groups.flatMap(g => (collapsed[g.key] ? [] : g.rows.map(t => t.id))), [groups, collapsed])
  const effectiveSelected = useMemo(() => new Set([...selected].filter(id => visibleIds.includes(id))), [selected, visibleIds])
  const onToggleSelect = useCallback((id, shift) => {
    setSelected(prev => {
      const next = new Set(prev)
      const from = lastPick.current ? visibleIds.indexOf(lastPick.current) : -1
      const to = visibleIds.indexOf(id)
      if (shift && from >= 0 && to >= 0) {
        const value = prev.has(lastPick.current)
        for (const x of visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1)) value ? next.add(x) : next.delete(x)
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    lastPick.current = id
  }, [visibleIds])
  const onSetSelected = useCallback((ids, checked) => setSelected(prev => {
    const next = new Set(prev)
    for (const id of ids) checked ? next.add(id) : next.delete(id)
    return next
  }), [])
  const clearSelection = useCallback(() => { setSelected(new Set()); lastPick.current = null }, [])

  const [creating, setCreating] = useState(false)

  if (ws.loading) return <LoadingState />
  if (ws.error) {
    return (
      <div role="alert" style={{ color: C.red || '#ef4444', fontSize: 14, padding: 24 }}>
        Erro ao carregar as tarefas: {ws.error}
        <div style={{ marginTop: 12 }}><Btn variant="ghost" onClick={ws.reload}>Tentar novamente</Btn></div>
      </div>
    )
  }

  return (
    <div data-testid="tasks-workspace">
      <Toolbar filters={filters} setFilters={setFilters} nFilters={nFilters} ws={ws} oppOptions={oppOptions}
        view={view} setView={changeView} onCreate={() => setCreating(true)}
        groupBy={groupBy} setGroupBy={g => setPrefs(p => ({ ...p, groupBy: g }))}
        columns={columns} setColumns={cols => setPrefs(p => ({ ...p, columns: serializeTaskColumns(cols) }))} />

      <StatStrip stats={stats} />

      {!ws.ready && canManage && (
        <div style={{ margin: '0 0 10px', padding: '7px 12px', borderRadius: 10, border: `1px solid ${C.yellow}55`, background: C.yellow + '14', color: C.textSub, fontSize: 12.5 }}>
          Colunas personalizadas, prioridade, descrição, subtarefas, comentários e histórico aparecem depois que a atualização do banco de Tarefas
          (<code>tasks_workspace_phase4.sql</code>) for aplicada. O restante já funciona normalmente.
        </div>
      )}

      {filtered.length === 0 && ws.tasks.length > 0 && (
        <div style={{ padding: '8px 2px 12px', fontSize: 13, color: C.textSub }}>
          Nenhuma tarefa corresponde aos filtros.{' '}
          {nFilters > 0 && <button type="button" onClick={() => setFilters(f => ({ ...EMPTY_TASK_FILTERS, scope: f.scope, q: f.q }))} style={{ border: 'none', background: 'transparent', color: C.accent, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Limpar filtros</button>}
        </div>
      )}
      {ws.tasks.length === 0 && <EmptyState onCreate={() => setCreating(true)} />}

      {ws.tasks.length > 0 && (view === 'kanban'
        ? <TaskKanban tasks={filtered} ws={ws} today={today} canManage={canManage} actions={actions} onOpen={onOpen} attemptFlash={attemptFlash} toast={toast} />
        : <TaskTable groups={groups} columns={columns} ws={ws} today={today} sort={sort}
            onSort={col => setPrefs(p => {
              const s = p.sort?.col === col ? (p.sort.dir === 'asc' ? { col, dir: 'desc' } : null) : { col, dir: 'asc' }
              return { ...p, sort: s }
            })}
            onReorderColumn={(from, to) => setPrefs(p => ({ ...p, columns: serializeTaskColumns(moveColumn(resolveTaskColumns(p.columns), from, to)) }))}
            collapsed={collapsed} onToggleCollapse={key => setPrefs(p => ({ ...p, collapsed: { ...(p.collapsed || {}), [key]: !(p.collapsed || {})[key] } }))}
            selected={effectiveSelected} onToggleSelect={onToggleSelect} onSetSelected={onSetSelected}
            onOpen={onOpen} actions={actions} attemptFlash={attemptFlash} />)}

      {view !== 'kanban' && effectiveSelected.size > 0 && (
        <BulkBar ids={[...effectiveSelected]} ws={ws} onClear={clearSelection} toast={toast} />
      )}

      {openTask && (
        <TaskDrawer task={openTask} ws={ws} ownerId={effectiveOwner} userId={user?.id} today={today} actions={actions}
          initialTab={drawerTab} onClose={() => setOpenId(null)} toast={toast} />
      )}

      {creating && (
        <NewTaskModal ws={ws} onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); toast('Tarefa criada.', 'success') }} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barra de ferramentas + filtros avançados
// ---------------------------------------------------------------------------
function ToolButton({ icon, children, onClick, active, badge, btnRef, testId }) {
  return (
    <button ref={btnRef} type="button" onClick={onClick} data-testid={testId}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, border: 'none', background: active ? C.accent + '1f' : 'transparent', color: active ? C.accent : C.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
      <Ico d={icon} size={15} />{children}
      {badge ? <span data-testid={testId ? `${testId}-count` : undefined} style={{ minWidth: 18, height: 18, borderRadius: 9, background: C.accent, color: '#fff', fontSize: 10.5, fontWeight: 800, display: 'grid', placeItems: 'center', padding: '0 5px' }}>{badge}</span> : null}
    </button>
  )
}

function Chip({ active, color, children, onClick, testId }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} data-testid={testId}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 14, fontSize: 12, fontWeight: 600, border: `1px solid ${active ? (color || C.accent) : C.border}`, background: active ? (color || C.accent) + '26' : C.surface, color: active ? C.text : C.textSub, cursor: 'pointer', fontFamily: 'inherit' }}>
      {color && <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />}{children}
    </button>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ padding: '8px 8px 10px', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: C.textDim, marginBottom: 7 }}>{title}</div>
      {children}
    </div>
  )
}

const toggleIn = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

function Toolbar({ filters, setFilters, nFilters, ws, oppOptions, view, setView, onCreate, groupBy, setGroupBy, columns, setColumns }) {
  const filterRef = useRef(null)
  const groupRef = useRef(null)
  const colsRef = useRef(null)
  const [open, setOpen] = useState(null)
  const [oppQ, setOppQ] = useState('')
  const close = () => setOpen(null)
  const toggle = id => setOpen(o => (o === id ? null : id))
  const set = patch => setFilters(f => ({ ...f, ...patch }))
  const seg = active => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: 'none', background: active ? C.card : 'transparent', color: active ? C.accent : C.textSub, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: active ? '0 4px 12px -8px rgba(0,0,0,.6)' : 'none' })
  const segWrap = { display: 'inline-flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, padding: 3 }
  const input = { fontSize: 12.5, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit', boxSizing: 'border-box', width: '100%' }
  const hiddenCount = columns.filter(c => c.hidden).length
  const oppList = oppOptions.filter(o => !oppQ.trim() || o.label.toLowerCase().includes(oppQ.trim().toLowerCase())).slice(0, 40)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      <button type="button" onClick={onCreate}
        style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 4 }}>
        <Ico d={ICONS.plus} size={14} sw={2.6} />Nova tarefa
      </button>

      <div style={segWrap} role="group" aria-label="Escopo">
        <button type="button" style={seg(filters.scope === 'minhas')} onClick={() => set({ scope: 'minhas' })}>Minhas</button>
        <button type="button" style={seg(filters.scope === 'todas')} onClick={() => set({ scope: 'todas' })}>Todas</button>
      </div>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textDim, minWidth: 160, flex: '0 1 230px' }}>
        <Ico d={ICONS.search} size={14} />
        <input value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="Buscar tarefa ou paciente…" aria-label="Buscar tarefas"
          style={{ border: 'none', outline: 'none', background: 'transparent', color: C.text, fontSize: 13, width: '100%', fontFamily: 'inherit' }} />
      </label>

      <ToolButton btnRef={filterRef} icon={ICONS.filter} onClick={() => toggle('filter')} active={nFilters > 0} badge={nFilters || null} testId="task-filter-button">Filtro</ToolButton>
      {nFilters > 0 && (
        <button type="button" data-testid="task-filter-clear" onClick={() => setFilters(f => ({ ...EMPTY_TASK_FILTERS, scope: f.scope, q: f.q }))}
          style={{ border: 'none', background: 'transparent', color: C.accent, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Limpar filtros
        </button>
      )}
      <Popover anchorRef={filterRef} open={open === 'filter'} onClose={close} width={400} label="Filtros de tarefas" testId="task-filter-panel">
        <Section title="Responsáveis">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {ws.members.map(m => {
              const label = ws.memberLabel[m.user_id]
              return (
                <Chip key={m.user_id} active={filters.responsible.includes(m.user_id)} onClick={() => set({ responsible: toggleIn(filters.responsible, m.user_id) })}>
                  <Avatar label={label} size={16} />{String(label).split('@')[0]}
                </Chip>
              )
            })}
            <Chip active={filters.responsible.includes('none')} onClick={() => set({ responsible: toggleIn(filters.responsible, 'none') })}>Sem responsável</Chip>
          </div>
        </Section>
        <Section title="Status">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {ws.stages.map(s => <Chip key={s.id} color={s.color} testId={`task-filter-stage-${s.seed_key || s.base_status}`} active={filters.stage.includes(s.id)} onClick={() => set({ stage: toggleIn(filters.stage, s.id) })}>{s.label}</Chip>)}
          </div>
        </Section>
        <Section title="Prazo">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {DUE_PRESETS.map(p => (
              <Chip key={p.id} testId={`task-filter-due-${p.id}`} active={filters.due?.preset === p.id}
                onClick={() => set({ due: filters.due?.preset === p.id ? null : { preset: p.id, from: filters.due?.from || null, to: filters.due?.to || null } })}>{p.label}</Chip>
            ))}
          </div>
          {filters.due?.preset === 'custom' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 7 }}>
              <input type="date" aria-label="Prazo de" value={filters.due.from || ''} onChange={e => set({ due: { ...filters.due, from: e.target.value || null } })} style={input} />
              <input type="date" aria-label="Prazo até" value={filters.due.to || ''} onChange={e => set({ due: { ...filters.due, to: e.target.value || null } })} style={input} />
            </div>
          )}
        </Section>
        {ws.ready && (
          <Section title="Prioridade">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {PRIORITIES.map(p => <Chip key={p.key} color={p.color} testId={`task-filter-priority-${p.key}`} active={filters.priority.includes(p.key)} onClick={() => set({ priority: toggleIn(filters.priority, p.key) })}>{p.label}</Chip>)}
              <Chip active={filters.priority.includes('none')} onClick={() => set({ priority: toggleIn(filters.priority, 'none') })}>Sem prioridade</Chip>
            </div>
          </Section>
        )}
        <Section title="Categoria">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {CATEGORIES.map(c => <Chip key={c.key} active={filters.category.includes(c.key)} onClick={() => set({ category: toggleIn(filters.category, c.key) })}>{c.label}</Chip>)}
          </div>
        </Section>
        <Section title="Paciente">
          <input value={filters.patient} onChange={e => set({ patient: e.target.value })} placeholder="Nome do paciente" aria-label="Filtrar por paciente" data-testid="task-filter-patient" style={input} />
        </Section>
        {oppOptions.length > 0 && (
          <Section title="Oportunidade">
            <input value={oppQ} onChange={e => setOppQ(e.target.value)} placeholder="Buscar negociação…" aria-label="Buscar oportunidade" style={{ ...input, marginBottom: 6 }} />
            <div style={{ maxHeight: 150, overflowY: 'auto' }}>
              {oppList.map(o => (
                <label key={o.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px', fontSize: 12.5, color: C.text, cursor: 'pointer' }}>
                  <input type="checkbox" checked={filters.opportunity.includes(o.key)} onChange={() => set({ opportunity: toggleIn(filters.opportunity, o.key) })} style={{ accentColor: C.accent }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                </label>
              ))}
            </div>
          </Section>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 6px 4px' }}>
          <span style={{ fontSize: 11.5, color: C.textDim }}>{nFilters ? `${nFilters} filtro${nFilters > 1 ? 's' : ''} ativo${nFilters > 1 ? 's' : ''}` : 'Nenhum filtro ativo'} · vale para Kanban e Tabela</span>
          <button type="button" onClick={() => setFilters(f => ({ ...EMPTY_TASK_FILTERS, scope: f.scope, q: f.q }))}
            style={{ border: 'none', background: 'transparent', color: C.accent, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Limpar filtros</button>
        </div>
      </Popover>

      {view !== 'kanban' && <>
        <ToolButton btnRef={groupRef} icon={ICONS.group} onClick={() => toggle('group')} active={groupBy !== 'status'} testId="task-group-button">
          Agrupar{groupBy !== 'status' ? `: ${TASK_GROUP_BY.find(g => g.id === groupBy)?.label}` : ''}
        </ToolButton>
        <Popover anchorRef={groupRef} open={open === 'group'} onClose={close} width={220} label="Agrupar por">
          {TASK_GROUP_BY.map(g => <MenuItem key={g.id} active={groupBy === g.id} onClick={() => { close(); setGroupBy(g.id) }}>{g.label}</MenuItem>)}
        </Popover>
        <ToolButton btnRef={colsRef} icon={ICONS.eyeOff} onClick={() => toggle('cols')} active={hiddenCount > 0} badge={hiddenCount || null} testId="task-columns-button">Colunas</ToolButton>
        <Popover anchorRef={colsRef} open={open === 'cols'} onClose={close} width={240} label="Mostrar ou ocultar colunas">
          {columns.filter(c => !c.fixed && !c.trailing).map(c => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 12.5, color: C.text, cursor: 'pointer' }}>
              <input type="checkbox" checked={!c.hidden} onChange={() => setColumns(columns.map(x => (x.id === c.id ? { ...x, hidden: !x.hidden } : x)))} style={{ accentColor: C.accent }} />{c.label}
            </label>
          ))}
          <div style={{ fontSize: 11, color: C.textDim, padding: '6px 9px', lineHeight: 1.4 }}>Arraste o cabeçalho de uma coluna para mudar a ordem.</div>
        </Popover>
      </>}

      <div style={{ flex: 1 }} />
      <div style={segWrap} role="group" aria-label="Visualização">
        <button type="button" data-testid="task-view-kanban" style={seg(view === 'kanban')} onClick={() => setView('kanban')}><Ico d={<><rect x="3" y="3" width="7" height="18" rx="1.5" /><rect x="14" y="3" width="7" height="11" rx="1.5" /></>} size={14} />Kanban</button>
        <button type="button" data-testid="task-view-table" style={seg(view !== 'kanban')} onClick={() => setView('lista')}><Ico d={<path d="M3 5h18M3 12h18M3 19h18" />} size={14} />Tabela</button>
      </div>
    </div>
  )
}

// Indicadores compactos (uma faixa só, sem cards grandes).
function StatStrip({ stats }) {
  const items = [
    { n: stats.atrasadas, l: 'atrasadas', color: C.red || '#e2445c', d: ICONS.warn },
    { n: stats.hoje, l: 'para hoje', color: C.accent, d: ICONS.clock },
    { n: stats.abertas, l: 'abertas', color: C.textSub, d: ICONS.calendar },
    { n: stats.feitasHoje, l: 'concluídas hoje', color: C.green || '#00c875', d: ICONS.check },
  ]
  return (
    <div data-testid="task-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
      {items.map(it => (
        <span key={it.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, fontSize: 12, color: C.textSub }}>
          <span style={{ color: it.color, display: 'inline-flex' }}><Ico d={it.d} size={13} sw={2.2} /></span>
          <strong style={{ fontSize: 14, color: it.n > 0 ? it.color : C.text, fontVariantNumeric: 'tabular-nums' }}>{it.n}</strong>{it.l}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edição em massa (Tabela)
// ---------------------------------------------------------------------------
function BulkBar({ ids, ws, onClear, toast }) {
  const refs = { stage: useRef(null), resp: useRef(null), prio: useRef(null), due: useRef(null) }
  const [open, setOpen] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const n = ids.length
  const close = () => setOpen(null)
  async function run(fn, okText) {
    setBusy(true); close()
    const res = await fn()
    setBusy(false)
    if (res.error) { toast(res.error, 'error'); return }
    if (res.failed) toast(`${okText} ${res.failed} não puderam ser alteradas.`, 'warning', 5000)
    else toast(okText, 'success')
  }
  const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: C.text, fontSize: 12.5, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }
  return (
    <div role="toolbar" aria-label="Ações em massa" data-testid="task-bulk-bar"
      style={{ position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 900, display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', borderRadius: 12, background: C.card, border: `1px solid ${C.borderBright || C.border}`, boxShadow: '0 18px 44px -14px rgba(0,0,0,.6)', maxWidth: 'calc(100vw - 24px)', flexWrap: 'wrap' }}>
      <span style={{ padding: '0 8px', fontSize: 12.5, fontWeight: 800, color: C.accent }}>{n} selecionada{n > 1 ? 's' : ''}</span>
      <button ref={refs.stage} type="button" style={btn} disabled={busy} data-testid="task-bulk-stage" onClick={() => setOpen('stage')}>Status</button>
      <button ref={refs.resp} type="button" style={btn} disabled={busy} data-testid="task-bulk-responsible" onClick={() => setOpen('resp')}>Responsável</button>
      {ws.ready && <button ref={refs.prio} type="button" style={btn} disabled={busy} data-testid="task-bulk-priority" onClick={() => setOpen('prio')}>Prioridade</button>}
      <button ref={refs.due} type="button" style={btn} disabled={busy} onClick={() => setOpen('due')}>Prazo</button>
      {!confirmDelete
        ? <button type="button" style={{ ...btn, color: C.red }} disabled={busy} onClick={() => setConfirmDelete(true)}>Excluir</button>
        : <button type="button" style={{ ...btn, color: '#fff', background: C.red }} disabled={busy} data-testid="task-bulk-delete-confirm"
            onClick={() => { setConfirmDelete(false); run(() => ws.bulkRemove(ids), `${n} tarefa${n > 1 ? 's' : ''} excluída${n > 1 ? 's' : ''}.`).then(onClear) }}>Confirmar exclusão de {n}</button>}
      <button type="button" aria-label="Limpar seleção" onClick={onClear} style={{ ...btn, color: C.textSub }}><Ico d={ICONS.x} size={14} /></button>

      <Popover anchorRef={refs.stage} open={open === 'stage'} onClose={close} width={220} label="Mudar status">
        {ws.stages.map(s => (
          <MenuItem key={s.id} onClick={() => run(() => ws.bulkStage(ids, s.id), `Status de ${n} tarefa${n > 1 ? 's' : ''} atualizado.`)}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />{s.label}
          </MenuItem>
        ))}
      </Popover>
      <Popover anchorRef={refs.resp} open={open === 'resp'} onClose={close} width={240} label="Atribuir responsável">
        <MenuItem onClick={() => run(() => ws.bulkPatch(ids, { assigned_user_id: null }), 'Responsável removido.')}>Sem responsável</MenuItem>
        {ws.members.map(m => (
          <MenuItem key={m.user_id} onClick={() => run(() => ws.bulkPatch(ids, { assigned_user_id: m.user_id }), `Responsável atualizado em ${n} tarefa${n > 1 ? 's' : ''}.`)}>
            <Avatar label={ws.memberLabel[m.user_id]} size={20} />{ws.memberLabel[m.user_id]}
          </MenuItem>
        ))}
      </Popover>
      <Popover anchorRef={refs.prio} open={open === 'prio'} onClose={close} width={200} label="Definir prioridade">
        {PRIORITIES.map(p => (
          <MenuItem key={p.key} onClick={() => run(() => ws.bulkPatch(ids, { priority: p.key }), `Prioridade definida em ${n} tarefa${n > 1 ? 's' : ''}.`)}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />{p.label}
          </MenuItem>
        ))}
        <MenuItem onClick={() => run(() => ws.bulkPatch(ids, { priority: null }), 'Prioridade removida.')}>Sem prioridade</MenuItem>
      </Popover>
      <Popover anchorRef={refs.due} open={open === 'due'} onClose={close} width={220} label="Definir prazo">
        <input type="date" aria-label="Novo prazo" autoFocus
          onChange={e => { if (e.target.value) run(() => ws.bulkPatch(ids, { due_date: e.target.value }), `Prazo definido em ${n} tarefa${n > 1 ? 's' : ''}.`) }}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, colorScheme: 'inherit', fontFamily: 'inherit' }} />
        <MenuItem onClick={() => run(() => ws.bulkPatch(ids, { due_date: null }), 'Prazo removido.')}>Remover prazo</MenuItem>
      </Popover>
    </div>
  )
}

function EmptyState({ onCreate }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0' }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 14px', display: 'grid', placeItems: 'center', background: (C.green || '#10B981') + '1e', color: C.green || '#10B981' }}><Ico d={ICONS.check} size={28} sw={2.4} /></div>
      <div style={{ color: C.text, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Nenhuma tarefa ainda</div>
      <div style={{ color: C.textSub, fontSize: 13, marginBottom: 12 }}>Crie a primeira tarefa da equipe.</div>
      <Btn onClick={onCreate}>Criar tarefa</Btn>
    </div>
  )
}

function LoadingState() {
  return (
    <div aria-busy="true">
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>{[1, 2, 3, 4].map(i => <div key={i} style={{ width: 120, height: 30, borderRadius: 8, background: C.border, opacity: 0.4 }} />)}</div>
      {[1, 2, 3, 4].map(i => <div key={i} style={{ height: 38, borderRadius: 6, background: C.border, opacity: 0.3, marginBottom: 6 }} />)}
    </div>
  )
}

// Também usado pela Agenda do CRM (initial = data/hora/responsável do horário clicado).
// `opportunities` (opcional, oportunidades abertas) liga o modo Follow-up: a atividade é a MESMA
// tarefa, vinculada a uma oportunidade e ao paciente dela — nenhum registro paralelo.
const FOLLOWUP_TYPES = ['ligar', 'whatsapp', 'retorno']
export function NewTaskModal({ ws, onClose, onCreated, initial = {}, opportunities = null }) {
  const [form, setForm] = useState({ title: '', due: '', time: '', type: 'outro', assigned: '', patient_id: '', patient_name: '', priority: '', description: '', kind: 'task', opp_id: '', ...initial })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const followup = Boolean(opportunities) && form.kind === 'followup'
  const opp = followup ? (opportunities || []).find(o => o.id === form.opp_id) : null
  const typeOptions = followup ? TASK_TYPES.filter(t => FOLLOWUP_TYPES.includes(t.key)) : TASK_TYPES

  function setKind(kind) {
    setForm(f => ({ ...f, kind, type: kind === 'followup' ? (FOLLOWUP_TYPES.includes(f.type) ? f.type : 'ligar') : f.type }))
  }

  async function save() {
    if (!form.title.trim() || saving) return
    if (followup && !opp) { setError('Escolha a oportunidade do follow-up.'); return }
    setSaving(true); setError(null)
    const patientId = followup ? (opp.patient_id || null) : (form.patient_id || null)
    const personName = followup ? (opp.patients?.full_name || opp.crm_contacts?.full_name || '') : form.patient_name
    const res = await ws.create({
      title: form.title, dueDate: form.due || null, dueTime: form.time || null, taskType: form.type,
      assignedUserId: form.assigned || null, patientId, opportunityId: followup ? opp.id : null,
      priority: form.priority || null, description: form.description || null,
    }, {
      patients: patientId ? { full_name: personName || 'Paciente' } : null,
      opportunities: followup ? { title: opp.title || 'Oportunidade' } : null,
    })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onCreated(res.task)
  }

  return (
    <Modal open onClose={onClose} title={opportunities ? 'Nova atividade' : 'Nova tarefa avulsa'} width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {opportunities && (
          <div role="group" aria-label="Tipo de atividade" style={{ display: 'flex', gap: 6 }}>
            {[['task', 'Tarefa'], ['followup', 'Follow-up']].map(([k, l]) => (
              <button key={k} type="button" data-testid={`new-activity-${k}`} aria-pressed={form.kind === k} onClick={() => setKind(k)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 9, border: `1px solid ${form.kind === k ? C.accent : C.border}`, background: form.kind === k ? C.accent + '1f' : 'transparent', color: form.kind === k ? C.text : C.textSub, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                {l}
              </button>
            ))}
          </div>
        )}
        <FInput label={followup ? 'Follow-up' : 'Tarefa'} value={form.title} onChange={v => set('title', v)} placeholder={followup ? 'Ex.: Ligar para confirmar o orçamento' : 'O que precisa ser feito?'} />
        {followup && (
          <FInput label="Oportunidade" value={form.opp_id} onChange={v => set('opp_id', v)}
            options={[{ v: '', l: 'Selecione a oportunidade' }, ...(opportunities || []).map(o => ({ v: o.id, l: [o.patients?.full_name || o.crm_contacts?.full_name, o.title && o.title !== 'Oportunidade' ? o.title : ''].filter(Boolean).join(' — ') || 'Oportunidade' }))]} />
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <FInput label={followup ? 'Canal' : 'Categoria'} value={form.type} onChange={v => set('type', v)} options={typeOptions.map(item => ({ v: item.key, l: item.label }))} />
          <FInput label="Responsável" value={form.assigned} onChange={v => set('assigned', v)}
            options={[{ v: '', l: 'Sem responsável' }, ...(ws.members || []).map(m => ({ v: m.user_id, l: m.member_email || m.user_id }))]} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <FInput label="Vencimento" type="date" value={form.due} onChange={v => set('due', v)} />
          <FInput label="Hora (opcional)" type="time" value={form.time} onChange={v => set('time', v)} />
          {ws.ready && <FInput label="Prioridade" value={form.priority} onChange={v => set('priority', v)} options={[{ v: '', l: 'Sem prioridade' }, ...PRIORITIES.map(p => ({ v: p.key, l: p.label }))]} />}
        </div>
        {!followup && <PatientSelector userId={ws.ownerId} value={form.patient_id} onChange={(id, name) => setForm(f => ({ ...f, patient_id: id, patient_name: name || '' }))} />}
        {ws.ready && <FInput label="Descrição (opcional)" value={form.description} onChange={v => set('description', v)} placeholder="Detalhes da tarefa" />}
        {error && <div style={{ color: C.red || '#ef4444', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={save} disabled={saving || !form.title.trim()}>{saving ? 'Salvando…' : followup ? 'Criar follow-up' : 'Criar tarefa'}</Btn>
        </div>
      </div>
    </Modal>
  )
}

