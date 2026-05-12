import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const TZ = 'America/Sao_Paulo'

const DEFAULTS = {
  concentrationAmount:5000,
  concentrationCount:5,
  delinquencyRatio:0.2,
  abruptIncreaseRatio:0.3,
}

function env(name, fallback = '') {
  return process.env[name] || fallback
}

export function getConfig() {
  return {
    supabaseUrl:env('VITE_SUPABASE_URL', env('SUPABASE_URL')),
    serviceRoleKey:env('SUPABASE_SERVICE_ROLE_KEY'),
    cronSecret:env('CRON_SECRET', env('VERCEL_CRON_SECRET')),
    googleClientId:env('GOOGLE_CLIENT_ID'),
    googleClientSecret:env('GOOGLE_CLIENT_SECRET'),
    googleRedirectUri:env('GOOGLE_REDIRECT_URI'),
    googleSheetsSpreadsheetId:env('GOOGLE_SHEETS_SPREADSHEET_ID'),
    serviceAccountEmail:env('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    serviceAccountPrivateKey:env('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n'),
    senderEmail:env('ALERTS_SENDER_EMAIL', 'surgimetrics@gmail.com'),
    fromName:env('ALERTS_EMAIL_FROM_NAME', 'SurgiMetrics Alertas'),
    subject:env('ALERTS_EMAIL_SUBJECT', 'Alerta financeiro: risco de caixa e vencimentos'),
  }
}

export function getTodayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:TZ,
    year:'numeric', month:'2-digit', day:'2-digit',
  }).formatToParts(now)
  const y = parts.find(p => p.type === 'year')?.value
  const m = parts.find(p => p.type === 'month')?.value
  const d = parts.find(p => p.type === 'day')?.value
  return `${y}-${m}-${d}`
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function createAdminClient(config = getConfig()) {
  if (!config.supabaseUrl || !config.serviceRoleKey) throw new Error('Supabase admin env not configured')
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth:{ persistSession:false, autoRefreshToken:false },
  })
}

function sumBy(items, key) {
  return (items || []).reduce((acc, item) => acc + Number(item?.[key] || 0), 0)
}

function isPendingStatus(value) {
  return String(value || '').toLowerCase() !== 'pago' && String(value || '').toLowerCase() !== 'cancelado'
}

function between(date, start, end) {
  return date >= start && date <= end
}

