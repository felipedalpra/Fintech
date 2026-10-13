import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { aggregateInsights, deriveMetrics, fmtBRL, fmtInt, fmtPct } from '../lib/metaMetrics.js'

// Tela CRM → Anúncios (Meta Ads). Espelho fiel do Meta: só exibe o que vem de lá, não cruza
// com o financeiro. Drill por nível (Campanhas / Conjuntos / Anúncios), métricas nativas.
const LEVELS = [
  { key: 'campaign', label: 'Campanhas', table: 'meta_campaigns', idCol: 'campaign_id' },
  { key: 'adset',    label: 'Conjuntos', table: 'meta_adsets',    idCol: 'adset_id' },
  { key: 'ad',       label: 'Anúncios',  table: 'meta_ads',       idCol: 'ad_id' },
]
const PERIODS = [
  { key: 'month',   label: 'Este mês' },
  { key: '30d',     label: 'Últimos 30d' },
  { key: 'quarter', label: 'Trimestre' },
]

function isoDay(d) { return d.toISOString().slice(0, 10) }
function rangeFor(period) {
  const until = new Date()
  if (period === 'month') return { since: isoDay(new Date(until.getFullYear(), until.getMonth(), 1)), until: isoDay(until) }
  const days = period === 'quarter' ? 89 : 29
  return { since: isoDay(new Date(Date.now() - days * 86400000)), until: isoDay(until) }
}
function freshness(iso) {
  if (!iso) return null
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000)
  if (h < 1) return 'agora há pouco'
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

const COLS = [
  { key: 'spend',       label: 'Gasto',      fmt: fmtBRL },
  { key: 'impressions', label: 'Impressões', fmt: fmtInt },
  { key: 'clicks',      label: 'Cliques',    fmt: fmtInt },
  { key: 'ctr',         label: 'CTR',        fmt: fmtPct },
  { key: 'cpc',         label: 'CPC',        fmt: fmtBRL },
  { key: 'cpm',         label: 'CPM',        fmt: fmtBRL },
  { key: 'leads',       label: 'Leads',      fmt: fmtInt },
  { key: 'cpl',         label: 'CPL',        fmt: fmtBRL },
]

