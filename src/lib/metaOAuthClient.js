// src/lib/metaOAuthClient.js
import { supabase } from './supabase.js'

const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'
const ENDPOINT = '/api/whatsapp'

async function getAccessToken() {
  if (E2E_BYPASS_AUTH) return 'e2e-token'
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sessão expirada. Entre novamente.')
  return token
}

async function request(action, { method = 'GET', body } = {}) {
  const token = await getAccessToken()
  const res = await fetch(`${ENDPOINT}?action=${action}`, {
    method,
    headers:{
      Authorization:`Bearer ${token}`,
      ...(body ? { 'Content-Type':'application/json' } : {}),
    },
    body:body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

export const startMetaConnection = () => request('meta-connect', { method:'POST' })
export const fetchMetaPendingAssets = () => request('meta-pending')
export const selectMetaAssets = ({ pageId, adAccountId }) => request('meta-select', { method:'POST', body:{ pageId, adAccountId } })
export const disconnectMeta = () => request('meta-disconnect', { method:'POST' })
