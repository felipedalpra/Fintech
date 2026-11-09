// src/lib/taskActions.js
// Ações de tarefas e notas (operacionais — não tocam financeiro).
import { supabase } from './supabase.js'
import { isValidTaskType, TASK_STATUSES } from './taskQueue.js'

const TASK_COLS = 'id, opportunity_id, patient_id, title, due_date, due_time, task_type, status, outcome, assigned_user_id, created_by, done_at, created_at'

// Cria uma tarefa. ownerId = dono/clínica (RLS). opportunityId/patientId opcionais (avulsa).
export async function createTask(ownerId, { title, dueDate, dueTime = null, taskType = 'outro', assignedUserId, opportunityId = null, patientId = null, createdBy = null }) {
  if (!ownerId) return { error: 'Sessão inválida' }
  if (!title?.trim()) return { error: 'Título obrigatório' }
  const row = {
    user_id: ownerId,
    opportunity_id: opportunityId,
    patient_id: patientId,
    title: title.trim(),
    due_date: dueDate || null,
    due_time: dueTime || null,
    task_type: isValidTaskType(taskType) ? taskType : 'outro',
    assigned_user_id: assignedUserId || null,
    created_by: createdBy || null,
    status: 'pendente',
  }
  const { data, error } = await supabase.from('tasks').insert(row).select(TASK_COLS).single()
  if (error) return { error: error.message }
  return { task: data }
}

// Alterna pendente/feita (grava done_at ao concluir).
export async function toggleTask(task) {
  if (!task?.id) return { error: 'Tarefa inválida' }
  const done = task.status !== 'feita'
  const patch = { status: done ? 'feita' : 'pendente', done_at: done ? new Date().toISOString() : null, updated_at: new Date().toISOString() }
  const { error } = await supabase.from('tasks').update(patch).eq('id', task.id)
  if (error) return { error: error.message }
  return { status: patch.status, done_at: patch.done_at }
}

// Update PARCIAL de uma tarefa (subitem do CRM): toca só os campos informados.
// Sair de 'feita' limpa done_at e o desfecho (o banco exige outcome só em tarefa concluída);
// as tentativas de contato ficam em task_attempts e não se perdem.
export async function updateTask(taskId, patch = {}) {
  if (!taskId) return { error: 'Tarefa inválida' }
  const allowed = {}
  if ('title' in patch) {
    const t = String(patch.title || '').trim()
    if (!t) return { error: 'Título obrigatório' }
    allowed.title = t.slice(0, 300)
  }
  if ('due_date' in patch) {
    const d = patch.due_date
    if (d === '' || d == null) allowed.due_date = null
    else if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) allowed.due_date = String(d)
    else return { error: 'Data inválida.' }
  }
  if ('assigned_user_id' in patch) allowed.assigned_user_id = patch.assigned_user_id || null
  if ('status' in patch) {
    if (!TASK_STATUSES.some(s => s.key === patch.status)) return { error: 'Status inválido.' }
    allowed.status = patch.status
    if (patch.status === 'feita') {
      allowed.done_at = new Date().toISOString()
    } else {
      allowed.done_at = null
      allowed.outcome = null
      allowed.outcome_at = null
      allowed.outcome_by = null
    }
  }
  if (Object.keys(allowed).length === 0) return { ok: true, patch: {} }
  allowed.updated_at = new Date().toISOString()
  // READ-BACK: update de 0 linhas (RLS) não dá erro — sem isto seria um "salvo" falso.
  const { data, error } = await supabase.from('tasks').update(allowed).eq('id', taskId).select('id')
  if (error) {
    if (error.code === '23514' && allowed.status === 'aguardando') {
      return { error: 'O status "Aguardando" fica disponível depois da atualização do banco do CRM (crm_workspace_phase2.sql).' }
    }
    return { error: error.message }
  }
  if (!data?.length) return { error: 'Não foi possível salvar a tarefa (sem permissão ou tarefa removida).' }
  return { ok: true, patch: allowed }
}

export async function deleteTask(taskId) {
  if (!taskId) return { error: 'Tarefa inválida' }
  const { error } = await supabase.from('tasks').delete().eq('id', taskId)
  if (error) return { error: error.message }
  return { ok: true }
}

// Registra uma nota manual na oportunidade (entra na timeline e nas Atualizações).
// parentId/mentions (resposta e menções) dependem de supabase/crm_workspace_phase3.sql: só são
// enviados quando usados, então a nota simples continua funcionando sem a migração.
export async function addNote(ownerId, opportunityId, body, authorId = null, { parentId = null, mentions = [] } = {}) {
  if (!ownerId || !opportunityId) return { error: 'Dados inválidos' }
  if (!body?.trim()) return { error: 'Nota vazia' }
  const row = { user_id: ownerId, opportunity_id: opportunityId, body: body.trim(), author_id: authorId }
  if (parentId) row.parent_id = parentId
  if (mentions?.length) row.mentions = mentions
  const { data, error } = await supabase.from('opportunity_notes').insert(row).select('*').single()
  if (error) {
    if (['42703', 'PGRST204'].includes(error.code)) return { error: 'Respostas e menções ficam disponíveis depois da atualização do banco do CRM.' }
    return { error: error.message }
  }
  return { note: data }
}

// Registra UMA tentativa de contato e, só quando o desfecho encerra, fecha a tarefa.
// A tentativa é gravada ANTES de encerrar: se a atualização da tarefa falhar, o histórico do
// contato não se perde — perder "ligamos e não atenderam" é perder a razão do próximo passo.
export async function registerTaskAttempt({ task, ownerId, actorId, outcome, notes, closes }) {
  if (!task?.id) return { error: 'Tarefa inválida' }
  if (!ownerId) return { error: 'Clínica não identificada' }
  if (!outcome) return { error: 'Informe o desfecho' }

  const { error: attemptError } = await supabase.from('task_attempts').insert({
    user_id: ownerId,
    task_id: task.id,
    outcome,
    notes: String(notes || '').trim() || null,
    created_by: actorId || null,
  })
  if (attemptError) return { error: attemptError.message }

  if (!closes) return { task: { ...task, status: 'pendente' }, closed: false }

  const now = new Date().toISOString()
  const patch = { status: 'feita', done_at: now, outcome, outcome_at: now, outcome_by: actorId || null, updated_at: now }
  const { error } = await supabase.from('tasks').update(patch).eq('id', task.id)
  // A tentativa já está gravada: a falha aqui deixa a tarefa aberta, nunca apaga o histórico.
  if (error) return { error: error.message, attemptSaved: true }
  return { task: { ...task, ...patch }, closed: true }
}

export async function listTaskAttempts(taskId) {
  if (!taskId) return { attempts: [] }
  const { data, error } = await supabase
    .from('task_attempts')
    .select('id, outcome, notes, created_at, created_by')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
  if (error) return { error: error.message, attempts: [] }
  return { attempts: data ?? [] }
}
