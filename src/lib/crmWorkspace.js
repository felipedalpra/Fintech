// src/lib/crmWorkspace.js
// Núcleo PURO do workspace de CRM (tabela estilo Monday): colunas, configuração de visualização,
// filtros, ordenação, agrupamento e totais. Sem I/O e sem tema — testável em unit test.
// Os totais são SEMPRE derivados das oportunidades carregadas (nunca armazenados).
import { avatarColor } from './avatar.js'
import { OUTCOMES, effectiveProbability } from './crmStages.js'
import { opportunityPerson } from './crmContact.js'

const DAY = 86400000

// ---------------------------------------------------------------------------
// Colunas
// ---------------------------------------------------------------------------
// requiresSchema: depende das colunas criadas por supabase/crm_workspace_phase1.sql.
export const SYSTEM_COLUMNS = [
  { id: 'person', label: 'Paciente', kind: 'person', width: 260, fixed: true },
  { id: 'procedure', label: 'Procedimento', kind: 'procedure', width: 170, requiresSchema: true },
  { id: 'stage', label: 'Etapa comercial', kind: 'stage', width: 170 },
  { id: 'responsible', label: 'Responsável', kind: 'member', width: 118 },
  { id: 'source', label: 'Origem do lead', kind: 'source', width: 150 },
  { id: 'value', label: 'Valor estimado', kind: 'currency', width: 140, summary: 'sum' },
  { id: 'probability', label: 'Probabilidade', kind: 'probability', width: 122, requiresSchema: true },
  { id: 'next_action', label: 'Próxima ação', kind: 'text', width: 200, requiresSchema: true },
  { id: 'next_action_due', label: 'Prazo', kind: 'date', width: 130, requiresSchema: true },
  { id: 'last_contact', label: 'Último contato', kind: 'last_contact', width: 140, readOnly: true },
  { id: 'whatsapp', label: 'WhatsApp', kind: 'whatsapp', width: 96, readOnly: true, sortable: false },
  { id: 'notes', label: 'Observações', kind: 'notes', width: 126, sortable: false },
  { id: 'status', label: 'Situação', kind: 'outcome', width: 120, defaultHidden: true },
  { id: 'expected_surgery_date', label: 'Cirurgia prevista', kind: 'date', width: 140, defaultHidden: true, requiresSchema: true },
  { id: 'created_at', label: 'Entrada', kind: 'datetime', width: 120, defaultHidden: true, readOnly: true },
  { id: 'days_in_stage', label: 'Tempo na etapa', kind: 'days', width: 124, defaultHidden: true, readOnly: true },
  { id: 'title', label: 'Título', kind: 'text', width: 180, defaultHidden: true },
]

export const SYSTEM_COLUMN_IDS = SYSTEM_COLUMNS.map(c => c.id)

export const CUSTOM_FIELD_TYPES = [
  { type: 'text', label: 'Texto' },
  { type: 'number', label: 'Número' },
  { type: 'currency', label: 'Moeda' },
  { type: 'date', label: 'Data' },
  { type: 'status', label: 'Status' },
  { type: 'select', label: 'Seleção única' },
  { type: 'multiselect', label: 'Seleção múltipla' },
  { type: 'person', label: 'Responsável' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'percent', label: 'Percentual' },
  { type: 'link', label: 'Link' },
]

// Mesmo critério do trigger crm_custom_fields_guard (banco): tipo só muda dentro do grupo.
const TYPE_FAMILIES = [['text', 'link'], ['number', 'currency', 'percent'], ['status', 'select']]
export function compatibleFieldTypes(type) {
  const family = TYPE_FAMILIES.find(f => f.includes(type))
  return family ? family : [type]
}

export function customColumnId(fieldId) {
  return `cf:${fieldId}`
}

export function customFieldIdOf(columnId) {
  return typeof columnId === 'string' && columnId.startsWith('cf:') ? columnId.slice(3) : null
}

