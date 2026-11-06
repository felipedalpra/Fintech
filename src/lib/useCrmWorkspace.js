// src/lib/useCrmWorkspace.js
// Estado ÚNICO do workspace de CRM, compartilhado por Tabela e Kanban: o que muda numa visualização
// aparece na outra sem recarregar. Edições são otimistas, com rollback só dos campos tocados.
// Etapa muda SEMPRE pela RPC auditada move_opportunity (mesmo caminho do funil).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { patchOpportunity, setOpportunityOutcome } from './opportunityActions.js'
import { confirmSuggestion, dismissSuggestion } from './opportunitySuggestion.js'
import {
  loadOpportunities, loadWorkspaceMeta, loadLastContact, loadOverdueTasks, loadNoteCounts, saveCustomValue,
} from './crmWorkspaceStore.js'
import { resolveStages, stageMap } from './crmStages.js'
import { isoDate } from './crmWorkspace.js'

export function useCrmWorkspace(ownerId, { fallbackOwnerLabel } = {}) {
  const [opps, setOpps] = useState([])
  const [members, setMembers] = useState([])
  const [stageSettings, setStageSettings] = useState([])
  const [customFields, setCustomFields] = useState([])
  const [views, setViews] = useState([])
  const [procedures, setProcedures] = useState(null) // null = não carregado (usa o do financeiro)
  const [lastContact, setLastContact] = useState({})
  const [overdueTasks, setOverdueTasks] = useState({})
  const [noteCounts, setNoteCounts] = useState({})
  const [features, setFeatures] = useState({ schema: false, contacts: false, fields: false, views: false, stages: false, lastContact: false })
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
      const today = isoDate(new Date())
      const [oppRes, meta, overdue, notes] = await Promise.all([
        loadOpportunities(ownerId),
        loadWorkspaceMeta(ownerId),
        loadOverdueTasks(ownerId, today),
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
      setOverdueTasks(overdue)
      setNoteCounts(notes)
      setFeatures(f => ({
        ...f,
        schema: oppRes.schemaReady,
        contacts: oppRes.contactsReady,
        fields: meta.customFields.available,
        views: meta.views.available,
        stages: meta.stageSettings.available,
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

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  return {
    opps, stages, stagesByKey, members, memberLabel, customFields, setCustomFields,
    views, setViews, procedures, stageSettings, setStageSettings, lastContact, overdueTasks, noteCounts,
    features, loading, error, movingId,
    updateOpp, updateCustomValue, moveStage, setOutcome, acceptSuggestion, rejectSuggestion,
    addOpp, onEditorSaved, reload,
  }
}
