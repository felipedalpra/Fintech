import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const cronSecret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET || ''

function getAnonSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase env not configured')
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth:{ persistSession:false, autoRefreshToken:false },
  })
}

function getAdminSupabase() {
  if (!supabaseUrl || !supabaseServiceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured')
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth:{ persistSession:false, autoRefreshToken:false },
  })
}

function extractBearer(headers = {}) {
  const authHeader = headers.authorization || headers.Authorization || ''
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
}

function readBody(req) {
  if (typeof req.body === 'object' && req.body !== null) return req.body
  if (!req.body) return {}
  try {
    return JSON.parse(req.body)
  } catch {
    return {}
  }
}

function resolveReferenceDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10)
  const normalized = String(value).slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized
  return new Date().toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error:'Method not allowed' })
  }

  try {
    const bearer = extractBearer(req.headers)
    const body = readBody(req)
    const referenceDate = resolveReferenceDate(req.query?.referenceDate || body.referenceDate)

    // Cron mode: process all users.
    if (req.method === 'GET') {
      const cronHeader = req.headers['x-cron-secret'] || req.headers['X-Cron-Secret'] || ''
      const authorized = Boolean(cronSecret) && (cronHeader === cronSecret || bearer === cronSecret)
      if (!authorized) return res.status(401).json({ error:'Invalid cron secret' })

      const admin = getAdminSupabase()
      const { data, error } = await admin.rpc('processar_recorrencias', {
        p_reference_date:referenceDate,
        p_user_id:null,
      })
      if (error) return res.status(400).json({ error:error.message || 'Nao foi possivel processar recorrencias.' })
      return res.status(200).json({ result:data || null, scope:'all' })
    }

    // User mode: process only current user.
    if (!bearer) return res.status(401).json({ error:'Missing bearer token' })

    const anon = getAnonSupabase()
    const { data:userData, error:userError } = await anon.auth.getUser(bearer)
    if (userError || !userData?.user) return res.status(401).json({ error:'Invalid auth token' })

    const admin = getAdminSupabase()
    const { data, error } = await admin.rpc('processar_recorrencias', {
      p_reference_date:referenceDate,
      p_user_id:userData.user.id,
    })
    if (error) return res.status(400).json({ error:error.message || 'Nao foi possivel processar recorrencias.' })

    return res.status(200).json({ result:data || null, scope:'user' })
  } catch (error) {
    return res.status(500).json({ error:error?.message || 'Erro interno no servidor.' })
  }
}
