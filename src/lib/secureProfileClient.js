import { supabase } from './supabase.js'

async function authFetch(path, payload = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
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
  return authFetch('/api/secure-profile/get')
}

export async function saveSecureProfile(profile) {
  return authFetch('/api/secure-profile/save', { profile })
}
