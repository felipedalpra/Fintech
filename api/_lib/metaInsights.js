// api/_lib/metaInsights.js — Meta Ads Insights (espelho fiel do Meta).
// Partes PURAS (testáveis): parseInsightsResponse, deriveMetrics.
// Orquestração: syncMetaInsights(supabase, opts) — lê estrutura + insights do Meta e faz upsert
// idempotente nas tabelas de cache. NÃO toca o financeiro.
//
// O sync é chamado pelo cron de alertas (api/alerts/process.js) e por api/whatsapp.js?action=meta-sync.
import { decryptPayload } from './secureProfile.js'

// Tipos de ação que representam leads, em ordem de PREFERÊNCIA. Nas Insights API esses tipos
// costumam descrever o MESMO evento por recortes diferentes de atribuição — somá-los conta em
// dobro. Então pegamos UM, pelo primeiro que existir (nunca a soma).
const LEAD_ACTION_PRIORITY = ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped']

// ---------- Puro ----------

const TOKEN_EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000

// Decide o status pós-sync bem-sucedido a partir do vencimento do token. Nunca deixa a
// clínica "conectada" com um token já vencido, e avisa com 7 dias de antecedência.
export function metaConnectionStatusAfterSync(tokenExpiresAt, now = Date.now()) {
  if (!tokenExpiresAt) return 'conectado'
  const expiresAtMs = new Date(tokenExpiresAt).getTime()
  if (!Number.isFinite(expiresAtMs)) return 'conectado'
  if (expiresAtMs <= now) return 'erro'
  if (expiresAtMs - now <= TOKEN_EXPIRY_WARNING_MS) return 'expirando'
  return 'conectado'
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_SYNC_RANGE_DAYS = 400

// Validação do período pedido pelo sync sob demanda (handleMetaSyncRange). since/until no
// formato YYYY-MM-DD; todayIso também YYYY-MM-DD (injetado pra não depender de Date.now()
// no teste). Retorna { ok:true } ou { ok:false, error }.
export function validateMetaSyncRange(since, until, todayIso) {
  if (!DATE_RE.test(since) || !DATE_RE.test(until)) return { ok: false, error: 'since/until inválidos (use YYYY-MM-DD)' }
  if (since > until) return { ok: false, error: 'since não pode ser depois de until' }
  if (until > todayIso) return { ok: false, error: 'until não pode ser no futuro' }
  const spanDays = Math.round((new Date(`${until}T00:00:00Z`) - new Date(`${since}T00:00:00Z`)) / 86400000)
  if (spanDays > MAX_SYNC_RANGE_DAYS) return { ok: false, error: `Intervalo máximo de ${MAX_SYNC_RANGE_DAYS} dias por sincronização.` }
  return { ok: true }
}

// Converte uma string decimal do Meta ('3120.50') para número; vazio/indefinido → 0.
function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Escolhe a contagem de leads pelo tipo de maior prioridade presente (sem somar tipos).
function pickLeads(actions) {
  const byType = {}
  for (const a of actions || []) {
    if (a?.action_type != null) byType[a.action_type] = num(a.value)
  }
  for (const type of LEAD_ACTION_PRIORITY) {
    if (byType[type] != null) return byType[type]
  }
  return 0
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
      leads: pickLeads(r.actions),
    })
  }
  return rows
}

