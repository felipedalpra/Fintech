// CRM — Gestão de Oportunidades. Workspace com visualizações dos MESMOS dados (estilo Monday):
// Tabela (padrão) · visualizações salvas · Kanban · Agenda (Fase 2) · Indicadores.
// Estado único em useCrmWorkspace: o que muda numa visualização aparece nas demais.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { C, base } from '../theme.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { Modal, Btn } from './UI.jsx'
import { useCrmWorkspace } from '../lib/useCrmWorkspace.js'
import {
  DEFAULT_VIEW_CONFIG, normalizeViewConfig, resolveColumns, serializeColumns, applyFilters, sortRows, groupRows,
  moveGroup, activeFilterCount, sourceKey, isoDate,
} from '../lib/crmWorkspace.js'
import {
  createCustomField, updateCustomField, archiveCustomField, createView, updateView, deleteView, saveStageSettings,
} from '../lib/crmWorkspaceStore.js'
import { CrmTable } from './CrmTable.jsx'
import { CrmToolbar } from './CrmToolbar.jsx'
import { CrmFieldEditor } from './CrmColumnsMenu.jsx'
import { CrmStageSettings } from './CrmStageSettings.jsx'
import { Ico, ICONS, Popover, MenuItem } from './CrmCells.jsx'
import { OpportunityPipeline } from './OpportunityPipeline.jsx'
import { OpportunityEditor } from './OpportunityEditor.jsx'
import { NewLeadModal } from './NewLeadModal.jsx'
import { CrmDashboard } from './CrmDashboard.jsx'
import { CrmBulkBar } from './CrmBulkBar.jsx'

const SOURCE_SUGGESTIONS = ['Instagram', 'Indicação', 'WhatsApp', 'Google', 'Facebook', 'Site', 'Outro']
const MAIN_KEY = 'table'

function storageKey(userId) {
  return `surgimetrics_crm_table_v1:${userId || 'anon'}`
}

// Preferência local da Tabela principal (conveniência por navegador). Visualizações salvas
// — pessoais ou compartilhadas — ficam no banco (crm_views).
function readLocalConfig(userId) {
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    return raw ? normalizeViewConfig(JSON.parse(raw)) : normalizeViewConfig(DEFAULT_VIEW_CONFIG)
  } catch {
    return normalizeViewConfig(DEFAULT_VIEW_CONFIG)
  }
}

function writeLocalConfig(userId, config) {
  try { window.localStorage.setItem(storageKey(userId), JSON.stringify(config)) } catch { /* armazenamento indisponível */ }
}

