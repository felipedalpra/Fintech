import { supabase } from './supabase.js'

const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'

async function authFetch(path, payload = {}) {
  const token = E2E_BYPASS_AUTH
    ? 'e2e-token'
    : (await supabase.auth.getSession()).data.session?.access_token
  if (!token) throw new Error('Sessao invalida. Entre novamente.')

  const response = await fetch(path, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      Authorization:`Bearer ${token}`,
    },
    body:JSON.stringify(payload),
  })

  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`)
  return json
}

export async function fetchSecureProfile() {
  return authFetch('/api/secure-profile?action=get')
}

export async function saveSecureProfile(profile) {
  return authFetch('/api/secure-profile?action=save', { profile })
}
