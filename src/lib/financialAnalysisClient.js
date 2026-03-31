import { supabase } from './supabase.js'

export async function fetchFinancialAnalysis({ startDate, endDate, granularity }) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sessao invalida. Entre novamente.')

  const query = new URLSearchParams({
    startDate,
    endDate,
    granularity,
  })

  const response = await fetch(`/api/financial/analysis?${query.toString()}`, {
    method:'GET',
    headers:{ Authorization:`Bearer ${token}` },
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
  return payload.rows || []
}
