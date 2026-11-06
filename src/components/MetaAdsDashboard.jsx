import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { conversionBreakdown, engagementFromActions, sumActions } from '../lib/metaActions.js'
import { buildFindings, compareMetric, previousPeriod } from '../lib/metaComparison.js'
import { dailySeries } from '../lib/metaSeries.js'
import { CampaignComparison, DailyBars, SERIES_COLORS } from './MetaAdsCharts.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { aggregateInsights, deriveMetrics, fmtBRL, fmtInt, fmtPct } from '../lib/metaMetrics.js'
import { requestMetaAnalysis } from '../lib/aiClient.js'
import { syncMetaRange } from '../lib/metaOAuthClient.js'
import MetaCreatives from './MetaCreatives.jsx'

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
  const [query, setQuery] = useState('')
  const [prevInsights, setPrevInsights] = useState([])
  const [thumbs, setThumbs] = useState({})
  const [drill, setDrill] = useState(null)  // { campaign_id, name } — filtra níveis abaixo
  const [lastRun, setLastRun] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
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

  // Atualização manual: busca no Meta o período que está na tela e recarrega.
  async function refreshNow() {
    setRefreshing(true)
    try {
      const { since, until } = rangeFor(period, customRange)
      await syncMetaRange({ since, until })
    } catch (e) {
      setRangeSyncError(e.message || 'Não foi possível atualizar agora.')
    } finally {
      setRefreshing(false)
      setReloadKey(k => k + 1)
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
          .select('level, ref_id, campaign_id, date, spend, impressions, clicks, leads, actions, updated_at')
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

      // Período anterior: vem do MESMO cache, sem requisição nova à Meta. Sem ele não há
      // comparação possível, e inventar uma base seria pior que não comparar.
      const anterior = previousPeriod(since, until)
      if (anterior) {
        const prevRes = await supabase.from('meta_insights')
          .select('ref_id, spend, impressions, clicks, leads')
          .eq('user_id', uid).eq('level', level).gte('date', anterior.start).lte('date', anterior.end)
        if (mounted) setPrevInsights(prevRes.error ? [] : (prevRes.data ?? []))
      } else if (mounted) setPrevInsights([])

      const runRes = await supabase.from('meta_sync_runs')
        .select('started_at, finished_at, ok, counts, error_code, error_text, trigger')
        .eq('user_id', uid).order('started_at', { ascending: false }).limit(1).maybeSingle()
      if (mounted) setLastRun(runRes.error ? null : runRes.data)

      if (level === 'ad') {
        const thumbRes = await supabase.from('meta_ads').select('ad_id, thumbnail_url').eq('user_id', uid)
        if (mounted) setThumbs(Object.fromEntries((thumbRes.data ?? []).map(r => [r.ad_id, r.thumbnail_url])))
      } else if (mounted) setThumbs({})
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
    // Drill: ao abrir uma campanha, os níveis abaixo mostram só o que pertence a ela.
    const doDrill = drill ? agg.filter(row => row.campaign_id === drill.campaign_id) : agg
    const busca = query.trim().toLowerCase()
    const filtrado = busca ? doDrill.filter(row => String(row.name || '').toLowerCase().includes(busca)) : doDrill
    const dir = sort.dir === 'asc' ? 1 : -1
    const isText = sort.key === 'name' || sort.key === 'status'
    // null (ex.: CPL sem leads) vai pro fim, nunca é tratado como "melhor".
    const nval = v => (v == null ? Infinity : Number(v) || 0)
    filtrado.sort((x, y) => isText
      ? String(x[sort.key] ?? '').localeCompare(String(y[sort.key] ?? ''), 'pt-BR') * dir
      : (nval(x[sort.key]) - nval(y[sort.key])) * dir)
    return filtrado
  }, [insights, names, reachMap, sort, query, drill])

  const totals = useMemo(() => {
    const t = rows.reduce((a, r) => ({
      spend: a.spend + r.spend, impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks, leads: a.leads + r.leads,
    }), { spend: 0, impressions: 0, clicks: 0, leads: 0 })
    const d = deriveMetrics(t)
    return { ...t, ...d, cpl: t.leads > 0 ? d.cpl : null }
  }, [rows])

  // Tudo abaixo sai do `actions` que já vinha da Meta e era descartado — nenhuma chamada nova.
  const actionsMap = useMemo(() => sumActions(insights), [insights])
  const engagement = useMemo(() => engagementFromActions(actionsMap), [actionsMap])
  const conversions = useMemo(() => conversionBreakdown(actionsMap), [actionsMap])

  const prevTotals = useMemo(() => {
    const t = (prevInsights || []).reduce((a, r) => ({
      spend: a.spend + Number(r.spend || 0), impressions: a.impressions + Number(r.impressions || 0),
      clicks: a.clicks + Number(r.clicks || 0), leads: a.leads + Number(r.leads || 0),
    }), { spend: 0, impressions: 0, clicks: 0, leads: 0 })
    const d = deriveMetrics(t)
    return { ...t, ...d, cpl: t.leads > 0 ? d.cpl : null }
  }, [prevInsights])

  const series = useMemo(() => {
    const { since, until } = rangeFor(period, customRange)
    return dailySeries(insights, since, until)
  }, [insights, period, customRange])

  const findings = useMemo(() => {
    const prevAgg = aggregateInsights(prevInsights).map(a => {
      const d = deriveMetrics(a)
      return { ...a, ...d, cpl: a.leads > 0 ? d.cpl : null }
    })
    return buildFindings({ current: rows, previous: prevAgg })
  }, [rows, prevInsights])

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
        <div style={s.subtab(subtab === 'desempenho')} data-testid="subtab-desempenho" onClick={() => setSubtab('desempenho')}>📊 Desempenho</div>
        <div style={s.subtab(subtab === 'criativos')} data-testid="subtab-criativos" onClick={() => setSubtab('criativos')}>🖼️ Criativos</div>
        <div style={s.subtab(subtab === 'analises')} data-testid="subtab-analises" onClick={() => setSubtab('analises')}>💡 Análises</div>
      </div>

      {subtab === 'criativos' ? (
        <>
          <div style={s.pills}>
            {PERIODS.filter(p => p.key !== 'custom' || period === 'custom').map(p => (
              <span key={p.key} style={s.pill(period === p.key)} onClick={() => setPeriod(p.key)}>{p.label}</span>
            ))}
          </div>
          <div style={{ height: 14 }} />
          <MetaCreatives
            uid={uid}
            since={rangeFor(period, customRange).since}
            until={rangeFor(period, customRange).until}
            periodLabel={PERIODS.find(p => p.key === period)?.label ?? period}
          />
        </>
      ) : subtab === 'analises' ? (
        <AnalysisView uid={uid} period={period} setPeriod={setPeriod} customRange={customRange} findings={findings} />
      ) : (
        <>
          <div style={s.bar}>
            <div style={s.seg}>
              {LEVELS.map(l => (
                <button key={l.key} style={s.segBtn(level === l.key)} onClick={() => { setLevel(l.key); setDrill(null) }}>{l.label}</button>
              ))}
            </div>
            <div style={s.pills}>
              {PERIODS.map(p => (
                <span key={p.key} style={s.pill(period === p.key)} onClick={() => setPeriod(p.key)}>{p.label}</span>
              ))}
            </div>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`Buscar ${LEVELS.find(l => l.key === level)?.label.toLowerCase()}…`}
              aria-label="Buscar pelo nome"
              data-testid="ads-search"
              style={{ flex: '1 1 180px', minWidth: 150, background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 10, padding: '8px 12px', color: C.text, fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
            />
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }} data-testid="sync-status">
            {syncedAt && (lastRun?.ok === false
              // Com a última tentativa falhada, "Sincronizado" seria falso: o número na tela
              // é o da sincronização ANTERIOR, e é isso que a linha tem que dizer.
              ? <span style={{ ...s.fresh, color: C.yellow || '#F59E0B' }}>
                  <span style={{ ...s.dot, background: C.yellow || '#F59E0B' }} /> Dados de {freshness(syncedAt)}
                </span>
              : <span style={s.fresh}><span style={s.dot} /> Sincronizado com o Meta · {freshness(syncedAt)}</span>)}
            <button
              onClick={refreshNow}
              disabled={refreshing}
              data-testid="refresh-now"
              style={{ padding: '6px 12px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface,
                color: refreshing ? C.textDim : C.text, fontSize: 12, fontWeight: 700, cursor: refreshing ? 'default' : 'pointer', fontFamily: 'inherit' }}
            >
              {refreshing ? 'Atualizando…' : 'Atualizar agora'}
            </button>
            {/* A última tentativa, mesmo quando falhou: dado velho sem explicação é pior que
                dado velho com o motivo ao lado. */}
            {lastRun?.ok === false && (
              <span style={{ fontSize: 11.5, color: C.yellow || '#F59E0B' }}>
                {lastRun.error_code === 'rate_limit'
                  ? 'A Meta limitou as consultas na última tentativa — os números são da sincronização anterior. Tente de novo em alguns minutos.'
                  : lastRun.error_code === 'auth'
                    ? 'A última sincronização falhou por autenticação. Reconecte em Configurações → Meta Ads.'
                    : `Última sincronização falhou${lastRun.error_text ? `: ${lastRun.error_text}` : '.'}`}
              </span>
            )}
            {lastRun?.ok === false && lastRun.finished_at == null && (
              <span style={{ fontSize: 11.5, color: C.textDim }}>Interrompida antes de terminar.</span>
            )}
          </div>

          {diagnosis.text && (
            <div style={s.banner}>
              <span>{diagnosis.kind === 'no_campaigns' ? 'ℹ️' : '⚠️'}</span>
              <span>{diagnosis.text}</span>
            </div>
          )}

          {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{error}</div>}

          {drill && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }} data-testid="drill-crumb">
              <span style={{ fontSize: 12.5, color: C.textSub }}>
                Mostrando apenas <strong style={{ color: C.text }}>{drill.name}</strong>
              </span>
              <button
                onClick={() => { setDrill(null); setLevel('campaign') }}
                data-testid="drill-clear"
                style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface,
                  color: C.text, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Ver todas as campanhas
              </button>
            </div>
          )}

          <div style={s.kpis}>
            <Kpi label="Gasto" value={fmtBRL(totals.spend)} cmp={compareMetric('spend', totals.spend, prevTotals.spend)} />
            <Kpi label="Alcance" value={fmtReach(accountReach?.reach)} hint={accountReach ? `freq. ${fmtFreq(accountReach.frequency)}` : 'pessoas únicas'} />
            <Kpi label="Impressões" value={fmtInt(totals.impressions)} cmp={compareMetric('impressions', totals.impressions, prevTotals.impressions)} />
            <Kpi label="Cliques" value={fmtInt(totals.clicks)} cmp={compareMetric('clicks', totals.clicks, prevTotals.clicks)} />
            <Kpi label="CTR" value={fmtPct(totals.ctr)} cmp={compareMetric('ctr', totals.ctr, prevTotals.ctr)} />
            <Kpi label="CPC" value={fmtBRL(totals.cpc)} cmp={compareMetric('cpc', totals.cpc, prevTotals.cpc)} />
            <Kpi label="CPM" value={fmtBRL(totals.cpm)} cmp={compareMetric('cpm', totals.cpm, prevTotals.cpm)} />
            {/* Engajamento ausente mostra "—": a Meta não informou, e isso não é zero. */}
            <Kpi label="Engajamento" value={engagement == null ? '—' : fmtInt(engagement)} hint="interações com o anúncio" />
            <Kpi label="Leads" value={fmtInt(totals.leads)} cmp={compareMetric('leads', totals.leads, prevTotals.leads)} />
            {/* "Custo por resultado" e "CPL" são o MESMO cálculo quando o resultado é lead:
                gasto ÷ leads. Dois cartões com o mesmo número davam a impressão de duas
                métricas distintas. Fica um só, dizendo o que ele é. */}
            <Kpi label="Custo por resultado" value={fmtBRL(totals.cpl)} cmp={compareMetric('cpl', totals.cpl, prevTotals.cpl)} hint="por lead · gasto ÷ leads" hero />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 18 }}>
            <DailyBars points={series} metric="spend" label="Investimento por dia" color={SERIES_COLORS.spend} fmt={fmtBRL} testId="chart-spend" />
            <DailyBars points={series} metric="leads" label="Leads por dia" color={SERIES_COLORS.leads} fmt={fmtInt} testId="chart-leads" />
            <DailyBars points={series} metric="clicks" label="Cliques por dia" color={SERIES_COLORS.clicks} fmt={fmtInt} testId="chart-clicks" />
            <DailyBars points={series} metric="cpl" label="CPL por dia" color={SERIES_COLORS.cpl} fmt={fmtBRL} testId="chart-cpl" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 18 }}>
            <CampaignComparison rows={rows} metric="spend" label={`Investimento por ${LEVELS.find(l => l.key === level)?.label.toLowerCase()}`} fmt={fmtBRL} testId="chart-comparison" />
            <div style={{ padding: 14, borderRadius: 14, border: `1px solid ${C.border}`, background: C.card }} data-testid="conversions-breakdown">
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 12 }}>Conversões por tipo</div>
              {conversions.length === 0
                ? <div style={{ color: C.textDim, fontSize: 12, padding: '20px 0', textAlign: 'center' }}>A Meta não informou conversões neste período.</div>
                : conversions.slice(0, 8).map(item => (
                  <div key={item.type} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: `1px solid ${C.border}33` }}>
                    <span style={{ fontSize: 12, color: C.textSub }}>{item.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(item.value)}</span>
                  </div>
                ))}
            </div>
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
                      <tr
                        key={r.ref_id}
                        onClick={level === 'campaign' ? () => { setDrill({ campaign_id: r.ref_id, name: r.name }); setLevel('adset') } : undefined}
                        title={level === 'campaign' ? 'Ver os conjuntos desta campanha' : undefined}
                        style={level === 'campaign' ? { cursor: 'pointer' } : undefined}
                      >
                        <td style={{ ...s.td, textAlign: 'left', color: C.text, fontWeight: 600 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                            {/* A URL da miniatura expira no Meta: imagem quebrada some em vez de
                                deixar um ícone de erro no meio da tabela. */}
                            {level === 'ad' && thumbs[r.ref_id] && (
                              <img src={thumbs[r.ref_id]} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }}
                                style={{ width: 34, height: 34, borderRadius: 7, objectFit: 'cover', border: `1px solid ${C.border}`, flexShrink: 0 }} />
                            )}
                            <span>
                              {r.name}
                              {r.status && (
                                <span style={{ marginLeft: 8, fontSize: 9.5, fontWeight: 700, textTransform: 'lowercase',
                                  color: r.status === 'ACTIVE' ? (C.green || '#10B981') : C.textDim,
                                  background: r.status === 'ACTIVE' ? 'rgba(16,185,129,.14)' : `${C.border}55`,
                                  padding: '2px 6px', borderRadius: 5 }}>
                                  {r.status === 'ACTIVE' ? 'ativo' : r.status === 'PAUSED' ? 'pausado' : String(r.status).toLowerCase()}
                                </span>
                              )}
                              {r.ref_id === bestCplId && <span style={{ marginLeft: 8, fontSize: 9.5, fontWeight: 700, color: C.green, background: 'rgba(16,185,129,.14)', padding: '2px 6px', borderRadius: 5 }}>★ melhor CPL</span>}
                            </span>
                          </span>
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
function AnalysisView({ uid, period, setPeriod, customRange, findings = [] }) {
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

  // meta_analyses tem UNIQUE(user_id, period) sem colunas since/until — codifica o intervalo
  // direto na string pra cada combinação de datas ter seu próprio cache (ver parseMetaAnalysisPeriod
  // em api/financial-assistant.js, que decodifica o mesmo formato).
  const analysisPeriod = period === 'custom' ? `custom:${customRange.since}:${customRange.until}` : period

  useEffect(() => {
    if (!uid) return
    let mounted = true
    async function loadCache() {
      setLoading(true); setError(null); setEmpty(false)
      const { data, error: err } = await supabase.from('meta_analyses')
        .select('generated_at, payload').eq('user_id', uid).eq('period', analysisPeriod).maybeSingle()
      if (!mounted) return
      if (err) { setError(err.message); setLoading(false); return }
      setItems(data?.payload?.items ?? [])
      setGeneratedAt(data?.generated_at ?? null)
      setLoading(false)
    }
    loadCache()
    return () => { mounted = false }
  }, [uid, analysisPeriod])

  async function reanalyze() {
    if (running) return
    setRunning(true); setError(null); setEmpty(false)
    const r = await requestMetaAnalysis({ period: analysisPeriod })
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
    customNote: { fontSize: 12, color: C.textSub, marginBottom: 14 },
  }

  return (
    <div>
      <div style={st.bar}>
        <div style={st.pills}>
          {PERIODS.map(p => (
            <span key={p.key} style={st.pill(period === p.key)} onClick={() => setPeriod(p.key)}>{p.label}</span>
          ))}
        </div>
        <div style={st.meta}>
          {fresh && <span>Gerado por IA · {fresh}</span>}
          <button style={st.btn} onClick={reanalyze} disabled={running}>{running ? 'Analisando…' : 'Reanalisar'}</button>
        </div>
      </div>

      {/* Leituras por regra, calculadas sobre os números do período — sem IA e sem espera.
          Cada uma traz o valor que a sustenta, para ser conferível na tabela ao lado. */}
      {findings.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10, marginBottom: 16 }} data-testid="rule-findings">
          {findings.slice(0, 6).map((f, index) => {
            const cor = f.tone === 'bad' ? (C.red || '#EF4444') : (C.green || '#10B981')
            return (
              <div key={`${f.kind}-${f.ref_id}-${index}`} style={{ padding: 12, borderRadius: 12, border: `1px solid ${cor}44`, background: `${cor}10` }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: cor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {f.tone === 'bad' ? 'Atenção' : 'Destaque'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 5, overflowWrap: 'anywhere' }}>{f.name}</div>
                <div style={{ fontSize: 12, color: C.textSub, marginTop: 3, lineHeight: 1.5 }}>
                  {f.text}
                  {f.metric === 'cpl' && f.value != null && ` · ${fmtBRL(f.value)}`}
                  {f.metric === 'ctr' && ` · ${fmtPct(f.value)}`}
                  {f.metric === 'spend' && ` · ${fmtBRL(f.value)}`}
                  {f.pct != null && ` (+${f.pct.toFixed(0)}%)`}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {period === 'custom' && (
        <div style={st.customNote}>Analisando {customRange.since} até {customRange.until} — ajuste as datas na aba Desempenho.</div>
      )}

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

// Indicador com variação em relação ao período anterior.
// A cor segue se a mudança foi BOA, não se o número subiu: em custo, cair é bom. Sem base
// anterior não há seta nenhuma — "+100%" saindo de zero seria comparação inventada.
function Kpi({ label, value, hint, cmp, hero = false }) {
  const s = {
    box: {
      background: hero ? 'linear-gradient(160deg,rgba(59,130,246,.14),rgba(139,92,246,.07))' : C.card,
      border: `1px solid ${hero ? 'rgba(59,130,246,.35)' : C.border}`,
      borderRadius: 13, padding: '12px 14px',
    },
    label: { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: C.textDim },
    value: { fontSize: hero ? 21 : 18, fontWeight: 800, color: C.text, marginTop: 5, fontVariantNumeric: 'tabular-nums' },
    hint: { fontSize: 11, color: C.textSub, marginTop: 3 },
  }
  const temVariacao = cmp && cmp.pct != null && cmp.direction !== 'flat'
  const cor = cmp?.good === true ? (C.green || '#10B981') : cmp?.good === false ? (C.red || '#EF4444') : C.textSub
  return (
    <div style={s.box}>
      <div style={s.label}>{label}</div>
      <div style={s.value}>{value}</div>
      {temVariacao && (
        <div style={{ ...s.hint, color: cor, fontWeight: 700 }}>
          {cmp.direction === 'up' ? '▲' : '▼'} {Math.abs(cmp.pct).toFixed(1).replace('.', ',')}% vs. período anterior
        </div>
      )}
      {!temVariacao && hint && <div style={s.hint}>{hint}</div>}
    </div>
  )
}
