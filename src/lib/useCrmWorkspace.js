// src/lib/useCrmWorkspace.js
// Estado ÚNICO do workspace de CRM, compartilhado por Tabela e Kanban: o que muda numa visualização
// aparece na outra sem recarregar. Edições são otimistas, com rollback só dos campos tocados.
// Etapa muda SEMPRE pela RPC auditada move_opportunity (mesmo caminho do funil).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import {
  patchOpportunity, patchOpportunities, setOpportunityOutcome, archiveOpportunities, restoreOpportunities,
  addOpportunityTags, duplicateOpportunity,
} from './opportunityActions.js'
import { createTask, updateTask } from './taskActions.js'
import { confirmSuggestion, dismissSuggestion } from './opportunitySuggestion.js'
import {
  loadOpportunities, loadWorkspaceMeta, loadLastContact, loadOpportunityTasks, loadNoteCounts, saveCustomValue,
} from './crmWorkspaceStore.js'
import { resolveStages, stageMap } from './crmStages.js'
import { isoDate, tasksByOpportunity, overdueTaskCounts } from './crmWorkspace.js'

export function useCrmWorkspace(ownerId, { fallbackOwnerLabel } = {}) {
  const [opps, setOpps] = useState([])
  const [members, setMembers] = useState([])
  const [stageSettings, setStageSettings] = useState([])
  const [customFields, setCustomFields] = useState([])
  const [views, setViews] = useState([])
  const [procedures, setProcedures] = useState(null) // null = não carregado (usa o do financeiro)
  const [lastContact, setLastContact] = useState({})
  const [tasks, setTasks] = useState([])
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const [noteCounts, setNoteCounts] = useState({})
  const [features, setFeatures] = useState({ schema: false, contacts: false, fields: false, views: false, stages: false, lastContact: false, tasks: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [movingId, setMovingId] = useState(null)
  const oppsRef = useRef(opps)
  oppsRef.current = opps
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!ownerId) return
    let mounted = true
    async function load() {
      setLoading(true)
      setError(null)
      const [oppRes, meta, taskRes, notes] = await Promise.all([
        loadOpportunities(ownerId),
        loadWorkspaceMeta(ownerId),
        loadOpportunityTasks(ownerId),
        loadNoteCounts(ownerId),
      ])
      if (!mounted) return
      if (oppRes.error) { setError(oppRes.error); setLoading(false); return }
      setOpps(oppRes.opps)
      setMembers(meta.members)
      setStageSettings(meta.stageSettings.data)
      setCustomFields(meta.customFields.data)
      setViews(meta.views.data)
      setProcedures(meta.procedures.available ? meta.procedures.data : null)
      setTasks(taskRes.tasks)
      setNoteCounts(notes)
      setFeatures(f => ({
        ...f,
        schema: oppRes.schemaReady,
        contacts: oppRes.contactsReady,
        fields: meta.customFields.available,
        views: meta.views.available,
        stages: meta.stageSettings.available,
        tasks: taskRes.available,
      }))
      setLoading(false)
      // Último contato vem depois (não bloqueia a tabela).
      const lc = await loadLastContact(oppRes.opps.map(o => o.id))
      if (!mounted) return
      setLastContact(lc.map)
      setFeatures(f => ({ ...f, lastContact: lc.available }))
    }
    load()
    return () => { mounted = false }
  }, [ownerId, reloadKey])

  // Subitens e atrasadas DERIVADOS das tarefas carregadas: concluir um subitem tira o alerta da
  // linha e do card do Kanban na hora. O "hoje" é recalculado a cada mudança das tarefas.
  const subitems = useMemo(() => tasksByOpportunity(tasks), [tasks])
  const overdueTasks = useMemo(() => overdueTaskCounts(tasks, isoDate(new Date())), [tasks])

  const stages = useMemo(() => resolveStages(stageSettings), [stageSettings])
  const stagesByKey = useMemo(() => stageMap(stages), [stages])

  const memberLabel = useMemo(() => {
    const map = Object.fromEntries(members.map(m => [m.user_id, m.member_email || m.user_id]))
    if (ownerId && !map[ownerId] && fallbackOwnerLabel) map[ownerId] = fallbackOwnerLabel
    return map
  }, [members, ownerId, fallbackOwnerLabel])

  // Aplica um patch local numa oportunidade.
  const applyLocal = useCallback((oppId, patch) => {
    setOpps(prev => prev.map(o => (o.id === oppId ? { ...o, ...patch } : o)))
  }, [])

  // Reverte SÓ os campos tocados (preserva alterações concorrentes de outros campos).
  const revertLocal = useCallback((oppId, before, keys) => {
    setOpps(prev => prev.map(o => {
      if (o.id !== oppId) return o
      const restored = { ...o }
      for (const k of keys) restored[k] = before ? before[k] : o[k]
      return restored
    }))
  }, [])

  // Edição de campos da oportunidade (não etapa/status). { ok } ou { error }.
  const updateOpp = useCallback(async (oppId, patch) => {
    const before = oppsRef.current.find(o => o.id === oppId)
    applyLocal(oppId, patch)
    const res = await patchOpportunity(oppId, patch)
    if (res.error) {
      revertLocal(oppId, before, Object.keys(patch))
      return { error: res.error }
    }
    return { ok: true }
  }, [applyLocal, revertLocal])

  const updateCustomValue = useCallback(async (oppId, fieldId, value) => {
    const before = oppsRef.current.find(o => o.id === oppId)
    const optimistic = { ...(before?.custom_values || {}) }
    if (value == null) delete optimistic[fieldId]
    else optimistic[fieldId] = value
    applyLocal(oppId, { custom_values: optimistic })
    const res = await saveCustomValue(oppId, fieldId, value)
    if (res.error) {
      revertLocal(oppId, before, ['custom_values'])
      return { error: res.error }
    }
    // O banco pode ter campos que outra pessoa gravou: adota o objeto confirmado.
    applyLocal(oppId, { custom_values: res.custom_values })
    return { ok: true }
  }, [applyLocal, revertLocal])

  const moveStage = useCallback(async (oppId, newStage) => {
    const before = oppsRef.current.find(o => o.id === oppId)
    if (!before || before.stage === newStage) return { ok: true }
    setMovingId(oppId)
    applyLocal(oppId, { stage: newStage, stage_entered_at: new Date().toISOString() })
    const { error: err } = await supabase.rpc('move_opportunity', { opp_id: oppId, new_stage: newStage, move_source: 'manual' })
    setMovingId(null)
    if (err) {
      revertLocal(oppId, before, ['stage', 'stage_entered_at'])
      return { error: 'Não foi possível mover a oportunidade. Tente novamente.' }
    }
    return { ok: true }
  }, [applyLocal, revertLocal])

  const setOutcome = useCallback(async (oppId, status, lostReason) => {
    const before = oppsRef.current.find(o => o.id === oppId)
    const patch = { status, lost_reason: status === 'perdido' ? (lostReason || '').trim() || null : null }
    applyLocal(oppId, patch)
    const res = await setOpportunityOutcome(oppId, status, lostReason)
    if (res.error) {
      revertLocal(oppId, before, Object.keys(patch))
      return { error: res.error }
    }
    return { ok: true }
  }, [applyLocal, revertLocal])

  const acceptSuggestion = useCallback(async (opp) => {
    const before = oppsRef.current.find(o => o.id === opp.id)
    setMovingId(opp.id)
    applyLocal(opp.id, { stage: opp.suggested_stage, stage_entered_at: new Date().toISOString(), suggestion_status: 'confirmed' })
    const { error: err } = await confirmSuggestion(opp)
    setMovingId(null)
    if (err) {
      revertLocal(opp.id, before, ['stage', 'stage_entered_at', 'suggestion_status'])
      return { error: 'Não foi possível aplicar a sugestão. Tente novamente.' }
    }
    return { ok: true }
  }, [applyLocal, revertLocal])

  const rejectSuggestion = useCallback(async (opp) => {
    const before = oppsRef.current.find(o => o.id === opp.id)
    applyLocal(opp.id, { suggestion_status: 'dismissed' })
    const { error: err } = await dismissSuggestion(opp)
    if (err) {
      revertLocal(opp.id, before, ['suggestion_status'])
      return { error: 'Não foi possível descartar a sugestão.' }
    }
    return { ok: true }
  }, [applyLocal, revertLocal])

  // Oportunidade criada em qualquer visualização entra no estado comum.
  const addOpp = useCallback((opp) => {
    if (!opp?.id) return
    setOpps(prev => [{ status: 'aberto', tags: [], custom_values: {}, ...opp }, ...prev.filter(o => o.id !== opp.id)])
  }, [])

  // Resultado do editor de oportunidade (mesmo contrato do funil).
  const onEditorSaved = useCallback((result) => {
    if (result.created) addOpp(result.created)
    else if (result.updated) applyLocal(result.updated.id, result.updated)
    else if (result.closed) {
      // O editor fecha como ganho/perdido; a tabela mantém a linha (vai para o grupo do desfecho).
      applyLocal(result.closed, { status: result.status, lost_reason: result.lostReason ?? null })
    }
  }, [addOpp, applyLocal])

  // ---------------------------------------------------------------------------
  // Subitens: o MESMO registro de `tasks` do módulo de Tarefas (createTask/updateTask).
  // ---------------------------------------------------------------------------
  const createSubitem = useCallback(async (opp, { title, dueDate = null, assignedUserId = null } = {}, createdBy = null) => {
    if (!opp?.id) return { error: 'Oportunidade inválida' }
    const res = await createTask(ownerId, {
      title, dueDate, assignedUserId, opportunityId: opp.id, patientId: opp.patient_id || null, createdBy,
    })
    if (res.error) return { error: res.error }
    setTasks(prev => [...prev, res.task])
    return { task: res.task }
  }, [ownerId])

  const updateSubitem = useCallback(async (taskId, patch) => {
    const before = tasksRef.current.find(t => t.id === taskId)
    if (!before) return { error: 'Tarefa não encontrada' }
    const local = { ...patch }
    if ('status' in patch) {
      local.done_at = patch.status === 'feita' ? new Date().toISOString() : null
      if (patch.status !== 'feita') local.outcome = null
    }
    setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, ...local } : t)))
    const res = await updateTask(taskId, patch)
    if (res.error) {
      const keys = Object.keys(local)
      setTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t
        const restored = { ...t }
        for (const k of keys) restored[k] = before[k]
        return restored
      }))
      return { error: res.error }
    }
    return { ok: true }
  }, [])

  // Mudança feita fora da tabela (aba Tarefas do editor): mantém o estado comum em dia.
  const syncTask = useCallback((change) => {
    const task = change?.task
    if (!task?.id) return
    setTasks(prev => {
      if (change.type === 'removed') return prev.filter(t => t.id !== task.id)
      const exists = prev.some(t => t.id === task.id)
      if (!exists) return task.opportunity_id ? [...prev, task] : prev
      return prev.map(t => (t.id === task.id ? { ...t, ...task } : t))
    })
  }, [])

  // ---------------------------------------------------------------------------
  // Ações em massa / menu contextual
  // ---------------------------------------------------------------------------
  // Etapa: UMA chamada auditada (move_opportunity) por oportunidade — nunca escrita direta.
  const bulkMoveStage = useCallback(async (ids, newStage, onProgress) => {
    const targets = ids.map(id => oppsRef.current.find(o => o.id === id)).filter(o => o && o.stage !== newStage)
    let moved = 0
    let failed = 0
    let done = 0
    const queue = [...targets]
    async function worker() {
      while (queue.length) {
        const before = queue.shift()
        applyLocal(before.id, { stage: newStage, stage_entered_at: new Date().toISOString() })
        const { error: err } = await supabase.rpc('move_opportunity', { opp_id: before.id, new_stage: newStage, move_source: 'manual' })
        if (err) { revertLocal(before.id, before, ['stage', 'stage_entered_at']); failed++ } else moved++
        done++
        onProgress?.(done, targets.length)
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker))
    return { moved, failed, skipped: ids.length - targets.length }
  }, [applyLocal, revertLocal])

  // Responsável / prazo: uma escrita para todas; reverte só as que o banco não confirmou.
  const bulkPatch = useCallback(async (ids, patch) => {
    const befores = ids.map(id => oppsRef.current.find(o => o.id === id)).filter(Boolean)
    const keys = Object.keys(patch)
    for (const o of befores) applyLocal(o.id, patch)
    const res = await patchOpportunities(befores.map(o => o.id), patch)
    if (res.error) {
      for (const o of befores) revertLocal(o.id, o, keys)
      return { error: res.error }
    }
    const ok = new Set(res.ids)
    const failed = befores.filter(o => !ok.has(o.id))
    for (const o of failed) revertLocal(o.id, o, keys)
    return { count: ok.size, failed: failed.length }
  }, [applyLocal, revertLocal])

  const bulkAddTags = useCallback(async (ids, tags) => {
    const res = await addOpportunityTags(ids, tags)
    if (res.error) return { error: res.error }
    setOpps(prev => prev.map(o => {
      if (!ids.includes(o.id)) return o
      const current = Array.isArray(o.tags) ? o.tags : []
      return { ...o, tags: [...current, ...res.tags.filter(t => !current.includes(t))] }
    }))
    return { count: res.count }
  }, [])

  const archive = useCallback(async (ids) => {
    const befores = ids.map(id => oppsRef.current.find(o => o.id === id)).filter(o => o && o.status !== 'arquivado')
    if (!befores.length) return { count: 0 }
    for (const o of befores) applyLocal(o.id, { status: 'arquivado', archived_from_status: o.status })
    const res = await archiveOpportunities(befores.map(o => o.id))
    if (res.error) {
      for (const o of befores) revertLocal(o.id, o, ['status', 'archived_from_status'])
      return { error: res.error }
    }
    return { count: res.count }
  }, [applyLocal, revertLocal])

  // Restaurar devolve o status ANTERIOR (ganho/perdido/aberto), que só o banco sabe com certeza:
  // relê a situação depois da RPC em vez de supor "aberta".
  const restore = useCallback(async (ids) => {
    const targets = ids.filter(id => oppsRef.current.find(o => o.id === id)?.status === 'arquivado')
    if (!targets.length) return { count: 0 }
    const res = await restoreOpportunities(targets)
    if (res.error) return { error: res.error }
    const { data } = await supabase.from('opportunities').select('id, status').in('id', targets)
    const statusById = Object.fromEntries((data || []).map(r => [r.id, r.status]))
    setOpps(prev => prev.map(o => (statusById[o.id] ? { ...o, status: statusById[o.id], archived_from_status: null } : o)))
    if (!data) setReloadKey(k => k + 1)
    return { count: res.count }
  }, [])

  const duplicate = useCallback(async (opp) => {
    const res = await duplicateOpportunity(opp.id)
    if (res.error) return { error: res.error }
    // A pessoa é a MESMA (referência), então o nome/telefone exibidos vêm da original.
    const copy = {
      ...res.opp,
      tags: Array.isArray(res.opp.tags) ? res.opp.tags : [],
      custom_values: res.opp.custom_values && typeof res.opp.custom_values === 'object' ? res.opp.custom_values : {},
      patients: opp.patients || null,
      crm_contacts: opp.crm_contacts || null,
    }
    setOpps(prev => {
      const i = prev.findIndex(o => o.id === opp.id)
      const next = prev.filter(o => o.id !== copy.id)
      next.splice(i < 0 ? 0 : i + 1, 0, copy)
      return next
    })
    return { opp: copy }
  }, [])

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  return {
    opps, stages, stagesByKey, members, memberLabel, customFields, setCustomFields,
    views, setViews, procedures, stageSettings, setStageSettings, lastContact, overdueTasks, noteCounts,
    tasks, subitems, features, loading, error, movingId,
    updateOpp, updateCustomValue, moveStage, setOutcome, acceptSuggestion, rejectSuggestion,
    addOpp, onEditorSaved, reload,
    createSubitem, updateSubitem, syncTask,
    bulkMoveStage, bulkPatch, bulkAddTags, archive, restore, duplicate,
  }
}
