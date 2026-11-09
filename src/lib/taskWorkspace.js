// src/lib/taskWorkspace.js
// Núcleo PURO do gerenciador de tarefas (estilo Monday): colunas do Kanban (task_stages),
// filtros combináveis, ordenação, agrupamento, colunas da tabela e ordem dos cards.
// Sem I/O e sem tema — testável em unit test. Recebe `today` (YYYY-MM-DD) por parâmetro.
//
// Status continua sendo pendente / aguardando / feita (fonte de Sino, Meu Dia, CRM). A coluna do
// Kanban é DERIVADA: stage_id quando ela combina com o status; senão a coluna padrão do status.
import { TASK_TYPES, TASK_TYPE_LABEL } from './taskQueue.js'

export const BASE_STATUSES = [
  { key: 'pendente', label: 'Aberta' },
  { key: 'aguardando', label: 'Aguardando' },
  { key: 'feita', label: 'Concluída' },
]

// Sem a migração (supabase/tasks_workspace_phase4.sql): colunas fixas, uma por status.
export const VIRTUAL_STAGES = [
  { id: 'v-pendente', label: 'A fazer', color: '#579bfc', base_status: 'pendente', position: 1, is_default: true, virtual: true },
  { id: 'v-aguardando', label: 'Aguardando', color: '#a25ddc', base_status: 'aguardando', position: 2, is_default: true, virtual: true },
  { id: 'v-feita', label: 'Concluída', color: '#00c875', base_status: 'feita', position: 3, is_default: true, virtual: true },
]

export const PRIORITIES = [
  { key: 'urgente', label: 'Urgente', color: '#e2445c', rank: 0 },
  { key: 'alta', label: 'Alta', color: '#fdab3d', rank: 1 },
  { key: 'media', label: 'Média', color: '#579bfc', rank: 2 },
  { key: 'baixa', label: 'Baixa', color: '#94a3b8', rank: 3 },
]
export const PRIORITY_BY_KEY = Object.fromEntries(PRIORITIES.map(p => [p.key, p]))

export const STAGE_COLORS = ['#579bfc', '#fdab3d', '#a25ddc', '#00c875', '#e2445c', '#ff642e', '#037f4c', '#ff158a', '#9cd326', '#784bd1', '#66ccff', '#7f5347']

// Categoria = tipo da tarefa (tasks.task_type, já existente).
export const CATEGORIES = TASK_TYPES.map(t => ({ key: t.key, label: t.label }))
export const categoryLabel = key => TASK_TYPE_LABEL[key] || 'Outro'

// ---------------------------------------------------------------------------
// Colunas do Kanban
// ---------------------------------------------------------------------------
// Colunas ativas ordenadas. Sem linhas (migração ausente) → VIRTUAL_STAGES. Garante uma coluna
// para cada status base (se faltar no banco, entra a virtual) — nenhuma tarefa fica sem lugar.
export function resolveTaskStages(rows) {
  const active = (rows || []).filter(s => s && !s.archived_at)
    .map(s => ({ ...s, position: Number(s.position) || 0 }))
    .sort((a, b) => a.position - b.position || String(a.created_at || '').localeCompare(String(b.created_at || '')))
  if (!active.length) return VIRTUAL_STAGES.map(s => ({ ...s }))
  const out = [...active]
  for (const v of VIRTUAL_STAGES) {
    if (!out.some(s => s.base_status === v.base_status)) out.push({ ...v, position: 999 })
  }
  return out
}

// { byId, defaultFor: { pendente: stage, aguardando: stage, feita: stage } }
export function stageIndex(stages) {
  const byId = Object.fromEntries((stages || []).map(s => [s.id, s]))
  const defaultFor = {}
  for (const b of BASE_STATUSES) {
    defaultFor[b.key] = (stages || []).find(s => s.base_status === b.key && s.is_default)
      || (stages || []).find(s => s.base_status === b.key) || null
  }
  return { byId, defaultFor }
}