export function MetaAdsDashboard() {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const uid = ownerId || user?.id

  const [subtab, setSubtab] = useState('desempenho')
  const [level, setLevel] = useState('campaign')
  const [period, setPeriod] = useState('month')
  const [insights, setInsights] = useState([])
  const [names, setNames] = useState({})
  const [syncedAt, setSyncedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sort, setSort] = useState({ key: 'spend', dir: 'desc' })

  useEffect(() => {
    if (!uid) return
    let mounted = true
    async function load() {
      setLoading(true); setError(null)
      const { since } = rangeFor(period)
      const lvl = LEVELS.find(l => l.key === level)
      const [insRes, strRes] = await Promise.all([
        supabase.from('meta_insights')
          .select('level, ref_id, campaign_id, date, spend, impressions, clicks, leads, updated_at')
          .eq('user_id', uid).eq('level', level).gte('date', since),
        supabase.from(lvl.table).select(`${lvl.idCol}, name, status`).eq('user_id', uid),
      ])
      if (!mounted) return
      if (insRes.error) { setError(insRes.error.message); setLoading(false); return }
      setInsights(insRes.data ?? [])
      const map = {}
      for (const r of strRes.data ?? []) map[r[lvl.idCol]] = { name: r.name, status: r.status }
      setNames(map)
      const latest = (insRes.data ?? []).reduce((acc, r) => (!acc || r.updated_at > acc ? r.updated_at : acc), null)
      setSyncedAt(latest)
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [uid, level, period])

  const rows = useMemo(() => {
    const agg = aggregateInsights(insights).map(a => {
      const meta = names[a.ref_id] || {}
      return { ...a, ...deriveMetrics(a), name: meta.name || a.ref_id, status: meta.status }
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    agg.sort((x, y) => (Number(x[sort.key]) - Number(y[sort.key])) * dir)
    return agg
  }, [insights, names, sort])

  const totals = useMemo(() => {
    const t = rows.reduce((a, r) => ({
      spend: a.spend + r.spend, impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks, leads: a.leads + r.leads,
    }), { spend: 0, impressions: 0, clicks: 0, leads: 0 })
    return { ...t, ...deriveMetrics(t) }
  }, [rows])

  const bestCplId = useMemo(() => {
    const withLeads = rows.filter(r => r.leads > 0)
    if (!withLeads.length) return null
    return withLeads.reduce((best, r) => (r.cpl < best.cpl ? r : best)).ref_id
  }, [rows])

  const s = {
    wrap: { padding: 4 },
    subtabs: { display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' },
    subtab: on => ({ padding: '7px 14px', fontSize: 13, borderRadius: 9, cursor: 'pointer',
      border: `1px solid ${on ? C.borderBright : C.border}`, background: on ? C.card : C.surface,
      color: on ? C.text : C.textSub, fontWeight: on ? 700 : 500 }),
    bar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 },
    seg: { display: 'inline-flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 3 },
    segBtn: on => ({ border: 0, background: on ? C.accent : 'transparent', color: on ? '#fff' : C.textSub,
      font: 'inherit', fontSize: 12.5, fontWeight: on ? 700 : 500, padding: '6px 13px', borderRadius: 7, cursor: 'pointer' }),
    pills: { display: 'flex', gap: 6, flexWrap: 'wrap' },
    pill: on => ({ padding: '6px 12px', fontSize: 12.5, borderRadius: 999, cursor: 'pointer',
      border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.surface, color: on ? '#fff' : C.textSub, fontWeight: on ? 700 : 500 }),
    fresh: { fontSize: 12, color: C.textSub, display: 'flex', alignItems: 'center', gap: 7 },
    dot: { width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block' },
    banner: { display: 'flex', gap: 10, alignItems: 'flex-start', background: 'rgba(245,158,11,.08)',
      border: '1px solid rgba(245,158,11,.28)', borderRadius: 12, padding: '11px 14px', fontSize: 12.5, color: '#f8d79a', marginBottom: 16, lineHeight: 1.5 },
    kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 },
    kpi: hero => ({ background: hero ? 'linear-gradient(160deg,rgba(59,130,246,.14),rgba(139,92,246,.07))' : C.card,
      border: `1px solid ${hero ? C.borderBright : C.border}`, borderRadius: 14, padding: 14 }),
    kLabel: { fontSize: 10.5, fontWeight: 700, color: C.textDim, letterSpacing: '.09em', textTransform: 'uppercase' },
    kVal: hero => ({ fontSize: 21, fontWeight: 700, marginTop: 7, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em', color: hero ? C.accentLight : C.text }),
    panel: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' },
    scroll: { overflowX: 'auto' },
    th: { fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: '.06em', textTransform: 'uppercase',
      borderBottom: `1px solid ${C.border}`, background: C.surface, padding: '11px 13px', whiteSpace: 'nowrap', cursor: 'pointer' },
    td: { borderBottom: `1px solid ${C.border}`, padding: '11px 13px', fontSize: 13, textAlign: 'right',
      fontVariantNumeric: 'tabular-nums', color: C.textSub, whiteSpace: 'nowrap' },
    note: { fontSize: 11.5, color: C.textDim, marginTop: 14, lineHeight: 1.55, display: 'flex', gap: 8, alignItems: 'flex-start' },
    empty: { textAlign: 'center', padding: '48px 20px', color: C.textSub },
  }
  const thAlign = (key) => ({ ...s.th, textAlign: key === 'name' || key === 'status' ? 'left' : 'right' })
  const setSortKey = (key) => setSort(p => ({ key, dir: p.key === key && p.dir === 'desc' ? 'asc' : 'desc' }))
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '')

  return (
    <div style={s.wrap}>
      <div style={s.subtabs}>
        <div style={s.subtab(subtab === 'desempenho')} onClick={() => setSubtab('desempenho')}>📊 Desempenho</div>
        <div style={s.subtab(subtab === 'analises')} onClick={() => setSubtab('analises')}>💡 Análises</div>
      </div>

      {subtab === 'analises' ? (
        <div style={s.panel}>
          <div style={s.empty}>
            A leitura por IA das campanhas chega no próximo passo. Vai interpretar estes mesmos números
            do Meta e apontar o que escalar, pausar ou trocar.
          </div>
        </div>
      ) : (
        <>
          <div style={s.bar}>
            <div style={s.seg}>
              {LEVELS.map(l => (
                <button key={l.key} style={s.segBtn(level === l.key)} onClick={() => setLevel(l.key)}>{l.label}</button>
              ))}
            </div>
            <div style={s.pills}>
              {PERIODS.map(p => (
                <span key={p.key} style={s.pill(period === p.key)} onClick={() => setPeriod(p.key)}>{p.label}</span>
              ))}
            </div>
          </div>

          {syncedAt && (
            <div style={{ ...s.fresh, marginBottom: 14 }}><span style={s.dot} /> Sincronizado com o Meta · {freshness(syncedAt)}</div>
          )}

          <div style={s.banner}>
            <span>⚠️</span>
            <span><b>Modo teste.</b> Os números vêm da conta conectada no Meta. A leitura dos anúncios reais
            depende da aprovação do app no Meta (App Review · <code>ads_read</code>) — em andamento.</span>
          </div>

          {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{error}</div>}

          <div style={s.kpis}>
            <div style={s.kpi(false)}><div style={s.kLabel}>Gasto</div><div style={s.kVal(false)}>{fmtBRL(totals.spend)}</div></div>
            <div style={s.kpi(false)}><div style={s.kLabel}>Impressões</div><div style={s.kVal(false)}>{fmtInt(totals.impressions)}</div></div>
            <div style={s.kpi(false)}><div style={s.kLabel}>Cliques</div><div style={s.kVal(false)}>{fmtInt(totals.clicks)}</div></div>
            <div style={s.kpi(false)}><div style={s.kLabel}>CTR</div><div style={s.kVal(false)}>{fmtPct(totals.ctr)}</div></div>
            <div style={s.kpi(false)}><div style={s.kLabel}>Leads</div><div style={s.kVal(false)}>{fmtInt(totals.leads)}</div></div>
            <div style={s.kpi(true)}><div style={s.kLabel}>CPL médio</div><div style={s.kVal(true)}>{fmtBRL(totals.cpl)}</div></div>
          </div>

          <div style={s.panel}>
            <div style={s.scroll}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
                <thead>
                  <tr>
                    <th style={thAlign('name')} onClick={() => setSortKey('name')}>{LEVELS.find(l => l.key === level).label}{arrow('name')}</th>
                    {COLS.map(c => (
                      <th key={c.key} style={thAlign(c.key)} onClick={() => setSortKey(c.key)}>{c.label}{arrow(c.key)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td style={{ ...s.td, textAlign: 'center', color: C.textDim }} colSpan={COLS.length + 1}>Carregando…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td style={{ ...s.td, textAlign: 'center' }} colSpan={COLS.length + 1}>
                      Nenhum dado do Meta ainda. Conecte a conta em <b>Configurações → Meta Ads</b> e aguarde o próximo sync.
                    </td></tr>
                  ) : (
                    rows.map(r => (
                      <tr key={r.ref_id}>
                        <td style={{ ...s.td, textAlign: 'left', color: C.text, fontWeight: 600 }}>
                          {r.name}
                          {r.ref_id === bestCplId && <span style={{ marginLeft: 8, fontSize: 9.5, fontWeight: 700, color: C.green, background: 'rgba(16,185,129,.14)', padding: '2px 6px', borderRadius: 5 }}>★ melhor CPL</span>}
                        </td>
                        {COLS.map(c => <td key={c.key} style={s.td}>{c.fmt(r[c.key])}</td>)}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={s.note}>
            <span>ℹ️</span>
            <span>Tudo aqui vem direto do Meta Ads — nada é somado ao financeiro. CTR/CPC/CPM/CPL são
            calculados a partir dos totais do período. <b>Alcance e frequência</b> entram num próximo
            incremento (precisam de consulta por período no Meta).</span>
          </div>
        </>
      )}
    </div>
  )
}
