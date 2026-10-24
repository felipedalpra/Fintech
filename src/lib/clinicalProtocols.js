const MAX_LIST_ITEMS = 60

const FIELD_LIMITS = {
  name:160,
  procedureName:160,
  description:2000,
  indication:5000,
  objectives:5000,
  plannedTreatment:10000,
  guidance:5000,
}

const LIST_LIMITS = {
  anamnesisPrompts:{ label:240, key:120 },
  examKit:{ value:240 },
  medicationFavorites:{ medication:240, presentation:240, quantity:120, directions:1000 },
  photoRequirements:{ value:240 },
  returnSchedule:{ title:160, instructions:1000 },
}

export const EMPTY_CLINICAL_PROTOCOL = {
  name:'', procedureName:'', description:'', indication:'', objectives:'', plannedTreatment:'', guidance:'',
  anamnesisPrompts:[], examKit:[], medicationFavorites:[], photoRequirements:[], returnSchedule:[],
}

const text = value => String(value || '').trim()

export function newRequestId() {
  return globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000000'
}

function limited(items, mapper) {
  return (Array.isArray(items) ? items : []).slice(0, MAX_LIST_ITEMS).map(mapper).filter(Boolean)
}

function validateRawLimits(input = {}) {
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (text(input[field]).length > limit) return `O campo ${field} excede o limite de ${limit} caracteres.`
  }

  for (const [field, limits] of Object.entries(LIST_LIMITS)) {
    const value = input[field]
    if (value !== undefined && !Array.isArray(value)) return `A lista ${field} é inválida.`
    if ((value || []).length > MAX_LIST_ITEMS) return `A lista ${field} aceita no máximo ${MAX_LIST_ITEMS} itens.`
    for (const item of value || []) {
      if (limits.value && text(item).length > limits.value) return `Um item da lista ${field} excede o limite de ${limits.value} caracteres.`
      for (const [itemField, limit] of Object.entries(limits)) {
        if (itemField !== 'value' && text(item?.[itemField]).length > limit) {
          return `O campo ${itemField} da lista ${field} excede o limite de ${limit} caracteres.`
        }
      }
    }
  }
  return ''
}

export function normalizeClinicalProtocol(input = {}) {
  return {
    name:text(input.name).slice(0, 160),
    procedureName:text(input.procedureName).slice(0, 160),
    description:text(input.description).slice(0, 2000),
    indication:text(input.indication).slice(0, 5000),
    objectives:text(input.objectives).slice(0, 5000),
    plannedTreatment:text(input.plannedTreatment).slice(0, 10000),
    guidance:text(input.guidance).slice(0, 5000),
    anamnesisPrompts:limited(input.anamnesisPrompts, (item, index) => {
      const label = text(typeof item === 'string' ? item : item?.label).slice(0, 240)
      return label ? { key:text(item?.key) || `question_${index + 1}`, label, required:Boolean(item?.required) } : null
    }),
    examKit:limited(input.examKit, item => text(item).slice(0, 240)),
    medicationFavorites:limited(input.medicationFavorites, item => {
      const medication = text(item?.medication).slice(0, 240)
      return medication ? {
        medication,
        presentation:text(item?.presentation).slice(0, 240),
        quantity:text(item?.quantity).slice(0, 120),
        directions:text(item?.directions).slice(0, 1000),
      } : null
    }),
    photoRequirements:limited(input.photoRequirements, item => text(item).slice(0, 240)),
    returnSchedule:limited(input.returnSchedule, item => {
      const title = text(item?.title).slice(0, 160)
      const days = Number(item?.days)
      if (!title || !Number.isInteger(days) || days < 0 || days > 3650) return null
      return { title, days, instructions:text(item?.instructions).slice(0, 1000) }
    }),
  }
}

