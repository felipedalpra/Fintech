import { supabase } from './supabase.js'
export { applyConversationFilters, operationalConversationKey, unreadCountForConversation } from './operationalWorkspacePure.js'

const LOCAL_PREFIX = 'surgimetrics_workspace_'

export function isOperationalSchemaMissing(error) {
  return ['PGRST200', 'PGRST204', '42P01', '42703'].includes(error?.code)
}

function localKey(ownerId, actorId) {
  return `${LOCAL_PREFIX}${ownerId || 'unknown'}_${actorId || 'unknown'}`
}

function readLocal(ownerId, actorId) {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(window.localStorage.getItem(localKey(ownerId, actorId)) || '{}') } catch { return {} }
}

function writeLocal(ownerId, actorId, value) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(localKey(ownerId, actorId), JSON.stringify(value)) } catch { /* fallback não crítico */ }
}

export async function loadWorkspacePreferences(ownerId, actorId) {
  const fallback = readLocal(ownerId, actorId)
  if (!ownerId || !actorId) return { data:fallback, persisted:false }
  const { data, error } = await supabase.from('workspace_preferences')
    .select('onboarding_dismissed_at, notification_state')
    .eq('user_id', ownerId).eq('actor_user_id', actorId).maybeSingle()
  if (error) return { data:fallback, persisted:false, error:isOperationalSchemaMissing(error) ? null : error }
  const merged = { ...fallback, ...(data || {}) }
  writeLocal(ownerId, actorId, merged)
  return { data:merged, persisted:true }
}

export async function saveWorkspacePreferences(ownerId, actorId, patch) {
  const current = readLocal(ownerId, actorId)
  const next = {
    ...current,
    ...patch,
    ...(Object.hasOwn(patch, 'notification_state') ? { notification_state:{ ...(current.notification_state || {}), ...(patch.notification_state || {}) } } : {}),
  }
  writeLocal(ownerId, actorId, next)
  if (!ownerId || !actorId) return { data:next, persisted:false }
  const payload = { user_id:ownerId, actor_user_id:actorId, updated_at:new Date().toISOString() }
  if (Object.hasOwn(patch, 'onboarding_dismissed_at')) payload.onboarding_dismissed_at = patch.onboarding_dismissed_at
  if (Object.hasOwn(patch, 'notification_state')) payload.notification_state = next.notification_state || {}
  const { data, error } = await supabase.from('workspace_preferences').upsert(payload, { onConflict:'user_id,actor_user_id' }).select().single()
  if (error) return { data:next, persisted:false, error:isOperationalSchemaMissing(error) ? null : error }
  writeLocal(ownerId, actorId, data)
  return { data, persisted:true }
}

export async function loadConversationStates(ownerId) {
  if (!ownerId) return { data:[], persisted:false }
  const { data, error } = await supabase.from('whatsapp_conversation_states').select('*').eq('user_id', ownerId)
  if (error) return { data:[], persisted:false, error:isOperationalSchemaMissing(error) ? null : error }
  return { data:data || [], persisted:true }
}

export async function saveConversationState(ownerId, conversationKey, patch, numberId = null) {
  if (!ownerId || !conversationKey) return { error:new Error('Conversa inválida.') }
  const payload = { user_id:ownerId, conversation_key:conversationKey, whatsapp_number_id:numberId || null, ...patch, updated_at:new Date().toISOString() }
  const { data, error } = await supabase.from('whatsapp_conversation_states')
    .upsert(payload, { onConflict:'user_id,conversation_key' }).select().single()
  return { data, error:isOperationalSchemaMissing(error) ? null : error, persisted:!error }
}

export async function loadSavedReplies(ownerId) {
  if (!ownerId) return { data:[] }
  const { data, error } = await supabase.from('whatsapp_saved_replies').select('id, title, body').eq('user_id', ownerId).eq('active', true).order('title')
  return { data:data || [], error:isOperationalSchemaMissing(error) ? null : error }
}

export async function createSavedReply(ownerId, title, body) {
  return supabase.from('whatsapp_saved_replies').insert({ user_id:ownerId, title:title.trim(), body:body.trim() }).select('id, title, body').single()
}

export async function loadContactNotes(ownerId, { contactId, patientId, opportunityId } = {}) {
  if (!ownerId || (!contactId && !patientId && !opportunityId)) return { data:[] }
  let query = supabase.from('crm_contact_notes').select('id, body, author_id, created_at').eq('user_id', ownerId).order('created_at', { ascending:false })
  if (contactId) query = query.eq('contact_id', contactId)
  else if (patientId) query = query.eq('patient_id', patientId)
  else query = query.eq('opportunity_id', opportunityId)
  const { data, error } = await query
  return { data:data || [], error:isOperationalSchemaMissing(error) ? null : error }
}

export async function createContactNote(ownerId, actorId, subject, body) {
  const payload = { user_id:ownerId, author_id:actorId, body:body.trim() }
  if (subject.contactId) payload.contact_id = subject.contactId
  if (subject.patientId) payload.patient_id = subject.patientId
  if (subject.opportunityId) payload.opportunity_id = subject.opportunityId
  return supabase.from('crm_contact_notes').insert(payload).select('id, body, author_id, created_at').single()
}