const CUSTOM_KIND = {
  text: 'text', link: 'link', number: 'number', currency: 'currency', percent: 'percent', date: 'date',
  status: 'option', select: 'option', multiselect: 'options', person: 'member', checkbox: 'checkbox',
}

function customColumn(field) {
  const kind = CUSTOM_KIND[field.field_type] || 'text'
  return {
    id: customColumnId(field.id),
    label: field.label,
    kind,
    custom: true,
    field,
    width: Number(field.width) || (kind === 'checkbox' ? 100 : 150),
    summary: ['number', 'currency'].includes(field.field_type) ? 'sum' : undefined,
  }
}

const MIN_WIDTH = 72
const MAX_WIDTH = 640
export function clampWidth(w, fallback = 150) {
  const n = Number(w)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)))
}

// Monta as colunas efetivas: ordem salva na visualização + colunas novas ao final.
// Campos personalizados arquivados somem; a coluna fixa (Paciente) é sempre a primeira e visível.
export function resolveColumns(configColumns = [], customFields = [], { schemaReady = true } = {}) {
  const defs = new Map()
  for (const c of SYSTEM_COLUMNS) {
    if (c.requiresSchema && !schemaReady) continue
    defs.set(c.id, c)
  }
  for (const f of customFields || []) {
    if (!f?.archived_at) defs.set(customColumnId(f.id), customColumn(f))
  }
  const seen = new Set()
  const out = []
  for (const saved of Array.isArray(configColumns) ? configColumns : []) {
    const def = saved && defs.get(saved.id)
    if (!def || seen.has(def.id)) continue
    seen.add(def.id)
    out.push({ ...def, width: clampWidth(saved.width, def.width), hidden: def.fixed ? false : Boolean(saved.hidden) })
  }
  for (const def of defs.values()) {
    if (seen.has(def.id)) continue
    out.push({ ...def, width: def.width, hidden: def.fixed ? false : Boolean(def.defaultHidden) })
  }
  const fixed = out.filter(c => c.fixed)
  return [...fixed, ...out.filter(c => !c.fixed)]
}

// Serializa as colunas para guardar na visualização (só id/largura/oculta).
export function serializeColumns(columns) {
  return (columns || []).map(c => ({ id: c.id, width: c.width, hidden: Boolean(c.hidden) }))
}

// ---------------------------------------------------------------------------
// Configuração da visualização
// ---------------------------------------------------------------------------
export const GROUP_BY_OPTIONS = [
  { id: 'stage', label: 'Etapa comercial' },
  { id: 'responsible', label: 'Responsável' },
  { id: 'procedure', label: 'Procedimento' },
  { id: 'source', label: 'Origem do lead' },
  { id: 'month', label: 'Mês de entrada' },
  { id: 'surgery', label: 'Data prevista de cirurgia' },
  { id: 'none', label: 'Sem agrupamento' },
]

export const PERIOD_FIELDS = [
  { id: 'created_at', label: 'Entrada' },
  { id: 'next_action_due', label: 'Prazo' },
  { id: 'expected_surgery_date', label: 'Cirurgia prevista' },
  { id: 'last_contact', label: 'Último contato' },
]

export const PERIOD_PRESETS = [
  { id: 'today', label: 'Hoje' },
  { id: 'this_week', label: 'Esta semana' },
  { id: 'next_7', label: 'Próximos 7 dias' },
  { id: 'this_month', label: 'Este mês' },
  { id: 'last_30', label: 'Últimos 30 dias' },
  { id: 'last_90', label: 'Últimos 90 dias' },
  { id: 'custom', label: 'Personalizado' },
]

export const EMPTY_FILTERS = {
  q: '',
  responsible: [],
  procedure: [],
  stage: [],
  source: [],
  status: 'all',          // all | aberto | ganho | perdido
  period: null,           // { field, preset, from, to }
  valueMin: null,
  valueMax: null,
  overdue: false,         // tarefa pendente vencida OU prazo da próxima ação vencido
  noContactDays: null,    // sem contato há mais de N dias
}