function currency(value) {
  return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(Number(value || 0))
}

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`
}

function esc(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function levelForTriggers(triggerKeys) {
  if (triggerKeys.includes('overdue_payables') || triggerKeys.includes('cash_risk')) return 'critical'
  if (triggerKeys.includes('recurrence_risk') || triggerKeys.includes('abrupt_increase')) return 'high'
  return 'medium'
}

export async function listAuthUsers(admin) {
  const users = []
  let page = 1
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage:200 })
    if (error) throw error
    const chunk = data?.users || []
    users.push(...chunk)
    if (chunk.length < 200) break
    page += 1
  }
  return users
}

export async function ensureSubscribers(admin, users) {
  const rows = (users || [])
    .filter(user => user?.id && user?.email)
    .map(user => ({ user_id:user.id, email:user.email, enabled:true }))

  if (!rows.length) return
  const { error } = await admin.from('alert_subscribers').upsert(rows, { onConflict:'user_id' })
  if (error) throw error
}

export async function fetchUserFinancialData(admin, userId, today) {
  const plus3 = addDays(today, 3)
  const plus7 = addDays(today, 7)
  const minus7 = addDays(today, -7)
  const minus1 = addDays(today, -1)

  const [payableRes, receivableRes, entriesRes, exitsRes, riskRes, sentTodayRes] = await Promise.all([
    admin.from('accounts_payable').select('source_id, description, category, value, due_date, status').eq('user_id', userId),
    admin.from('accounts_receivable').select('source_id, patient, description, value, due_date, status').eq('user_id', userId),
    admin.from('entries_financial').select('value, date').eq('user_id', userId).lte('date', today),
    admin.from('exits_financial').select('value, date').eq('user_id', userId).lte('date', today),
    admin.from('alert_risk_daily').select('reference_date, risk_level').eq('user_id', userId).gte('reference_date', addDays(today, -3)).order('reference_date', { ascending:false }),
    admin.from('alert_dispatch_log').select('id').eq('user_id', userId).eq('reference_date', today).limit(1),
  ])

  if (payableRes.error) throw payableRes.error
  if (receivableRes.error) throw receivableRes.error
  if (entriesRes.error) throw entriesRes.error
  if (exitsRes.error) throw exitsRes.error
  if (riskRes.error) throw riskRes.error
  if (sentTodayRes.error) throw sentTodayRes.error

  const payable = (payableRes.data || []).filter(item => isPendingStatus(item.status) && item.due_date)
  const receivable = (receivableRes.data || []).filter(item => isPendingStatus(item.status) && item.due_date)

  const overduePayables = payable.filter(item => item.due_date < today)
  const dueIn3 = payable.filter(item => between(item.due_date, today, plus3))
  const dueIn7 = payable.filter(item => between(item.due_date, today, plus7))

  const entries7 = receivable.filter(item => between(item.due_date, today, plus7))
  const exits7 = dueIn7
  const projectedDeficit = Math.max(0, sumBy(exits7, 'value') - sumBy(entries7, 'value'))

  const concentrationValue = sumBy(dueIn3, 'value')
  const concentrationTriggered = dueIn3.length > DEFAULTS.concentrationCount || concentrationValue > DEFAULTS.concentrationAmount

  const overdueReceivable = receivable.filter(item => item.due_date < today)
  const dueWeekReceivableTotal = sumBy(entries7, 'value')
  const overdueReceivableTotal = sumBy(overdueReceivable, 'value')
  const delinquencyRatio = dueWeekReceivableTotal > 0 ? overdueReceivableTotal / dueWeekReceivableTotal : 0

  const thisWeekPayables = sumBy(payable.filter(item => between(item.due_date, today, plus7)), 'value')
  const prevWeekPayables = sumBy(payable.filter(item => between(item.due_date, minus7, minus1)), 'value')
  const abruptIncreaseRatio = prevWeekPayables > 0 ? (thisWeekPayables - prevWeekPayables) / prevWeekPayables : 0

  const cashBalance = sumBy(entriesRes.data, 'value') - sumBy(exitsRes.data, 'value')
  const futureDeficitFromBalance = (cashBalance + sumBy(entries7, 'value')) - sumBy(exits7, 'value')

  const triggerKeys = []
  if (overduePayables.length > 0) triggerKeys.push('overdue_payables')
  if (dueIn3.length > 0 || dueIn7.length > 0) triggerKeys.push('upcoming_due')
  if (futureDeficitFromBalance < 0 || projectedDeficit > 0) triggerKeys.push('cash_risk')
  if (concentrationTriggered) triggerKeys.push('due_concentration')
  if (delinquencyRatio > DEFAULTS.delinquencyRatio) triggerKeys.push('delinquency_impact')
  if (abruptIncreaseRatio > DEFAULTS.abruptIncreaseRatio) triggerKeys.push('abrupt_increase')

  const previousRiskDays = (riskRes.data || []).filter(row => row.reference_date < today && row.risk_level !== 'none').length
  if (triggerKeys.length > 0 && previousRiskDays >= 2) triggerKeys.push('recurrence_risk')

  const payload = {
    cashBalance,
    projectedDeficit,
    futureDeficitFromBalance,
    overduePayablesCount:overduePayables.length,
    overduePayablesTotal:sumBy(overduePayables, 'value'),
    dueIn3Count:dueIn3.length,
    dueIn3Total:sumBy(dueIn3, 'value'),
    dueIn7Count:dueIn7.length,
    dueIn7Total:sumBy(dueIn7, 'value'),
    delinquencyRatio,
    overdueReceivableTotal,
    dueWeekReceivableTotal,
    abruptIncreaseRatio,
    thisWeekPayables,
    prevWeekPayables,
  }

  return {
    triggerKeys,
    payload,
    riskLevel:triggerKeys.length ? levelForTriggers(triggerKeys) : 'none',
    alreadySentToday:(sentTodayRes.data || []).length > 0,
  }
}

export function buildAlertHtml({ email, referenceDate, triggerKeys, payload, dashboardUrl = '' }) {
  const chips = triggerKeys.map(key => {
    const label = {
      overdue_payables:'Contas vencidas',
      upcoming_due:'Vencimentos próximos',
      cash_risk:'Risco de caixa',
      due_concentration:'Concentração de vencimentos',
      delinquency_impact:'Inadimplência impactando caixa',
      recurrence_risk:'Risco recorrente (3 dias)',
      abrupt_increase:'Aumento brusco de saídas',
    }[key] || key
    return `<span style="display:inline-block;padding:6px 10px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:12px;margin:4px 6px 0 0;font-weight:600">${esc(label)}</span>`
  }).join('')

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f5f7fb;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
      <tr>
        <td align="center">
          <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
            <tr>
              <td style="padding:24px;background:linear-gradient(135deg,#0f172a,#1e293b)">
                <div style="font-size:13px;color:#94a3b8;letter-spacing:.08em;text-transform:uppercase">SurgiMetrics</div>
                <h1 style="margin:8px 0 0;color:#f8fafc;font-size:22px;line-height:1.25">Alerta financeiro da clínica</h1>
                <p style="margin:8px 0 0;color:#cbd5e1;font-size:14px">Data de referência: ${esc(referenceDate)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px">
                <p style="margin:0 0 12px;font-size:15px;color:#334155">Detectamos sinais de risco para a conta <strong>${esc(email)}</strong>.</p>
                <div style="margin:0 0 18px">${chips}</div>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 8px">
                  <tr><td style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc">Contas vencidas: <strong>${payload.overduePayablesCount}</strong> (${currency(payload.overduePayablesTotal)})</td></tr>
                  <tr><td style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc">Vencendo em 3 dias: <strong>${payload.dueIn3Count}</strong> (${currency(payload.dueIn3Total)})</td></tr>
                  <tr><td style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc">Vencendo em 7 dias: <strong>${payload.dueIn7Count}</strong> (${currency(payload.dueIn7Total)})</td></tr>
                  <tr><td style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc">Saldo atual: <strong>${currency(payload.cashBalance)}</strong></td></tr>
                  <tr><td style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc">Déficit projetado 7 dias: <strong style="color:#b91c1c">${currency(payload.projectedDeficit)}</strong></td></tr>
                  <tr><td style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc">Inadimplência relevante: <strong>${pct(payload.delinquencyRatio)}</strong></td></tr>
                </table>
                ${dashboardUrl ? `<a href="${esc(dashboardUrl)}" style="display:inline-block;margin-top:18px;background:#0f172a;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:600">Abrir painel financeiro</a>` : ''}
                <p style="margin:22px 0 0;font-size:12px;color:#64748b">Este email é automático e enviado uma vez por dia por clínica quando há risco ativo.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw:text } }
  if (!res.ok) throw new Error(json.error_description || json.error?.message || json.error || `HTTP ${res.status}`)
  return json
}

export async function getServiceAccessToken(config = getConfig()) {
  if (!config.serviceAccountEmail || !config.serviceAccountPrivateKey) throw new Error('Service account env not configured')
  const now = Math.floor(Date.now() / 1000)
  const header = { alg:'RS256', typ:'JWT' }
  const claim = {
    iss:config.serviceAccountEmail,
    scope:'https://www.googleapis.com/auth/spreadsheets',
    aud:'https://oauth2.googleapis.com/token',
    exp:now + 3600,
    iat:now,
  }
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsigned)
  const signature = signer.sign(config.serviceAccountPrivateKey, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const assertion = `${unsigned}.${signature}`

  const body = new URLSearchParams({
    grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  })
  const token = await fetchJson('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body,
  })
  return token.access_token
}

export async function appendSheetsRow(values, sheetName, config = getConfig()) {
  if (!config.googleSheetsSpreadsheetId) return
  const accessToken = await getServiceAccessToken(config)
  const range = encodeURIComponent(`${sheetName}!A:Z`)
  await fetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheetsSpreadsheetId}/values/${range}:append?valueInputOption=RAW`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ values:[values] }),
  })
}

