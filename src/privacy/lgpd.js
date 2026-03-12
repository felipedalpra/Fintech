import { normalizeData } from '../dataModel.js'

export function createPatientAlias(seed = '') {
  const normalized = seed.trim().toLowerCase()
  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(index)
    hash |= 0
  }
  const code = String(Math.abs(hash)).padStart(6, '0').slice(0, 6)
  return `PAC-${code || '000000'}`
}

export function anonymizeFinanceData(rawData) {
  const data = normalizeData(rawData)

  return {
    ...data,
    surgeries:data.surgeries.map(item => ({
      ...item,
      patient:createPatientAlias(item.patient || item.patientId || item.id || ''),
      notes:'',
    })),
    consultations:data.consultations.map(item => ({
      ...item,
      patient:createPatientAlias(item.patient || item.patientId || item.id || ''),
      notes:'',
    })),
    productSales:data.productSales.map(item => ({
      ...item,
      patientName:item.patientName ? createPatientAlias(item.patientName) : '',
    })),
  }
}

export function exportPatientData(rawData, patientReference) {
  const data = normalizeData(rawData)
  const target = normalizeReference(patientReference)
  return {
    surgeries:data.surgeries.filter(item => normalizeReference(item.patient) === target),
    consultations:data.consultations.filter(item => normalizeReference(item.patient) === target),
    productSales:data.productSales.filter(item => normalizeReference(item.patientName) === target),
  }
}

export function anonymizePatientData(rawData, patientReference) {
  const data = normalizeData(rawData)
  const target = normalizeReference(patientReference)
  const alias = createPatientAlias(patientReference)

  return {
    ...data,
    surgeries:data.surgeries.map(item => normalizeReference(item.patient) === target ? { ...item, patient:alias, notes:'' } : item),
    consultations:data.consultations.map(item => normalizeReference(item.patient) === target ? { ...item, patient:alias, notes:'' } : item),
    productSales:data.productSales.map(item => normalizeReference(item.patientName) === target ? { ...item, patientName:alias } : item),
  }
}

export function deletePatientData(rawData, patientReference) {
  const data = normalizeData(rawData)
  const target = normalizeReference(patientReference)

  return {
    ...data,
    surgeries:data.surgeries.filter(item => normalizeReference(item.patient) !== target),
    consultations:data.consultations.filter(item => normalizeReference(item.patient) !== target),
    productSales:data.productSales.filter(item => normalizeReference(item.patientName) !== target),
  }
}

export function buildPrivacyAudit(rawData) {
  const data = normalizeData(rawData)
  return {
    findings:[
      { location:'surgeries.patient', classification:'dado pessoal', records:data.surgeries.filter(item => !!item.patient).length },
      { location:'surgeries.notes', classification:'potencial dado sensível', records:data.surgeries.filter(item => !!item.notes).length },
      { location:'consultations.patient', classification:'dado pessoal', records:data.consultations.filter(item => !!item.patient).length },
      { location:'productSales.patientName', classification:'dado pessoal', records:data.productSales.filter(item => !!item.patientName).length },
    ],
  }
}

function normalizeReference(value = '') {
  return String(value).trim().toLowerCase()
}