export const DEFAULT_VIEW_CONFIG = {
  columns: [],
  groupBy: 'stage',
  groupOrder: [],
  collapsed: { ganho: true, perdido: true },
  sort: null,             // { col, dir: 'asc' | 'desc' }
  filters: EMPTY_FILTERS,
}

function arr(v) {
  return Array.isArray(v) ? v.filter(x => x != null && x !== '').map(String) : []
}
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function normalizeFilters(f = {}) {
  const src = f && typeof f === 'object' ? f : {}
  const status = ['all', 'aberto', 'ganho', 'perdido'].includes(src.status) ? src.status : 'all'
  let period = null
  if (src.period && typeof src.period === 'object' && PERIOD_FIELDS.some(p => p.id === src.period.field)) {
    const preset = PERIOD_PRESETS.some(p => p.id === src.period.preset) ? src.period.preset : 'custom'
    period = { field: src.period.field, preset, from: src.period.from || null, to: src.period.to || null }
  }
  const noContact = numOrNull(src.noContactDays)
  return {
    q: typeof src.q === 'string' ? src.q : '',
    responsible: arr(src.responsible),
    procedure: arr(src.procedure),
    stage: arr(src.stage),
    source: arr(src.source),
    status,
    period,
    valueMin: numOrNull(src.valueMin),
    valueMax: numOrNull(src.valueMax),
    overdue: src.overdue === true,
    noContactDays: noContact != null && noContact > 0 ? Math.floor(noContact) : null,
  }
}

export function normalizeViewConfig(config = {}) {
  const src = config && typeof config === 'object' ? config : {}
  const groupBy = GROUP_BY_OPTIONS.some(g => g.id === src.groupBy) ? src.groupBy : DEFAULT_VIEW_CONFIG.groupBy
  const sort = src.sort && typeof src.sort.col === 'string'
    ? { col: src.sort.col, dir: src.sort.dir === 'desc' ? 'desc' : 'asc' }
    : null
  const collapsed = src.collapsed && typeof src.collapsed === 'object' && !Array.isArray(src.collapsed)
    ? Object.fromEntries(Object.entries(src.collapsed).filter(([, v]) => typeof v === 'boolean'))
    : { ...DEFAULT_VIEW_CONFIG.collapsed }
  return {
    columns: Array.isArray(src.columns) ? src.columns.filter(c => c && typeof c.id === 'string') : [],
    groupBy,
    groupOrder: arr(src.groupOrder),
    collapsed,
    sort,
    filters: normalizeFilters(src.filters),
  }
}

export function activeFilterCount(filters) {
  const f = normalizeFilters(filters)
  let n = 0
  for (const k of ['responsible', 'procedure', 'stage', 'source']) if (f[k].length) n++
  if (f.status !== 'all') n++
  if (f.period) n++
  if (f.valueMin != null || f.valueMax != null) n++
  if (f.overdue) n++
  if (f.noContactDays) n++
  return n
}