export function validateClinicalProtocol(input) {
  const limitError = validateRawLimits(input)
  if (limitError) return limitError
  const protocol = normalizeClinicalProtocol(input)
  if (!protocol.name) return 'Informe o nome do protocolo.'
  if (!protocol.procedureName) return 'Informe o procedimento relacionado.'
  if (!protocol.indication || !protocol.objectives || !protocol.plannedTreatment || !protocol.guidance) {
    return 'Preencha indicação, objetivos, tratamento e orientações.'
  }
  if (protocol.anamnesisPrompts.some(item => !/^[a-z0-9_]+$/i.test(item.key))) return 'Há uma pergunta complementar inválida.'
  return ''
}

export function protocolVersionToForm(version = {}) {
  return normalizeClinicalProtocol({
    name:version.name, procedureName:version.procedure_name, description:version.description,
    indication:version.indication, objectives:version.objectives, plannedTreatment:version.planned_treatment,
    guidance:version.guidance, anamnesisPrompts:version.anamnesis_prompts, examKit:version.exam_kit,
    medicationFavorites:version.medication_favorites, photoRequirements:version.photo_requirements,
    returnSchedule:version.return_schedule,
  })
}

export function buildClinicalProtocolRpcArgs({ protocolId = null, requestId, form }) {
  const error = validateClinicalProtocol(form)
  if (error) throw new Error(error)
  if (!requestId) throw new Error('Não foi possível identificar esta tentativa.')
  return { p_protocol_id:protocolId, p_request_id:requestId, p_payload:normalizeClinicalProtocol(form) }
}

export function buildProtocolAnamnesisDraft(version, current = {}) {
  const protocol = protocolVersionToForm(version)
  return {
    ...current,
    therapeutic_plan:text(current.therapeutic_plan) || [protocol.plannedTreatment, protocol.guidance].filter(Boolean).join('\n\n'),
    protocol_id:version.protocol_id || null,
    protocol_version_id:version.id || null,
    protocol_name:protocol.name,
    protocol_responses:Object.fromEntries(protocol.anamnesisPrompts.map(item => [item.key, ''])),
  }
}

export function validateProtocolResponses(version, responses = {}) {
  const missing = protocolVersionToForm(version).anamnesisPrompts.find(item => item.required && !text(responses[item.key]))
  return missing ? `Responda ao campo obrigatório do protocolo: ${missing.label}.` : ''
}

export function applyProtocolToTreatment(version, current = {}, startOn = '') {
  const protocol = protocolVersionToForm(version)
  const start = startOn ? new Date(`${startOn}T12:00:00`) : null
  const sessions = protocol.returnSchedule.map(item => {
    const date = start && !Number.isNaN(start.getTime()) ? new Date(start.getTime() + item.days * 86400000) : null
    return {
      sessionType:item.days === 0 ? 'procedure' : 'return', title:item.title,
      instructions:item.instructions, scheduledStart:date ? `${date.toISOString().slice(0, 10)}T09:00` : '', durationMinutes:30,
    }
  })
  return {
    values:{
      ...current,
      title:current.title || protocol.name,
      indication:current.indication || protocol.indication,
      objectives:current.objectives || protocol.objectives,
      plannedTreatment:current.plannedTreatment || protocol.plannedTreatment,
      guidance:current.guidance || protocol.guidance,
      protocolId:version.protocol_id || null,
      protocolVersionId:version.id || null,
    },
    sessions,
  }
}

export function buildProtocolWorkspace({ protocols = [], versions = [], statuses = [] }) {
  return protocols.map(protocol => {
    const history = versions.filter(item => item.protocol_id === protocol.id).sort((a, b) => b.version_number - a.version_number)
    const events = statuses.filter(item => item.protocol_id === protocol.id).sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))
    return { ...protocol, versions:history, currentVersion:history[0] || null, currentStatus:events[0]?.status || 'active', statusEvents:events }
  }).sort((a, b) => String(a.currentVersion?.name || '').localeCompare(String(b.currentVersion?.name || ''), 'pt-BR'))
}
