// Peças visuais compartilhadas pelo gerenciador de tarefas (Kanban, Tabela e painel lateral).
// Estilos SEMPRE dentro dos componentes (tema claro/escuro).
import { useRef, useState } from 'react'
import { C } from '../theme.js'
import { Ico, ICONS, Popover, MenuItem } from './CrmCells.jsx'
import { WhatsAppGlyph } from './WhatsAppGlyph.jsx'
import { TASK_OUTCOMES } from '../lib/taskQueue.js'
import { PRIORITY_BY_KEY, PRIORITIES, isTaskOverdue, isTaskDone, addDaysIso } from '../lib/taskWorkspace.js'

export function textOnColor(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return '#fff'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.68 ? '#1f2937' : '#fff'
}

// "hoje", "amanhã", "ontem", "3 dias atrás" ou data curta.
export function dueLabel(due, today) {
  if (!due) return null
  const d = String(due).slice(0, 10)
  if (d === today) return 'hoje'
  if (d === addDaysIso(today, 1)) return 'amanhã'
  if (d === addDaysIso(today, -1)) return 'ontem'
  const diff = Math.round((new Date(`${d}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
  if (diff < -1) return `${Math.abs(diff)} dias atrás`
  const [y, m, day] = d.split('-')
  return `${day}/${m}${y !== today.slice(0, 4) ? `/${y.slice(2)}` : ''}`
}

export function DuePill({ task, today, compact = false }) {
  if (!task?.due_date) return null
  const overdue = isTaskOverdue(task, today)
  const isToday = String(task.due_date).slice(0, 10) === today && !isTaskDone(task)
  const hora = String(task.due_time || '').slice(0, 5)
  const color = overdue ? (C.red || '#e2445c') : isToday ? C.accent : C.textSub
  return (
    <span data-testid="task-due" title={overdue ? 'Prazo vencido' : 'Prazo'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: compact ? 11 : 12, fontWeight: 700, padding: compact ? '2px 5px' : '3px 8px', borderRadius: 6, whiteSpace: 'nowrap', color, background: overdue ? (C.red || '#e2445c') + '1f' : isToday ? C.accent + '1a' : C.surface, border: `1px solid ${overdue ? (C.red || '#e2445c') + '55' : C.border}`, textDecoration: isTaskDone(task) ? 'line-through' : 'none' }}>
      {overdue ? <Ico d={ICONS.warn} size={11} sw={2.4} /> : <Ico d={ICONS.calendar} size={11} />}
      {dueLabel(task.due_date, today)}{hora ? ` · ${hora}` : ''}
    </span>
  )
}

export function PriorityPill({ priority, compact = false }) {
  const p = PRIORITY_BY_KEY[priority]
  if (!p) return null
  return (
    <span data-testid="task-priority" title={`Prioridade ${p.label.toLowerCase()}`}
      style={{ display: 'inline-flex', alignItems: 'center', fontSize: compact ? 10.5 : 11.5, fontWeight: 800, padding: compact ? '2px 6px' : '3px 8px', borderRadius: 6, background: p.color, color: textOnColor(p.color), whiteSpace: 'nowrap' }}>
      {p.label}
    </span>
  )
}

export function Chip({ children, color, title, testId }) {
  return (
    <span title={title} data-testid={testId}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', fontSize: 11, fontWeight: 650, padding: '2px 7px', borderRadius: 6, color: color || C.textSub, background: (color || C.textSub) + '17', border: `1px solid ${(color || C.textSub)}33`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {children}
    </span>
  )
}

export function ChecklistBadge({ progress }) {
  if (!progress?.total) return null
  const complete = progress.done === progress.total
  return (
    <span data-testid="task-checklist-progress" title="Subtarefas concluídas"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: complete ? (C.green || '#00c875') : C.textSub, fontVariantNumeric: 'tabular-nums' }}>
      <Ico d={ICONS.check} size={11} sw={2.6} />{progress.done}/{progress.total}
    </span>
  )
}

export function whatsappHref(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

export function WhatsAppLink({ task, size = 26 }) {
  const href = whatsappHref(task?.patients?.phone)
  if (!href || isTaskDone(task)) return null
  return (
    <a href={href} target="_blank" rel="noreferrer" title={`Abrir conversa com ${task.patients?.full_name || 'o paciente'}`}
      data-testid={`task-whatsapp-${task.id}`} onClick={e => e.stopPropagation()}
      style={{ width: size, height: size, borderRadius: 7, border: `1px solid ${C.border}`, color: C.green || '#10B981', display: 'grid', placeItems: 'center', textDecoration: 'none', flexShrink: 0 }}>
      <WhatsAppGlyph size={13} />
    </a>
  )
}

// Botão "Desfecho" (mesma regra de antes: o menu diz, antes do clique, o que encerra a tarefa).
export function OutcomeButton({ task, onOutcome, compact = false, iconOnly = false }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  if (isTaskDone(task) || !onOutcome) return null
  return (
    <>
      <button ref={ref} type="button" data-testid={`task-outcome-${task.id}`} title="Registrar desfecho" aria-label="Registrar desfecho"
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        style={iconOnly
          ? { width: 22, height: 22, borderRadius: 7, border: `1px solid ${C.border}`, background: open ? C.surface : 'transparent', color: C.textSub, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0, flexShrink: 0 }
          : { padding: compact ? '3px 7px' : '4px 9px', borderRadius: 7, border: `1px solid ${C.border}`, background: open ? C.surface : 'transparent', color: C.textSub, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        {iconOnly
          ? <Ico d={<><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" /><path d="m15 5 2 2 4-4" /></>} size={12} />
          : 'Desfecho'}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={210} label="Registrar desfecho" testId={`task-outcome-menu-${task.id}`}>
        {TASK_OUTCOMES.map(option => (
          <button key={option.key} type="button" onClick={e => { e.stopPropagation(); setOpen(false); onOutcome(task, option.key) }}
            style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: C.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            {option.label}
            <span style={{ fontSize: 10.5, fontWeight: 700, color: option.closes ? (C.green || '#10B981') : (C.yellow || '#F59E0B') }}>
              {option.closes ? 'encerra' : 'segue'}
            </span>
          </button>
        ))}
      </Popover>
    </>
  )
}

// Menu de ações rápidas (⋯ no card/linha e botão direito).
export function TaskActionsMenu({ task, stages, currentStageId, anchorRef, open, onClose, actions }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [sub, setSub] = useState(null)
  const close = () => { setConfirmDelete(false); setSub(null); onClose() }
  return (
    <Popover anchorRef={anchorRef} open={open} onClose={close} width={220} label="Ações da tarefa" testId="task-actions-menu">
      {!sub && <>
        <MenuItem testId="task-menu-open" onClick={() => { close(); actions.open(task) }}><Ico d={ICONS.open} size={13} />Abrir detalhes</MenuItem>
        <MenuItem testId="task-menu-toggle" onClick={() => { close(); actions.toggle(task) }}><Ico d={ICONS.check} size={13} />{isTaskDone(task) ? 'Reabrir' : 'Concluir'}</MenuItem>
        <MenuItem onClick={() => setSub('stage')}><Ico d={ICONS.chevronRight} size={13} />Mover para…</MenuItem>
        <MenuItem onClick={() => setSub('priority')}><Ico d={ICONS.tag} size={13} />Prioridade…</MenuItem>
        {!confirmDelete
          ? <MenuItem danger testId="task-menu-delete" onClick={() => setConfirmDelete(true)}><Ico d={ICONS.x} size={13} />Excluir</MenuItem>
          : <MenuItem danger testId="task-menu-delete-confirm" onClick={() => { close(); actions.remove(task) }}>Confirmar exclusão</MenuItem>}
      </>}
      {sub === 'stage' && <>
        <MenuItem onClick={() => setSub(null)}><Ico d={ICONS.arrowUp} size={12} />Voltar</MenuItem>
        {stages.map(s => (
          <MenuItem key={s.id} active={s.id === currentStageId} onClick={() => { close(); if (s.id !== currentStageId) actions.setStage(task, s.id) }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />{s.label}
          </MenuItem>
        ))}
      </>}
      {sub === 'priority' && <>
        <MenuItem onClick={() => setSub(null)}><Ico d={ICONS.arrowUp} size={12} />Voltar</MenuItem>
        {PRIORITIES.map(p => (
          <MenuItem key={p.key} active={task.priority === p.key} onClick={() => { close(); actions.setPriority(task, p.key) }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />{p.label}
          </MenuItem>
        ))}
        <MenuItem onClick={() => { close(); actions.setPriority(task, null) }}>Sem prioridade</MenuItem>
      </>}
    </Popover>
  )
}
