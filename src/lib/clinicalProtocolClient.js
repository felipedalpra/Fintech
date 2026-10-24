import { supabase } from './supabase.js'
import { buildProtocolWorkspace } from './clinicalProtocols.js'

export async function loadClinicalProtocols(ownerId, { activeOnly = false } = {}) {
  const [protocolsResult, versionsResult, statusesResult] = await Promise.all([
    supabase.from('clinical_protocols').select('*').eq('user_id', ownerId),
    supabase.from('clinical_protocol_versions').select('*').eq('user_id', ownerId),
    supabase.from('clinical_protocol_status_events').select('*').eq('user_id', ownerId),
  ])
  const failed = [protocolsResult, versionsResult, statusesResult].find(result => result.error)
  if (failed) throw failed.error
  const workspace = buildProtocolWorkspace({
    protocols:protocolsResult.data || [], versions:versionsResult.data || [], statuses:statusesResult.data || [],
  })
  return activeOnly ? workspace.filter(item => item.currentStatus === 'active') : workspace
}
