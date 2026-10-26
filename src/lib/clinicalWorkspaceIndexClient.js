import { supabase } from './supabase.js'

const SOURCE_QUERIES = [
  ['records', () => supabase.rpc('list_clinical_workspace_record_metadata')],
  ['anamneses', ownerId => supabase.from('clinical_anamneses').select('id,patient_id,session_date,author_name,recorded_at').eq('user_id', ownerId)],
  ['intakeRequests', ownerId => supabase.from('clinical_intake_requests').select('id,patient_id,status,expires_at,submitted_at,created_at').eq('user_id', ownerId)],
  ['intakeSubmissions', ownerId => supabase.from('clinical_intake_submissions').select('id,patient_id,request_id,submitted_at').eq('user_id', ownerId)],
  ['documents', ownerId => supabase.from('clinical_documents').select('id,patient_id,patient_name,document_type,issue_date,author_name,created_at').eq('user_id', ownerId)],
  ['signatures', ownerId => supabase.from('clinical_document_signatures').select('id,document_id,status,created_at,updated_at,signed_at').eq('user_id', ownerId)],
  ['assets', ownerId => supabase.from('clinical_assets').select('id,patient_id,asset_kind,stage,status,captured_on,procedure_name,file_name,created_at,completed_at,archived_at').eq('user_id', ownerId)],
  ['plans', ownerId => supabase.from('clinical_treatment_plans').select('id,patient_id,created_at').eq('user_id', ownerId)],
  ['planVersions', ownerId => supabase.from('clinical_treatment_plan_versions').select('id,plan_id,patient_id,version_number,title,review_on,author_name,recorded_at').eq('user_id', ownerId)],
  ['planStatuses', ownerId => supabase.from('clinical_treatment_plan_status_events').select('id,plan_id,patient_id,status,recorded_at').eq('user_id', ownerId)],
  ['sessions', ownerId => supabase.from('clinical_treatment_sessions').select('id,plan_id,patient_id,title,session_type,sequence_number,created_at').eq('user_id', ownerId)],
  ['sessionEvents', ownerId => supabase.from('clinical_treatment_session_events').select('id,session_id,plan_id,patient_id,status,scheduled_start,recorded_at').eq('user_id', ownerId)],
]

export const emptyClinicalWorkspaceSources = () => ({
  ...Object.fromEntries(SOURCE_QUERIES.map(([key]) => [key, []])),
  unavailableSources:[],
})

export async function loadClinicalWorkspaceSources(ownerId) {
  const entries = await Promise.all(SOURCE_QUERIES.map(async ([key, query]) => {
    try {
      const result = await query(ownerId)
      if (result.error) return [key, [], true]
      return [key, result.data || [], false]
    } catch {
      return [key, [], true]
    }
  }))
  const unavailableSources = entries.filter(([, , unavailable]) => unavailable).map(([key]) => key)
  return {
    ...Object.fromEntries(entries.map(([key, rows]) => [key, rows])),
    unavailableSources,
  }
}
