import { supabase } from './supabase.js'

const TABLE = 'billing_accounts'

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

  const payload = {
    user_id:user.id,
    email:user.email,
    status:'active',
    selected_plan:preferredPlan,
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
