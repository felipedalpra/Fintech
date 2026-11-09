// src/lib/useTaskWorkspace.js
// Estado ÚNICO da página Tarefas: Kanban e Tabela leem as mesmas tarefas. Edições otimistas com
// rollback só dos campos tocados. As tarefas são o MESMO registro do CRM (subitens), Meu Dia e
// Sino — nada é copiado.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { createTask, toggleTask, deleteTask, updateTask, registerTaskAttempt } from './taskActions.js'
import { TASK_OUTCOMES } from './taskQueue.js'
import {
  loadTasks, loadStages, ensureDefaultStages, createStage, updateStage, archiveStage, moveTaskOnBoard, patchTasks,
  loadChecklistRows,
} from './taskWorkspaceStore.js'
import { resolveTaskStages, stageIndex, stageOf, checklistCounts } from './taskWorkspace.js'

const stagesChecked = new Set()

export function useTaskWorkspace(ownerId, userId) {
  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [stageRows, setStageRows] = useState(null) // null = migração ausente
  const [checklist, setChecklist] = useState({})
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  useEffect(() => {
    if (!ownerId) return undefined
    let mounted = true
    async function load() {
      setLoading(true); setError(null)
      // Colunas iniciais (uma vez por clínica) em PARALELO com a carga: a tabela não espera.
      // Se acabaram de ser criadas, relê as colunas depois.
      const firstVisit = !stagesChecked.has(ownerId)
      stagesChecked.add(ownerId)
      const seeding = firstVisit ? ensureDefaultStages() : Promise.resolve(0)
      const [taskRes, team, stages, rows] = await Promise.all([
        loadTasks(ownerId),
        supabase.rpc('clinic_team'),
        loadStages(ownerId),
        loadChecklistRows(ownerId),
      ])
      if (!mounted) return
      if (taskRes.error) { setError(taskRes.error); setLoading(false); return }
      setTasks(taskRes.tasks)
      setReady(taskRes.ready && stages != null)
      setMembers((team?.data || []).filter(m => m.user_id))
      setStageRows(stages)
      setChecklist(checklistCounts(rows || []))
      setLoading(false)
      if (await seeding > 0) {
        const fresh = await loadStages(ownerId)
        if (mounted && fresh) { setStageRows(fresh); setReady(taskRes.ready) }
      }
    }
    load()
    return () => { mounted = false }
  }, [ownerId, reloadKey])

  const stages = useMemo(() => resolveTaskStages(stageRows), [stageRows])
  const index = useMemo(() => stageIndex(stages), [stages])
  const memberLabel = useMemo(() => Object.fromEntries(members.map(m => [m.user_id, m.member_email || m.user_id])), [members])

  const applyLocal = useCallback((id, patch) => setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t))), [])
  const revertLocal = useCallback((id, before, keys) => setTasks(prev => prev.map(t => {
    if (t.id !== id || !before) return t
    const r = { ...t }
    for (const k of keys) r[k] = before[k]
    return r
  })), [])

  // Patch local equivalente ao que o banco fará (status/conclusão seguem a coluna).
  const localForStage = useCallback((task, stage) => {
    const patch = { stage_id: stage.virtual ? task.stage_id ?? null : stage.id }
    if (task.status !== stage.base_status) {
      patch.status = stage.base_status
      if (stage.base_status === 'feita') patch.done_at = new Date().toISOString()
      else { patch.done_at = null; patch.outcome = null }
    }
    return patch
  }, [])

  // Edição de campos. { ok } ou { error }.
  const update = useCallback(async (id, patch) => {
    const before = tasksRef.current.find(t => t.id === id)
    if (!before) return { error: 'Tarefa não encontrada' }
    const local = { ...patch }
    if ('status' in patch) {
      local.done_at = patch.status === 'feita' ? new Date().toISOString() : null
      if (patch.status !== 'feita') local.outcome = null
      // O banco libera a coluna incompatível; espelha aqui.
      const own = before.stage_id ? index.byId[before.stage_id] : null
      if (own && own.base_status !== patch.status) local.stage_id = null
    }
    applyLocal(id, local)
    const res = await updateTask(id, patch)
    if (res.error) { revertLocal(id, before, Object.keys(local)); return { error: res.error } }
    return { ok: true }
  }, [applyLocal, revertLocal, index])

  // Mudar de coluna (Kanban, célula Status, painel). Sem migração: muda o status.
  const setStage = useCallback(async (id, stageId) => {
    const before = tasksRef.current.find(t => t.id === id)
    const stage = index.byId[stageId]
    if (!before || !stage) return { error: 'Coluna inválida' }
    if (stageOf(before, index)?.id === stage.id) return { ok: true }
    if (stage.virtual) return update(id, { status: stage.base_status })
    const local = localForStage(before, stage)
    applyLocal(id, local)
    const res = await updateTask(id, { stage_id: stage.id })
    if (res.error) { revertLocal(id, before, Object.keys(local)); return { error: res.error } }
    return { ok: true }
  }, [index, localForStage, applyLocal, revertLocal, update])

  // Arrastar no Kanban: coluna de destino + ordem final dos cards dela.
  const moveOnBoard = useCallback(async (id, stageId, orderedIds) => {
    const before = tasksRef.current.find(t => t.id === id)
    const stage = index.byId[stageId]
    if (!before || !stage) return { error: 'Coluna inválida' }
    const sameColumn = stageOf(before, index)?.id === stage.id
    if (stage.virtual || !ready) {
      // Sem migração não há ordem manual: só a troca de status vale.
      return sameColumn ? { ok: true } : update(id, { status: stage.base_status })
    }
    const snapshot = tasksRef.current
    const pos = Object.fromEntries(orderedIds.map((x, i) => [x, (i + 1) * 1024]))
    setTasks(prev => prev.map(t => {
      let n = t
      if (t.id === id && !sameColumn) n = { ...n, ...localForStage(t, stage) }
      if (pos[t.id] != null) n = { ...n, board_position: pos[t.id] }
      return n
    }))
    const res = await moveTaskOnBoard(id, sameColumn ? null : stage.id, orderedIds)
    if (res.error) { setTasks(snapshot); return { error: res.error } }
    return { ok: true }
  }, [index, ready, update, localForStage])

  const toggle = useCallback(async (task) => {
    const done = task.status !== 'feita'
    applyLocal(task.id, { status: done ? 'feita' : 'pendente', done_at: done ? new Date().toISOString() : null, ...(done ? {} : { outcome: null }), ...(task.stage_id ? { stage_id: null } : {}) })
    const res = await toggleTask(task)
    if (res.error) { revertLocal(task.id, task, ['status', 'done_at', 'outcome', 'stage_id']); return { error: res.error } }
    return { ok: true }
  }, [applyLocal, revertLocal])

  // Desfecho (mesma regra de antes): desfecho que não encerra registra a tentativa e mantém.
  const registerOutcome = useCallback(async (task, outcome) => {
    const closes = TASK_OUTCOMES.find(item => item.key === outcome)?.closes === true
    if (closes) applyLocal(task.id, { status: 'feita', outcome, done_at: new Date().toISOString(), ...(task.stage_id ? { stage_id: null } : {}) })
    const res = await registerTaskAttempt({ task, ownerId, actorId: userId, outcome, closes })
    if (res.error) {
      if (closes) revertLocal(task.id, task, ['status', 'outcome', 'done_at', 'stage_id'])
      return { error: res.error }
    }
    return { ok: true, closes }
  }, [applyLocal, revertLocal, ownerId, userId])

  const remove = useCallback(async (task) => {
    setTasks(prev => prev.filter(t => t.id !== task.id))
    const res = await deleteTask(task.id)
    if (res.error) { setTasks(prev => (prev.some(t => t.id === task.id) ? prev : [...prev, task])); return { error: res.error } }
    return { ok: true }
  }, [])

  const create = useCallback(async (input, links = {}) => {
    const res = await createTask(ownerId, { ...input, createdBy: userId })
    if (res.error) return { error: res.error }
    const task = { patients: links.patients || null, opportunities: links.opportunities || null, ...res.task }
    setTasks(prev => [...prev, task])
    return { task }
  }, [ownerId, userId])

  // Em massa: responsável/prioridade/prazo numa escrita; coluna uma a uma (trigger por tarefa).
  const bulkPatch = useCallback(async (ids, patch) => {
    const befores = ids.map(id => tasksRef.current.find(t => t.id === id)).filter(Boolean)
    for (const t of befores) applyLocal(t.id, patch)
    const res = await patchTasks(befores.map(t => t.id), patch)
    if (res.error) { for (const t of befores) revertLocal(t.id, t, Object.keys(patch)); return { error: res.error } }
    const ok = new Set(res.ids)
    const failed = befores.filter(t => !ok.has(t.id))
    for (const t of failed) revertLocal(t.id, t, Object.keys(patch))
    return { count: ok.size, failed: failed.length }
  }, [applyLocal, revertLocal])

  const bulkStage = useCallback(async (ids, stageId) => {
    let count = 0
    let failed = 0
    for (const id of ids) {
      const res = await setStage(id, stageId)
      if (res.error) failed++
      else count++
    }
    return { count, failed }
  }, [setStage])

  const bulkRemove = useCallback(async (ids) => {
    let count = 0
    let failed = 0
    for (const id of ids) {
      const t = tasksRef.current.find(x => x.id === id)
      if (!t) continue
      const res = await remove(t)
      if (res.error) failed++
      else count++
    }
    return { count, failed }
  }, [remove])

  // ----- colunas do Kanban (admin/gestão; a RLS confere) -----
  const addStage = useCallback(async ({ label, color, base_status }) => {
    const position = Math.max(0, ...stages.filter(s => !s.virtual).map(s => Number(s.position) || 0)) + 1
    const res = await createStage(ownerId, { label, color, base_status, position })
    if (res.error) return res
    setStageRows(prev => [...(prev || []), res.stage])
    return res
  }, [ownerId, stages])

  const editStage = useCallback(async (id, patch) => {
    const res = await updateStage(id, patch)
    if (res.error) return res
    setStageRows(prev => (prev || []).map(s => (s.id === id ? res.stage : s)))
    return res
  }, [])

  // Reordenar colunas: grava a nova posição de cada coluna real.
  const reorderStages = useCallback(async (orderedIds) => {
    const prev = stageRows
    const pos = Object.fromEntries(orderedIds.map((id, i) => [id, i + 1]))
    setStageRows(rows => (rows || []).map(s => (pos[s.id] != null ? { ...s, position: pos[s.id] } : s)))
    for (const id of orderedIds) {
      const before = (prev || []).find(s => s.id === id)
      if (!before || Number(before.position) === pos[id]) continue
      const res = await updateStage(id, { position: pos[id] })
      if (res.error) { setStageRows(prev); return res }
    }
    return { ok: true }
  }, [stageRows])

  const removeStage = useCallback(async (id) => {
    const res = await archiveStage(id)
    if (res.error) return res
    setStageRows(prev => (prev || []).filter(s => s.id !== id))
    // As tarefas da coluna passam a aparecer na coluna padrão do status (stageOf já cuida).
    return res
  }, [])

  const setChecklistCount = useCallback((taskId, progress) => {
    setChecklist(prev => {
      const next = { ...prev }
      if (!progress?.total) delete next[taskId]
      else next[taskId] = { done: progress.done, total: progress.total }
      return next
    })
  }, [])

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  return {
    ownerId, tasks, members, memberLabel, stages, stageIndex: index, checklist, ready, loading, error,
    update, setStage, moveOnBoard, toggle, registerOutcome, remove, create, bulkPatch, bulkStage, bulkRemove,
    addStage, editStage, reorderStages, removeStage, setChecklistCount, reload,
  }
}
