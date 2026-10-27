const CORE_FIELDS = [
  ['chief_complaint', 'Queixa principal'],
  ['history_present_illness', 'História da doença atual'],
  ['physical_exam', 'Exame físico'],
  ['diagnostic_hypotheses', 'Hipóteses diagnósticas'],
  ['therapeutic_plan', 'Plano terapêutico'],
]

const NUMERIC_FIELDS = [
  'systolic_bp',
  'diastolic_bp',
  'temperature_c',
  'heart_rate',
  'respiratory_rate',
  'oxygen_saturation',
  'pain_score',
  'weight_kg',
  'height_cm',
]

export function emptyClinicalAnamnesis(sessionDate = '') {
  return {
    session_date:sessionDate,
    chief_complaint:'',
    history_present_illness:'',
    personal_history:'',
    family_history:'',
    review_of_systems:'',
    physical_exam:'',
    diagnostic_hypotheses:'',
    therapeutic_plan:'',
    systolic_bp:'',
    diastolic_bp:'',
    temperature_c:'',
    heart_rate:'',
    respiratory_rate:'',
    oxygen_saturation:'',
    pain_score:'',
    weight_kg:'',
    height_cm:'',
    protocol_id:null,
    protocol_version_id:null,
    protocol_name:'',
    protocol_responses:{},
  }
}

function joinedHistory(profile = {}) {
  const source = profile || {}
  return [
    ['Doenças crônicas', source.chronic_diseases],
    ['Cirurgias anteriores', source.previous_surgeries],
    ['Internações', source.hospitalizations],
    ['Antecedentes ginecológicos', source.gynecological_history],
    ['Tabagismo', source.smoking],
    ['Etilismo', source.alcohol],
    ['Atividade física', source.physical_activity],
  ].filter(([, value]) => String(value || '').trim())
    .map(([label, value]) => `${label}: ${String(value).trim()}`)
    .join('\n')
}

export function clinicalAnamnesisFromLegacy(profile, sessionDate = '') {
  return {
    ...emptyClinicalAnamnesis(sessionDate),
    chief_complaint:String(profile?.chief_complaint || '').trim(),
    history_present_illness:String(profile?.hda || '').trim(),
    personal_history:joinedHistory(profile),
    family_history:String(profile?.family_history || '').trim(),
    therapeutic_plan:String(profile?.clinical_notes || '').trim(),
  }
}

export function hasLegacyClinicalAnamnesis(profile) {
  if (!profile) return false
  const anamnesisValues = Object.values(clinicalAnamnesisFromLegacy(profile))
  const protectedDetails = [profile.allergies, profile.current_medications, profile.consent_date]
  return Object.hasOwn(profile, 'consent_signed')
    || [...anamnesisValues, ...protectedDetails].some(value => String(value || '').trim())
}

function nullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

export function calculateClinicalBmi(weightKg, heightCm) {
  const weight = nullableNumber(weightKg)
  const height = nullableNumber(heightCm)
  if (!weight || !height) return null
  return Number((weight / ((height / 100) ** 2)).toFixed(1))
}

export function validateClinicalAnamnesis(form, author) {
  if (!form?.session_date) return 'Informe a data da anamnese.'
  if (!author?.name?.trim() || !author?.registration?.trim()) {
    return 'Cadastre o nome e o registro profissional antes de assinar a anamnese.'
  }
  const missing = CORE_FIELDS.find(([field]) => !String(form?.[field] || '').trim())
  if (missing) return `${missing[1]} é obrigatório.`
  const invalidNumber = NUMERIC_FIELDS.find(field => {
    const value = form?.[field]
    return value !== '' && value !== null && value !== undefined && nullableNumber(value) === null
  })
  if (invalidNumber) return 'Revise os sinais vitais: há um valor numérico inválido.'
  return ''
}

export function buildClinicalAnamnesisRpcArgs({ patientId, requestId, form, author }) {
  if (!patientId) throw new Error('Paciente não identificado.')
  if (!requestId) throw new Error('Não foi possível identificar esta tentativa de assinatura.')
  const validationError = validateClinicalAnamnesis(form, author)
  if (validationError) throw new Error(validationError)

  const payload = {
    chief_complaint:String(form.chief_complaint).trim(),
    history_present_illness:String(form.history_present_illness).trim(),
    personal_history:String(form.personal_history || '').trim() || null,
    family_history:String(form.family_history || '').trim() || null,
    review_of_systems:String(form.review_of_systems || '').trim() || null,
    physical_exam:String(form.physical_exam).trim(),
    diagnostic_hypotheses:String(form.diagnostic_hypotheses).trim(),
    therapeutic_plan:String(form.therapeutic_plan).trim(),
    protocol_id:form.protocol_id || null,
    protocol_version_id:form.protocol_version_id || null,
    protocol_name:String(form.protocol_name || '').trim() || null,
    protocol_responses:form.protocol_responses || {},
  }
  NUMERIC_FIELDS.forEach(field => { payload[field] = nullableNumber(form[field]) })

  return {
    p_patient_id:patientId,
    p_session_date:form.session_date,
    p_anamnesis:payload,
    p_request_id:requestId,
  }
}
