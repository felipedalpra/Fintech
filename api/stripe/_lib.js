import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripeSecretKey = process.env.STRIPE_SECRET_KEY
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export function getStripe() {
  if (!stripeSecretKey) throw new Error('STRIPE_SECRET_KEY not configured')
  return new Stripe(stripeSecretKey)
}

export function getServerSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase env not configured')
  return createClient(supabaseUrl, supabaseAnonKey)
}

export function getAdminSupabase() {
  if (!supabaseUrl || !supabaseServiceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured')
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth:{ persistSession:false, autoRefreshToken:false },
  })
}

export async function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) throw new Error('Missing bearer token')

  const supabase = getServerSupabase()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) throw new Error('Invalid auth token')
  return data.user
}

export function getAppUrl(req) {
  return process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` || inferRequestOrigin(req)
}

function inferRequestOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'
  return `${proto}://${host}`
}

export async function findBillingAccountByUser(userId) {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase.from('billing_accounts').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

export async function findBillingAccountByStripeCustomer(customerId) {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase.from('billing_accounts').select('*').eq('stripe_customer_id', customerId).maybeSingle()
  if (error) throw error
  return data
}

export async function upsertBillingAccount(userId, patch) {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('billing_accounts')
    .upsert({ user_id:userId, ...patch }, { onConflict:'user_id' })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}
