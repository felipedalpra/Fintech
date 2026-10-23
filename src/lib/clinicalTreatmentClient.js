import { buildTreatmentWorkspace } from './clinicalTreatment.js'
import { supabase } from './supabase.js'

export async function loadTreatmentWorkspace(ownerId, patientId) {
  const [plans, versions, statuses, sessions, events] = await Promise.all([
    supabase.from('clinical_treatment_plans').select('*').eq('user_id', ownerId).eq('patient_id', patientId),
    supabase.from('clinical_treatment_plan_versions').select('*').eq('user_id', ownerId).eq('patient_id', patientId),
    supabase.from('clinical_treatment_plan_status_events').select('*').eq('user_id', ownerId).eq('patient_id', patientId),
    supabase.from('clinical_treatment_sessions').select('*').eq('user_id', ownerId).eq('patient_id', patientId),
    supabase.from('clinical_treatment_session_events').select('*').eq('user_id', ownerId).eq('patient_id', patientId),
  ])
  const failure = [plans, versions, statuses, sessions, events].find(result => result.error)
  if (failure) throw failure.error
  return buildTreatmentWorkspace({
    plans:plans.data, versions:versions.data, statuses:statuses.data, sessions:sessions.data, events:events.data,
  })
}