export async function getGmailAccessToken(admin, config = getConfig()) {
  const { data, error } = await admin.from('google_oauth_tokens').select('refresh_token').eq('provider', 'gmail').maybeSingle()
  if (error) throw error
  if (!data?.refresh_token) throw new Error('Gmail nao conectado. Conecte em /api/google/oauth/start')

  const body = new URLSearchParams({
    client_id:config.googleClientId,
    client_secret:config.googleClientSecret,
    refresh_token:data.refresh_token,
    grant_type:'refresh_token',
  })

  const token = await fetchJson('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body,
  })

  return token.access_token
}

export async function sendGmailHtml({ to, subject, html, admin, config = getConfig() }) {
  const accessToken = await getGmailAccessToken(admin, config)
  const textFallback = 'Abra este email em cliente compatível HTML para ver o alerta formatado.'
  const mime = [
    `From: ${config.fromName} <${config.senderEmail}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="alert_boundary"',
    '',
    '--alert_boundary',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    textFallback,
    '--alert_boundary',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html,
    '--alert_boundary--',
  ].join('\r\n')

  const raw = Buffer.from(mime).toString('base64url')

  await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method:'POST',
    headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ raw }),
  })
}

export async function persistRiskSnapshot(admin, userId, today, riskLevel, triggerKeys, payload) {
  const { error } = await admin
    .from('alert_risk_daily')
    .upsert({ user_id:userId, reference_date:today, risk_level:riskLevel, trigger_keys:triggerKeys, payload }, { onConflict:'user_id,reference_date' })
  if (error) throw error
}

export async function persistDispatchLog(admin, row) {
  const { error } = await admin.from('alert_dispatch_log').insert(row)
  if (error) throw error
}
