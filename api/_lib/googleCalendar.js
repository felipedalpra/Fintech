export { signState, verifyState } from './oauthState.js'

function addDaysIso(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Trata data/hora como horário de parede (sem fuso), evitando efeitos de horário de verão.
function addMinutesToLocal(isoDate, time, minutes) {
  const date = new Date(`${isoDate}T${time}:00Z`)
  date.setUTCMinutes(date.getUTCMinutes() + minutes)
  return date.toISOString().slice(0, 19)
}

export function snapshotOf({ date, startTime, durationMinutes }) {
  return `${date}|${startTime || ''}|${startTime ? durationMinutes : ''}`
}

export function buildGoogleEvent(payload) {
  const base = {
    summary:payload.title,
    description:'Criado pelo SurgiMetrics',
    extendedProperties:{
      private:{ surgimetricsType:payload.type, surgimetricsId:payload.id },
    },
  }

  if (!payload.startTime) {
    return { ...base, start:{ date:payload.date }, end:{ date:addDaysIso(payload.date, 1) } }
  }

  return {
    ...base,
    start:{ dateTime:`${payload.date}T${payload.startTime}:00`, timeZone:payload.timeZone },
    end:{
      dateTime:addMinutesToLocal(payload.date, payload.startTime, payload.durationMinutes),
      timeZone:payload.timeZone,
    },
  }
}

// O Google devolve dateTime já no fuso pedido em `timeZone`, então basta fatiar a string.
export function normalizeGoogleEvent(item) {
  const priv = item.extendedProperties?.private || {}
  const allDay = Boolean(item.start?.date && !item.start?.dateTime)
  let date = ''
  let startTime = ''
  let durationMinutes = 0

  if (allDay) {
    date = item.start.date
  } else if (item.start?.dateTime) {
    const start = item.start.dateTime
    date = start.slice(0, 10)
    startTime = start.slice(11, 16)
    if (item.end?.dateTime) {
      durationMinutes = Math.max(0, Math.round((Date.parse(item.end.dateTime) - Date.parse(start)) / 60000))
    }
  }

  return {
    googleId:item.id,
    title:item.summary || '(sem título)',
    date,
    startTime,
    durationMinutes,
    allDay,
    cancelled:item.status === 'cancelled',
    recordType:priv.surgimetricsType || '',
    recordId:priv.surgimetricsId || '',
  }
}
