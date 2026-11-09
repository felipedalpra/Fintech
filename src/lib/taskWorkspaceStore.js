// src/lib/taskWorkspaceStore.js
// I/O do gerenciador de tarefas (Supabase). Leituras toleram a migração ainda não aplicada
// (supabase/tasks_workspace_phase4.sql): sem ela, a página funciona com os campos atuais e as
// colunas fixas (A fazer / Aguardando / Concluída) — nunca mostra dado inventado.
import { supabase } from './supabase.js'
import { isSchemaMissing } from './crmWorkspaceStore.js'

const BASE_FIELDS = 'id, title, due_date, due_time, task_type, status, outcome, assigned_user_id, done_at, created_at, opportunity_id, patient_id'
const PHASE4_FIELDS = 'stage_id, priority, description, board_position'
const LINKS = 'patients(full_name, phone), opportunities(title)'

async function fetchAll(makeQuery) {
  const PAGE = 1000
  let from = 0
  let all = []
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    all = all.concat(data || [])
    if (!data || data.length < PAGE) return { data: all, error: null }
    from += PAGE
  }
}

function friendly(error) {
  if (error?.code === '42501') return 'Sem permissão para esta ação.'
  if (isSchemaMissing(error)) return 'Recurso indisponível: a atualização do banco de Tarefas (tasks_workspace_phase4.sql) ainda não foi aplicada.'
  return error?.message || 'Erro ao salvar.'
}

// Todas as tarefas da clínica. { tasks, ready, error } — ready=false: migração ausente.
export async function loadTasks(ownerId) {
  const query = fields => () => supabase.from('tasks').select(fields)
    .eq('user_id', ownerId).order('due_date', { ascending: true, nullsFirst: false }).order('id', { ascending: true })
  const full = await fetchAll(query(`${BASE_FIELDS}, ${PHASE4_FIELDS}, ${LINKS}`))
  if (!full.error) return { tasks: full.data || [], ready: true, error: null }
  if (!isSchemaMissing(full.error)) return { tasks: [], ready: false, error: full.error.message || 'Erro ao carregar tarefas' }
  const basic = await fetchAll(query(`${BASE_FIELDS}, ${LINKS}`))
  if (basic.error) return { tasks: [], ready: false, error: basic.error.message || 'Erro ao carregar tarefas' }
  return { tasks: basic.data || [], ready: false, error: null }
}

// Colunas do Kanban. null = migração ausente (usa as virtuais).
const STAGE_FIELDS = 'id, label, color, base_status, position, is_default, seed_key, archived_at, created_at'
export async function loadStages(ownerId) {
  const { data, error } = await supabase.from('task_stages').select(STAGE_FIELDS)
    .eq('user_id', ownerId).is('archived_at', null).order('position', { ascending: true })
  if (error) return null
  return data || []
}

// Cria as 4 colunas iniciais na primeira vez da clínica. Retorna quantas criou.
export async function ensureDefaultStages() {
  const { data, error } = await supabase.rpc('task_ensure_default_stages')
  if (error) return 0
  return Number(data) || 0
}

export async function createStage(ownerId, { label, color, base_status, position }) {
  const { data, error } = await supabase.from('task_stages')
    .insert({ user_id: ownerId, label, color, base_status, position }).select(STAGE_FIELDS).single()
  if (error) return { error: friendly(error) }
  return { stage: data }
}

export async function updateStage(stageId, patch) {
  const allowed = {}
  for (const k of ['label', 'color', 'position']) if (k in patch) allowed[k] = patch[k]
  const { data, error } = await supabase.from('task_stages').update(allowed).eq('id', stageId).select(STAGE_FIELDS)
  if (error) return { error: friendly(error) }
  if (!data?.length) return { error: 'Sem permissão para alterar as colunas (somente Administrador e Gestão).' }
  return { stage: data[0] }
}

// Remover = arquivar: as tarefas da coluna voltam para a coluna padrão do status delas.
export async function archiveStage(stageId) {
  const { data, error } = await supabase.from('task_stages')
    .update({ archived_at: new Date().toISOString() }).eq('id', stageId).select('id')
  if (error) return { error: friendly(error) }
  if (!data?.length) return { error: 'Sem permissão para remover a coluna.' }
  return { ok: true }
}

// Mover/reordenar: uma chamada (o banco ajusta o status pela coluna). stageId nulo = só ordem.
export async function moveTaskOnBoard(taskId, stageId, orderedIds) {
  const { error } = await supabase.rpc('task_move', { p_task_id: taskId, p_stage_id: stageId, p_ordered_ids: orderedIds })
  if (error) return { error: friendly(error) }
  return { ok: true }
}

