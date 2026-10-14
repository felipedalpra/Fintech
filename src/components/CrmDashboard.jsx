import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { initials, avatarColor } from '../lib/avatar.js'
import { funnelCounts, weightedPipeline, leadsBySource, byResponsible, lossReasons, avgDaysPerStage, crmKpis } from '../lib/crmMetrics.js'
import { slaForLead, SLA_CONFIG } from '../lib/slaBusinessTime.js'

// Painel de CRM: lê oportunidades + histórico de estágios e calcula tudo no cliente
// (módulo puro crmMetrics.js). Não cruza com o financeiro — conversão ≠ faturamento.

// Ordem e cor das etapas do funil de conversão (follow_up é pós-venda, fica fora).
const STAGE_META = [
  { key: 'primeiro_contato', label: 'Primeiro contato', color: '#94a3b8' },
  { key: 'consulta_agendada', label: 'Consulta agendada', color: '#6366f1' },
  { key: 'consultado', label: 'Consultado', color: '#0ea5e9' },
  { key: 'orcamento_enviado', label: 'Orçamento enviado', color: '#f59e0b' },
  { key: 'reserva_paga', label: 'Reserva paga', color: '#10b981' },
  { key: 'cirurgia_marcada', label: 'Cirurgia marcada', color: '#14b8a6' },
  { key: 'cirurgia_feita', label: 'Cirurgia feita', color: '#22c55e' },
]
const STAGE_ORDER = STAGE_META.map(s => s.key)
const STAGE_LABEL = Object.fromEntries(STAGE_META.map(s => [s.key, s.label]))
const DAY = 86400000
const PERIODS = [{ v: 30, l: '30 dias' }, { v: 90, l: '90 dias' }, { v: 365, l: '12 meses' }, { v: 0, l: 'Tudo' }]

function fmtBRL(v) {
  const n = Number(v) || 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
function pct(x) { return x == null ? '—' : `${Math.round(x * 100)}%` }

// Busca TODAS as linhas paginando (PostgREST corta em 1000 por padrão — sem isso, KPIs/funil
// ficariam errados silenciosamente em bases maiores, principalmente o histórico de estágios).
async function fetchAll(makeQuery) {
  const PAGE = 1000
  let from = 0
  let all = []
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) return { error }
    all = all.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return { data: all }
}

