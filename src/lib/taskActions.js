// src/lib/taskActions.js
// Ações de tarefas e notas (operacionais — não tocam financeiro).
import { supabase } from './supabase.js'

const TASK_COLS = 'id, opportunity_id, patient_id, title, due_date, status, assigned_user_id, created_by, done_at, created_at'

// Cria uma tarefa. ownerId = dono/clínica (RLS). opportunityId/patientId opcionais (avulsa).
export async function createTask(ownerId, { title, dueDate, assignedUserId, opportunityId = null, patientId = null, createdBy = null }) {
  if (!ownerId) return { error: 'Sessão inválida' }
  if (!title?.trim()) return { error: 'Título obrigatório' }
  const row = {
    user_id: ownerId,
    opportunity_id: opportunityId,
    patient_id: patientId,
    title: title.trim(),
    due_date: dueDate || null,
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

export async function deleteTask(taskId) {
  if (!taskId) return { error: 'Tarefa inválida' }
  const { error } = await supabase.from('tasks').delete().eq('id', taskId)
  if (error) return { error: error.message }
  return { ok: true }
}

// Registra uma nota manual na oportunidade (entra na timeline).
export async function addNote(ownerId, opportunityId, body, authorId = null) {
  if (!ownerId || !opportunityId) return { error: 'Dados inválidos' }
  if (!body?.trim()) return { error: 'Nota vazia' }
  const { data, error } = await supabase.from('opportunity_notes')
    .insert({ user_id: ownerId, opportunity_id: opportunityId, body: body.trim(), author_id: authorId })
    .select('id, body, author_id, created_at').single()
  if (error) return { error: error.message }
  return { note: data }
}
