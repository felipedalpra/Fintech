import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { groupTasksByDue } from '../lib/taskGroups.js'
import { dayKey } from '../lib/taskViews.js'
import { initials, avatarColor } from '../lib/avatar.js'

// "Meu dia": a home do operador. Junta o que a pessoa logada precisa resolver hoje —
// tarefas de hoje/atrasadas atribuídas a mim, leads (oportunidades) novos do dia atribuídos a mim,
// e oportunidades minhas paradas há +7 dias. Tudo derivado dos dados que já temos.

function fmtDue(due) {
  if (!due) return null
  try { return new Date(String(due).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) } catch { return due }
}
function daysSince(ts) {
  if (!ts) return null
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  return d >= 0 ? d : null
}
function fmtBRL(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function Ico({ d, size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
}
const I = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  user: <><circle cx="9" cy="8" r="4" /><path d="M3 20a6 6 0 0 1 12 0M17 11h5M19.5 8.5v5" /></>,
  warn: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  check: <path d="M20 6 9 17l-5-5" />,
}

export function MeuDia() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const uid = user?.id
  const effectiveUserId = ownerId || uid

  const [tasks, setTasks] = useState([])
  const [opps, setOpps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!uid || !effectiveUserId) return
    let mounted = true
    async function load() {
      setLoading(true); setError(null)
      const [taskRes, oppRes] = await Promise.all([
        supabase.from('tasks')
          .select('id, title, due_date, status, assigned_user_id, patient_id, opportunity_id, patients(full_name), opportunities(title)')
          .eq('assigned_user_id', uid).eq('status', 'pendente'),
        supabase.from('opportunities')
          .select('id, title, stage, status, value, responsible_user_id, stage_entered_at, created_at, patients(full_name)')
          .eq('user_id', effectiveUserId).eq('responsible_user_id', uid).eq('status', 'aberto'),
      ])
      if (!mounted) return
      if (taskRes.error) { setError(taskRes.error.message); setLoading(false); return }
      if (oppRes.error) { setError(oppRes.error.message); setLoading(false); return }
      setTasks(taskRes.data ?? [])
      setOpps(oppRes.data ?? [])
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [uid, effectiveUserId])

  const groups = useMemo(() => groupTasksByDue(tasks), [tasks])
  const hojeTarefas = useMemo(() => [...groups.atrasadas, ...groups.hoje], [groups])
  const hoje = dayKey(new Date())
  // "novo hoje" no fuso LOCAL (created_at é UTC; comparar o slice cru erraria à noite).
  const leadsNovos = useMemo(() => opps.filter(o => {
    if (!o.created_at) return false
    const d = new Date(o.created_at)
    return !Number.isNaN(d.getTime()) && dayKey(d) === hoje
  }), [opps, hoje])
  const parados = useMemo(() => opps.filter(o => (daysSince(o.stage_entered_at) || 0) >= 7).sort((a, b) => (daysSince(b.stage_entered_at) || 0) - (daysSince(a.stage_entered_at) || 0)), [opps])

  if (loading) return <div style={{ color: C.textSub, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Carregando seu dia…</div>
  if (error) return <div style={{ color: C.red || '#ef4444', fontSize: 14, padding: 24 }}>Erro: {error}</div>

  const go = id => navigate(`/app/${id}`)
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }
  // Dentro do componente (lê C no render) — regra de dark mode do projeto.
  const rowText = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: C.text }

  return (
    <div style={grid}>
      <Panel title="Tarefas de hoje" count={hojeTarefas.length} color={C.accent} icon={I.clock} onHeader={() => go('tarefas')}
        empty="Nada pra hoje. 🎉">
        {hojeTarefas.map(t => {
          const late = groups.atrasadas.includes(t)
          return (
            <Row key={t.id}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: late ? (C.red || '#EF4444') : C.accent, flexShrink: 0 }} />
              <span style={rowText}>{t.title}{(t.patients?.full_name || t.opportunities?.title) ? ` · ${t.patients?.full_name || t.opportunities?.title}` : ''}</span>
              <Pill color={late ? (C.red || '#EF4444') : C.accent}>{late ? (t.due_date ? fmtDue(t.due_date) : 'atrasada') : 'hoje'}</Pill>
            </Row>
          )
        })}
      </Panel>

      <Panel title="Leads novos p/ mim" count={leadsNovos.length} color={C.green || '#10B981'} icon={I.user} onHeader={() => go('funnel')}
        empty="Nenhum lead novo hoje.">
        {leadsNovos.map(o => (
          <Row key={o.id}>
            <Avatar label={o.patients?.full_name || 'Paciente'} />
            <span style={rowText}>{o.patients?.full_name || 'Paciente'}{o.title && o.title !== 'Oportunidade' ? ` · ${o.title}` : ''}</span>
            {fmtBRL(o.value) && <Pill color={C.green || '#10B981'}>{fmtBRL(o.value)}</Pill>}
          </Row>
        ))}
      </Panel>

      <Panel title="Paradas há +7 dias" count={parados.length} color={C.yellow || '#F59E0B'} icon={I.warn} onHeader={() => go('funnel')}
        empty="Nada parado. 👏">
        {parados.map(o => (
          <Row key={o.id}>
            <Avatar label={o.patients?.full_name || 'Paciente'} />
            <span style={rowText}>{o.patients?.full_name || 'Paciente'}{o.title && o.title !== 'Oportunidade' ? ` · ${o.title}` : ''}</span>
            <Pill color={C.yellow || '#F59E0B'}>{daysSince(o.stage_entered_at)} dias</Pill>
          </Row>
        ))}
      </Panel>
    </div>
  )
}

function Panel({ title, count, color, icon, children, empty, onHeader }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : (children ? [children] : [])
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 15, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12, cursor: onHeader ? 'pointer' : 'default' }} onClick={onHeader}>
        <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: color + '22', color, flexShrink: 0 }}><Ico d={icon} size={16} /></span>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>{title}</h3>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: C.textSub, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: '1px 9px', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      </div>
      {items.length === 0 ? <div style={{ color: C.textDim, fontSize: 13, padding: '14px 0' }}>{empty}</div> : items}
    </div>
  )
}
function Row({ children }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 0', borderBottom: `1px solid ${C.border}` }}>{children}</div>
}
function Pill({ color, children }) {
  return <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 7, whiteSpace: 'nowrap', color, background: color + '22', fontVariantNumeric: 'tabular-nums' }}>{children}</span>
}
function Avatar({ label }) {
  return <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 800, color: '#fff', background: avatarColor(label), flexShrink: 0 }}>{initials(label)}</span>
}