// Normaliza GET insights por INTERVALO (sem time_increment) em linhas de alcance/frequência.
// Alcance é deduplicado por período, por isso vem de uma consulta separada (não dos diários).
// level='account' não tem id próprio → ref_id 'account'.
export function parseReachResponse(body, level) {
  const refField = REF_FIELD[level]
  const rows = []
  for (const r of body?.data || []) {
    const ref_id = level === 'account' ? 'account' : r?.[refField]
    if (!ref_id) continue
    rows.push({ level, ref_id, reach: num(r.reach), frequency: num(r.frequency) })
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

// Campos de alcance/frequência por nível (consulta por intervalo, sem time_increment).
const REACH_FIELDS = {
  account: 'reach,frequency',
  campaign: 'campaign_id,reach,frequency',
  adset: 'adset_id,reach,frequency',
  ad: 'ad_id,reach,frequency',
}

// Sincroniza estrutura + insights + alcance de UMA clínica para o cache. Retorna contagem por tabela.
async function syncOwner(supabase, conn, { version, since, until, reachPeriods }) {
  const { user_id, ad_account_id, access_token } = conn
  const acct = String(ad_account_id).startsWith('act_') ? ad_account_id : `act_${ad_account_id}`
  const now = new Date().toISOString()
  const counts = { campaigns: 0, adsets: 0, ads: 0, insights: 0, reach: 0 }

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

  // 3) Alcance/frequência por período (deduplicado — consulta por intervalo, sem time_increment).
  //    'account' = alcance da conta inteira (para o KPI, que não pode ser a soma das campanhas).
  for (const p of reachPeriods || []) {
    const tr = JSON.stringify({ since: p.since, until })
    for (const level of ['account', 'campaign', 'adset', 'ad']) {
      const params = { time_range: tr, fields: REACH_FIELDS[level] }
      if (level !== 'account') params.level = level
      const data = await graphGetAll(version, access_token, `${acct}/insights`, params)
      const rows = parseReachResponse({ data }, level).map(r => ({ ...r, user_id, period: p.key, updated_at: now }))
      if (rows.length) {
        const { error } = await supabase.from('meta_reach').upsert(rows, { onConflict: 'user_id,level,ref_id,period' })
        if (error) throw error
        counts.reach += rows.length
      }
    }
  }
  return counts
}

// Motor do sync: varre as clínicas conectadas e atualiza o cache. Fail-safe por clínica.
// opts: { owner?: só uma clínica, since?: 'YYYY-MM-DD', days?: janela padrão (30) }
export async function syncMetaInsights(supabase, opts = {}) {
  const version = process.env.META_GRAPH_VERSION
  if (!version) return { ok: false, reason: 'META_GRAPH_VERSION ausente', owners: 0 }

  // Janela padrão de 90 dias: cobre todos os períodos da tela (mês/30d/trimestre) sem
  // subestimar silenciosamente. days inválido cai no padrão (nunca gera data NaN).
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  const days = Number.isInteger(opts.days) && opts.days > 0 && opts.days <= 90 ? opts.days : 90
  const until = ISO.test(opts.until || '') ? opts.until : isoDate(new Date())
  const since = ISO.test(opts.since || '') ? opts.since : isoDate(new Date(Date.now() - days * 86400000))

  // Janelas de alcance que a tela oferece (cada uma termina em `until`) — SEMPRE relativas
  // a `until`, então só fazem sentido quando `until` é "agora" (sync normal). Um sync de
  // intervalo histórico sob demanda (opts.skipReach) pularia escrever period='month'/'30d'/
  // 'quarter' com números calculados a partir de um `until` antigo, o que sobrescreveria
  // silenciosamente o Alcance ATUAL de verdade com dado velho.
  const u = new Date(until + 'T00:00:00Z')
  const reachPeriods = opts.skipReach ? [] : [
    { key: 'month', since: isoDate(new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), 1))) },
    { key: '30d', since: isoDate(new Date(u.getTime() - 29 * 86400000)) },
    { key: 'quarter', since: isoDate(new Date(u.getTime() - 89 * 86400000)) },
  ]

  let query = supabase
    .from('meta_connections')
    .select('user_id, ad_account_id, access_token_encrypted, token_expires_at')
    .in('status', ['conectado', 'expirando'])
    .not('access_token_encrypted', 'is', null)
    .not('ad_account_id', 'is', null)
  if (opts.owner) query = query.eq('user_id', opts.owner)

  const { data: rawConns, error } = await query
  if (error) throw error

  // act_<id>/campanhas, adsets, ads e insights são endpoints de Conta de Anúncios: exigem o
  // token de USUÁRIO (ads_read), não o pageToken — pageToken só serve pra ações de Página
  // (ex.: leads_retrieval dos formulários, em handleMetaWebhook). Usar pageToken aqui derruba
  // toda consulta com "(#100) Unsupported get request" do Graph API.
  const conns = (rawConns || [])
    .map(row => ({
      user_id: row.user_id,
      ad_account_id: row.ad_account_id,
      access_token: decryptPayload(row.access_token_encrypted)?.userToken,
      token_expires_at: row.token_expires_at,
    }))
    .filter(conn => conn.access_token)

  const summary = { ok: true, owners: 0, synced: 0, failures: 0, since, until, details: [] }
  for (const conn of conns) {
    summary.owners += 1
    try {
      const counts = await syncOwner(supabase, conn, { version, since, until, reachPeriods })
      summary.synced += 1
      summary.details.push({ owner: conn.user_id, ...counts })
      // Sync real bem-sucedido valida a conexão; ainda assim, nunca mostra "conectado"
      // com um token vencido ou perto de vencer (ver metaConnectionStatusAfterSync).
      await supabase.from('meta_connections')
        .update({ status: metaConnectionStatusAfterSync(conn.token_expires_at), updated_at: new Date().toISOString() })
        .eq('user_id', conn.user_id)
    } catch (e) {
      summary.failures += 1
      summary.details.push({ owner: conn.user_id, error: e?.message || 'erro no sync Meta' })
      console.error('meta insights sync error:', conn.user_id, e?.message)
      // Marca erro para o usuário ver (ex.: token expirado) em vez de falhar em silêncio.
      // PostgrestFilterBuilder só garante .then (thenable), não .catch — por isso try/await,
      // não encadeamento direto (que lançava "catch is not a function" e mascarava o erro real).
      try {
        await supabase.from('meta_connections')
          .update({ status: 'erro', updated_at: new Date().toISOString() })
          .eq('user_id', conn.user_id)
      } catch {}
    }
  }
  return summary
}
