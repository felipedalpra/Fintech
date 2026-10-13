// api/_lib/metaInsights.js — Meta Ads Insights (espelho fiel do Meta).
// Partes PURAS (testáveis): parseInsightsResponse, deriveMetrics.
// Orquestração: syncMetaInsights(supabase, opts) — lê estrutura + insights do Meta e faz upsert
// idempotente nas tabelas de cache. NÃO toca o financeiro.
//
// O sync é chamado pelo cron de alertas (api/alerts/process.js) e por api/whatsapp.js?action=meta-sync.

// Tipos de ação que contam como "lead" nos insights do Meta.
const LEAD_ACTION_TYPES = new Set(['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped'])

// ---------- Puro ----------

// Converte uma string decimal do Meta ('3120.50') para número; vazio/indefinido → 0.
function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Soma os valores das actions cujo tipo representa um lead.
function sumLeads(actions) {
  let total = 0
  for (const a of actions || []) {
    if (LEAD_ACTION_TYPES.has(a?.action_type)) total += num(a.value)
  }
  return total
}

// O id de referência de cada nível tem um nome de campo próprio no retorno do Meta.
const REF_FIELD = { campaign: 'campaign_id', adset: 'adset_id', ad: 'ad_id' }

// Normaliza o retorno de GET /act_<id>/insights (time_increment=1) em linhas de cache.
// Cada linha: { level, ref_id, campaign_id, date, spend, impressions, reach, clicks, leads }.
export function parseInsightsResponse(body, level) {
  const refField = REF_FIELD[level]
  const rows = []
  for (const r of body?.data || []) {
    const ref_id = r?.[refField]
    if (!ref_id) continue
    rows.push({
      level,
      ref_id,
      campaign_id: r.campaign_id || (level === 'campaign' ? ref_id : null),
      date: r.date_start,
      spend: num(r.spend),
      impressions: num(r.impressions),
      reach: num(r.reach),
      clicks: num(r.clicks),
      leads: sumLeads(r.actions),
    })
  }
  return rows
}

// Divisão segura: denominador 0/ausente → 0 (nunca NaN/Infinity).
function div(a, b) {
  const d = Number(b)
  return d ? Number(a) / d : 0
}

// Métricas derivadas a partir dos valores crus (calculadas na leitura, nunca armazenadas).
// ctr e cpc/cpm em reais; frequency = impressões/alcance; cpl = gasto/leads.
export function deriveMetrics({ spend = 0, impressions = 0, reach = 0, clicks = 0, leads = 0 } = {}) {
  return {
    ctr: div(clicks, impressions) * 100,
    cpc: div(spend, clicks),
    cpm: div(spend, impressions) * 1000,
    frequency: div(impressions, reach),
    cpl: div(spend, leads),
  }
}

// ---------- Orquestração (integração; não unit-testada) ----------

const GRAPH = 'https://graph.facebook.com'

// 'YYYY-MM-DD' a partir de um Date (UTC).
function isoDate(d) { return d.toISOString().slice(0, 10) }

// GET na Graph API seguindo paginação (cap de páginas pra não rodar sem fim).
async function graphGetAll(version, token, path, params = {}, maxPages = 25) {
  const qs = new URLSearchParams({ ...params, access_token: token, limit: '200' })
  let url = `${GRAPH}/${version}/${path}?${qs.toString()}`
  const all = []
  for (let page = 0; page < maxPages && url; page++) {
    const res = await fetch(url)
    if (!res.ok) {
      const err = await res.text().catch(() => String(res.status))
      throw new Error(`Meta Graph error (${path}): ${err}`)
    }
    const json = await res.json()
    for (const row of json?.data || []) all.push(row)
    url = json?.paging?.next || null
  }
  return all
}

// Campos de insights por nível.
const INSIGHT_FIELDS = {
  campaign: 'campaign_id,spend,impressions,reach,clicks,actions',
  adset: 'adset_id,campaign_id,spend,impressions,reach,clicks,actions',
  ad: 'ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,actions',
}