// Edição em massa de campos simples (responsável, prioridade, prazo). Read-back: só conta o que
// o banco confirmou. Retorna { ids } ou { error }.
export async function patchTasks(ids, patch) {
  if (!ids?.length) return { ids: [] }
  const allowed = {}
  for (const k of ['assigned_user_id', 'priority', 'due_date']) if (k in patch) allowed[k] = patch[k] || null
  allowed.updated_at = new Date().toISOString()
  const { data, error } = await supabase.from('tasks').update(allowed).in('id', ids).select('id')
  if (error) return { error: friendly(error) }
  return { ids: (data || []).map(r => r.id) }
}

// ---------------------------------------------------------------------------
// Subtarefas (checklist)
// ---------------------------------------------------------------------------
export async function loadChecklistRows(ownerId) {
  const { data, error } = await fetchAll(() => supabase.from('task_checklist_items').select('task_id, done')
    .eq('user_id', ownerId).order('id', { ascending: true }))
  if (error) return null
  return data || []
}

const ITEM_FIELDS = 'id, task_id, title, done, position, done_at, done_by, created_at'
export async function loadChecklist(taskId) {
  const { data, error } = await supabase.from('task_checklist_items').select(ITEM_FIELDS)
    .eq('task_id', taskId).order('position', { ascending: true }).order('created_at', { ascending: true })
  if (error) return { items: [], error: friendly(error) }
  return { items: data || [] }
}

export async function addChecklistItem(ownerId, taskId, title, position) {
  const t = String(title || '').trim()
  if (!t) return { error: 'Escreva a subtarefa.' }
  const { data, error } = await supabase.from('task_checklist_items')
    .insert({ user_id: ownerId, task_id: taskId, title: t.slice(0, 300), position }).select(ITEM_FIELDS).single()
  if (error) return { error: friendly(error) }
  return { item: data }
}

export async function updateChecklistItem(itemId, patch) {
  const allowed = {}
  if ('done' in patch) allowed.done = Boolean(patch.done)
  if ('title' in patch) {
    const t = String(patch.title || '').trim()
    if (!t) return { error: 'Escreva a subtarefa.' }
    allowed.title = t.slice(0, 300)
  }
  const { data, error } = await supabase.from('task_checklist_items').update(allowed).eq('id', itemId).select(ITEM_FIELDS)
  if (error) return { error: friendly(error) }
  if (!data?.length) return { error: 'Subtarefa não encontrada.' }
  return { item: data[0] }
}

export async function deleteChecklistItem(itemId) {
  const { data, error } = await supabase.from('task_checklist_items').delete().eq('id', itemId).select('id')
  if (error) return { error: friendly(error) }
  if (!data?.length) return { error: 'Subtarefa não encontrada.' }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Comentários e histórico
// ---------------------------------------------------------------------------
export async function loadTaskComments(taskId) {
  const { data, error } = await supabase.from('task_comments')
    .select('id, task_id, body, author_id, parent_id, mentions, created_at')
    .eq('task_id', taskId).order('created_at', { ascending: true }).order('id', { ascending: true })
  if (error) return { notes: [], threaded: false, error: isSchemaMissing(error) ? null : friendly(error), unavailable: isSchemaMissing(error) }
  return { notes: data || [], threaded: true, error: null }
}

export async function addTaskComment(ownerId, taskId, body, authorId, { parentId = null, mentions = [] } = {}) {
  const text = String(body || '').trim()
  if (!text) return { error: 'Comentário vazio' }
  const row = { user_id: ownerId, task_id: taskId, body: text, author_id: authorId }
  if (parentId) row.parent_id = parentId
  if (mentions?.length) row.mentions = mentions
  const { data, error } = await supabase.from('task_comments').insert(row).select('*').single()
  if (error) return { error: friendly(error) }
  return { note: data }
}

export async function loadTaskHistory(taskId) {
  const { data, error } = await supabase.from('task_history')
    .select('id, field, old_value, new_value, changed_by, created_at')
    .eq('task_id', taskId).order('created_at', { ascending: false }).limit(200)
  if (error) return { rows: [], unavailable: isSchemaMissing(error), error: isSchemaMissing(error) ? null : friendly(error) }
  return { rows: data || [] }
}

// Menções ao usuário em comentários de tarefa (sino do CRM).
export async function loadTaskMentions(ownerId, userId, sinceIso) {
  if (!ownerId || !userId) return []
  const { data, error } = await supabase.from('task_comments')
    .select('id, task_id, body, author_id, mentions, created_at, tasks(title)')
    .eq('user_id', ownerId).contains('mentions', [userId]).gte('created_at', sinceIso)
    .order('created_at', { ascending: false }).limit(50)
  return error ? [] : (data || [])
}