// ---------------------------------------------------------------------------
// Datas (data civil local — mesmo critério de src/utils.js)
// ---------------------------------------------------------------------------
export function isoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseIso(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function addDays(iso, n) {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

// Converte um timestamp/data para a data civil LOCAL (YYYY-MM-DD).
export function localDateOf(value) {
  if (!value) return null
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : isoDate(d)
}

// Intervalo [from, to] (inclusive) de um preset relativo a `today` (YYYY-MM-DD).
// Presets são guardados na visualização como relativos: "Esta semana" continua sendo esta semana.
export function periodRange(period, today) {
  if (!period) return null
  const t = today
  switch (period.preset) {
    case 'today': return { from: t, to: t }
    case 'this_week': {
      const dow = parseIso(t).getDay() // 0 = domingo
      const monday = addDays(t, dow === 0 ? -6 : 1 - dow)
      return { from: monday, to: addDays(monday, 6) }
    }
    case 'next_7': return { from: t, to: addDays(t, 6) }
    case 'this_month': {
      const d = parseIso(t)
      const first = isoDate(new Date(d.getFullYear(), d.getMonth(), 1))
      const last = isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
      return { from: first, to: last }
    }
    case 'last_30': return { from: addDays(t, -29), to: t }
    case 'last_90': return { from: addDays(t, -89), to: t }
    default: return { from: period.from || null, to: period.to || null }
  }
}

export function daysSince(value, now = Date.now()) {
  if (!value) return null
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return null
  const d = Math.floor((now - t) / DAY)
  return d >= 0 ? d : 0
}

// ---------------------------------------------------------------------------
// Valores derivados por linha
// ---------------------------------------------------------------------------
// ctx = { stagesByKey, memberLabel, procedureName, lastContact, overdueTasks, today, now }
export function lastContactOf(opp, ctx) {
  return ctx?.lastContact?.[opp.id]?.at || null
}

export function isOverdue(opp, ctx) {
  if (opp.status !== 'aberto') return false
  if ((ctx?.overdueTasks?.[opp.id] || 0) > 0) return true
  return Boolean(opp.next_action_due && ctx?.today && opp.next_action_due < ctx.today)
}

function normalizeText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function sourceKey(source) {
  const s = String(source || '').trim()
  return s ? s.toLowerCase() : 'none'
}

// ---------------------------------------------------------------------------
// Filtros (combináveis — todos precisam passar)
// ---------------------------------------------------------------------------
export function applyFilters(opps, filters, ctx = {}) {
  const f = normalizeFilters(filters)
  const q = normalizeText(f.q.trim())
  const range = f.period ? periodRange(f.period, ctx.today) : null
  const now = ctx.now ?? Date.now()
  const respSet = new Set(f.responsible)
  const procSet = new Set(f.procedure)
  const stageSet = new Set(f.stage)
  const sourceSet = new Set(f.source)

  return (opps || []).filter(o => {
    if (f.status !== 'all' && o.status !== f.status) return false
    if (q) {
      const person = opportunityPerson(o)
      const hay = normalizeText([
        person.name, person.phone, o.title, o.source, o.next_action,
        ctx.procedureName?.[o.procedure_id], ...(Array.isArray(o.tags) ? o.tags : []),
      ].filter(Boolean).join(' '))
      if (!hay.includes(q)) return false
    }
    if (respSet.size && !respSet.has(o.responsible_user_id || 'none')) return false
    if (procSet.size && !procSet.has(o.procedure_id || 'none')) return false
    if (stageSet.size && !stageSet.has(o.stage)) return false
    if (sourceSet.size && !sourceSet.has(sourceKey(o.source))) return false
    if (f.valueMin != null || f.valueMax != null) {
      if (o.value == null || o.value === '') return false
      const v = Number(o.value)
      if (f.valueMin != null && v < f.valueMin) return false
      if (f.valueMax != null && v > f.valueMax) return false
    }
    if (range && (range.from || range.to)) {
      const raw = f.period.field === 'last_contact' ? lastContactOf(o, ctx) : o[f.period.field]
      const d = localDateOf(raw)
      if (!d) return false
      if (range.from && d < range.from) return false
      if (range.to && d > range.to) return false
    }
    if (f.overdue && !isOverdue(o, ctx)) return false
    if (f.noContactDays) {
      // "Sem contato há mais de N dias": usa o último contato; sem nenhum contato, conta desde a entrada.
      const ref = lastContactOf(o, ctx) || o.created_at
      const d = daysSince(ref, now)
      if (d == null || d <= f.noContactDays) return false
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Ordenação (vazios sempre no fim, nas duas direções)
// ---------------------------------------------------------------------------
export function sortValue(opp, col, ctx = {}) {
  if (col.custom) {
    const v = opp.custom_values?.[col.field.id]
    if (v == null || v === '') return null
    if (col.kind === 'option') return optionLabel(col.field, v)
    if (col.kind === 'options') return Array.isArray(v) && v.length ? v.map(id => optionLabel(col.field, id)).join(', ') : null
    if (col.kind === 'member') return ctx.memberLabel?.[v] || v
    if (col.kind === 'checkbox') return v ? 1 : 0
    return v
  }
  switch (col.id) {
    case 'person': return opportunityPerson(opp).name
    case 'procedure': return ctx.procedureName?.[opp.procedure_id] || null
    case 'stage': return ctx.stagesByKey?.[opp.stage]?.position ?? null
    case 'responsible': return opp.responsible_user_id ? (ctx.memberLabel?.[opp.responsible_user_id] || opp.responsible_user_id) : null
    case 'source': return opp.source || null
    case 'value': return opp.value == null || opp.value === '' ? null : Number(opp.value)
    case 'probability': return effectiveProbability(opp, ctx.stagesByKey)
    case 'last_contact': return lastContactOf(opp, ctx)
    case 'days_in_stage': return daysSince(opp.stage_entered_at, ctx.now)
    case 'status': return opp.status
    default: {
      const v = opp[col.id]
      return v == null || v === '' ? null : v
    }
  }
}

function compare(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base', numeric: true })
}

export function sortRows(opps, sort, columns, ctx = {}) {
  const list = [...(opps || [])]
  const col = sort && (columns || []).find(c => c.id === sort.col)
  if (!col) {
    // Padrão: mais recentes primeiro (mesma ordem do funil).
    return list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  }
  const dir = sort.dir === 'desc' ? -1 : 1
  return list
    .map(o => ({ o, v: sortValue(o, col, ctx) }))
    .sort((x, y) => {
      const xe = x.v == null || x.v === ''
      const ye = y.v == null || y.v === ''
      if (xe && ye) return 0
      if (xe) return 1
      if (ye) return -1
      return compare(x.v, y.v) * dir
    })
    .map(x => x.o)
}

// ---------------------------------------------------------------------------
// Agrupamento
// ---------------------------------------------------------------------------
const NONE_COLOR = '#64748b'
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS[(m || 1) - 1]}/${y}`
}

function groupKeyOf(opp, groupBy, ctx) {
  switch (groupBy) {
    case 'stage': return opp.status === 'aberto' || !opp.status ? opp.stage : opp.status
    case 'responsible': return opp.responsible_user_id || 'none'
    case 'procedure': return opp.procedure_id || 'none'
    case 'source': return sourceKey(opp.source)
    case 'month': return localDateOf(opp.created_at)?.slice(0, 7) || 'none'
    case 'surgery': return opp.expected_surgery_date ? String(opp.expected_surgery_date).slice(0, 7) : 'none'
    default: return 'all'
  }
}

// Lista de grupos possíveis, na ordem natural, para um agrupamento.
function baseGroups(groupBy, opps, ctx) {
  const stages = ctx.stages || []
  if (groupBy === 'stage') {
    return [
      ...stages.map(s => ({ key: s.key, label: s.label, color: s.color, stage: s.key })),
      { key: 'ganho', label: OUTCOMES.ganho.label, color: OUTCOMES.ganho.color, outcome: 'ganho' },
      { key: 'perdido', label: OUTCOMES.perdido.label, color: OUTCOMES.perdido.color, outcome: 'perdido' },
    ]
  }
  if (groupBy === 'none') return [{ key: 'all', label: 'Todas as oportunidades', color: '#3b82f6' }]
  const keys = new Set((opps || []).map(o => groupKeyOf(o, groupBy, ctx)))
  let list = []
  if (groupBy === 'responsible') {
    for (const m of ctx.members || []) keys.add(m.user_id)
    list = [...keys].filter(k => k !== 'none').map(k => ({ key: k, label: ctx.memberLabel?.[k] || 'Usuário', color: avatarColor(ctx.memberLabel?.[k] || k), responsible: k }))
    list.sort((a, b) => compare(a.label, b.label))
    list.push({ key: 'none', label: 'Sem responsável', color: NONE_COLOR, responsible: null })
  } else if (groupBy === 'procedure') {
    list = [...keys].filter(k => k !== 'none').map(k => ({ key: k, label: ctx.procedureName?.[k] || 'Procedimento removido', color: ctx.procedureColor?.[k] || avatarColor(k), procedure: k }))
    list.sort((a, b) => compare(a.label, b.label))
    list.push({ key: 'none', label: 'Sem procedimento', color: NONE_COLOR, procedure: null })
  } else if (groupBy === 'source') {
    const labelByKey = {}
    for (const o of opps || []) {
      const k = sourceKey(o.source)
      if (k !== 'none' && !labelByKey[k]) labelByKey[k] = String(o.source).trim()
    }
    list = [...keys].filter(k => k !== 'none').map(k => ({ key: k, label: labelByKey[k] || k, color: avatarColor(k), source: labelByKey[k] || k }))
    list.sort((a, b) => compare(a.label, b.label))
    list.push({ key: 'none', label: 'Sem origem', color: NONE_COLOR, source: null })
  } else if (groupBy === 'month' || groupBy === 'surgery') {
    list = [...keys].filter(k => k !== 'none').map(k => ({ key: k, label: monthLabel(k), color: avatarColor(k) }))
    // Entrada: mais recente primeiro. Cirurgia prevista: mais próxima primeiro.
    list.sort((a, b) => (groupBy === 'month' ? -1 : 1) * compare(a.key, b.key))
    list.push({ key: 'none', label: groupBy === 'month' ? 'Sem data' : 'Sem data prevista', color: NONE_COLOR })
  }
  return list
}

// Agrupa linhas JÁ filtradas e ordenadas. Etapas vazias continuam visíveis (para adicionar
// oportunidade nelas) enquanto não há filtro — `ctx.keepEmptyStages`. Demais grupos vazios somem.
export function groupRows(opps, groupBy, ctx = {}, groupOrder = []) {
  const groups = baseGroups(groupBy, opps, ctx).map(g => ({ ...g, rows: [] }))
  const byKey = new Map(groups.map(g => [g.key, g]))
  for (const o of opps || []) {
    const k = groupKeyOf(o, groupBy, ctx)
    let g = byKey.get(k)
    if (!g) {
      g = { key: k, label: k, color: NONE_COLOR, rows: [] }
      byKey.set(k, g)
      groups.push(g)
    }
    g.rows.push(o)
  }
  const keepEmptyStages = ctx.keepEmptyStages !== false
  const visible = groups.filter(g => g.rows.length > 0 || groupBy === 'none' || (groupBy === 'stage' && g.stage && keepEmptyStages))
  if (!groupOrder?.length) return visible
  const rank = new Map(groupOrder.map((k, i) => [k, i]))
  return visible
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const ra = rank.has(a.g.key) ? rank.get(a.g.key) : Infinity
      const rb = rank.has(b.g.key) ? rank.get(b.g.key) : Infinity
      return ra === rb ? a.i - b.i : ra - rb
    })
    .map(x => x.g)
}

// Move um grupo para cima/baixo e devolve a nova ordem completa de chaves.
export function moveGroup(currentKeys, key, delta) {
  const keys = [...currentKeys]
  const i = keys.indexOf(key)
  const j = i + delta
  if (i < 0 || j < 0 || j >= keys.length) return keys
  ;[keys[i], keys[j]] = [keys[j], keys[i]]
  return keys
}

// Totais do grupo: soma das colunas monetárias/numéricas e distribuição das colunas de status.
export function groupSummary(rows, columns, ctx = {}) {
  const out = {}
  for (const col of columns || []) {
    if (col.summary === 'sum') {
      let sum = 0
      let count = 0
      for (const o of rows || []) {
        const raw = col.custom ? o.custom_values?.[col.field.id] : o[col.id]
        if (raw == null || raw === '') continue
        const n = Number(raw)
        if (!Number.isFinite(n)) continue
        sum += n
        count++
      }
      out[col.id] = { type: 'sum', sum, count }
    } else if (col.kind === 'stage' || col.kind === 'option' || col.kind === 'outcome') {
      const counts = new Map()
      for (const o of rows || []) {
        let key
        let color
        if (col.kind === 'stage') { key = o.stage; color = ctx.stagesByKey?.[key]?.color }
        else if (col.kind === 'outcome') { key = o.status; color = OUTCOMES[key]?.color }
        else {
          key = o.custom_values?.[col.field.id]
          color = (col.field.options || []).find(opt => opt.id === key)?.color
        }
        if (key == null || key === '') { key = '__empty'; color = NONE_COLOR }
        const prev = counts.get(key) || { key, color: color || NONE_COLOR, count: 0 }
        prev.count++
        counts.set(key, prev)
      }
      out[col.id] = { type: 'dist', parts: [...counts.values()], total: (rows || []).length }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Campos personalizados
// ---------------------------------------------------------------------------
export function optionLabel(field, optionId) {
  return (field?.options || []).find(o => o.id === optionId)?.label || null
}

// Converte o valor digitado para o formato persistido em custom_values. { value } ou { error }.
// value === null remove a chave (célula vazia).
export function coerceCustomValue(field, raw) {
  const type = field?.field_type
  if (raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
    return { value: type === 'checkbox' ? false : null }
  }
  switch (type) {
    case 'text': return { value: String(raw).slice(0, 2000) }
    case 'link': {
      const s = String(raw).trim()
      if (!/^https?:\/\/\S+$/i.test(s)) return { error: 'Link inválido (use http:// ou https://).' }
      return { value: s }
    }
    case 'number':
    case 'currency':
    case 'percent': {
      const n = Number(String(raw).replace(',', '.'))
      if (!Number.isFinite(n)) return { error: 'Número inválido.' }
      if (type === 'currency' && n < 0) return { error: 'Valor não pode ser negativo.' }
      if (type === 'percent' && (n < 0 || n > 100)) return { error: 'Percentual deve estar entre 0 e 100.' }
      return { value: n }
    }
    case 'date': {
      const s = String(raw)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: 'Data inválida.' }
      return { value: s }
    }
    case 'status':
    case 'select': {
      if (!(field.options || []).some(o => o.id === raw)) return { error: 'Opção inválida.' }
      return { value: raw }
    }
    case 'multiselect': {
      const ids = (Array.isArray(raw) ? raw : [raw]).filter(id => (field.options || []).some(o => o.id === id))
      return { value: ids.length ? ids : null }
    }
    case 'person': return { value: String(raw) }
    case 'checkbox': return { value: raw === true || raw === 'true' }
    default: return { value: raw }
  }
}

// Aplica um valor numa cópia de custom_values (null remove a chave).
export function withCustomValue(customValues, fieldId, value) {
  const next = { ...(customValues && typeof customValues === 'object' ? customValues : {}) }
  if (value == null) delete next[fieldId]
  else next[fieldId] = value
  return next
}

const OPTION_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#64748b']
export function nextOptionColor(index) {
  return OPTION_COLORS[index % OPTION_COLORS.length]
}

// Valida a definição de um campo antes de gravar. { field } ou { error }.
export function validateFieldDraft(draft) {
  const label = String(draft?.label || '').trim()
  if (!label) return { error: 'Dê um nome para a coluna.' }
  if (label.length > 60) return { error: 'Nome com no máximo 60 caracteres.' }
  if (!CUSTOM_FIELD_TYPES.some(t => t.type === draft.field_type)) return { error: 'Tipo inválido.' }
  const needsOptions = ['status', 'select', 'multiselect'].includes(draft.field_type)
  const options = needsOptions
    ? (draft.options || []).map(o => ({ ...o, label: String(o.label || '').trim() })).filter(o => o.label)
    : []
  if (needsOptions && options.length === 0) return { error: 'Adicione ao menos uma opção.' }
  const labels = new Set()
  for (const o of options) {
    const k = o.label.toLowerCase()
    if (labels.has(k)) return { error: `Opção repetida: ${o.label}` }
    labels.add(k)
  }
  return { field: { label, field_type: draft.field_type, options } }
}
