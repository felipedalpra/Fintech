import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Modal, Btn, FInput } from './UI.jsx'
import { PatientSelector } from './PatientSelector.jsx'
import { createTask, toggleTask, deleteTask } from '../lib/taskActions.js'
import { groupTasksByDue, GROUP_ORDER } from '../lib/taskGroups.js'

// Painel de tarefas da clínica (cross-oportunidade + avulsas). Agenda do dia da equipe.
function fmtDue(due) {
  if (!due) return null
  try { return new Date(String(due).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) } catch { return due }
}
function vinculo(t) {
  if (t.opportunities?.title && t.opportunities.title !== 'Oportunidade') return t.opportunities.title
  if (t.patients?.full_name) return t.patients.full_name
  if (t.opportunity_id) return 'Oportunidade'
  return 'avulsa'
}

export function TasksPanel() {
  const { user } = useAuth()
  const { ownerId, role } = useUserRole()
  const effectiveUserId = ownerId || user?.id

  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [scope, setScope] = useState(role === 'admin' || role === 'gestao' ? 'todas' : 'minhas')
  const [showDone, setShowDone] = useState(false)
  const [creating, setCreating] = useState(false)

  async function load() {
    setLoading(true); setError(null)
    const [taskRes, memRes] = await Promise.all([
      supabase.from('tasks')
        .select('id, title, due_date, status, assigned_user_id, done_at, created_at, opportunity_id, patient_id, patients(full_name), opportunities(title)')
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('clinic_members').select('user_id, member_email').order('created_at', { ascending: true }),
    ])
    if (taskRes.error) { setError(taskRes.error.message); setLoading(false); return }
    setTasks(taskRes.data ?? [])
    setMembers((memRes.data ?? []).filter(m => m.user_id))
    setLoading(false)
  }
  useEffect(() => { if (effectiveUserId) load() }, [effectiveUserId])

  const memberLabel = useMemo(() => Object.fromEntries(members.map(m => [m.user_id, m.member_email || m.user_id])), [members])
  const scoped = useMemo(
    () => (scope === 'minhas' ? tasks.filter(t => t.assigned_user_id === user?.id) : tasks),
    [tasks, scope, user],
  )
  const groups = useMemo(() => groupTasksByDue(scoped), [scoped])

  async function toggle(task) {
    const prev = tasks
    setTasks(ts => ts.map(x => (x.id === task.id ? { ...x, status: x.status === 'feita' ? 'pendente' : 'feita', done_at: x.status === 'feita' ? null : new Date().toISOString() } : x)))
    const res = await toggleTask(task)
    if (res.error) { setTasks(prev); setError(res.error) }
  }
  async function remove(task) {
    const prev = tasks
    setTasks(ts => ts.filter(x => x.id !== task.id))
    const res = await deleteTask(task.id)
    if (res.error) { setTasks(prev); setError(res.error) }
  }

  if (loading) return <div style={{ color: C.textSub, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Carregando tarefas…</div>
  if (error) return <div style={{ color: C.red || '#ef4444', fontSize: 14, padding: 24 }}>Erro: {error}</div>

  const seg = active => ({ padding: '6px 14px', borderRadius: 8, border: `1px solid ${active ? C.accent : C.border}`, background: active ? C.accent + '18' : C.card, color: active ? C.accent : C.textSub, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' })
  const createBtn = { padding: '7px 14px', borderRadius: 8, background: C.accent, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" style={seg(scope === 'minhas')} onClick={() => setScope('minhas')}>Minhas</button>
        <button type="button" style={seg(scope === 'todas')} onClick={() => setScope('todas')}>Todas</button>
        <div style={{ flex: 1 }} />
        <button type="button" style={createBtn} onClick={() => setCreating(true)}>+ Nova tarefa avulsa</button>
      </div>

      {GROUP_ORDER.map(g => {
        const items = groups[g.key]
        if (!items.length) return null
        return (
          <div key={g.key} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: g.key === 'atrasadas' ? (C.red || '#ef4444') : C.textSub, marginBottom: 6 }}>
              {g.icon} {g.label.toUpperCase()} ({items.length})
            </div>
            {items.map(t => <TaskRow key={t.id} t={t} memberLabel={memberLabel} onToggle={() => toggle(t)} onRemove={() => remove(t)} />)}
          </div>
        )
      })}

      {GROUP_ORDER.every(g => !groups[g.key].length) && (
        <div style={{ color: C.textDim, fontSize: 13, padding: '24px 0', textAlign: 'center' }}>Nenhuma tarefa pendente. 🎉</div>
      )}

      {groups.concluidas.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={() => setShowDone(v => !v)} style={{ background: 'none', border: 'none', color: C.textSub, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
            {showDone ? '▾' : '▸'} Concluídas ({groups.concluidas.length})
          </button>
          {showDone && <div style={{ marginTop: 8 }}>{groups.concluidas.map(t => <TaskRow key={t.id} t={t} memberLabel={memberLabel} onToggle={() => toggle(t)} onRemove={() => remove(t)} />)}</div>}
        </div>
      )}

      {creating && (
        <NewTaskModal ownerId={effectiveUserId} userId={user?.id} members={members}
          onClose={() => setCreating(false)} onCreated={t => { setTasks(ts => [...ts, t]); setCreating(false) }} />
      )}
    </div>
  )
}

function TaskRow({ t, memberLabel, onToggle, onRemove }) {
  const done = t.status === 'feita'
  const s = {
    row: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}` },
    title: { flex: 1, fontSize: 13, color: done ? C.textDim : C.text, textDecoration: done ? 'line-through' : 'none' },
    link: { fontSize: 11, color: C.textSub, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' },
    due: { fontSize: 11, color: C.textSub, whiteSpace: 'nowrap' },
    who: { fontSize: 10, color: C.textSub, whiteSpace: 'nowrap' },
    del: { background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 14, padding: 0 },
  }
  return (
    <div style={s.row}>
      <input type="checkbox" checked={done} onChange={onToggle} style={{ cursor: 'pointer', accentColor: C.accent }} />
      <span style={s.title}>{t.title}</span>
      <span style={s.link}>{vinculo(t)}</span>
      {t.due_date && <span style={s.due}>📅 {fmtDue(t.due_date)}</span>}
      {t.assigned_user_id && <span style={s.who}>{memberLabel[t.assigned_user_id] || '—'}</span>}
      <button type="button" style={s.del} onClick={onRemove} title="Excluir">×</button>
    </div>
  )
}

function NewTaskModal({ ownerId, userId, members, onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', due: '', assigned: '', patient_id: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.title.trim() || saving) return
    setSaving(true); setError(null)
    const res = await createTask(ownerId, {
      title: form.title, dueDate: form.due || null, assignedUserId: form.assigned || null,
      patientId: form.patient_id || null, createdBy: userId,
    })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onCreated(res.task)
  }

  return (
    <Modal open onClose={onClose} title="Nova tarefa avulsa" width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FInput label="Tarefa" value={form.title} onChange={v => set('title', v)} placeholder="O que precisa ser feito?" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <FInput label="Vencimento" type="date" value={form.due} onChange={v => set('due', v)} />
          <FInput label="Responsável" value={form.assigned} onChange={v => set('assigned', v)}
            options={[{ v: '', l: 'Sem responsável' }, ...(members || []).map(m => ({ v: m.user_id, l: m.member_email || m.user_id }))]} />
        </div>
        <PatientSelector userId={ownerId} value={form.patient_id} onChange={id => set('patient_id', id)} />
        {error && <div style={{ color: C.red || '#ef4444', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={save} disabled={saving || !form.title.trim()}>{saving ? 'Salvando…' : 'Criar tarefa'}</Btn>
        </div>
      </div>
    </Modal>
  )
}
