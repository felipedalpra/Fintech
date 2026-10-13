import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { createTask, toggleTask, deleteTask } from '../lib/taskActions.js'
import { initials, avatarColor } from '../lib/avatar.js'

function MiniAvatar({ label }) {
  return <span title={label} style={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800, color: '#fff', background: avatarColor(label), flexShrink: 0 }}>{initials(label)}</span>
}

// Aba Tarefas da oportunidade: lista + criar + concluir. Tarefas ligadas a esta oportunidade.
function overdue(due, status) {
  if (!due || status === 'feita') return false
  return new Date(due) < new Date(new Date().toDateString())
}
function fmtDue(due) {
  if (!due) return null
  try { return new Date(due + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) } catch { return due }
}

export function OpportunityTasks({ ownerId, opportunityId, patientId, members, userId }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState({ title: '', due: '', assigned: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    supabase.from('tasks')
      .select('id, title, due_date, status, assigned_user_id, done_at, created_at')
      .eq('opportunity_id', opportunityId)
      .order('status', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .then(({ data, error: err }) => {
        if (!active) return
        if (err) setError(err.message); else setTasks(data || [])
        setLoading(false)
      })
    return () => { active = false }
  }, [opportunityId])

  const memberLabel = Object.fromEntries((members || []).map(m => [m.user_id, m.member_email || m.user_id]))

  async function add() {
    if (!draft.title.trim() || saving) return
    setSaving(true); setError(null)
    const res = await createTask(ownerId, {
      title: draft.title, dueDate: draft.due || null, assignedUserId: draft.assigned || null,
      opportunityId, patientId, createdBy: userId,
    })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setTasks(t => [...t, res.task])
    setDraft({ title: '', due: '', assigned: '' })
  }

  async function toggle(task) {
    const prev = tasks
    setTasks(t => t.map(x => (x.id === task.id ? { ...x, status: x.status === 'feita' ? 'pendente' : 'feita', done_at: x.status === 'feita' ? null : new Date().toISOString() } : x)))
    const res = await toggleTask(task)
    if (res.error) { setTasks(prev); setError(res.error) }
  }

  async function remove(task) {
    const prev = tasks
    setTasks(t => t.filter(x => x.id !== task.id))
    const res = await deleteTask(task.id)
    if (res.error) { setTasks(prev); setError(res.error) }
  }

  const s = {
    row: done => ({ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 11, border: `1px solid ${C.border}`, background: C.surface, marginBottom: 8, opacity: done ? 0.6 : 1 }),
    title: done => ({ flex: 1, fontSize: 13.5, fontWeight: 500, color: done ? C.textSub : C.text, textDecoration: done ? 'line-through' : 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
    due: late => ({ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 7, whiteSpace: 'nowrap', color: late ? (C.red || '#ef4444') : C.textSub, background: late ? (C.red || '#ef4444') + '22' : C.card }),
    check: done => ({ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${done ? (C.green || '#10B981') : (C.borderBright || C.border)}`, background: done ? (C.green || '#10B981') : 'transparent', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0, padding: 0 }),
    del: { background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 },
    form: { display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center', marginTop: 12 },
    input: { ...base.input, fontSize: 13 },
    btn: { padding: '8px 14px', borderRadius: 8, background: C.accent, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily: 'inherit' },
  }

  if (loading) return <div style={{ color: C.textSub, fontSize: 13, padding: 20, textAlign: 'center' }}>Carregando tarefas…</div>

  return (
    <div>
      {error && <div style={{ color: C.red || '#ef4444', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {tasks.length === 0
        ? <div style={{ color: C.textDim, fontSize: 13, padding: '16px 0' }}>Nenhuma tarefa ainda.</div>
        : tasks.map(t => {
            const done = t.status === 'feita'
            const late = overdue(t.due_date, t.status)
            return (
              <div key={t.id} style={s.row(done)}>
                <button type="button" style={s.check(done)} onClick={() => toggle(t)} aria-label={done ? 'Reabrir' : 'Concluir'}>
                  {done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                </button>
                <span style={s.title(done)}>{t.title}</span>
                {t.due_date && <span style={s.due(late)}>{late ? '⚠ ' : ''}{fmtDue(t.due_date)}</span>}
                {t.assigned_user_id && <MiniAvatar label={memberLabel[t.assigned_user_id] || '—'} />}
                <button type="button" style={s.del} onClick={() => remove(t)} title="Excluir">×</button>
              </div>
            )
          })}

      <div style={s.form}>
        <input style={s.input} placeholder="Nova tarefa…" value={draft.title}
          onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <input style={{ ...s.input, width: 140 }} type="date" value={draft.due}
          onChange={e => setDraft(d => ({ ...d, due: e.target.value }))} title="Vencimento" />
        <select style={{ ...s.input, width: 150 }} value={draft.assigned}
          onChange={e => setDraft(d => ({ ...d, assigned: e.target.value }))} title="Responsável">
          <option value="">Responsável…</option>
          {(members || []).map(m => <option key={m.user_id} value={m.user_id}>{memberLabel[m.user_id]}</option>)}
        </select>
        <button type="button" style={s.btn} onClick={add} disabled={saving || !draft.title.trim()}>Adicionar</button>
      </div>
    </div>
  )
}
