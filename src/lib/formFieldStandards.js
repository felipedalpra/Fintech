export const BRAZIL_STATES = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]

const digits = (value, limit) => String(value || '').replace(/\D/g, '').slice(0, limit)

export function formatCpf(value) {
  const raw = digits(value, 11)
  return raw.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2')
}

export function formatCnpj(value) {
  const raw = digits(value, 14)
  return raw.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\/\d{4})(\d)/, '$1-$2')
}

export function formatCpfCnpj(value) {
  const raw = digits(value, 14)
  return raw.length <= 11 ? formatCpf(raw) : formatCnpj(raw)
}

export function formatPhone(value) {
  let raw = digits(value, 13)
  const hasCountry = raw.startsWith('55') && raw.length > 11
  if (hasCountry) raw = raw.slice(2)
  raw = raw.slice(0, 11)
  const local = raw.length <= 10
    ? raw.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
    : raw.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
  return hasCountry ? `+55 ${local}` : local
}

export function formatCep(value) {
  return digits(value, 8).replace(/^(\d{5})(\d)/, '$1-$2')
}

export function formatUf(value) {
  return String(value || '').replace(/[^a-z]/gi, '').toUpperCase().slice(0, 2)
}

export function formatNumericRegistration(value) {
  return digits(value, 10)
}

export function formatEmail(value) {
  return String(value || '').replace(/\s/g, '').toLocaleLowerCase('pt-BR').slice(0, 254)
}

export function isValidCpf(value) {
  const raw = digits(value, 11)
  if (raw.length !== 11 || /^(\d)\1+$/.test(raw)) return false
  const digit = length => {
    let sum = 0
    for (let index = 0; index < length; index += 1) sum += Number(raw[index]) * (length + 1 - index)
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }
  return digit(9) === Number(raw[9]) && digit(10) === Number(raw[10])
}

export function isValidCnpj(value) {
  const raw = digits(value, 14)
  if (raw.length !== 14 || /^(\d)\1+$/.test(raw)) return false
  const calculate = base => {
    let weight = base.length - 7
    const sum = [...base].reduce((total, item) => {
      const next = total + Number(item) * weight
      weight -= 1
      if (weight < 2) weight = 9
      return next
    }, 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  return calculate(raw.slice(0, 12)) === Number(raw[12]) && calculate(raw.slice(0, 13)) === Number(raw[13])
}

export const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim())
export const isValidPhone = value => {
  const length = digits(value, 13).length
  return length >= 10 && length <= 13
}
export const isValidCep = value => digits(value, 8).length === 8
export const isValidUf = value => BRAZIL_STATES.includes(formatUf(value))

export function parseProfessionalRegistration(value) {
  const text = String(value || '').trim().toUpperCase()
  const state = text.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/)?.[1] || ''
  const number = formatNumericRegistration(text)
  return { state, number }
}

export function buildProfessionalRegistration(council = 'CRM', state = '', number = '') {
  const cleanCouncil = String(council || 'CRM').replace(/[^a-z]/gi, '').toUpperCase().slice(0, 10) || 'CRM'
  const cleanState = formatUf(state)
  const cleanNumber = formatNumericRegistration(number)
  if (!cleanState && !cleanNumber) return ''
  return `${cleanCouncil}${cleanState ? `-${cleanState}` : ''}${cleanNumber ? ` ${cleanNumber}` : ''}`
}

export const FIELD_STANDARDS = {
  cpf:{ format:formatCpf, maxLength:14, inputMode:'numeric', validate:value => !value || isValidCpf(value) || 'CPF inválido.' },
  cpfCnpj:{ format:formatCpfCnpj, maxLength:18, inputMode:'numeric', validate:value => !value || (digits(value, 14).length <= 11 ? isValidCpf(value) : isValidCnpj(value)) || 'CPF ou CNPJ inválido.' },
  phone:{ format:formatPhone, maxLength:19, inputMode:'tel', validate:value => !value || isValidPhone(value) || 'Informe DDD e número.' },
  cep:{ format:formatCep, maxLength:9, inputMode:'numeric', validate:value => !value || isValidCep(value) || 'CEP deve ter 8 números.' },
  uf:{ format:formatUf, maxLength:2, inputMode:'text', validate:value => !value || isValidUf(value) || 'Use uma UF válida, como RS ou SP.' },
  email:{ format:formatEmail, maxLength:254, inputMode:'email', validate:value => !value || isValidEmail(value) || 'E-mail inválido.' },
  registration:{ format:formatNumericRegistration, maxLength:10, inputMode:'numeric', validate:value => !value || /^\d+$/.test(value) || 'Use somente números.' },
}

export function validateContactIdentity({ cpf, phone, email, address_zip:cep, address_state:uf } = {}) {
  if (cpf && !isValidCpf(cpf)) return 'Informe um CPF válido com 11 números.'
  if (phone && !isValidPhone(phone)) return 'Informe o telefone com DDD.'
  if (email && !isValidEmail(email)) return 'Informe um e-mail válido.'
  if (cep && !isValidCep(cep)) return 'Informe o CEP com 8 números.'
  if (uf && !isValidUf(uf)) return 'Informe uma UF válida, como RS ou SP.'
  return ''
}
