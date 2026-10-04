import { supabase } from './supabase.js'

const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'
const ENDPOINT = '/api/google/calendar'

async function getAccessToken() {
  if (E2E_BYPASS_AUTH) return 'e2e-token'
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sessao expirada. Entre novamente.')
  return token
}

async function request(action, { method = 'GET', query = {}, body } = {}) {
  const token = await getAccessToken()
  const params = new URLSearchParams({ action, ...query })
  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    method,
    headers:{
      Authorization:`Bearer ${token}`,
      ...(body ? { 'Content-Type':'application/json' } : {}),
    },
    body:body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(json.error || `HTTP ${res.status}`)
    error.status = res.status
    error.needsReconnect = json.error === 'needs_reconnect'
    throw error
  }
  return json
}

export const getGoogleCalendarStatus = () => request('status')
export const startGoogleCalendarConnection = () => request('connect', { method:'POST' })
export const disconnectGoogleCalendar = () => request('disconnect', { method:'POST' })
export const fetchGoogleEvents = ({ timeMin, timeMax, timeZone }) => request('events', { query:{ timeMin, timeMax, timeZone } })
export const syncGoogleCalendar = ({ upserts, deletes }) => request('sync', { method:'POST', body:{ upserts, deletes } })
