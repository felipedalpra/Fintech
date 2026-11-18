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
    googleSheetsSpreadsheetId:env('GOOGLE_SHEETS_SPREADSHEET_ID'),
    serviceAccountEmail:env('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    serviceAccountPrivateKey:env('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n'),
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

  const [payableRes, receivableRes, entriesRes, exitsRes, riskRes] = await Promise.all([
    admin.from('accounts_payable').select('source_id, description, category, value, due_date, status').eq('user_id', userId),
    admin.from('accounts_receivable').select('source_id, patient, description, value, due_date, status').eq('user_id', userId),
    admin.from('entries_financial').select('value, date').eq('user_id', userId).lte('date', today),
    admin.from('exits_financial').select('value, date').eq('user_id', userId).lte('date', today),
    admin.from('alert_risk_daily').select('reference_date, risk_level').eq('user_id', userId).gte('reference_date', addDays(today, -3)).order('reference_date', { ascending:false }),
  ])

  if (payableRes.error) throw payableRes.error
  if (receivableRes.error) throw receivableRes.error
  if (entriesRes.error) throw entriesRes.error
  if (exitsRes.error) throw exitsRes.error
  if (riskRes.error) throw riskRes.error

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
  }
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

export async function persistRiskSnapshot(admin, userId, today, riskLevel, triggerKeys, payload) {
  const { error } = await admin
    .from('alert_risk_daily')
    .upsert({ user_id:userId, reference_date:today, risk_level:riskLevel, trigger_keys:triggerKeys, payload }, { onConflict:'user_id,reference_date' })
  if (error) throw error
}
