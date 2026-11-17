import { clinicalDocumentTypeLabel, CLINICAL_DOCUMENT_TYPES } from './clinicalDocuments.js'

const { EXAM_REQUEST, SIMPLE_PRESCRIPTION } = CLINICAL_DOCUMENT_TYPES

const text = value => String(value || '').trim()

function examLines(value) {
  return String(value || '')
    .split('\n')
    .map(line => line.replace(/^[-•\d.)\s]+/, '').trim())
    .filter(Boolean)
}

function prescriptionItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => ({
      medication:text(item?.medication),
      presentation:text(item?.presentation),
      quantity:text(item?.quantity),
      directions:text(item?.directions),
    }))
    .filter(item => Object.values(item).some(Boolean))
}

export function defaultClinicalDocumentTemplateName(type) {
  return `Modelo de ${type === SIMPLE_PRESCRIPTION ? 'receita' : 'pedido de exames'}`
}

// Reaproveita o contrato de protocolos versionados como biblioteca de modelos.
// O documento emitido continua sendo um snapshot próprio; alterar o modelo
// depois nunca altera o histórico do paciente.
export function buildClinicalDocumentTemplate({ type, form, name }) {
  const templateName = text(name)
  if (!templateName) throw new Error('Informe um nome para o modelo.')

  const isPrescription = type === SIMPLE_PRESCRIPTION
  if (![EXAM_REQUEST, SIMPLE_PRESCRIPTION].includes(type)) {
    throw new Error('Tipo de documento inválido para modelo.')
  }

  const exams = isPrescription ? [] : examLines(form?.exams_text)
  const medications = isPrescription ? prescriptionItems(form?.items) : []
  if (isPrescription && medications.length === 0) throw new Error('Inclua ao menos um medicamento antes de salvar o modelo.')
  if (!isPrescription && exams.length === 0) throw new Error('Inclua ao menos um exame antes de salvar o modelo.')

  const label = clinicalDocumentTypeLabel(type)
  return {
    name:templateName,
    procedureName:label,
    description:`Modelo reutilizável de ${label.toLocaleLowerCase('pt-BR')}.`,
    indication:text(form?.clinical_indication) || 'Preencher ou revisar a indicação clínica para o paciente.',
    objectives:'Agilizar o preenchimento sem substituir a revisão do profissional.',
    plannedTreatment:`Conteúdo-base para ${label.toLocaleLowerCase('pt-BR')}.`,
    guidance:text(form?.instructions) || 'Revisar e ajustar todos os dados antes de emitir.',
    anamnesisPrompts:[],
    examKit:exams,
    medicationFavorites:medications,
    photoRequirements:[],
    returnSchedule:[],
  }
}