export function CrmDashboard() {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id

  const [opps, setOpps] = useState([])
  const [history, setHistory] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState(90)

  useEffect(() => {
    if (!effectiveUserId) return
    let mounted = true
    async function load() {
      setLoading(true); setError(null)
      const cutoff = period ? new Date(Date.now() - period * DAY).toISOString() : '1970-01-01'
      const [oppRes, histRes, memRes] = await Promise.all([
        fetchAll(() => supabase.from('opportunities')
          .select('id, stage, status, value, source, responsible_user_id, stage_entered_at, created_at, first_response_at, lost_reason')
          .eq('user_id', effectiveUserId).gte('created_at', cutoff)
          .order('created_at', { ascending: true }).order('id', { ascending: true })),
        fetchAll(() => supabase.from('opportunity_stage_history')
          .select('opportunity_id, from_stage, to_stage, created_at')
          .eq('user_id', effectiveUserId).gte('created_at', cutoff)
          .order('created_at', { ascending: true }).order('opportunity_id', { ascending: true })),
        supabase.from('clinic_members').select('user_id, member_email'),
      ])
      if (!mounted) return
      if (oppRes.error) { setError(oppRes.error.message); setLoading(false); return }
      if (histRes.error) { setError(histRes.error.message); setLoading(false); return }
      setOpps(oppRes.data ?? [])
      setHistory(histRes.data ?? [])
      setMembers((memRes.data ?? []).filter(m => m.user_id))
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [effectiveUserId, period])

  const memberLabel = useMemo(() => {
    const map = Object.fromEntries(members.map(m => [m.user_id, m.member_email || m.user_id]))
    if (effectiveUserId && !map[effectiveUserId]) map[effectiveUserId] = user?.email || 'Dono'
    return map
  }, [members, effectiveUserId, user])
  const kpis = useMemo(() => crmKpis(opps), [opps])
  const sla = useMemo(() => {
    const now = new Date()
    const states = opps.map(o => slaForLead(o, now))
    const responded = states.filter(r => r.state === 'respondido' && r.minutes > 0)
    const avg = responded.length ? Math.round(responded.reduce((s, r) => s + r.minutes, 0) / responded.length) : null
    const within = responded.filter(r => r.minutes <= SLA_CONFIG.targetMin).length
    const waiting = states.filter(r => r.state === 'ok' || r.state === 'late')
    const late = waiting.filter(r => r.state === 'late').length
    return { avg, withinPct: responded.length ? within / responded.length : null, waiting: waiting.length, late }
  }, [opps])
  const pipeline = useMemo(() => weightedPipeline(opps), [opps])
  const funnel = useMemo(() => funnelCounts(opps, STAGE_ORDER), [opps])
  const sources = useMemo(() => leadsBySource(opps), [opps])
  const responsibles = useMemo(() => byResponsible(opps), [opps])
  const times = useMemo(() => avgDaysPerStage(history), [history])
  const losses = useMemo(() => lossReasons(opps), [opps])

  if (loading) return <div style={{ color: C.textSub, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Carregando painel…</div>
  if (error) return <div style={{ color: C.red || '#ef4444', fontSize: 14, padding: 24 }}>Erro: {error}</div>

  const seg = active => ({ padding: '7px 13px', borderRadius: 8, border: 'none', background: active ? C.card : 'transparent', color: active ? C.accent : C.textSub, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' })
  const panel = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 18 }
  const h3 = { margin: '0 0 3px', fontSize: 14, fontWeight: 800, color: C.text }
  const sub = { fontSize: 11.5, color: C.textSub, marginBottom: 16 }

  const maxFunnel = funnel[0]?.reached || 1
  const maxSource = Math.max(1, ...sources.map(s => s.total))
  const maxResp = Math.max(1, ...responsibles.map(r => r.total))
  const maxTime = Math.max(1, ...Object.values(times))
  const empty = opps.length === 0

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11, padding: 4 }}>
          {PERIODS.map(p => <button key={p.v} type="button" style={seg(period === p.v)} onClick={() => setPeriod(p.v)}>{p.l}</button>)}
        </div>
      </div>

      {empty && <div style={{ color: C.textSub, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Nenhuma oportunidade no período. Crie leads no <strong>Funil</strong>.</div>}

      {!empty && <>
        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
          <Kpi label="Leads no período" value={kpis.leads} />
          <Kpi label="Taxa de conversão" value={pct(kpis.convRate)} color={C.green || '#10B981'} />
          <Kpi label="Pipeline ponderado" value={fmtBRL(pipeline.total)} color={C.accent} note={`${pipeline.count} oportunidades abertas`} />
          <Kpi label="Ticket médio (ganho)" value={fmtBRL(kpis.avgTicket)} />
          <Kpi label="Ganhos · Perdidos" value={<span>{kpis.won} · <span style={{ color: C.red || '#EF4444' }}>{kpis.lost}</span></span>} />
          <Kpi label="1ª resposta média" value={sla.avg == null ? '—' : `${sla.avg} min`} color={C.green || '#10B981'} note="em horário comercial" />
          <Kpi label={`Dentro do SLA (${SLA_CONFIG.targetMin} min)`} value={pct(sla.withinPct)} note="dos leads respondidos" />
          <Kpi label="Aguardando 1ª resposta" value={<span>{sla.waiting}{sla.late > 0 && <span style={{ color: C.red || '#EF4444' }}> · {sla.late} atrasado{sla.late > 1 ? 's' : ''}</span>}</span>} color={sla.late > 0 ? (C.yellow || '#F59E0B') : undefined} />
        </div>

        {/* Funil + Origem */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 14, marginBottom: 14 }} className="crm-two">
          <div style={panel}>
            <h3 style={h3}>Funil de conversão</h3><div style={sub}>Quantos leads alcançam cada etapa e a taxa de passagem.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {funnel.map((f, i) => (
                <div key={f.stage} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 132, flexShrink: 0, fontSize: 12, fontWeight: 600, color: C.textSub, display: 'flex', alignItems: 'center', gap: 7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STAGE_META[i].color, flexShrink: 0 }} />{STAGE_META[i].label}
                  </span>
                  <div style={{ flex: 1, background: C.surface, borderRadius: 8, height: 28, overflow: 'hidden', minWidth: 0 }}>
                    <div style={{ height: '100%', width: `${Math.max(6, (f.reached / maxFunnel) * 100)}%`, background: STAGE_META[i].color, borderRadius: 8, display: 'flex', alignItems: 'center', padding: '0 10px', color: '#fff', fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{f.reached}</div>
                  </div>
                  <span style={{ width: 48, flexShrink: 0, textAlign: 'right', fontSize: 12, fontWeight: 700, color: C.textSub, fontVariantNumeric: 'tabular-nums' }}>{f.conv == null ? '—' : pct(f.conv)}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={panel}>
            <h3 style={h3}>Leads por origem</h3><div style={sub}>De onde vêm e quanto cada origem converte.</div>
            {sources.length === 0 ? <Dim>Sem origens registradas.</Dim> : sources.map(s => (
              <BarRow key={s.source} label={s.source} frac={s.total / maxSource} color={C.purple || '#8B5CF6'}
                value={`${s.total} · ${pct(s.conv)}`} />
            ))}
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>o 2º número = conversão daquela origem</div>
          </div>
        </div>

        {/* Responsável + Tempo por etapa */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14, marginBottom: 14 }} className="crm-two">
          <div style={panel}>
            <h3 style={h3}>Desempenho por responsável</h3><div style={sub}>Oportunidades, ganhos e conversão de cada um.</div>
            {responsibles.length === 0 ? <Dim>Sem responsáveis atribuídos.</Dim> : responsibles.map(r => {
              const label = r.userId === 'none' ? 'Sem responsável' : (memberLabel[r.userId] || r.userId)
              return <BarRow key={r.userId} avatarLabel={r.userId === 'none' ? null : label} label={label} frac={r.total / maxResp}
                color={C.green || '#10B981'} value={`${r.won}/${r.total} · ${pct(r.conv)}`} />
            })}
          </div>

          <div style={panel}>
            <h3 style={h3}>Tempo médio por etapa</h3><div style={sub}>Onde os leads empacam (dias médios por etapa já encerrada, via histórico).</div>
            {Object.keys(times).length === 0 ? <Dim>Ainda sem histórico suficiente de movimentações.</Dim> : STAGE_ORDER.filter(s => times[s] != null).map(s => {
              const d = times[s]
              const slow = d >= 7
              return <BarRow key={s} label={STAGE_LABEL[s] || s} frac={d / maxTime}
                color={slow ? (C.yellow || '#F59E0B') : C.accent} value={`${d.toFixed(1)} d${slow ? ' ⚠' : ''}`} />
            })}
          </div>
        </div>

        {/* Motivos de perda */}
        <div style={panel}>
          <h3 style={h3}>Motivos de perda</h3><div style={sub}>Por que as oportunidades são perdidas ({kpis.lost} no período).</div>
          {losses.length === 0 ? <Dim>Nenhuma perda registrada no período. 🎉</Dim> : (
            <div>
              {losses.map((l, i) => {
                const c = [C.red || '#EF4444', C.yellow || '#F59E0B', C.purple || '#8B5CF6', C.cyan || '#06B6D4', C.textDim][i % 5]
                return <BarRow key={l.reason} label={l.reason} frac={l.count / (losses[0]?.count || 1)} color={c} value={String(l.count)} />
              })}
            </div>
          )}
        </div>
      </>}

      <style>{`@media (max-width: 820px){ .crm-two{ grid-template-columns: 1fr !important } }`}</style>
    </div>
  )
}

function Kpi({ label, value, color, note }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 15, padding: '15px 16px' }}>
      <div style={{ fontSize: 12, color: C.textSub, fontWeight: 600 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 25, letterSpacing: '-0.02em', marginTop: 9, fontVariantNumeric: 'tabular-nums', color: color || C.text }}>{value}</div>
      {note && <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 5 }}>{note}</div>}
    </div>
  )
}

function BarRow({ label, avatarLabel, frac, color, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 }}>
      <span style={{ width: 128, flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: C.text, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {avatarLabel && <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 800, color: '#fff', background: avatarColor(avatarLabel), flexShrink: 0 }}>{initials(avatarLabel)}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </span>
      <div style={{ flex: 1, background: C.surface, borderRadius: 7, height: 12, overflow: 'hidden', minWidth: 0 }}>
        <div style={{ height: '100%', width: `${Math.max(3, Math.min(100, frac * 100))}%`, background: color, borderRadius: 7 }} />
      </div>
      <span style={{ width: 84, flexShrink: 0, textAlign: 'right', fontSize: 12, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function Dim({ children }) {
  return <div style={{ color: C.textDim, fontSize: 13, padding: '14px 0' }}>{children}</div>
}
