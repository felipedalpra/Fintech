import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

function readQuery(req) {
  if (req.query) return req.query
  const url = new URL(req.url || '', 'http://localhost')
  return Object.fromEntries(url.searchParams.entries())
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error:'Method not allowed' })
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error:'Supabase env not configured' })
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return res.status(401).json({ error:'Missing bearer token' })

  const query = readQuery(req)
  const startDate = String(query.startDate || '')
  const endDate = String(query.endDate || '')
  const granularity = String(query.granularity || 'month').toLowerCase()

  if (!startDate || !endDate) {
    return res.status(400).json({ error:'startDate and endDate are required' })
  }

  if (!['month', 'quarter', 'year'].includes(granularity)) {
    return res.status(400).json({ error:'granularity must be month, quarter or year' })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth:{ persistSession:false, autoRefreshToken:false },
    global:{ headers:{ Authorization:`Bearer ${token}` } },
  })

  try {
    const { data:userData, error:userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user) {
      return res.status(401).json({ error:'Invalid auth token' })
    }

    const { data, error } = await supabase.rpc('get_financial_analysis', {
      start_date:startDate,
      end_date:endDate,
      granularity,
    })

    if (error) {
      return res.status(400).json({ error:error.message || 'Nao foi possivel calcular a analise financeira.' })
    }

    return res.status(200).json({
      rows:data || [],
      period:{ startDate, endDate },
      granularity,
    })
  } catch (error) {
    return res.status(500).json({ error:error?.message || 'Erro interno no servidor.' })
  }
}
