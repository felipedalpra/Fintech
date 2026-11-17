import { formatCpf, formatPhone, isValidCpf, isValidPhone } from './formFieldStandards.js'

export function buildClinicalPatientIdentity(patient = {}) {
  const items = [`Nascimento: ${patient.date_of_birth || 'não informado'}`]
  const phoneDigits = String(patient.phone || '').replace(/\D/g, '')
  if (isValidCpf(patient.cpf)) items.push(`CPF: ${formatCpf(patient.cpf)}`)
  if (phoneDigits.length >= 10 && phoneDigits.length <= 13 && isValidPhone(patient.phone)) items.push(`Telefone: ${formatPhone(patient.phone)}`)
  else if (patient.phone) items.push('Telefone cadastrado: revisar')
  if (patient.email) items.push(`E-mail: ${patient.email}`)
  return items
}
