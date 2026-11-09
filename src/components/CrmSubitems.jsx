// Subitens da oportunidade na Tabela do CRM (estilo Monday): as TAREFAS vinculadas à oportunidade,
// abertas logo abaixo da linha. Não há sistema paralelo: cada subitem é um registro de `tasks`
// (módulo de Tarefas), e as mudanças aparecem na aba Tarefas do editor, na página Tarefas,
// no Meu Dia e no Sino.
import { useEffect, useRef, useState } from 'react'
import { C } from '../theme.js'
import { TASK_STATUSES } from '../lib/taskQueue.js'
import { Ico, ICONS, StatusCell, MemberCell, DateCell, TextCell } from './CrmCells.jsx'

const SUB_ROW_H = 34
const COLS = { check: 36, title: 300, status: 130, owner: 96, due: 124 }

export function CrmSubitems({ opp, tasks, members, memberLabel, groupColor, today, focusNew, onFocusedNew, ws, userId, toast }) {
  const list = tasks || []
  const width = COLS.check + COLS.title + COLS.status + COLS.owner + COLS.due

  async function update(task, patch, okMessage) {
    const res = await ws.updateSubitem(task.id, patch)
    if (res.error) toast(res.error, 'error')
    else if (okMessage) toast(okMessage, 'success')
  }

  return (
    <div data-testid="crm-subitems" data-opp-id={opp.id} role="group" aria-label={`Subitens de ${opp.title || 'oportunidade'}`}
      style={{ position: 'sticky', left: 0, width: 'max-content', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', padding: '4px 0 8px 34px', background: C.bg, animation: 'crmSubIn .14s ease-out' }}>
      <style>{'@keyframes crmSubIn{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}'}</style>
      <div style={{ width, maxWidth: '100%', overflowX: 'auto', border: `1px solid ${C.border}`, borderLeft: `3px solid ${groupColor}88`, borderRadius: 6, background: C.card }}>
        <div role="row" style={{ display: 'flex', height: 30, alignItems: 'center', fontSize: 11.5, fontWeight: 700, color: C.textSub, borderBottom: `1px solid ${C.border}`, minWidth: width }}>
          <span style={{ width: COLS.check, flex: `0 0 ${COLS.check}px` }} />
          <span style={{ width: COLS.title, flex: `0 0 ${COLS.title}px`, padding: '0 10px' }}>Subitem</span>
          <span style={{ width: COLS.status, flex: `0 0 ${COLS.status}px`, textAlign: 'center', borderLeft: `1px solid ${C.border}` }}>Status</span>
          <span style={{ width: COLS.owner, flex: `0 0 ${COLS.owner}px`, textAlign: 'center', borderLeft: `1px solid ${C.border}` }}>Responsável</span>
          <span style={{ width: COLS.due, flex: `0 0 ${COLS.due}px`, textAlign: 'center', borderLeft: `1px solid ${C.border}` }}>Prazo</span>
        </div>
        {list.map(t => (
          <SubitemRow key={t.id} task={t} members={members} memberLabel={memberLabel} today={today} width={width}
            onUpdate={(patch, msg) => update(t, patch, msg)} />
        ))}
        <NewSubitem opp={opp} ws={ws} userId={userId} toast={toast} width={width} autoFocus={focusNew} onFocused={onFocusedNew} />
      </div>
    </div>
  )
}

function SubitemRow({ task, members, memberLabel, today, width, onUpdate }) {
  const done = task.status === 'feita'
  const st = TASK_STATUSES.find(s => s.key === task.status) || TASK_STATUSES[0]
  const cell = w => ({ width: w, flex: `0 0 ${w}px`, height: '100%', borderLeft: `1px solid ${C.border}`, overflow: 'hidden', boxSizing: 'border-box' })
  return (
    <div role="row" data-testid="crm-subitem" data-task-id={task.id} data-status={task.status}
      style={{ display: 'flex', height: SUB_ROW_H, alignItems: 'stretch', borderBottom: `1px solid ${C.border}`, minWidth: width }}>
      <div style={{ width: COLS.check, flex: `0 0 ${COLS.check}px`, display: 'grid', placeItems: 'center' }}>
        <button type="button" role="checkbox" aria-checked={done} data-testid="crm-subitem-done"
          aria-label={done ? `Reabrir ${task.title}` : `Concluir ${task.title}`}
          onClick={() => onUpdate({ status: done ? 'pendente' : 'feita' })}
          style={{ width: 18, height: 18, borderRadius: '50%', padding: 0, cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#fff', transition: 'background .12s, border-color .12s',
            border: `2px solid ${done ? '#16a34a' : (C.borderBright || C.border)}`, background: done ? '#16a34a' : 'transparent' }}>
          {done && <Ico d={ICONS.check} size={10} sw={3.5} />}
        </button>
      </div>
      <div style={{ width: COLS.title, flex: `0 0 ${COLS.title}px`, height: '100%', overflow: 'hidden', opacity: done ? 0.6 : 1, textDecoration: done ? 'line-through' : 'none' }}>
        <TextCell value={task.title} testId="crm-subitem-title" onCommit={v => onUpdate({ title: v })} />
      </div>
      <div style={cell(COLS.status)}>
        <StatusCell testId="crm-subitem-status" label={st.label} color={st.color} value={task.status} popLabel="Status do subitem"
          options={TASK_STATUSES.map(s => ({ key: s.key, label: s.label, color: s.color }))}
          onPick={k => onUpdate({ status: k })} />
      </div>
      <div style={cell(COLS.owner)}>
        <MemberCell testId="crm-subitem-owner" value={task.assigned_user_id} members={members} memberLabel={memberLabel}
          onCommit={v => onUpdate({ assigned_user_id: v })} />
      </div>
      <div style={cell(COLS.due)}>
        <DateCell testId="crm-subitem-due" value={task.due_date} overdueBefore={done ? null : today}
          onCommit={v => onUpdate({ due_date: v })} />
      </div>
    </div>
  )
}

function NewSubitem({ opp, ws, userId, toast, width, autoFocus, onFocused }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  // "Criar tarefa" pelo menu contextual abre direto no campo.
  useEffect(() => {
    if (!autoFocus) return
    setOpen(true)
    onFocused?.()
  }, [autoFocus, onFocused])
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  async function submit() {
    const t = title.trim()
    if (!t || saving) return
    setSaving(true)
    const res = await ws.createSubitem(opp, { title: t }, userId)
    setSaving(false)
    if (res.error) { toast(res.error, 'error'); return }
    setTitle('')
    inputRef.current?.focus()
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', height: SUB_ROW_H, minWidth: width, paddingLeft: COLS.check, boxSizing: 'border-box' }}>
      {open ? (
        <input ref={inputRef} value={title} disabled={saving} data-testid="crm-subitem-new"
          aria-label={`Novo subitem de ${opp.title || 'oportunidade'}`} placeholder="Nome da tarefa e Enter"
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (!title.trim()) setOpen(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') { e.stopPropagation(); setTitle(''); setOpen(false) }
          }}
          style={{ width: COLS.title - 10, height: 26, boxSizing: 'border-box', padding: '0 8px', border: `1.5px solid ${C.accent}`, borderRadius: 6, background: C.surface, color: C.text, fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
      ) : (
        <button type="button" onClick={() => setOpen(true)} data-testid="crm-subitem-add"
          style={{ border: 'none', background: 'transparent', color: C.textSub, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Ico d={ICONS.plus} size={12} />Adicionar subitem
        </button>
      )}
    </div>
  )
}
