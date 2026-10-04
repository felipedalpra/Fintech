const CONSULTATION_LABELS = {
  avaliacao:'Avaliação',
  retorno:'Retorno',
  pos_operatorio:'Pós-operatório',
  procedimento_estetico:'Procedimento estético',
}

export const DEFAULT_DURATION_MINUTES = { surgery:180, consultation:60 }
export const MAX_SYNC_BATCH = 50
const MAX_AUTO_DELETES = 25
const FALLBACK_TIME_ZONE = 'America/Sao_Paulo'

export function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE
  } catch {
    return FALLBACK_TIME_ZONE
  }
}

export function localTodayIso(now = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function normalizeTime(value) {
  const text = String(value || '')
  return /^\d{2}:\d{2}/.test(text) ? text.slice(0, 5) : ''
}

export function normalizeDuration(value, type) {
  const minutes = Math.round(Number(value))
  return minutes > 0 && minutes <= 1440 ? minutes : DEFAULT_DURATION_MINUTES[type]
}

export function buildEventTitle(type, record, procedures = []) {
  const patient = String(record.patient || '').trim() || 'Paciente'
  if (type === 'surgery') {
    const procedureName = procedures.find(item => item.id === record.procedureId)?.name || 'Cirurgia'
    return `${patient} — ${procedureName}`
  }
  return `${patient} — ${CONSULTATION_LABELS[record.consultationType] || 'Consulta'}`
}

export function hashPayload(payload) {
  const text = JSON.stringify([
    payload.type,
    payload.id,
    payload.title,
    payload.date,
    payload.startTime,
    payload.durationMinutes,
    payload.timeZone,
  ])
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

export function buildSyncPayload(type, record, procedures, timeZone) {
  const startTime = normalizeTime(record.startTime)
  const payload = {
    type,
    id:record.id,
    title:buildEventTitle(type, record, procedures),
    date:record.date,
    startTime,
    durationMinutes:startTime ? normalizeDuration(record.durationMinutes, type) : 0,
    timeZone,
  }
  return { ...payload, hash:hashPayload(payload) }
}

// links: { 'surgery:<id>': hashSincronizado }. Só envia registros de hoje em diante
// (ou que já tenham vínculo) para não inundar a agenda com histórico antigo.
export function collectSyncChanges({ data, links, todayIso, timeZone }) {
  const upserts = []
  const seen = new Set()
  const groups = [
    ['surgery', data.surgeries || []],
    ['consultation', data.consultations || []],
  ]

  for (const [type, records] of groups) {
    for (const record of records) {
      if (!record.id) continue
      const key = `${type}:${record.id}`
      seen.add(key)
      if (!record.date) continue
      const linked = key in links
      if (!linked && record.date < todayIso) continue
      const payload = buildSyncPayload(type, record, data.procedures || [], timeZone)
      if (links[key] !== payload.hash) upserts.push(payload)
    }
  }

  const staleKeys = Object.keys(links).filter(key => !seen.has(key))
  const deletes = staleKeys.length <= MAX_AUTO_DELETES
    ? staleKeys.map(key => {
      const [type, ...rest] = key.split(':')
      return { type, id:rest.join(':') }
    })
    : []

  return { upserts, deletes }
}

// Aplica nos registros locais as mudanças de data/horário feitas diretamente no Google.
export function applyExternalChanges(data, events) {
  let changed = 0

  function patch(records, type) {
    return records.map(record => {
      const event = events.find(item => item.linked && item.externalChange && item.recordType === type && item.recordId === record.id)
      if (!event || !event.date) return record
      const next = { ...record, date:event.date, startTime:event.startTime || '' }
      if (event.startTime && event.durationMinutes > 0) next.durationMinutes = event.durationMinutes
      const same = next.date === record.date
        && (next.startTime || '') === (record.startTime || '')
        && (next.durationMinutes || 0) === (record.durationMinutes || 0)
      if (same) return record
      changed += 1
      return next
    })
  }

  const next = {
    ...data,
    surgeries:patch(data.surgeries || [], 'surgery'),
    consultations:patch(data.consultations || [], 'consultation'),
  }
  return { data:changed > 0 ? next : data, changed }
}
