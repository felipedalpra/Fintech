const CONSULTATION_LABELS = {
  avaliacao:'Avaliação',
  retorno:'Retorno',
  pos_operatorio:'Pós-operatório',
  procedimento_estetico:'Procedimento estético',
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
}

export function buildClinicalDaySchedule(data, date) {
  const consultations = (data?.consultations || [])
    .filter(item => item.date === date && item.paymentStatus !== 'cancelado')
    .map(item => ({
      id:`consultation:${item.id}`,
      sourceId:item.id,
      kind:'consultation',
      patientId:item.patientId || '',
      patientName:item.patient || 'Paciente não identificado',
      time:item.startTime || '',
      durationMinutes:Number(item.durationMinutes) || 60,
      label:CONSULTATION_LABELS[item.consultationType] || 'Consulta',
      status:item.paymentStatus || 'pendente',
    }))

  const surgeries = (data?.surgeries || [])
    .filter(item => item.date === date && item.paymentStatus !== 'cancelado')
    .map(item => ({
      id:`surgery:${item.id}`,
      sourceId:item.id,
      kind:'surgery',
      patientId:item.patientId || '',
      patientName:item.patient || 'Paciente não identificado',
      time:item.startTime || '',
      durationMinutes:Number(item.durationMinutes) || 180,
      label:'Cirurgia',
      status:item.paymentStatus || 'pendente',
    }))

  return [...consultations, ...surgeries].sort((left, right) => {
    if (!left.time && right.time) return 1
    if (left.time && !right.time) return -1
    return left.time.localeCompare(right.time) || left.patientName.localeCompare(right.patientName, 'pt-BR')
  })
}

export function resolveSchedulePatient(item, patients) {
  if (!item) return null
  if (item.patientId) {
    const exact = (patients || []).find(patient => patient.id === item.patientId)
    if (exact) return exact
  }
  const targetName = normalizedName(item.patientName)
  if (!targetName) return null
  const matches = (patients || []).filter(patient => normalizedName(patient.full_name) === targetName)
  return matches.length === 1 ? matches[0] : null
}

export function patientInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '—'
  return `${parts[0][0] || ''}${parts.length > 1 ? parts.at(-1)[0] || '' : ''}`.toLocaleUpperCase('pt-BR')
}

export function patientAge(dateOfBirth, referenceDate = new Date()) {
  if (!dateOfBirth) return null
  const [year, month, day] = String(dateOfBirth).split('-').map(Number)
  if (!year || !month || !day) return null
  let age = referenceDate.getFullYear() - year
  const beforeBirthday = referenceDate.getMonth() + 1 < month
    || (referenceDate.getMonth() + 1 === month && referenceDate.getDate() < day)
  if (beforeBirthday) age -= 1
  return age >= 0 ? age : null
}
