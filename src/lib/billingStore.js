import { FREE_TRIAL_DAYS } from '../billing/plans.js'
import { supabase } from './supabase.js'

const TABLE = 'billing_accounts'
const BLOCKED_STATUSES = new Set(['past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'])

export async function fetchBillingAccount(userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function ensureBillingAccount(user) {
  const preferredPlan = user?.user_metadata?.selected_billing_cycle || 'mensal'
  const existing = await fetchBillingAccount(user.id)
  if (existing) {
    if (!existing.email || existing.selected_plan !== preferredPlan) {
      const { data, error } = await supabase
        .from(TABLE)
        .update({
          email:user.email,
          selected_plan:existing.selected_plan || preferredPlan,
        })
        .eq('user_id', user.id)
        .select('*')
        .single()

      if (error) throw error
      return data
    }
    return existing
  }

  const trialEndsAt = addDays(new Date(), FREE_TRIAL_DAYS)
  const payload = {
    user_id:user.id,
    email:user.email,
    status:'trialing',
    selected_plan:preferredPlan,
    trial_started_at:new Date().toISOString(),
    trial_ends_at:trialEndsAt.toISOString(),
    access_expires_at:trialEndsAt.toISOString(),
  }

  const { data, error } = await supabase.from(TABLE).insert(payload).select('*').single()
  if (error) throw error
  return data
}

export async function updateSelectedPlan(userId, planId) {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ selected_plan:planId })
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error) throw error
  return data
}

export function hasActiveAccess(account) {
  if (!account) return false
  if (BLOCKED_STATUSES.has(account.status)) return false

  const now = Date.now()
  const accessExpiresAt = account.access_expires_at ? new Date(account.access_expires_at).getTime() : 0
  const periodEnd = account.current_period_end ? new Date(account.current_period_end).getTime() : 0

  // Beta testers continuam com acesso mesmo após o fim do trial.
  if (account.status === 'trialing') return true
  if (account.status === 'active') {
    if (!accessExpiresAt && !periodEnd) return true // webhook ainda não chegou
    return Math.max(accessExpiresAt, periodEnd) > now
  }
  return true
}

export function getTrialDaysLeft(account) {
  if (!account?.trial_ends_at) return 0
  const diff = new Date(account.trial_ends_at).getTime() - Date.now()
  if (diff <= 0) return 0
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