export function CrmWorkspace({ data }) {
  const { user } = useAuth()
  const { ownerId, role, isOwner } = useUserRole()
  const { toast } = useToast()
  const { mode: themeMode } = useTheme()
  const effectiveOwner = ownerId || user?.id
  const canManage = Boolean(isOwner || role === 'admin' || role === 'gestao')
  const ws = useCrmWorkspace(effectiveOwner, { fallbackOwnerLabel: user?.email || 'Dono' })

  const [params, setParams] = useSearchParams()
  const tab = params.get('view') || MAIN_KEY
  const [lastTableKey, setLastTableKey] = useState(MAIN_KEY)
  const isSavedView = tab.startsWith('v-')
  const tableKey = tab === MAIN_KEY || isSavedView ? tab : lastTableKey
  useEffect(() => { if (tab === MAIN_KEY || isSavedView) setLastTableKey(tab) }, [tab, isSavedView])

  function goTab(next) {
    const p = new URLSearchParams(params)
    if (next === MAIN_KEY) p.delete('view')
    else p.set('view', next)
    setParams(p, { replace: true })
  }

  // ----- configuração ativa (tabela principal local + rascunhos das visualizações salvas) -----
  const [mainConfig, setMainConfig] = useState(() => readLocalConfig(user?.id))
  useEffect(() => { setMainConfig(readLocalConfig(user?.id)) }, [user?.id])
  useEffect(() => { writeLocalConfig(user?.id, mainConfig) }, [user?.id, mainConfig])
  const [viewDrafts, setViewDrafts] = useState({})

  const activeView = tableKey.startsWith('v-') ? ws.views.find(v => `v-${v.id}` === tableKey) : null
  const savedConfig = useMemo(() => (activeView ? normalizeViewConfig(activeView.config) : null), [activeView])
  const config = activeView ? (viewDrafts[activeView.id] || savedConfig) : mainConfig
  const viewDirty = Boolean(activeView && viewDrafts[activeView.id] && JSON.stringify(viewDrafts[activeView.id]) !== JSON.stringify(savedConfig))
  const canEditView = v => Boolean(v && ((v.scope === 'personal' && v.owner_id === user?.id) || (v.scope === 'shared' && canManage)))

  const setConfig = useCallback((updater) => {
    if (activeView) {
      setViewDrafts(d => {
        const current = d[activeView.id] || normalizeViewConfig(activeView.config)
        return { ...d, [activeView.id]: normalizeViewConfig(updater(current)) }
      })
    } else {
      setMainConfig(c => normalizeViewConfig(updater(c)))
    }
  }, [activeView])

  // Se a visualização da URL não existe (excluída / sem acesso), volta para a tabela principal.
  useEffect(() => {
    if (!ws.loading && isSavedView && !ws.views.some(v => `v-${v.id}` === tab)) goTab(MAIN_KEY)
  }, [ws.loading, isSavedView, ws.views, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ----- dados derivados -----
  const procedures = useMemo(() => (ws.procedures || data?.procedures || []).filter(p => p?.id), [ws.procedures, data?.procedures])
  const procedureName = useMemo(() => Object.fromEntries(procedures.map(p => [p.id, p.name])), [procedures])
  const procedureColor = useMemo(() => Object.fromEntries(procedures.filter(p => /^#[0-9a-f]{6}$/i.test(p.color || '')).map(p => [p.id, p.color])), [procedures])
  const procedureOptions = useMemo(() => procedures.map(p => ({ key: p.id, label: p.name, color: procedureColor[p.id] })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')), [procedures, procedureColor])
  const sourceOptions = useMemo(() => {
    const map = new Map()
    for (const s of SOURCE_SUGGESTIONS) map.set(sourceKey(s), s)
    for (const o of ws.opps) if (o.source && !map.has(sourceKey(o.source))) map.set(sourceKey(o.source), String(o.source).trim())
    return [...map.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }, [ws.opps])

  const [clock] = useState(() => Date.now())
  const today = useMemo(() => isoDate(new Date(clock)), [clock])
  const hasFilters = activeFilterCount(config.filters) > 0 || Boolean(config.filters.q.trim())
  const ctx = useMemo(() => ({
    stages: ws.stages, stagesByKey: ws.stagesByKey, members: ws.members, memberLabel: ws.memberLabel,
    procedureName, procedureColor, lastContact: ws.lastContact, overdueTasks: ws.overdueTasks, noteCounts: ws.noteCounts,
    today, now: clock, keepEmptyStages: !hasFilters, themeMode,
  }), [ws.stages, ws.stagesByKey, ws.members, ws.memberLabel, procedureName, procedureColor, ws.lastContact, ws.overdueTasks, ws.noteCounts, today, clock, hasFilters, themeMode])

  const columns = useMemo(() => resolveColumns(config.columns, ws.customFields, { schemaReady: ws.features.schema }), [config.columns, ws.customFields, ws.features.schema])
  const filtered = useMemo(() => applyFilters(ws.opps, config.filters, ctx), [ws.opps, config.filters, ctx])
  const sorted = useMemo(() => sortRows(filtered, config.sort, columns, ctx), [filtered, config.sort, columns, ctx])
  const groups = useMemo(() => groupRows(sorted, config.groupBy, ctx, config.groupOrder), [sorted, config.groupBy, ctx, config.groupOrder])
  const kanbanOpps = useMemo(() => {
    const f = ['ganho', 'perdido', 'arquivado'].includes(config.filters.status) ? { ...config.filters, status: 'all' } : config.filters
    return sortRows(applyFilters(ws.opps, f, ctx).filter(o => o.status === 'aberto'), null, columns, ctx)
  }, [ws.opps, config.filters, ctx, columns])

  // ----- ações de configuração -----
  const updateColumns = useCallback((fn) => setConfig(c => ({ ...c, columns: fn(serializeColumns(resolveColumns(c.columns, ws.customFields, { schemaReady: ws.features.schema }))) })), [setConfig, ws.customFields, ws.features.schema])
  const onSort = useCallback((colId, dir) => setConfig(c => {
    if (dir) return { ...c, sort: { col: colId, dir } }
    if (c.sort?.col !== colId) return { ...c, sort: { col: colId, dir: 'asc' } }
    if (c.sort.dir === 'asc') return { ...c, sort: { col: colId, dir: 'desc' } }
    return { ...c, sort: null }
  }), [setConfig])
  const onResizeColumn = useCallback((id, w) => updateColumns(cols => cols.map(c => (c.id === id ? { ...c, width: w } : c))), [updateColumns])
  const onToggleHidden = useCallback(id => updateColumns(cols => cols.map(c => (c.id === id ? { ...c, hidden: !c.hidden } : c))), [updateColumns])
  const onHideColumn = useCallback(id => updateColumns(cols => cols.map(c => (c.id === id ? { ...c, hidden: true } : c))), [updateColumns])
  const onReorderColumn = useCallback((fromId, toId) => updateColumns(cols => {
    const from = cols.findIndex(c => c.id === fromId)
    const to = cols.findIndex(c => c.id === toId)
    if (from < 0 || to < 0 || cols[to].id === 'person') return cols
    const next = [...cols]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  }), [updateColumns])
  const onMoveColumn = useCallback((id, delta) => updateColumns(cols => {
    const movable = cols.filter(c => c.id !== 'person')
    const i = movable.findIndex(c => c.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= movable.length) return cols
    ;[movable[i], movable[j]] = [movable[j], movable[i]]
    return [...cols.filter(c => c.id === 'person'), ...movable]
  }), [updateColumns])
  const onToggleCollapse = useCallback(key => setConfig(c => ({ ...c, collapsed: { ...c.collapsed, [key]: !c.collapsed?.[key] } })), [setConfig])
  const onCollapseAll = useCallback((keys, value) => setConfig(c => ({ ...c, collapsed: Object.fromEntries(keys.map(k => [k, value])) })), [setConfig])
  const onMoveGroup = useCallback((keys, key, delta) => setConfig(c => ({ ...c, groupOrder: moveGroup(keys, key, delta) })), [setConfig])
  const onGroupByChange = useCallback(groupBy => setConfig(c => ({ ...c, groupBy, groupOrder: [], collapsed: groupBy === 'stage' ? { ganho: true, perdido: true } : {} })), [setConfig])
  const onFiltersChange = useCallback(filters => setConfig(c => ({ ...c, filters })), [setConfig])
  const onSortChange = useCallback(sort => setConfig(c => ({ ...c, sort })), [setConfig])

  // ----- seleção (edição em massa) -----
  // Só conta o que está VISÍVEL na tabela: filtrar depois de selecionar nunca altera registro escondido.
  const [selected, setSelected] = useState(() => new Set())
  const lastPickRef = useRef(null)
  const visibleIds = useMemo(() => groups.flatMap(g => (config.collapsed?.[g.key] ? [] : g.rows.map(o => o.id))), [groups, config.collapsed])
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds])
  const effectiveSelected = useMemo(() => new Set([...selected].filter(id => visibleSet.has(id))), [selected, visibleSet])
  const selectedOpps = useMemo(() => ws.opps.filter(o => effectiveSelected.has(o.id)), [ws.opps, effectiveSelected])
  const visibleIdsRef = useRef(visibleIds)
  visibleIdsRef.current = visibleIds

  const onToggleSelect = useCallback((id, shift) => {
    setSelected(prev => {
      const next = new Set(prev)
      const ids = visibleIdsRef.current
      const from = lastPickRef.current ? ids.indexOf(lastPickRef.current) : -1
      const to = ids.indexOf(id)
      if (shift && from >= 0 && to >= 0) {
        // Shift+clique: aplica o estado do item de origem a todo o intervalo (como no Monday).
        const value = prev.has(lastPickRef.current)
        for (const x of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) value ? next.add(x) : next.delete(x)
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    lastPickRef.current = id
  }, [])
  const onSetSelected = useCallback((ids, checked) => setSelected(prev => {
    const next = new Set(prev)
    for (const id of ids) checked ? next.add(id) : next.delete(id)
    return next
  }), [])
  const clearSelection = useCallback(() => { setSelected(new Set()); lastPickRef.current = null }, [])
  // Esc limpa a seleção (os popovers tratam o próprio Esc antes, na fase de captura).
  useEffect(() => {
    if (!effectiveSelected.size) return
    function onKey(e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (e.target.closest?.('input, textarea, select, [role="dialog"]')) return
      clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [effectiveSelected.size, clearSelection])

  const tagSuggestions = useMemo(() => {
    const count = new Map()
    for (const o of ws.opps) for (const t of o.tags || []) count.set(t, (count.get(t) || 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [ws.opps])

  function report(res, okText, { failedText = 'não foram alteradas (sem permissão ou erro)' } = {}) {
    if (res.error) { toast(res.error, 'error'); return false }
    const failed = res.failed || 0
    if (failed) toast(`${okText} ${failed} ${failedText}.`, 'warning', 5000)
    else toast(okText, 'success')
    return true
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

  const bulkActions = useMemo(() => ({
    moveStage: async (ids, stage, onProgress) => {
      const res = await ws.bulkMoveStage(ids, stage, onProgress)
      const label = ws.stagesByKey[stage]?.label || stage
      if (res.failed) toast(`${plural(res.moved, 'movida', 'movidas')} para ${label}; ${res.failed} não puderam ser movidas.`, 'warning', 5000)
      else toast(`${plural(res.moved, 'oportunidade movida', 'oportunidades movidas')} para ${label}.`, 'success')
    },
    setResponsible: async (ids, userId) => {
      const res = await ws.bulkPatch(ids, { responsible_user_id: userId })
      report(res, `Responsável atualizado em ${plural(res.count || 0, 'oportunidade', 'oportunidades')}.`)
    },
    setDue: async (ids, date) => {
      const res = await ws.bulkPatch(ids, { next_action_due: date })
      report(res, date ? `Prazo definido em ${plural(res.count || 0, 'oportunidade', 'oportunidades')}.` : `Prazo removido de ${plural(res.count || 0, 'oportunidade', 'oportunidades')}.`)
    },
    addTags: async (ids, tags) => {
      const res = await ws.bulkAddTags(ids, tags)
      report(res, `Tags adicionadas em ${plural(res.count || 0, 'oportunidade', 'oportunidades')}.`)
    },
    archive: async (ids) => {
      const res = await ws.archive(ids)
      if (report(res, `${plural(res.count || 0, 'oportunidade arquivada', 'oportunidades arquivadas')}.`)) clearSelection()
    },
    restore: async (ids) => {
      const res = await ws.restore(ids)
      if (report(res, `${plural(res.count || 0, 'oportunidade restaurada', 'oportunidades restauradas')}.`)) clearSelection()
    },
  }), [ws, toast, clearSelection]) // eslint-disable-line react-hooks/exhaustive-deps

  // ----- editor / criação -----
  const [editor, setEditor] = useState({ open: false, opp: null, tab: 'dados' })
  const [leadOpen, setLeadOpen] = useState(false)
  const onOpenOpp = useCallback((opp, initialTab = 'dados') => setEditor({ open: true, opp, tab: initialTab }), [])

  // Ações do menu contextual da linha (uma oportunidade).
  const rowActions = useMemo(() => ({
    open: opp => onOpenOpp(opp),
    duplicate: async opp => {
      const res = await ws.duplicate(opp)
      if (res.error) toast(res.error, 'error')
      else toast('Oportunidade duplicada.', 'success')
    },
    moveStage: async (opp, stage) => {
      const res = await ws.moveStage(opp.id, stage)
      if (res.error) toast(res.error, 'error')
    },
    setResponsible: async (opp, userId) => {
      const res = await ws.updateOpp(opp.id, { responsible_user_id: userId })
      if (res.error) toast('Não foi possível salvar. A alteração foi desfeita.', 'error')
    },
    archive: async opp => {
      const res = await ws.archive([opp.id])
      if (res.error) toast(res.error, 'error')
      else toast('Oportunidade arquivada. Para ver ou restaurar: Filtro → Situação → Arquivadas.', 'success', 4500)
    },
    restore: async opp => {
      const res = await ws.restore([opp.id])
      if (res.error) toast(res.error, 'error')
      else toast('Oportunidade restaurada.', 'success')
    },
  }), [ws, toast, onOpenOpp])

  // ----- campos personalizados -----
  const [fieldEditor, setFieldEditor] = useState({ open: false, field: null })
  async function saveField(draft) {
    if (fieldEditor.field?.id) {
      const res = await updateCustomField(fieldEditor.field.id, draft)
      if (res.error) return res
      ws.setCustomFields(list => list.map(f => (f.id === res.field.id ? res.field : f)))
      toast('Coluna atualizada.', 'success')
      return res
    }
    const position = ws.customFields.reduce((m, f) => Math.max(m, Number(f.position) || 0), 0) + 1
    const res = await createCustomField(effectiveOwner, draft, position)
    if (res.error) return res
    ws.setCustomFields(list => [...list, res.field])
    toast('Coluna criada.', 'success')
    return res
  }
  async function archiveField(field) {
    const res = await archiveCustomField(field.id)
    if (res.error) return res
    ws.setCustomFields(list => list.filter(f => f.id !== field.id))
    toast('Coluna removida da tabela. Os valores continuam guardados.', 'success')
    return res
  }

  // ----- etapas -----
  const [stagesOpen, setStagesOpen] = useState(false)
  async function saveStages(rows) {
    const res = await saveStageSettings(effectiveOwner, rows)
    if (res.error) return res
    ws.setStageSettings(res.settings)
    toast('Etapas atualizadas.', 'success')
    return res
  }

  // ----- visualizações salvas -----
  const [viewModal, setViewModal] = useState({ open: false, mode: 'new', view: null })
  async function submitView({ name, scope }) {
    if (viewModal.mode === 'rename') {
      const res = await updateView(viewModal.view.id, { name })
      if (res.error) return res
      ws.setViews(list => list.map(v => (v.id === res.view.id ? res.view : v)))
      return res
    }
    const position = ws.views.reduce((m, v) => Math.max(m, Number(v.position) || 0), 0) + 1
    const res = await createView(effectiveOwner, { name, scope, config, position })
    if (res.error) return res
    ws.setViews(list => [...list, res.view])
    if (activeView) setViewDrafts(d => { const n = { ...d }; delete n[activeView.id]; return n })
    goTab(`v-${res.view.id}`)
    toast('Visualização salva.', 'success')
    return res
  }
  async function saveActiveView() {
    if (!activeView) return
    const res = await updateView(activeView.id, { config })
    if (res.error) { toast(res.error, 'error'); return }
    ws.setViews(list => list.map(v => (v.id === res.view.id ? res.view : v)))
    setViewDrafts(d => { const n = { ...d }; delete n[activeView.id]; return n })
    toast('Visualização atualizada.', 'success')
  }
  async function removeView(view) {
    const res = await deleteView(view.id)
    if (res.error) { toast(res.error, 'error'); return }
    ws.setViews(list => list.filter(v => v.id !== view.id))
    if (tab === `v-${view.id}`) goTab(MAIN_KEY)
    toast('Visualização excluída.', 'success')
  }

  const columnsMenu = useMemo(() => ({
    columns, canManage, fieldsAvailable: ws.features.fields,
    onToggleHidden, onMoveColumn, onSetWidth: onResizeColumn,
    onNewField: () => setFieldEditor({ open: true, field: null }),
    onEditField: field => setFieldEditor({ open: true, field }),
  }), [columns, canManage, ws.features.fields, onToggleHidden, onMoveColumn, onResizeColumn])

  if (ws.loading) return <LoadingState />
  if (ws.error) {
    return (
      <div role="alert" style={{ padding: 24, color: C.red, fontSize: 14 }}>
        Erro ao carregar o CRM: {ws.error}
        <div style={{ marginTop: 12 }}><Btn variant="ghost" onClick={ws.reload}>Tentar novamente</Btn></div>
      </div>
    )
  }

  const isTable = tab === MAIN_KEY || isSavedView
  const isKanban = tab === 'kanban'
  const isIndicators = tab === 'indicators'
  const showToolbar = isTable || isKanban

  const saveSlot = isTable && (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {viewDirty && canEditView(activeView) && <Btn onClick={saveActiveView} style={{ padding: '7px 12px', fontSize: 12.5 }}>Salvar alterações</Btn>}
      {viewDirty && <Btn variant="ghost" onClick={() => setViewDrafts(d => { const n = { ...d }; delete n[activeView.id]; return n })} style={{ padding: '7px 12px', fontSize: 12.5 }}>Descartar</Btn>}
    </div>
  )

  return (
    <div data-testid="crm-workspace">
      <ViewTabs tab={tab} onTab={goTab} views={ws.views} viewsAvailable={ws.features.views} canEditView={canEditView}
        onNewView={() => setViewModal({ open: true, mode: 'new', view: null })}
        onRenameView={view => setViewModal({ open: true, mode: 'rename', view })}
        onDeleteView={removeView} />

      {!ws.features.schema && canManage && (
        <div style={{ margin: '10px 0 0', padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.yellow}55`, background: C.yellow + '14', color: C.textSub, fontSize: 12.5 }}>
          Procedimento, probabilidade, próxima ação, prazo e colunas personalizadas aparecem depois que a atualização do banco do CRM
          (<code>crm_workspace_phase1.sql</code>) for aplicada. O restante já funciona normalmente.
        </div>
      )}

      {showToolbar && (
        <CrmToolbar filters={config.filters} onFiltersChange={onFiltersChange} columns={columns} onToggleHidden={onToggleHidden}
          sort={config.sort} onSortChange={onSortChange} groupBy={config.groupBy} onGroupByChange={onGroupByChange}
          tableControls={isTable} members={ws.members} memberLabel={ws.memberLabel} stages={ws.stages}
          procedureOptions={procedureOptions} sourceOptions={sourceOptions}
          onNewLead={() => setLeadOpen(true)} onNewOpportunity={() => setEditor({ open: true, opp: null, tab: 'dados' })}
          schemaReady={ws.features.schema} lastContactAvailable={ws.features.lastContact} rightSlot={saveSlot} />
      )}

      {isTable && (
        ws.opps.length === 0 ? (
          <EmptyState onNewLead={() => setLeadOpen(true)} />
        ) : (
          <>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 2px', fontSize: 13, color: C.textSub }}>Nenhuma oportunidade corresponde aos filtros.</div>
            )}
            <CrmTable groups={groups} columns={columns} ctx={ctx} ws={ws} ownerId={effectiveOwner} canManage={canManage}
              groupBy={config.groupBy} sort={config.sort} collapsed={config.collapsed} toast={toast}
              procedureOptions={procedureOptions} sourceOptions={sourceOptions}
              onToggleCollapse={onToggleCollapse} onCollapseAll={onCollapseAll} onSort={onSort}
              onResizeColumn={onResizeColumn} onReorderColumn={onReorderColumn} onHideColumn={onHideColumn}
              onMoveGroup={onMoveGroup} onConfigureStages={ws.features.stages ? () => setStagesOpen(true) : null}
              onOpenOpp={onOpenOpp} columnsMenu={columnsMenu}
              selectedIds={effectiveSelected} onToggleSelect={onToggleSelect} onSetSelected={onSetSelected}
              rowActions={rowActions} userId={user?.id} />
          </>
        )
      )}

      {isTable && selectedOpps.length > 0 && (
        <CrmBulkBar selected={selectedOpps} stages={ws.stages} members={ws.members} memberLabel={ws.memberLabel}
          tagSuggestions={tagSuggestions} onClear={clearSelection} actions={bulkActions} />
      )}

      {isKanban && (
        <OpportunityPipeline ws={ws} opps={kanbanOpps} ownerId={effectiveOwner} procedureName={procedureName}
          onEdit={opp => onOpenOpp(opp)} onError={msg => toast(msg, 'error')} />
      )}

      {isIndicators && <CrmDashboard />}

      <OpportunityEditor open={editor.open} onClose={() => setEditor(e => ({ ...e, open: false }))} opp={editor.opp} initialTab={editor.tab}
        stages={ws.stages} members={ws.members} ownerId={effectiveOwner} userId={user?.id} onSaved={ws.onEditorSaved}
        onTasksChanged={ws.syncTask} />
      <NewLeadModal open={leadOpen} onClose={() => setLeadOpen(false)} ownerId={effectiveOwner} members={ws.members}
        stage="primeiro_contato" onCreated={opp => { ws.addOpp(opp); setLeadOpen(false) }} />
      <CrmFieldEditor open={fieldEditor.open} field={fieldEditor.field} onClose={() => setFieldEditor({ open: false, field: null })}
        onSave={saveField} onArchive={archiveField} />
      <CrmStageSettings open={stagesOpen} stages={ws.stages} onClose={() => setStagesOpen(false)} onSave={saveStages} />
      <ViewModal state={viewModal} canShare={canManage} onClose={() => setViewModal({ open: false, mode: 'new', view: null })} onSubmit={submitView} />
    </div>
  )
}

function ViewTabs({ tab, onTab, views, viewsAvailable, canEditView, onNewView, onRenameView, onDeleteView }) {
  const tabs = [
    { key: MAIN_KEY, label: 'Tabela' },
    ...views.map(v => ({ key: `v-${v.id}`, label: v.name, view: v })),
    { key: 'kanban', label: 'Kanban' },
    { key: 'agenda', label: 'Agenda', disabled: true, hint: 'Disponível na Fase 2' },
    { key: 'indicators', label: 'Indicadores' },
  ]
  return (
    <div role="tablist" aria-label="Visualizações do CRM" style={{ display: 'flex', alignItems: 'flex-end', gap: 2, borderBottom: `1px solid ${C.border}`, overflowX: 'auto' }}>
      {tabs.map(t => <TabButton key={t.key} t={t} active={tab === t.key} onTab={onTab} canEdit={t.view && canEditView(t.view)} onRename={onRenameView} onDelete={onDeleteView} />)}
      {viewsAvailable && (
        <button type="button" onClick={onNewView} data-testid="crm-new-view"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', border: 'none', background: 'transparent', color: C.textSub, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          <Ico d={ICONS.plus} size={13} />Nova visualização
        </button>
      )}
    </div>
  )
}

function TabButton({ t, active, onTab, canEdit, onRename, onDelete }) {
  const ref = useRef(null)
  const [menu, setMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'center', borderBottom: `2px solid ${active ? C.accent : 'transparent'}`, marginBottom: -1 }}>
      <button type="button" role="tab" aria-selected={active} disabled={t.disabled} title={t.hint || (t.view ? (t.view.scope === 'shared' ? 'Visualização compartilhada' : 'Visualização pessoal') : undefined)}
        onClick={() => !t.disabled && onTab(t.key)}
        style={{ padding: '9px 12px', border: 'none', background: 'transparent', color: active ? C.text : t.disabled ? C.textDim : C.textSub, fontSize: 13.5, fontWeight: active ? 700 : 600, cursor: t.disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
        {t.label}
        {t.view?.scope === 'shared' && <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, background: C.accent + '1a', borderRadius: 6, padding: '1px 5px' }}>equipe</span>}
        {t.disabled && <span style={{ fontSize: 10, fontWeight: 700, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0 5px' }}>em breve</span>}
      </button>
      {canEdit && active && <>
        <button ref={ref} type="button" aria-label={`Opções da visualização ${t.label}`} onClick={() => { setConfirmDelete(false); setMenu(m => !m) }}
          style={{ border: 'none', background: 'transparent', color: C.textDim, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: '2px 4px' }}>
          <Ico d={ICONS.dots} size={14} />
        </button>
        <Popover anchorRef={ref} open={menu} onClose={() => setMenu(false)} width={210} label="Opções da visualização">
          <MenuItem onClick={() => { setMenu(false); onRename(t.view) }}>Renomear</MenuItem>
          {!confirmDelete
            ? <MenuItem danger onClick={() => setConfirmDelete(true)}>Excluir visualização</MenuItem>
            : <MenuItem danger onClick={() => { setMenu(false); onDelete(t.view) }}>Confirmar exclusão</MenuItem>}
          <div style={{ fontSize: 11, color: C.textDim, padding: '4px 9px' }}>Excluir a visualização não apaga nenhuma oportunidade.</div>
        </Popover>
      </>}
    </div>
  )
}

function ViewModal({ state, canShare, onClose, onSubmit }) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState('personal')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!state.open) return
    setName(state.view?.name || ''); setScope(state.view?.scope || 'personal'); setError(null); setSaving(false)
  }, [state.open, state.view])
  async function submit() {
    const n = name.trim()
    if (!n) { setError('Dê um nome para a visualização.'); return }
    setSaving(true); setError(null)
    const res = await onSubmit({ name: n.slice(0, 60), scope })
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    onClose()
  }
  const rename = state.mode === 'rename'
  return (
    <Modal open={state.open} onClose={onClose} title={rename ? 'Renomear visualização' : 'Nova visualização'} width={440} trackDirty={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!rename && <p style={{ margin: 0, fontSize: 12.5, color: C.textSub, lineHeight: 1.5 }}>Salva as colunas, larguras, filtros, ordenação e agrupamento que estão na tela agora.</p>}
        <div>
          <label htmlFor="crm-view-name" style={base.label}>Nome</label>
          <input id="crm-view-name" autoFocus value={name} maxLength={60} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }} placeholder="Ex.: Orçamentos da semana" style={{ ...base.input, fontSize: 13 }} />
        </div>
        {!rename && (
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={base.label}>Quem vê</legend>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.text, marginBottom: 6, cursor: 'pointer' }}>
              <input type="radio" name="crm-view-scope" checked={scope === 'personal'} onChange={() => setScope('personal')} style={{ accentColor: C.accent }} />Só eu (pessoal)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: canShare ? C.text : C.textDim, cursor: canShare ? 'pointer' : 'not-allowed' }}>
              <input type="radio" name="crm-view-scope" disabled={!canShare} checked={scope === 'shared'} onChange={() => setScope('shared')} style={{ accentColor: C.accent }} />
              Toda a equipe (compartilhada){!canShare && ' — somente Administrador e Gestão'}
            </label>
          </fieldset>
        )}
        {error && <div role="alert" style={{ color: C.red, fontSize: 12.5 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={submit} disabled={saving}>{saving ? 'Salvando…' : rename ? 'Renomear' : 'Salvar visualização'}</Btn>
        </div>
      </div>
    </Modal>
  )
}

function EmptyState({ onNewLead }) {
  return (
    <div style={{ padding: '48px 16px', textAlign: 'center', color: C.textSub, fontSize: 14, border: `1px dashed ${C.border}`, borderRadius: 12, marginTop: 8 }}>
      Nenhuma oportunidade ainda.
      <div style={{ marginTop: 12 }}><Btn onClick={onNewLead}>Criar a primeira oportunidade</Btn></div>
    </div>
  )
}

function LoadingState() {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 16 }}>
      {[0, 1, 2, 3, 4, 5].map(i => <div key={i} style={{ height: i === 0 ? 30 : 38, borderRadius: 8, background: C.border, opacity: 0.35 }} />)}
    </div>
  )
}