// Coluna onde a tarefa aparece.
export function stageOf(task, index) {
  const own = task?.stage_id ? index?.byId?.[task.stage_id] : null
  if (own && own.base_status === (task.status || 'pendente')) return own
  return index?.defaultFor?.[task?.status || 'pendente'] || null
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------
function parseIso(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
export function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function addDaysIso(iso, n) {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return isoDay(d)
}
const dueOf = t => (t?.due_date ? String(t.due_date).slice(0, 10) : null)
export const isTaskDone = t => t?.status === 'feita'
export function isTaskOverdue(task, today) {
  const due = dueOf(task)
  return Boolean(!isTaskDone(task) && due && today && due < today)
}

// 'atrasada' | 'hoje' | 'amanha' | 'semana' | 'depois' | 'sem_data' | 'feita'
export function dueBucket(task, today) {
  if (isTaskDone(task)) return 'feita'
  const due = dueOf(task)
  if (!due) return 'sem_data'
  if (due < today) return 'atrasada'
  if (due === today) return 'hoje'
  if (due === addDaysIso(today, 1)) return 'amanha'
  return due <= addDaysIso(today, 7) ? 'semana' : 'depois'
}

export const DUE_PRESETS = [
  { id: 'overdue', label: 'Atrasadas' },
  { id: 'today', label: 'Hoje' },
  { id: 'tomorrow', label: 'Amanhã' },
  { id: 'this_week', label: 'Esta semana' },
  { id: 'none', label: 'Sem prazo' },
  { id: 'custom', label: 'Intervalo' },
]

function weekRange(today) {
  const dow = parseIso(today).getDay() // 0 = domingo
  const monday = addDaysIso(today, dow === 0 ? -6 : 1 - dow)
  return { from: monday, to: addDaysIso(monday, 6) }
}

function matchDue(task, due, today) {
  if (!due) return true
  const d = dueOf(task)
  switch (due.preset) {
    case 'overdue': return isTaskOverdue(task, today)
    case 'today': return d === today
    case 'tomorrow': return d === addDaysIso(today, 1)
    case 'this_week': { const r = weekRange(today); return Boolean(d && d >= r.from && d <= r.to) }
    case 'none': return !d
    case 'custom':
      if (!d) return false
      if (due.from && d < due.from) return false
      if (due.to && d > due.to) return false
      return true
    default: return true
  }
}

// ---------------------------------------------------------------------------
// Filtros (combináveis — todos precisam passar; listas = qualquer um dos itens)
// ---------------------------------------------------------------------------
export const EMPTY_TASK_FILTERS = {
  q: '',
  scope: 'todas',      // todas | minhas
  responsible: [],     // user_id | 'none'
  stage: [],           // ids de coluna (efetiva)
  due: null,           // { preset, from, to }
  priority: [],        // urgente | alta | media | baixa | 'none'
  category: [],        // task_type
  patient: '',         // nome (contém, sem acento)
  opportunity: [],     // opportunity_id
}

const arr = v => (Array.isArray(v) ? v.filter(x => x != null && x !== '').map(String) : [])

export function normalizeTaskFilters(f = {}) {
  const src = f && typeof f === 'object' ? f : {}
  let due = null
  if (src.due && DUE_PRESETS.some(p => p.id === src.due.preset)) {
    due = { preset: src.due.preset, from: src.due.from || null, to: src.due.to || null }
  }
  return {
    q: typeof src.q === 'string' ? src.q : '',
    scope: src.scope === 'minhas' ? 'minhas' : 'todas',
    responsible: arr(src.responsible),
    stage: arr(src.stage),
    due,
    priority: arr(src.priority),
    category: arr(src.category),
    patient: typeof src.patient === 'string' ? src.patient : '',
    opportunity: arr(src.opportunity),
  }
}

// Quantos critérios estão ativos (busca e Minhas/Todas ficam fora: têm controle próprio).
export function activeTaskFilterCount(filters) {
  const f = normalizeTaskFilters(filters)
  let n = 0
  for (const k of ['responsible', 'stage', 'priority', 'category', 'opportunity']) if (f[k].length) n++
  if (f.due) n++
  if (f.patient.trim()) n++
  return n
}

export function normalizeText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function taskPersonName(t) {
  return t?.patients?.full_name || t?.crm_contacts?.full_name || ''
}
export function taskOpportunityTitle(t) {
  const title = t?.opportunities?.title
  return title && title !== 'Oportunidade' ? title : ''
}

// ctx = { userId, today, stageIndex }
export function applyTaskFilters(tasks, filters, ctx = {}) {
  const f = normalizeTaskFilters(filters)
  const q = normalizeText(f.q.trim())
  const patient = normalizeText(f.patient.trim())
  const resp = new Set(f.responsible)
  const stages = new Set(f.stage)
  const prio = new Set(f.priority)
  const cats = new Set(f.category)
  const opps = new Set(f.opportunity)
  return (tasks || []).filter(t => {
    if (f.scope === 'minhas' && (!ctx.userId || t.assigned_user_id !== ctx.userId)) return false
    if (resp.size && !resp.has(t.assigned_user_id || 'none')) return false
    if (stages.size && !stages.has(stageOf(t, ctx.stageIndex)?.id)) return false
    if (prio.size && !prio.has(t.priority || 'none')) return false
    if (cats.size && !cats.has(t.task_type || 'outro')) return false
    if (opps.size && !opps.has(t.opportunity_id || 'none')) return false
    if (patient && !normalizeText(taskPersonName(t)).includes(patient)) return false
    if (!matchDue(t, f.due, ctx.today)) return false
    if (q) {
      const hay = normalizeText([t.title, t.description, taskPersonName(t), taskOpportunityTitle(t)].filter(Boolean).join(' '))
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// Oportunidades que têm tarefa (opções do filtro "Oportunidade").
export function opportunityOptions(tasks) {
  const map = new Map()
  for (const t of tasks || []) {
    if (!t?.opportunity_id || map.has(t.opportunity_id)) continue
    const label = [taskOpportunityTitle(t) || 'Oportunidade', taskPersonName(t)].filter(Boolean).join(' · ')
    map.set(t.opportunity_id, { key: t.opportunity_id, label })
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

// ---------------------------------------------------------------------------
// Tabela: colunas
// ---------------------------------------------------------------------------
export const TASK_COLUMNS = [
  { id: 'title', label: 'Tarefa', width: 300, fixed: true },
  { id: 'status', label: 'Status', width: 150 },
  { id: 'responsible', label: 'Responsável', width: 120 },
  { id: 'priority', label: 'Prioridade', width: 130 },
  { id: 'patient', label: 'Paciente', width: 200 },
  { id: 'category', label: 'Categoria', width: 140 },
  { id: 'due', label: 'Prazo', width: 150 },
  { id: 'subtasks', label: 'Subtarefas', width: 120, sortable: false },
  { id: 'actions', label: 'Ações', width: 170, sortable: false, trailing: true },
]

// Ordem salva + colunas novas no fim; Tarefa sempre primeira e visível, Ações sempre por último.
export function resolveTaskColumns(saved = []) {
  const defs = new Map(TASK_COLUMNS.map(c => [c.id, c]))
  const seen = new Set()
  const out = []
  for (const s of Array.isArray(saved) ? saved : []) {
    const def = s && defs.get(s.id)
    if (!def || seen.has(def.id)) continue
    seen.add(def.id)
    out.push({ ...def, hidden: def.fixed ? false : Boolean(s.hidden) })
  }
  for (const def of TASK_COLUMNS) if (!seen.has(def.id)) out.push({ ...def, hidden: false })
  return [...out.filter(c => c.fixed), ...out.filter(c => !c.fixed && !c.trailing), ...out.filter(c => c.trailing)]
}
export const serializeTaskColumns = cols => (cols || []).map(c => ({ id: c.id, hidden: Boolean(c.hidden) }))

export function moveColumn(cols, fromId, toId) {
  const list = [...(cols || [])]
  const from = list.findIndex(c => c.id === fromId)
  const to = list.findIndex(c => c.id === toId)
  if (from < 0 || to < 0 || list[from].fixed || list[to].fixed || list[from].trailing || list[to].trailing) return list
  const [m] = list.splice(from, 1)
  list.splice(to, 0, m)
  return list
}

// ---------------------------------------------------------------------------
// Ordenação (vazios no fim nas duas direções)
// ---------------------------------------------------------------------------
export function taskSortValue(t, col, ctx = {}) {
  switch (col) {
    case 'title': return t.title || null
    case 'status': return stageOf(t, ctx.stageIndex)?.position ?? null
    case 'responsible': return t.assigned_user_id ? (ctx.memberLabel?.[t.assigned_user_id] || t.assigned_user_id) : null
    case 'priority': return t.priority ? PRIORITY_BY_KEY[t.priority]?.rank ?? null : null
    case 'patient': return taskPersonName(t) || null
    case 'category': return categoryLabel(t.task_type)
    case 'due': return dueOf(t) ? `${dueOf(t)} ${String(t.due_time || '99:99').slice(0, 5)}` : null
    default: return null
  }
}

function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base', numeric: true })
}

// Padrão: abertas por prazo (sem prazo no fim), concluídas por último.
export function defaultTaskOrder(a, b) {
  const da = isTaskDone(a) ? 1 : 0
  const db = isTaskDone(b) ? 1 : 0
  if (da !== db) return da - db
  const ad = dueOf(a) || '9999-12-31'
  const bd = dueOf(b) || '9999-12-31'
  if (ad !== bd) return ad < bd ? -1 : 1
  const at = String(a.due_time || '99:99')
  const bt = String(b.due_time || '99:99')
  if (at !== bt) return at < bt ? -1 : 1
  return String(a.created_at || '').localeCompare(String(b.created_at || ''))
}

export function sortTasks(tasks, sort, ctx = {}) {
  const list = [...(tasks || [])]
  if (!sort?.col) return list.sort(defaultTaskOrder)
  const dir = sort.dir === 'desc' ? -1 : 1
  return list
    .map(t => ({ t, v: taskSortValue(t, sort.col, ctx) }))
    .sort((x, y) => {
      const xe = x.v == null || x.v === ''
      const ye = y.v == null || y.v === ''
      if (xe && ye) return defaultTaskOrder(x.t, y.t)
      if (xe) return 1
      if (ye) return -1
      return cmp(x.v, y.v) * dir || defaultTaskOrder(x.t, y.t)
    })
    .map(x => x.t)
}

// ---------------------------------------------------------------------------
// Agrupamento da tabela
// ---------------------------------------------------------------------------
export const TASK_GROUP_BY = [
  { id: 'status', label: 'Status' },
  { id: 'responsible', label: 'Responsável' },
  { id: 'priority', label: 'Prioridade' },
  { id: 'due', label: 'Prazo' },
  { id: 'none', label: 'Sem agrupamento' },
]

const DUE_GROUPS = [
  { key: 'atrasada', label: 'Atrasadas', color: '#e2445c' },
  { key: 'hoje', label: 'Hoje', color: '#579bfc' },
  { key: 'amanha', label: 'Amanhã', color: '#66ccff' },
  { key: 'semana', label: 'Próximos 7 dias', color: '#a25ddc' },
  { key: 'depois', label: 'Depois', color: '#94a3b8' },
  { key: 'sem_data', label: 'Sem prazo', color: '#64748b' },
  { key: 'feita', label: 'Concluídas', color: '#00c875' },
]

// Recebe tarefas JÁ filtradas e ordenadas. Grupos vazios somem.
export function groupTasks(tasks, groupBy, ctx = {}) {
  let defs = []
  let keyOf = () => 'all'
  if (groupBy === 'status') {
    defs = (ctx.stages || []).map(s => ({ key: s.id, label: s.label, color: s.color, stage: s }))
    keyOf = t => stageOf(t, ctx.stageIndex)?.id
  } else if (groupBy === 'responsible') {
    const ids = [...new Set((tasks || []).map(t => t.assigned_user_id).filter(Boolean))]
    defs = ids.map(id => ({ key: id, label: ctx.memberLabel?.[id] || 'Pessoa removida', color: '#579bfc', responsible: id }))
      .sort((a, b) => cmp(a.label, b.label))
    defs.push({ key: 'none', label: 'Sem responsável', color: '#64748b', responsible: null })
    keyOf = t => t.assigned_user_id || 'none'
  } else if (groupBy === 'priority') {
    defs = [...PRIORITIES.map(p => ({ key: p.key, label: p.label, color: p.color, priority: p.key })), { key: 'none', label: 'Sem prioridade', color: '#64748b', priority: null }]
    keyOf = t => t.priority || 'none'
  } else if (groupBy === 'due') {
    defs = DUE_GROUPS.map(g => ({ ...g }))
    keyOf = t => dueBucket(t, ctx.today)
  } else {
    defs = [{ key: 'all', label: 'Todas as tarefas', color: '#579bfc' }]
  }
  const byKey = new Map(defs.map(d => [d.key, { ...d, rows: [] }]))
  for (const t of tasks || []) {
    const k = keyOf(t)
    if (!byKey.has(k)) byKey.set(k, { key: k, label: String(k), color: '#64748b', rows: [] })
    byKey.get(k).rows.push(t)
  }
  return [...byKey.values()].filter(g => g.rows.length || groupBy === 'none')
}

// ---------------------------------------------------------------------------
// Kanban: cards por coluna e reordenação
// ---------------------------------------------------------------------------
// Ordem do card na coluna: posição manual (board_position) primeiro; sem posição, pela ordem
// padrão (prazo). Concluídas sem posição: mais recentes primeiro.
function boardOrder(a, b) {
  const pa = a.board_position == null ? null : Number(a.board_position)
  const pb = b.board_position == null ? null : Number(b.board_position)
  if (pa != null && pb != null && pa !== pb) return pa - pb
  if (pa != null && pb == null) return -1
  if (pa == null && pb != null) return 1
  if (isTaskDone(a) && isTaskDone(b)) return String(b.done_at || '').localeCompare(String(a.done_at || ''))
  return defaultTaskOrder(a, b)
}

export function kanbanColumns(tasks, stages, index) {
  const cols = (stages || []).map(s => ({ stage: s, tasks: [] }))
  const byId = new Map(cols.map(c => [c.stage.id, c]))
  for (const t of tasks || []) {
    const s = stageOf(t, index)
    const col = s && byId.get(s.id)
    if (col) col.tasks.push(t)
  }
  for (const c of cols) c.tasks.sort(boardOrder)
  return cols
}

// Nova ordem de ids da coluna de destino ao soltar `taskId` antes de `beforeId` (null = no fim).
export function reorderIds(ids, taskId, beforeId) {
  const list = (ids || []).filter(id => id !== taskId)
  const at = beforeId ? list.indexOf(beforeId) : -1
  if (at < 0) list.push(taskId)
  else list.splice(at, 0, taskId)
  return list
}

// ---------------------------------------------------------------------------
// Subtarefas e histórico
// ---------------------------------------------------------------------------
export function checklistProgress(items) {
  const list = items || []
  if (!list.length) return null
  return { done: list.filter(i => i.done).length, total: list.length }
}

// { taskId: { done, total } } a partir das linhas (task_id, done).
export function checklistCounts(rows) {
  const out = {}
  for (const r of rows || []) {
    if (!r?.task_id) continue
    const c = out[r.task_id] || (out[r.task_id] = { done: 0, total: 0 })
    c.total++
    if (r.done) c.done++
  }
  return out
}

const FIELD_LABEL = {
  title: 'Título', description: 'Descrição', status: 'Status', stage_id: 'Coluna', priority: 'Prioridade',
  assigned_user_id: 'Responsável', due_date: 'Prazo', due_time: 'Hora', task_type: 'Categoria', outcome: 'Desfecho',
}
const STATUS_LABEL = { pendente: 'Aberta', aguardando: 'Aguardando', feita: 'Concluída' }

function historyValue(field, v, ctx) {
  if (v == null || v === '') return '—'
  switch (field) {
    case 'status': return STATUS_LABEL[v] || v
    case 'stage_id': return ctx.stageIndex?.byId?.[v]?.label || 'Coluna removida'
    case 'priority': return PRIORITY_BY_KEY[v]?.label || v
    case 'assigned_user_id': return ctx.memberLabel?.[v] ? String(ctx.memberLabel[v]).split('@')[0] : 'Pessoa removida'
    case 'due_date': { const [y, m, d] = String(v).split('-'); return d ? `${d}/${m}/${y}` : String(v) }
    case 'due_time': return String(v).slice(0, 5)
    case 'task_type': return categoryLabel(v)
    case 'outcome': return ctx.outcomeLabel?.[v] || v
    case 'description': { const s = String(v); return s.length > 60 ? `${s.slice(0, 60)}…` : s }
    default: return String(v)
  }
}

// Linhas de task_history → [{ id, at, who, text }] (mais recentes primeiro). A troca de coluna
// que só reflete a mudança de status (mesmo instante) não vira linha repetida.
export function describeHistory(rows, ctx = {}) {
  return [...(rows || [])]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(r => {
      const who = r.changed_by ? (ctx.memberLabel?.[r.changed_by] ? String(ctx.memberLabel[r.changed_by]).split('@')[0] : 'Pessoa da equipe') : 'Sistema'
      if (r.field === 'created') return { id: r.id, at: r.created_at, who, text: 'criou a tarefa' }
      const label = FIELD_LABEL[r.field] || r.field
      return { id: r.id, at: r.created_at, who, text: `${label}: ${historyValue(r.field, r.old_value, ctx)} → ${historyValue(r.field, r.new_value, ctx)}` }
    })
}

// Contadores compactos do topo (sobre o conjunto filtrado).
export function taskStats(tasks, today) {
  let atrasadas = 0, hoje = 0, abertas = 0, feitasHoje = 0
  for (const t of tasks || []) {
    if (isTaskDone(t)) {
      if (t.done_at) { const d = new Date(t.done_at); if (!Number.isNaN(d.getTime()) && isoDay(d) === today) feitasHoje++ }
      continue
    }
    abertas++
    const b = dueBucket(t, today)
    if (b === 'atrasada') atrasadas++
    if (b === 'hoje') hoje++
  }
  return { atrasadas, hoje, abertas, feitasHoje }
}
