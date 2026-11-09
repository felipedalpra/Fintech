// Painel lateral da tarefa (estilo Monday): abre por cima do Kanban/Tabela sem sair da página.
// Título e descrição editáveis, status (coluna), prioridade, responsável, prazo, categoria,
// vínculo com paciente/oportunidade, subtarefas (checklist), comentários e histórico.
// Comentários reutilizam o mesmo fio das Atualizações do CRM (UpdatesThread).
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { C } from '../theme.js'
import { Ico, ICONS } from './CrmCells.jsx'
import { UpdatesThread } from './UpdatesThread.jsx'
import { DuePill, OutcomeButton, WhatsAppLink, textOnColor } from './TaskBits.jsx'
import {
  loadChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem, loadTaskComments, addTaskComment, loadTaskHistory,
} from '../lib/taskWorkspaceStore.js'
import {
  PRIORITIES, CATEGORIES, stageOf, isTaskDone, taskPersonName, taskOpportunityTitle, checklistProgress, describeHistory,
} from '../lib/taskWorkspace.js'
import { TASK_OUTCOME_LABEL } from '../lib/taskQueue.js'

function fmtWhen(at) {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function TaskDrawer({ task, ws, ownerId, userId, today, actions, onClose, toast, initialTab = 'subtasks' }) {
  const [tab, setTab] = useState(initialTab)
  const panelRef = useRef(null)
  useEffect(() => { setTab(initialTab) }, [task?.id, initialTab])
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (e.target.closest?.('[role="dialog"]:not([data-task-drawer])')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!task || typeof document === 'undefined') return null

  const stage = stageOf(task, ws.stageIndex)
  const person = taskPersonName(task)
  const opp = taskOpportunityTitle(task)
  const done = isTaskDone(task)
  const field = { fontSize: 12.5, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' }
  const label = { fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.05em', alignSelf: 'center' }
  const tabBtn = active => ({ padding: '7px 12px', border: 'none', borderBottom: `2px solid ${active ? C.accent : 'transparent'}`, background: 'transparent', color: active ? C.text : C.textSub, fontSize: 13, fontWeight: active ? 800 : 600, cursor: 'pointer', fontFamily: 'inherit' })
  const notReady = !ws.ready

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)', animation: 'fadeIn .15s' }} />
      <aside ref={panelRef} role="dialog" aria-label={`Tarefa ${task.title}`} data-task-drawer data-testid="task-drawer"
        style={{ position: 'relative', width: 'min(560px, 100vw)', height: '100%', background: C.bg || C.card, borderLeft: `1px solid ${C.border}`, boxShadow: '-20px 0 50px -20px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', animation: 'slideInRight .18s ease-out' }}>
        <style>{'@keyframes slideInRight{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}'}</style>
        <div style={{ padding: '14px 18px 10px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <button type="button" aria-label={done ? 'Reabrir' : 'Concluir'} onClick={() => actions.toggle(task)}
              style={{ width: 22, height: 22, marginTop: 4, borderRadius: '50%', border: `2px solid ${done ? (C.green || '#00c875') : (C.borderBright || C.border)}`, background: done ? (C.green || '#00c875') : 'transparent', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0, flexShrink: 0 }}>
              {done && <Ico d={ICONS.check} size={12} sw={3.4} />}
            </button>
            <EditableTitle key={task.id} value={task.title} onSave={v => actions.patch(task, { title: v })} />
            <button type="button" aria-label="Fechar painel" data-testid="task-drawer-close" onClick={onClose}
              style={{ border: 'none', background: 'transparent', color: C.textSub, cursor: 'pointer', padding: 4, display: 'grid', placeItems: 'center' }}>
              <Ico d={ICONS.x} size={18} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {stage && <span style={{ fontSize: 11.5, fontWeight: 800, padding: '3px 9px', borderRadius: 6, background: stage.color, color: textOnColor(stage.color) }}>{stage.label}</span>}
            <DuePill task={task} today={today} />
            <span style={{ flex: 1 }} />
            <WhatsAppLink task={task} />
            <OutcomeButton task={task} onOutcome={actions.outcome} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px 10px' }}>
            <span style={label}>Status</span>
            <select aria-label="Status" data-testid="task-drawer-stage" value={stage?.id || ''} onChange={e => actions.setStage(task, e.target.value)} style={field}>
              {ws.stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <span style={label}>Prioridade</span>
            <select aria-label="Prioridade" data-testid="task-drawer-priority" value={task.priority || ''} disabled={notReady} onChange={e => actions.patch(task, { priority: e.target.value || null })} style={field}>
              <option value="">Sem prioridade</option>
              {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <span style={label}>Responsável</span>
            <select aria-label="Responsável" data-testid="task-drawer-responsible" value={task.assigned_user_id || ''} onChange={e => actions.patch(task, { assigned_user_id: e.target.value || null })} style={field}>
              <option value="">Sem responsável</option>
              {ws.members.map(m => <option key={m.user_id} value={m.user_id}>{ws.memberLabel[m.user_id]}</option>)}
            </select>
            <span style={label}>Prazo</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 6 }}>
              <input type="date" aria-label="Prazo" data-testid="task-drawer-due" defaultValue={task.due_date ? String(task.due_date).slice(0, 10) : ''} key={`d-${task.id}-${task.due_date}`}
                onBlur={e => { const v = e.target.value || null; if (v !== (task.due_date ? String(task.due_date).slice(0, 10) : null)) actions.patch(task, { due_date: v }) }} style={{ ...field, colorScheme: 'inherit' }} />
              <input type="time" aria-label="Hora" defaultValue={task.due_time ? String(task.due_time).slice(0, 5) : ''} key={`h-${task.id}-${task.due_time}`}
                onBlur={e => { const v = e.target.value || null; if (v !== (task.due_time ? String(task.due_time).slice(0, 5) : null)) actions.patch(task, { due_time: v }) }} style={{ ...field, colorScheme: 'inherit' }} />
            </div>
            <span style={label}>Categoria</span>
            <select aria-label="Categoria" value={task.task_type || 'outro'} onChange={e => actions.patch(task, { task_type: e.target.value })} style={field}>
              {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <span style={label}>Vínculo</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12.5, color: C.text, minHeight: 30 }}>
              {person && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ico d={ICONS.user} size={12} />{person}</span>}
              {task.opportunity_id && (
                <Link to={`/app/funnel?opp=${task.opportunity_id}&tab=atualizacoes`} onClick={onClose}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: C.purple || '#a25ddc', fontWeight: 700, textDecoration: 'none' }}>
                  <Ico d={ICONS.open} size={11} />{opp || 'Oportunidade'} no CRM
                </Link>
              )}
              {!person && !task.opportunity_id && <span style={{ color: C.textDim }}>Tarefa avulsa</span>}
            </div>
            {task.outcome && <>
              <span style={label}>Desfecho</span>
              <span style={{ fontSize: 12.5, color: C.text, alignSelf: 'center' }}>{TASK_OUTCOME_LABEL[task.outcome] || task.outcome}</span>
            </>}
          </div>

          <div>
            <div style={{ ...label, marginBottom: 6 }}>Descrição</div>
            <EditableDescription key={task.id} value={task.description || ''} disabled={notReady}
              onSave={v => actions.patch(task, { description: v })} />
          </div>

          {notReady && (
            <div style={{ fontSize: 12, color: C.textSub, padding: '8px 10px', borderRadius: 8, background: C.yellow + '14', border: `1px solid ${C.yellow}55` }}>
              Prioridade, descrição, subtarefas, comentários e histórico ficam disponíveis depois que a atualização do banco de Tarefas (<code>tasks_workspace_phase4.sql</code>) for aplicada.
            </div>
          )}

          <div>
            <div role="tablist" aria-label="Detalhes da tarefa" style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${C.border}`, marginBottom: 12 }}>
              <button type="button" role="tab" aria-selected={tab === 'subtasks'} style={tabBtn(tab === 'subtasks')} onClick={() => setTab('subtasks')}>Subtarefas</button>
              <button type="button" role="tab" aria-selected={tab === 'comments'} data-testid="task-tab-comments" style={tabBtn(tab === 'comments')} onClick={() => setTab('comments')}>Comentários</button>
              <button type="button" role="tab" aria-selected={tab === 'history'} data-testid="task-tab-history" style={tabBtn(tab === 'history')} onClick={() => setTab('history')}>Histórico</button>
            </div>
            {tab === 'subtasks' && <Checklist key={task.id} task={task} ownerId={ownerId} ws={ws} disabled={notReady} toast={toast} />}
            {tab === 'comments' && (
              <UpdatesThread threadKey={task.id} testId="task-comments" members={ws.members}
                load={() => loadTaskComments(task.id)}
                save={(text, opts) => addTaskComment(ownerId, task.id, text, userId, opts)}
                realtime={{ key: 'task-comments', table: 'task_comments', filter: `task_id=eq.${task.id}` }}
                placeholder="Escreva um comentário… use @ para mencionar alguém da equipe"
                emptyText="Nenhum comentário ainda."
                unavailableText="Comentários ficam disponíveis depois da atualização do banco de Tarefas (tasks_workspace_phase4.sql)." />
            )}
            {tab === 'history' && <History key={task.id} task={task} ws={ws} />}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function EditableTitle({ value, onSave }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  function commit() {
    const v = draft.trim()
    if (!v) { setDraft(value); return }
    if (v !== value) onSave(v)
  }
  return (
    <textarea aria-label="Título da tarefa" data-testid="task-drawer-title" value={draft} rows={1}
      onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(value); e.currentTarget.blur() } }}
      style={{ flex: 1, resize: 'none', border: '1px solid transparent', borderRadius: 8, background: 'transparent', color: C.text, fontSize: 18, fontWeight: 800, lineHeight: 1.3, fontFamily: 'inherit', padding: '2px 6px', outline: 'none', fieldSizing: 'content', minHeight: 30 }}
      onFocus={e => { e.currentTarget.style.borderColor = C.accent }} />
  )
}

function EditableDescription({ value, onSave, disabled }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <textarea aria-label="Descrição" data-testid="task-drawer-description" value={draft} disabled={disabled} rows={3} maxLength={5000}
      placeholder={disabled ? '' : 'Adicione detalhes, combinados com o paciente, documentos necessários…'}
      onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft.trim() !== (value || '').trim()) onSave(draft) }}
      style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 70, border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, color: C.text, fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', padding: '8px 10px', outline: 'none' }} />
  )
}

function Checklist({ task, ownerId, ws, disabled, toast }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const progress = useMemo(() => checklistProgress(items), [items])

  useEffect(() => {
    if (disabled) { setLoading(false); return undefined }
    let mounted = true
    loadChecklist(task.id).then(res => { if (mounted) { setItems(res.items); setError(res.error || null); setLoading(false) } })
    return () => { mounted = false }
  }, [task.id, disabled])

  // O contador do card/linha acompanha.
  const syncCount = list => ws.setChecklistCount(task.id, checklistProgress(list))

  async function add() {
    const t = draft.trim()
    if (!t) return
    const position = items.reduce((m, i) => Math.max(m, i.position || 0), 0) + 1
    const res = await addChecklistItem(ownerId, task.id, t, position)
    if (res.error) { toast(res.error, 'error'); return }
    const next = [...items, res.item]
    setItems(next); syncCount(next); setDraft('')
  }
  async function toggle(item) {
    const next = items.map(i => (i.id === item.id ? { ...i, done: !i.done } : i))
    setItems(next); syncCount(next)
    const res = await updateChecklistItem(item.id, { done: !item.done })
    if (res.error) { setItems(items); syncCount(items); toast(res.error, 'error') }
  }
  async function remove(item) {
    const next = items.filter(i => i.id !== item.id)
    setItems(next); syncCount(next)
    const res = await deleteChecklistItem(item.id)
    if (res.error) { setItems(items); syncCount(items); toast(res.error, 'error') }
  }
  async function rename(item, title) {
    const t = title.trim()
    if (!t || t === item.title) return
    const res = await updateChecklistItem(item.id, { title: t })
    if (res.error) { toast(res.error, 'error'); return }
    setItems(list => list.map(i => (i.id === item.id ? res.item : i)))
  }

  if (disabled) return <div style={{ fontSize: 12.5, color: C.textDim }}>Subtarefas indisponíveis até a atualização do banco.</div>
  if (loading) return <div style={{ fontSize: 12.5, color: C.textSub }}>Carregando…</div>
  return (
    <div data-testid="task-checklist" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {progress && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ flex: 1, height: 6, borderRadius: 3, background: C.border, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${(progress.done / progress.total) * 100}%`, background: C.green || '#00c875', transition: 'width .2s' }} />
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.textSub, fontVariantNumeric: 'tabular-nums' }}>{progress.done}/{progress.total}</span>
        </div>
      )}
      {error && <div role="alert" style={{ color: C.red, fontSize: 12 }}>{error}</div>}
      {items.map(item => (
        <div key={item.id} data-testid="task-checklist-item" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 7, background: C.surface, border: `1px solid ${C.border}` }}>
          <input type="checkbox" checked={item.done} aria-label={`Concluir ${item.title}`} onChange={() => toggle(item)} style={{ accentColor: C.green || '#00c875', cursor: 'pointer' }} />
          <input defaultValue={item.title} aria-label="Subtarefa" onBlur={e => rename(item, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: item.done ? C.textSub : C.text, textDecoration: item.done ? 'line-through' : 'none', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          <button type="button" aria-label={`Remover ${item.title}`} onClick={() => remove(item)}
            style={{ border: 'none', background: 'transparent', color: C.textDim, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 2 }}>
            <Ico d={ICONS.x} size={13} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={draft} placeholder="+ Adicionar subtarefa" aria-label="Nova subtarefa" data-testid="task-checklist-new"
          onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
          style={{ flex: 1, fontSize: 13, padding: '7px 9px', borderRadius: 8, border: `1px dashed ${C.borderBright || C.border}`, background: 'transparent', color: C.text, fontFamily: 'inherit', outline: 'none' }} />
        <button type="button" onClick={add} disabled={!draft.trim()}
          style={{ border: 'none', background: C.accent, color: '#fff', borderRadius: 8, padding: '0 12px', fontSize: 12.5, fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'not-allowed', opacity: draft.trim() ? 1 : 0.5, fontFamily: 'inherit' }}>
          Adicionar
        </button>
      </div>
    </div>
  )
}

function History({ task, ws }) {
  const [rows, setRows] = useState(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let mounted = true
    loadTaskHistory(task.id).then(res => { if (mounted) { setRows(res.rows); setUnavailable(Boolean(res.unavailable)) } })
    return () => { mounted = false }
  }, [task.id, task.status, task.stage_id, task.priority, task.assigned_user_id, task.due_date, task.title])
  const entries = useMemo(() => describeHistory(rows || [], { stageIndex: ws.stageIndex, memberLabel: ws.memberLabel, outcomeLabel: TASK_OUTCOME_LABEL }), [rows, ws.stageIndex, ws.memberLabel])
  if (unavailable) return <div style={{ fontSize: 12.5, color: C.textDim }}>Histórico disponível depois da atualização do banco.</div>
  if (!rows) return <div style={{ fontSize: 12.5, color: C.textSub }}>Carregando…</div>
  if (!entries.length) {
    return <div style={{ fontSize: 12.5, color: C.textDim }}>Criada em {fmtWhen(task.created_at)}. Nenhuma alteração registrada desde a atualização.</div>
  }
  return (
    <ol data-testid="task-history" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map(e => (
        <li key={e.id} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: C.text }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.accent, marginTop: 6, flexShrink: 0 }} />
          <span style={{ flex: 1 }}><strong>{e.who}</strong> {e.text}<span style={{ display: 'block', fontSize: 11, color: C.textDim }}>{fmtWhen(e.at)}</span></span>
        </li>
      ))}
    </ol>
  )
}
