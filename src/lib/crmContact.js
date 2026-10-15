export function opportunityPerson(opportunity = {}) {
  const patient = opportunity.patients || null
  const contact = opportunity.crm_contacts || null
  return {
    name: patient?.full_name || contact?.full_name || contact?.phone || 'Contato',
    phone: patient?.phone || contact?.phone || '',
    isPatient: Boolean(opportunity.patient_id || patient?.full_name),
  }
}

export function conversationKind({ isGroup = false, patientId = null, contactStatus = null } = {}) {
  if (isGroup) return 'group'
  if (patientId || contactStatus === 'patient') return 'patient'
  if (contactStatus === 'lead') return 'lead'
  if (contactStatus === 'ignored') return 'ignored'
  return 'contact'
}

export const CONVERSATION_KIND_LABEL = {
  group: 'Grupo',
  patient: 'Paciente',
  lead: 'Lead',
  ignored: 'Ignorado',
  contact: 'Contato',
}

export function isCrmContactSchemaMissing(error) {
  return ['PGRST200', 'PGRST204', '42703'].includes(error?.code)
}
