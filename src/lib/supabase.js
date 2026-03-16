import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const publicAppUrl = import.meta.env.VITE_APP_URL || import.meta.env.VITE_SITE_URL || ''

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey)

function normalizeAppUrl(url) {
  return url.trim().replace(/\/+$/, '')
}

export function getAppOrigin() {
  if (publicAppUrl) return normalizeAppUrl(publicAppUrl)
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
  return ''
}

export const supabase = hasSupabaseEnv
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