// Sincroniza estrutura + insights de UMA clínica para o cache. Retorna contagem por tabela.
async function syncOwner(supabase, conn, { version, since, until }) {
  const { user_id, ad_account_id, access_token } = conn
  const acct = String(ad_account_id).startsWith('act_') ? ad_account_id : `act_${ad_account_id}`
  const now = new Date().toISOString()
  const counts = { campaigns: 0, adsets: 0, ads: 0, insights: 0 }

  // 1) Estrutura (nome/status pra exibir junto dos números).
  const campaigns = await graphGetAll(version, access_token, `${acct}/campaigns`, { fields: 'id,name,status,objective' })
  if (campaigns.length) {
    const rows = campaigns.map(c => ({ user_id, campaign_id: c.id, name: c.name, status: c.status, objective: c.objective, updated_at: now }))
    const { error } = await supabase.from('meta_campaigns').upsert(rows, { onConflict: 'user_id,campaign_id' })
    if (error) throw error
    counts.campaigns = rows.length
  }
  const adsets = await graphGetAll(version, access_token, `${acct}/adsets`, { fields: 'id,name,status,campaign_id' })
  if (adsets.length) {
    const rows = adsets.map(a => ({ user_id, adset_id: a.id, campaign_id: a.campaign_id, name: a.name, status: a.status, updated_at: now }))
    const { error } = await supabase.from('meta_adsets').upsert(rows, { onConflict: 'user_id,adset_id' })
    if (error) throw error
    counts.adsets = rows.length
  }
  const ads = await graphGetAll(version, access_token, `${acct}/ads`, { fields: 'id,name,status,adset_id,campaign_id' })
  if (ads.length) {
    const rows = ads.map(a => ({ user_id, ad_id: a.id, adset_id: a.adset_id, campaign_id: a.campaign_id, name: a.name, status: a.status, updated_at: now }))
    const { error } = await supabase.from('meta_ads').upsert(rows, { onConflict: 'user_id,ad_id' })
    if (error) throw error
    counts.ads = rows.length
  }

  // 2) Insights diários por nível (campaign/adset/ad).
  const timeRange = JSON.stringify({ since, until })
  for (const level of ['campaign', 'adset', 'ad']) {
    const data = await graphGetAll(version, access_token, `${acct}/insights`, {
      level, time_increment: '1', time_range: timeRange, fields: INSIGHT_FIELDS[level],
    })
    const rows = parseInsightsResponse({ data }, level).map(r => ({ ...r, user_id, updated_at: now }))
    if (rows.length) {
      const { error } = await supabase.from('meta_insights').upsert(rows, { onConflict: 'user_id,level,ref_id,date' })
      if (error) throw error
      counts.insights += rows.length
    }
  }
  return counts
}

// Motor do sync: varre as clínicas conectadas e atualiza o cache. Fail-safe por clínica.
// opts: { owner?: só uma clínica, since?: 'YYYY-MM-DD', days?: janela padrão (30) }
export async function syncMetaInsights(supabase, opts = {}) {
  const version = process.env.META_GRAPH_VERSION
  if (!version) return { ok: false, reason: 'META_GRAPH_VERSION ausente', owners: 0 }

  const until = opts.until || isoDate(new Date())
  const since = opts.since || isoDate(new Date(Date.now() - (Number(opts.days || 30)) * 86400000))

  let query = supabase
    .from('meta_connections')
    .select('user_id, ad_account_id, access_token')
    .in('status', ['configurado', 'conectado'])
    .not('access_token', 'is', null)
    .not('ad_account_id', 'is', null)
  if (opts.owner) query = query.eq('user_id', opts.owner)

  const { data: conns, error } = await query
  if (error) throw error

  const summary = { ok: true, owners: 0, synced: 0, failures: 0, since, until, details: [] }
  for (const conn of conns || []) {
    summary.owners += 1
    try {
      const counts = await syncOwner(supabase, conn, { version, since, until })
      summary.synced += 1
      summary.details.push({ owner: conn.user_id, ...counts })
    } catch (e) {
      summary.failures += 1
      summary.details.push({ owner: conn.user_id, error: e?.message || 'erro no sync Meta' })
      console.error('meta insights sync error:', conn.user_id, e?.message)
    }
  }
  return summary
}
