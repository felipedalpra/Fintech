import { supabase } from './supabase.js'
import { flattenDefaultChart, normalizeChartAccount } from './chartOfAccounts.js'
import { uid } from '../utils.js'

export function isChartSchemaMissing(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code === '42P01' || code === 'PGRST205' || message.includes('chart_accounts') && message.includes('schema cache')
}

export async function fetchChartAccounts(ownerId) {
  if (!ownerId) return []
  const { data, error } = await supabase
    .from('chart_accounts')
    .select('*')
    .eq('user_id', ownerId)
    .order('sort_order', { ascending:true })
    .order('code', { ascending:true })
  if (error) throw error
  return (data || []).map(normalizeChartAccount)
}

export async function ensureDefaultChartAccounts(ownerId) {
  const current = await fetchChartAccounts(ownerId)
  if (current.length) return current
  const rows = flattenDefaultChart(ownerId, uid)
  const { error } = await supabase.from('chart_accounts').insert(rows)
  if (error) {
    // Duas sessões podem inicializar simultaneamente. Se outra ganhou a corrida, usa o resultado dela.
    const reloaded = await fetchChartAccounts(ownerId).catch(() => [])
    if (reloaded.length) return reloaded
    throw error
  }
  return fetchChartAccounts(ownerId)
}

function toRow(ownerId, item) {
  return {
    user_id:ownerId,
    parent_id:item.parentId || null,
    code:String(item.code || '').trim(),
    name:String(item.name || '').trim(),
    node_type:item.nodeType || 'account',
    nature:item.nature || 'unclassified',
    dre_section:item.dreSection || 'unclassified',
    description:String(item.description || '').trim() || null,
    is_active:item.isActive !== false,
    sort_order:Number(item.sortOrder || 0),
  }
}

export async function createChartAccount(ownerId, item) {
  const { data, error } = await supabase
    .from('chart_accounts')
    .insert({ id:item.id || uid(), ...toRow(ownerId, item), system_key:null })
    .select('*')
    .single()
  if (error) throw error
  return normalizeChartAccount(data)
}

export async function updateChartAccount(ownerId, accountId, updates) {
  const { data, error } = await supabase
    .from('chart_accounts')
    .update(toRow(ownerId, updates))
    .eq('user_id', ownerId)
    .eq('id', accountId)
    .select('*')
    .single()
  if (error) throw error
  return normalizeChartAccount(data)
}

export async function updateChartAccountOrder(ownerId, updates) {
  for (const item of updates) {
    const { error } = await supabase
      .from('chart_accounts')
      .update({ sort_order:Number(item.sortOrder || 0), parent_id:item.parentId || null })
      .eq('user_id', ownerId)
      .eq('id', item.id)
    if (error) throw error
  }
}

export async function setChartAccountActive(ownerId, accountId, isActive) {
  const { error } = await supabase
    .from('chart_accounts')
    .update({ is_active:Boolean(isActive) })
    .eq('user_id', ownerId)
    .eq('id', accountId)
  if (error) throw error
}

export async function deleteChartAccount(ownerId, accountId) {
  const { error } = await supabase
    .from('chart_accounts')
    .delete()
    .eq('user_id', ownerId)
    .eq('id', accountId)
  if (error) throw error
}

export async function countChartAccountUsage(ownerId, accountId) {
  const tables = ['procedures', 'extra_revenues', 'expenses', 'recorrencias', 'financial_entries']
  const counts = await Promise.all(tables.map(async table => {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count:'exact', head:true })
      .eq('user_id', ownerId)
      .eq('chart_account_id', accountId)
    if (error) throw error
    return Number(count || 0)
  }))
  return counts.reduce((sum, count) => sum + count, 0)
}
