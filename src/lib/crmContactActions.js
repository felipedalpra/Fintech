import { supabase } from './supabase.js'

export async function createWhatsAppContactLead(contactId, title) {
  if (!contactId) return { error: 'Contato ainda não foi identificado. Atualize as conversas e tente novamente.' }
  const { data, error } = await supabase.rpc('create_whatsapp_contact_lead', {
    p_contact: contactId,
    p_title: String(title || '').trim() || null,
  })
  return error ? { error: error.message } : { opportunity: data }
}

export async function convertContactToPatient(contactId, { patientId = null, name = null } = {}) {
  if (!contactId) return { error: 'Contato ainda não foi identificado. Atualize as conversas e tente novamente.' }
  const { data, error } = await supabase.rpc('convert_crm_contact_to_patient', {
    p_contact: contactId,
    p_patient: patientId || null,
    p_name: String(name || '').trim() || null,
  })
  return error ? { error: error.message } : { patientId: data }
}

export async function setContactIgnored(contactId, ignored) {
  if (!contactId) return { error: 'Contato ainda não foi identificado. Atualize as conversas e tente novamente.' }
  const { data, error } = await supabase.from('crm_contacts')
    .update({ status: ignored ? 'ignored' : 'contact', updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .is('patient_id', null)
    .select('id, status')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'O contato não pôde ser atualizado ou já está vinculado a um paciente.' }
  return { contact: data[0] }
}
