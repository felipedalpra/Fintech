export const PATIENT_FIELDS = [
  'full_name',
  'cpf',
  'date_of_birth',
  'sex',
  'civil_status',
  'profession',
  'phone',
  'email',
  'emergency_contact_name',
  'emergency_contact_phone',
  'address_street',
  'address_number',
  'address_complement',
  'address_district',
  'address_city',
  'address_state',
  'address_zip',
  'start_date',
]

export const PATIENT_CLINICAL_FIELDS = [
  'chief_complaint',
  'hda',
  'previous_surgeries',
  'hospitalizations',
  'chronic_diseases',
  'allergies',
  'current_medications',
  'smoking',
  'alcohol',
  'physical_activity',
  'family_history',
  'gynecological_history',
  'clinical_notes',
]

function nullableText(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

export function buildPatientPayload(form) {
  const payload = Object.fromEntries(PATIENT_FIELDS.map(field => [field, nullableText(form?.[field])]))
  payload.full_name = nullableText(form?.full_name)
  if (!payload.full_name) throw new Error('Informe o nome completo do paciente.')
  return payload
}

export function buildPatientClinicalPayload(form) {
  const payload = Object.fromEntries(PATIENT_CLINICAL_FIELDS.map(field => [field, nullableText(form?.[field])]))
  payload.consent_signed = Boolean(form?.consent_signed)
  payload.consent_date = payload.consent_signed ? nullableText(form?.consent_date) : null
  return payload
}

export function buildPatientSaveRpcArgs({ patientId, form, includeClinical }) {
  return {
    p_patient_id:patientId || null,
    p_patient:buildPatientPayload(form),
    p_clinical:includeClinical ? buildPatientClinicalPayload(form) : null,
  }
}

function samePersistedValue(actual, expected) {
  if (expected === null) return actual === null || actual === undefined || actual === ''
  return String(actual) === String(expected)
}

function assertFields(row, expected, fields, label) {
  if (!row || typeof row !== 'object') throw new Error(`O banco não confirmou os ${label}.`)
  const mismatched = fields.filter(field => !samePersistedValue(row[field], expected[field]))
  if (mismatched.length > 0) {
    throw new Error(`O banco não confirmou integralmente os ${label}. Revise: ${mismatched.join(', ')}.`)
  }
}

export function confirmedPatientSave(data, args) {
  const patient = data?.patient
  const clinicalProfile = data?.clinical_profile || null
  assertFields(patient, args.p_patient, PATIENT_FIELDS, 'dados cadastrais')
  if (!patient.id) throw new Error('O banco não devolveu a identificação do paciente salvo.')
  if (args.p_patient_id && patient.id !== args.p_patient_id) {
    throw new Error('O banco confirmou outro paciente. Recarregue a página antes de continuar.')
  }
  if (args.p_clinical) {
    assertFields(
      clinicalProfile,
      args.p_clinical,
      [...PATIENT_CLINICAL_FIELDS, 'consent_signed', 'consent_date'],
      'dados clínicos',
    )
    if (clinicalProfile.patient_id !== patient.id) {
      throw new Error('O perfil clínico não foi vinculado ao paciente correto.')
    }
  }
  return { ...patient, ...(clinicalProfile || {}) }
}
