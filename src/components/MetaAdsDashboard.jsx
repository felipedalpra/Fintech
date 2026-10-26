import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { aggregateInsights, deriveMetrics, fmtBRL, fmtInt, fmtPct } from '../lib/metaMetrics.js'
import { requestMetaAnalysis } from '../lib/aiClient.js'
import { syncMetaRange } from '../lib/metaOAuthClient.js'

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
  { key: 'custom',  label: 'Personalizado' },
]

function isoDay(d) { return d.toISOString().slice(0, 10) }
// customRange só é usado quando period === 'custom'. Alcance/Frequência (meta_reach) são
// pré-calculados no backend só pra month/30d/quarter — período personalizado nunca tem
// linha em meta_reach, então aparecem como "—" (honesto: Gasto/Cliques/Leads continuam
// exatos, vêm de meta_insights por dia, que funciona pra qualquer intervalo).
function rangeFor(period, customRange) {
  const until = new Date()
  if (period === 'custom' && customRange?.since && customRange?.until) return customRange
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

// Alcance/frequência vêm do cache meta_reach (deduplicados por período); ausentes → "—".
const fmtReach = v => (v == null ? '—' : fmtInt(v))
const fmtFreq = v => (v == null ? '—' : Number(v).toFixed(2).replace('.', ','))

const COLS = [
  { key: 'spend',       label: 'Gasto',      fmt: fmtBRL },
  { key: 'reach',       label: 'Alcance',    fmt: fmtReach },
  { key: 'impressions', label: 'Impressões', fmt: fmtInt },
  { key: 'frequency',   label: 'Freq.',      fmt: fmtFreq },
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
  const [customRange, setCustomRange] = useState(() => {
    const until = new Date()
    return { since: isoDay(new Date(Date.now() - 89 * 86400000)), until: isoDay(until) }
  })
  const [insights, setInsights] = useState([])
  const [names, setNames] = useState({})
  const [reachRows, setReachRows] = useState([])
  const [syncedAt, setSyncedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [conn, setConn] = useState(null)
  const [hasAnyCampaign, setHasAnyCampaign] = useState(null)
  const [sort, setSort] = useState({ key: 'spend', dir: 'desc' })
  const [rangeSyncing, setRangeSyncing] = useState(false)
  const [rangeSyncError, setRangeSyncError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  async function syncRangeNow() {
    setRangeSyncing(true); setRangeSyncError(null)
    try {
      await syncMetaRange(customRange)
      setReloadKey(k => k + 1)
    } catch (e) {
      setRangeSyncError(e.message || 'Não foi possível sincronizar esse período.')
    } finally {
      setRangeSyncing(false)
    }
  }

  useEffect(() => {
    if (!uid) return
    let mounted = true
    async function load() {
      setLoading(true); setError(null)
      const { since, until } = rangeFor(period, customRange)
      const lvl = LEVELS.find(l => l.key === level)
      const [insRes, strRes, reachRes, connRes, campaignsRes] = await Promise.all([
        supabase.from('meta_insights')
          .select('level, ref_id, campaign_id, date, spend, impressions, clicks, leads, updated_at')
          .eq('user_id', uid).eq('level', level).gte('date', since).lte('date', until),
        supabase.from(lvl.table).select(`${lvl.idCol}, name, status`).eq('user_id', uid),
        supabase.from('meta_reach').select('level, ref_id, reach, frequency')
          .eq('user_id', uid).eq('period', period),
        // Status real da conexão (não cruza com financeiro) — explica o "sem dado" em vez de
        // mostrar sempre o mesmo aviso genérico de App Review, que nem é a causa mais comum.
        supabase.from('meta_connections')
          .select('status, ad_account_id, updated_at').eq('user_id', uid).maybeSingle(),
        supabase.from('meta_campaigns').select('campaign_id', { count: 'exact', head: true }).eq('user_id', uid),
      ])
      if (!mounted) return
      if (insRes.error) { setError(insRes.error.message); setLoading(false); return }
      setInsights(insRes.data ?? [])
      setReachRows(reachRes.data ?? [])
      setConn(connRes.data ?? null)
      setHasAnyCampaign((campaignsRes.count ?? 0) > 0)
      const map = {}
      for (const r of strRes.data ?? []) map[r[lvl.idCol]] = { name: r.name, status: r.status }
      setNames(map)
      const latest = (insRes.data ?? []).reduce((acc, r) => (!acc || r.updated_at > acc ? r.updated_at : acc), null)
      setSyncedAt(latest)
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [uid, level, period, customRange, reloadKey])

  // Motivo real de não ter dado na tela — nunca o aviso fixo de App Review, que nem é
  // a causa mais provável (Standard Access já cobre a própria conta sem revisão do Meta).
  const diagnosis = useMemo(() => {
    if (!conn || !conn.ad_account_id) return { kind: 'not_connected', text: 'Nenhuma conta do Meta conectada ainda. Conecte em Configurações → Meta Ads.' }
    if (conn.status === 'selecionando') return { kind: 'selecting', text: 'Conexão iniciada, mas falta escolher a Página/Conta de Anúncios em Configurações → Meta Ads.' }
    if (conn.status === 'erro') return { kind: 'error', text: `A última sincronização falhou (token pode ter expirado ou sido revogado). Reconecte em Configurações → Meta Ads. Última tentativa: ${freshness(conn.updated_at) || 'desconhecida'}.` }
    if (conn.status === 'expirando') return { kind: 'expiring', text: 'O token do Meta está perto de vencer. Reconecte em Configurações → Meta Ads para não perder a sincronização.' }
    // hasAnyCampaign vem de meta_campaigns (estrutura, sem filtro de período) — é o sinal
    // confiável de "já sincronizou com sucesso". meta_insights (syncedAt) NUNCA ganha linha
    // quando a conta não tem campanha nenhuma, então usá-lo aqui travava a mensagem em
    // "aguardando sincronização" pra sempre nesse caso, mesmo com o sync rodando certinho.
    if (hasAnyCampaign === false) {
      return { kind: 'no_campaigns', text: `Conectado${conn.updated_at ? ` (última sincronização ${freshness(conn.updated_at)})` : ''}, mas não há nenhuma campanha sincronizada — ou a Conta de Anúncios realmente não tem campanha nenhuma, ou o sync ainda não rodou. O Alcance acima é o agregado da conta inteira. Se você tem campanhas ativas no Gerenciador de Anúncios e isso persistir, reconecte em Configurações → Meta Ads para forçar um sync novo.` }
    }
    if (hasAnyCampaign === true && !syncedAt) {
      return { kind: 'no_period_data', text: 'Esta conta tem campanhas, mas nenhuma teve atividade no período selecionado. Tente "Trimestre" ou "Personalizado" com um intervalo mais amplo (o sync guarda até 90 dias de histórico).' }
    }
    return { kind: 'ok', text: null }
  }, [conn, syncedAt, hasAnyCampaign])

  // Alcance/frequência do período para o nível atual (keyed por ref_id) e da conta (KPI total).
  const reachMap = useMemo(() => {
    const m = {}
    for (const r of reachRows) if (r.level === level) m[r.ref_id] = { reach: r.reach, frequency: r.frequency }
    return m
  }, [reachRows, level])
  const accountReach = useMemo(() => reachRows.find(r => r.level === 'account') || null, [reachRows])

  const rows = useMemo(() => {
    const agg = aggregateInsights(insights).map(a => {
      const meta = names[a.ref_id] || {}
      const d = deriveMetrics(a)
      const rm = reachMap[a.ref_id]
      // CPL só com leads > 0; com gasto e 0 leads fica indefinido (—), não "melhor".
      return {
        ...a, ...d, cpl: a.leads > 0 ? d.cpl : null,
        reach: rm?.reach ?? null, frequency: rm?.frequency ?? null,
        name: meta.name || a.ref_id, status: meta.status,
      }
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    const isText = sort.key === 'name' || sort.key === 'status'
    // null (ex.: CPL sem leads) vai pro fim, nunca é tratado como "melhor".
    const nval = v => (v == null ? Infinity : Number(v) || 0)
    agg.sort((x, y) => isText
      ? String(x[sort.key] ?? '').localeCompare(String(y[sort.key] ?? ''), 'pt-BR') * dir
      : (nval(x[sort.key]) - nval(y[sort.key])) * dir)
    return agg
  }, [insights, names, reachMap, sort])

  const totals = useMemo(() => {
    const t = rows.reduce((a, r) => ({
      spend: a.spend + r.spend, impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks, leads: a.leads + r.leads,
    }), { spend: 0, impressions: 0, clicks: 0, leads: 0 })
    const d = deriveMetrics(t)
    return { ...t, ...d, cpl: t.leads > 0 ? d.cpl : null }
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
    customRange: { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14,
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px' },
    customLabel: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.textSub, fontWeight: 600 },
    customInput: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, color: C.text,
      font: 'inherit', fontSize: 12.5, padding: '5px 8px' },
    customHint: { fontSize: 11, color: C.textDim, lineHeight: 1.4, flex: '1 1 260px' },
    syncBtn: busy => ({ border: 0, borderRadius: 8, padding: '7px 13px', fontSize: 12.5, fontWeight: 700,
      cursor: busy ? 'default' : 'pointer', background: C.accent, color: '#fff', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }),
    syncError: { flexBasis: '100%', fontSize: 12, color: C.red },
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
        <AnalysisView uid={uid} period={period} setPeriod={setPeriod} />
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

          {period === 'custom' && (
            <div style={s.customRange}>
              <label style={s.customLabel}>De
                <input type="date" style={s.customInput} value={customRange.since} max={customRange.until}
                  onChange={e => setCustomRange(r => ({ ...r, since: e.target.value }))} />
              </label>
              <label style={s.customLabel}>Até
                <input type="date" style={s.customInput} value={customRange.until} min={customRange.since} max={isoDay(new Date())}
                  onChange={e => setCustomRange(r => ({ ...r, until: e.target.value }))} />
              </label>
              <button style={s.syncBtn(rangeSyncing)} disabled={rangeSyncing} onClick={syncRangeNow}>
                {rangeSyncing ? 'Buscando no Meta…' : 'Buscar esse período'}
              </button>
              <span style={s.customHint}>Alcance e Frequência não ficam disponíveis em período personalizado (só pré-calculados pros atalhos acima); Gasto, Impressões, Cliques e Leads valem pra qualquer intervalo. O cron diário e a conexão só trazem os últimos 90 dias automaticamente — pra datas mais antigas, clique em "Buscar esse período" (busca direto no Meta, uma vez; fica salvo depois).</span>
              {rangeSyncError && <div style={s.syncError}>{rangeSyncError}</div>}
            </div>
          )}

          {syncedAt && (
            <div style={{ ...s.fresh, marginBottom: 14 }}><span style={s.dot} /> Sincronizado com o Meta · {freshness(syncedAt)}</div>
          )}

          {diagnosis.text && (
            <div style={s.banner}>
              <span>{diagnosis.kind === 'no_campaigns' ? 'ℹ️' : '⚠️'}</span>
              <span>{diagnosis.text}</span>
            </div>
          )}

          {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{error}</div>}

          <div style={s.kpis}>
            <div style={s.kpi(false)}><div style={s.kLabel}>Gasto</div><div style={s.kVal(false)}>{fmtBRL(totals.spend)}</div></div>
            <div style={s.kpi(false)}><div style={s.kLabel}>Alcance</div><div style={s.kVal(false)}>{fmtReach(accountReach?.reach)}</div><div style={{ fontSize: 11, color: C.textSub, marginTop: 3 }}>{accountReach ? `freq. ${fmtFreq(accountReach.frequency)}` : 'pessoas únicas'}</div></div>
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
                      {diagnosis.text || <>Nenhum dado do Meta ainda. Conecte a conta em <b>Configurações → Meta Ads</b> e aguarde o próximo sync.</>}
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
            calculados a partir dos totais do período. <b>Alcance e frequência</b> vêm deduplicados por
            período do Meta (não são a soma dos dias).</span>
          </div>
        </>
      )}
    </div>
  )
}

// Aba Análises: leitura por IA das campanhas. Lê o cache (meta_analyses) ao abrir e regenera sob demanda.
function AnalysisView({ uid, period, setPeriod }) {
  // Dentro do componente (lê C no render) — nunca no nível de módulo, senão não acompanha o tema.
  const TIPO = {
    escalar:  { icon: '↑', color: C.green,       bg: 'rgba(16,185,129,.14)' },
    destaque: { icon: '★', color: C.accentLight, bg: 'rgba(59,130,246,.14)' },
    ajustar:  { icon: '⚠', color: C.yellow,      bg: 'rgba(245,158,11,.14)' },
    pausar:   { icon: '⏸', color: C.red,         bg: 'rgba(239,68,68,.14)' },
  }
  const [items, setItems] = useState([])
  const [generatedAt, setGeneratedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [empty, setEmpty] = useState(false)

  useEffect(() => {
    if (!uid) return
    let mounted = true
    async function loadCache() {
      setLoading(true); setError(null); setEmpty(false)
      const { data, error: err } = await supabase.from('meta_analyses')
        .select('generated_at, payload').eq('user_id', uid).eq('period', period).maybeSingle()
      if (!mounted) return
      if (err) { setError(err.message); setLoading(false); return }
      setItems(data?.payload?.items ?? [])
      setGeneratedAt(data?.generated_at ?? null)
      setLoading(false)
    }
    loadCache()
    return () => { mounted = false }
  }, [uid, period])

  async function reanalyze() {
    if (running) return
    setRunning(true); setError(null); setEmpty(false)
    const r = await requestMetaAnalysis({ period })
    setRunning(false)
    if (r?.error) { setError(r.error); return }
    if (r?.empty) { setItems([]); setGeneratedAt(null); setEmpty(true); return }
    setItems(r?.items ?? [])
    setGeneratedAt(r?.generatedAt ?? new Date().toISOString())
  }

  const fresh = generatedAt ? freshness(generatedAt) : null
  const st = {
    bar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 },
    pills: { display: 'flex', gap: 6, flexWrap: 'wrap' },
    pill: on => ({ padding: '6px 12px', fontSize: 12.5, borderRadius: 999, cursor: 'pointer',
      border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.surface, color: on ? '#fff' : C.textSub, fontWeight: on ? 700 : 500 }),
    btn: { border: 0, borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: running ? 'default' : 'pointer',
      background: C.accent, color: '#fff', opacity: running ? 0.6 : 1 },
    meta: { fontSize: 12, color: C.textSub, display: 'flex', alignItems: 'center', gap: 8 },
    list: { display: 'flex', flexDirection: 'column', gap: 10 },
    card: t => ({ display: 'flex', gap: 12, alignItems: 'flex-start', background: C.card, border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${(TIPO[t] || TIPO.destaque).color}`, borderRadius: 12, padding: '13px 15px' }),
    badge: t => ({ flexShrink: 0, width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center',
      background: (TIPO[t] || TIPO.destaque).bg, color: (TIPO[t] || TIPO.destaque).color, fontWeight: 700, fontSize: 14 }),
    title: { color: C.text, fontWeight: 700, fontSize: 13.5 },
    detail: { color: C.textSub, fontSize: 12.5, marginTop: 2, lineHeight: 1.5 },
    empty: { textAlign: 'center', padding: '44px 20px', color: C.textSub, background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, lineHeight: 1.5 },
    disclaimer: { fontSize: 11.5, color: C.textDim, marginTop: 14, display: 'flex', gap: 8, alignItems: 'flex-start' },
  }

  return (
    <div>
      <div style={st.bar}>
        <div style={st.pills}>
          {/* 'custom' fica de fora aqui: a análise por IA é cacheada por período fixo no
              backend (meta_analyses), que ainda não sabe lidar com intervalo arbitrário. */}
          {PERIODS.filter(p => p.key !== 'custom').map(p => (
            <span key={p.key} style={st.pill(period === p.key)} onClick={() => setPeriod(p.key)}>{p.label}</span>
          ))}
        </div>
        <div style={st.meta}>
          {fresh && <span>Gerado por IA · {fresh}</span>}
          <button style={st.btn} onClick={reanalyze} disabled={running}>{running ? 'Analisando…' : 'Reanalisar'}</button>
        </div>
      </div>

      {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={st.empty}>Carregando…</div>
      ) : empty ? (
        <div style={st.empty}>Sem dados do Meta no período para analisar. Conecte a conta e rode o sync primeiro.</div>
      ) : items.length === 0 ? (
        <div style={st.empty}>Nenhuma análise ainda. Clique em <b>Reanalisar</b> para a IA ler as campanhas do período.</div>
      ) : (
        <div style={st.list}>
          {items.map((it, i) => (
            <div key={i} style={st.card(it.tipo)}>
              <div style={st.badge(it.tipo)}>{(TIPO[it.tipo] || TIPO.destaque).icon}</div>
              <div>
                {it.titulo && <div style={st.title}>{it.titulo}</div>}
                {it.detalhe && <div style={st.detail}>{it.detalhe}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={st.disclaimer}>
        <span>💡</span>
        <span>Leitura automática por IA a partir dos números do Meta do período — é uma sugestão de
        gestão de tráfego, não um dado oficial. Clique em <b>Reanalisar</b> para atualizar.</span>
      </div>
    </div>
  )
}
