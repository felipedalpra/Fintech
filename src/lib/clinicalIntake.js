export const CLINICAL_INTAKE_FIELD_TYPES = [
  { value:'text', label:'Texto curto' },
  { value:'textarea', label:'Texto longo' },
  { value:'date', label:'Data' },
  { value:'boolean', label:'Sim ou não' },
  { value:'select', label:'Escolha única' },
  { value:'multiselect', label:'Múltipla escolha' },
]

export const CLINICAL_INTAKE_SOAP_FIELDS = [
  { value:'', label:'Não levar ao rascunho SOAP' },
  { value:'chief_complaint', label:'Queixa principal' },
  { value:'history_present_illness', label:'História da doença atual' },
  { value:'personal_history', label:'Antecedentes pessoais' },
  { value:'family_history', label:'Antecedentes familiares' },
  { value:'review_of_systems', label:'Revisão de sistemas' },
]

export const DEFAULT_CLINICAL_INTAKE_FIELDS = [
  { id:'chief_complaint', label:'Qual é o principal motivo da consulta?', type:'textarea', required:true, soap_field:'chief_complaint' },
  { id:'history_present_illness', label:'Quando começou e como evoluiu?', type:'textarea', required:true, soap_field:'history_present_illness' },
  { id:'previous_surgeries', label:'Já realizou cirurgias ou internações? Quais?', type:'textarea', required:false, soap_field:'personal_history' },
  { id:'chronic_conditions', label:'Possui doenças crônicas ou condições de saúde importantes?', type:'textarea', required:false, soap_field:'personal_history' },
  { id:'current_medications', label:'Usa medicamentos atualmente? Quais?', type:'textarea', required:false, soap_field:'personal_history' },
  { id:'allergies', label:'Possui alergias? Quais?', type:'textarea', required:false, soap_field:'personal_history' },
  { id:'family_history', label:'Há doenças relevantes na família?', type:'textarea', required:false, soap_field:'family_history' },
]

const ALLOWED_TYPES = new Set(CLINICAL_INTAKE_FIELD_TYPES.map(item => item.value))
const ALLOWED_SOAP_FIELDS = new Set(CLINICAL_INTAKE_SOAP_FIELDS.map(item => item.value))

function cleanText(value, maxLength = 20000) {
  return String(value ?? '').trim().slice(0, maxLength)
}

export function clinicalFieldId(label, index = 0) {
  const normalized = cleanText(label, 80)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = /^[a-z]/.test(normalized) ? normalized : `campo_${normalized || index + 1}`
  return `${base.slice(0, 42)}_${index + 1}`.slice(0, 50)
}

export function normalizeClinicalIntakeDefinition(fields) {
  const used = new Set()
  return {
    fields:(Array.isArray(fields) ? fields : []).map((field, index) => {
      let id = cleanText(field?.id, 50).toLowerCase().replace(/[^a-z0-9_]/g, '')
      if (!/^[a-z][a-z0-9_]{1,49}$/.test(id) || used.has(id)) id = clinicalFieldId(field?.label, index)
      while (used.has(id)) id = `${id.slice(0, 46)}_${index + 1}`
      used.add(id)
      const type = ALLOWED_TYPES.has(field?.type) ? field.type : 'text'
      const normalized = {
        id,
        label:cleanText(field?.label, 160),
        type,
        required:Boolean(field?.required),
      }
      const soapField = cleanText(field?.soap_field, 40)
      if (ALLOWED_SOAP_FIELDS.has(soapField) && soapField) normalized.soap_field = soapField
      if (type === 'select' || type === 'multiselect') {
        normalized.options = [...new Set((Array.isArray(field?.options) ? field.options : String(field?.options || '').split('\n'))
          .map(option => cleanText(option, 120)).filter(Boolean))].slice(0, 30)
      }
      return normalized
    }),
  }
}

export function validateClinicalIntakeDefinition(definition) {
  const fields = definition?.fields
  if (!Array.isArray(fields) || fields.length === 0) return 'Adicione ao menos um campo ao formulário.'
  if (fields.length > 40) return 'O formulário pode ter no máximo 40 campos.'
  const ids = new Set()
  for (const field of fields) {
    if (!field.label?.trim()) return 'Todos os campos precisam de um título.'
    if (!ALLOWED_TYPES.has(field.type)) return 'Há um tipo de campo inválido.'
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(field.id || '') || ids.has(field.id)) return 'Há campos com identificadores inválidos ou repetidos.'
    ids.add(field.id)
    if ((field.type === 'select' || field.type === 'multiselect') && (!Array.isArray(field.options) || field.options.length === 0)) {
      return `Adicione opções ao campo “${field.label}”.`
    }
  }
  return ''
}

function isEmptyAnswer(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

export function validateClinicalIntakeAnswers(definition, answers, acceptedConsentIds = [], consents = []) {
  for (const field of definition?.fields || []) {
    const value = answers?.[field.id]
    if (field.required && isEmptyAnswer(value)) return `Preencha “${field.label}”.`
    if (typeof value === 'string' && value.length > 20000) return `A resposta de “${field.label}” está muito extensa.`
    if ((field.type === 'select' || field.type === 'multiselect') && !isEmptyAnswer(value)) {
      const selected = Array.isArray(value) ? value : [value]
      if (selected.some(item => !field.options?.includes(item))) return `Revise a seleção de “${field.label}”.`
    }
  }
  const accepted = new Set(acceptedConsentIds)
  const missingConsent = consents.find(consent => consent.required && !accepted.has(consent.id))
  if (missingConsent) return `É necessário aceitar “${missingConsent.title}”.`
  return ''
}

function answerToText(value) {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  return cleanText(value)
}

export function clinicalIntakeToSoapDraft(submission) {
  const fields = submission?.template_snapshot?.definition?.fields || []
  const answers = submission?.answers || {}
  const grouped = {}
  fields.forEach(field => {
    const soapField = field.soap_field
    const value = answerToText(answers[field.id])
    if (!soapField || !value || !ALLOWED_SOAP_FIELDS.has(soapField)) return
    const line = fields.filter(item => item.soap_field === soapField).length > 1 ? `${field.label}: ${value}` : value
    grouped[soapField] = [grouped[soapField], line].filter(Boolean).join('\n')
  })
  return grouped
}

export function publicClinicalIntakeUrl(token, origin = '') {
  if (!token) return ''
  return `${String(origin).replace(/\/+$/, '')}/anamnese/${encodeURIComponent(token)}`
}

export function clinicalIntakeRequestStatus(request, now = new Date()) {
  if (request?.status === 'submitted') return { label:'Respondido', tone:'success' }
  if (request?.status === 'revoked') return { label:'Revogado', tone:'muted' }
  if (request?.expires_at && new Date(request.expires_at) <= now) return { label:'Expirado', tone:'warning' }
  if (request?.opened_at) return { label:'Aberto pelo paciente', tone:'info' }
  return { label:'Aguardando paciente', tone:'warning' }
}
