import { decryptPayload, encryptPayload, getAdminSupabase } from '../secure-profile/_lib.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const CALENDAR_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary'
export const CALENDAR_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email'
const CONNECTIONS = 'google_calendar_connections'
const LINKS = 'google_calendar_event_links'

export class NeedsReconnectError extends Error {
  constructor() {
    super('needs_reconnect')
    this.name = 'NeedsReconnectError'
  }
}

export function getCalendarConfig() {
  return {
    clientId:process.env.GOOGLE_CLIENT_ID || '',
    clientSecret:process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri:process.env.GOOGLE_CALENDAR_REDIRECT_URI || '',
    appUrl:(process.env.APP_URL || process.env.VITE_APP_URL || '').replace(/\/+$/, ''),
    stateSecret:process.env.APP_DATA_ENCRYPTION_KEY || '',
  }
}

export function isConfigured(config) {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri && config.stateSecret)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function googleFetch(url, options = {}, attempt = 0) {
  const res = await fetch(url, options)
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw:text } }
  if (res.ok) return json

  if ((res.status === 429 || res.status === 503) && attempt < 2) {
    await sleep(400 * Math.pow(2, attempt))
    return googleFetch(url, options, attempt + 1)
  }

  const error = new Error(json.error_description || json.error?.message || json.error || `HTTP ${res.status}`)
  error.status = res.status
  error.code = typeof json.error === 'string' ? json.error : json.error?.status
  throw error
}

function bearer(accessToken) {
  return { Authorization:`Bearer ${accessToken}` }
}

// ---------- OAuth ----------

export function buildAuthUrl(config, state) {
  const params = new URLSearchParams({
    client_id:config.clientId,
    redirect_uri:config.redirectUri,
    response_type:'code',
    access_type:'offline',
    prompt:'consent',
    scope:CALENDAR_SCOPES,
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function exchangeCode(config, code) {
  return googleFetch(TOKEN_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body:new URLSearchParams({
      code,
      client_id:config.clientId,
      client_secret:config.clientSecret,
      redirect_uri:config.redirectUri,
      grant_type:'authorization_code',
    }),
  })
}

export function fetchAccountEmail(accessToken) {
  return googleFetch(USERINFO_URL, { headers:bearer(accessToken) })
}

async function refreshAccessToken(config, refreshToken) {
  try {
    const token = await googleFetch(TOKEN_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body:new URLSearchParams({
        client_id:config.clientId,
        client_secret:config.clientSecret,
        refresh_token:refreshToken,
        grant_type:'refresh_token',
      }),
    })
    return token.access_token
  } catch (error) {
    if (error.code === 'invalid_grant') throw new NeedsReconnectError()
    throw error
  }
}

export async function revokeToken(refreshToken) {
  try {
    await googleFetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method:'POST' })
  } catch {
    // Revogação é best effort: a conexão local é removida de qualquer forma.
  }
}

// ---------- Conexão e vínculos (service role) ----------

export async function getConnection(userId) {
  const { data, error } = await getAdminSupabase().from(CONNECTIONS).select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

export async function saveConnection(userId, { email, refreshToken }) {
  const { error } = await getAdminSupabase().from(CONNECTIONS).upsert({
    user_id:userId,
    account_email:email || null,
    refresh_token_encrypted:encryptPayload({ refreshToken }),
    status:'connected',
    updated_at:new Date().toISOString(),
  }, { onConflict:'user_id' })
  if (error) throw error
}

async function markNeedsReconnect(userId) {
  const { error } = await getAdminSupabase()
    .from(CONNECTIONS)
    .update({ status:'needs_reconnect', updated_at:new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw error
}

export async function deleteConnection(userId) {
  const admin = getAdminSupabase()
  const connection = await getConnection(userId)
  if (connection?.refresh_token_encrypted) {
    const decrypted = decryptPayload(connection.refresh_token_encrypted)
    if (decrypted?.refreshToken) await revokeToken(decrypted.refreshToken)
  }
  const links = await admin.from(LINKS).delete().eq('user_id', userId)
  if (links.error) throw links.error
  const removed = await admin.from(CONNECTIONS).delete().eq('user_id', userId)
  if (removed.error) throw removed.error
}

export async function getAccessToken(config, userId) {
  const connection = await getConnection(userId)
  if (!connection || connection.status !== 'connected') throw new NeedsReconnectError()
  const decrypted = decryptPayload(connection.refresh_token_encrypted)
  if (!decrypted?.refreshToken) throw new NeedsReconnectError()
  try {
    return await refreshAccessToken(config, decrypted.refreshToken)
  } catch (error) {
    if (error instanceof NeedsReconnectError) await markNeedsReconnect(userId)
    throw error
  }
}

export async function getLinks(userId) {
  const { data, error } = await getAdminSupabase().from(LINKS).select('*').eq('user_id', userId)
  if (error) throw error
  return data || []
}

export async function upsertLink(userId, { type, id, googleEventId, hash, snapshot }) {
  const { error } = await getAdminSupabase().from(LINKS).upsert({
    user_id:userId,
    record_type:type,
    record_id:id,
    google_event_id:googleEventId,
    synced_hash:hash,
    remote_snapshot:snapshot,
    detached:false,
    updated_at:new Date().toISOString(),
  }, { onConflict:'user_id,record_type,record_id' })
  if (error) throw error
}

export async function deleteLink(userId, type, id) {
  const { error } = await getAdminSupabase().from(LINKS).delete().eq('user_id', userId).eq('record_type', type).eq('record_id', id)
  if (error) throw error
}

export async function markDetached(userId, type, id) {
  const { error } = await getAdminSupabase()
    .from(LINKS)
    .update({ detached:true, updated_at:new Date().toISOString() })
    .eq('user_id', userId).eq('record_type', type).eq('record_id', id)
  if (error) throw error
}

// ---------- Google Calendar ----------

export async function listEvents(accessToken, { timeMin, timeMax, timeZone }) {
  const items = []
  let pageToken = ''
  for (let page = 0; page < 4; page += 1) {
    const params = new URLSearchParams({
      singleEvents:'true',
      showDeleted:'true',
      orderBy:'startTime',
      maxResults:'250',
      timeMin,
      timeMax,
      timeZone,
    })
    if (pageToken) params.set('pageToken', pageToken)
    const result = await googleFetch(`${CALENDAR_URL}/events?${params.toString()}`, { headers:bearer(accessToken) })
    items.push(...(result.items || []))
    pageToken = result.nextPageToken || ''
    if (!pageToken) break
  }
  return items
}

export function insertEvent(accessToken, event) {
  return googleFetch(`${CALENDAR_URL}/events`, {
    method:'POST',
    headers:{ ...bearer(accessToken), 'Content-Type':'application/json' },
    body:JSON.stringify(event),
  })
}

export function updateEvent(accessToken, eventId, event) {
  return googleFetch(`${CALENDAR_URL}/events/${encodeURIComponent(eventId)}`, {
    method:'PUT',
    headers:{ ...bearer(accessToken), 'Content-Type':'application/json' },
    body:JSON.stringify(event),
  })
}

export async function deleteEvent(accessToken, eventId) {
  try {
    await googleFetch(`${CALENDAR_URL}/events/${encodeURIComponent(eventId)}`, {
      method:'DELETE',
      headers:bearer(accessToken),
    })
  } catch (error) {
    if (error.status !== 404 && error.status !== 410) throw error
  }
}
