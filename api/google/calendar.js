import { getAuthenticatedUser } from '../secure-profile/_lib.js'
import {
  NeedsReconnectError,
  buildAuthUrl,
  deleteConnection,
  deleteEvent,
  deleteLink,
  exchangeCode,
  fetchAccountEmail,
  getAccessToken,
  getCalendarConfig,
  getConnection,
  getLinks,
  insertEvent,
  isConfigured,
  listEvents,
  markDetached,
  saveConnection,
  updateEvent,
  upsertLink,
} from '../_lib/googleCalendarApi.js'
import { buildGoogleEvent, normalizeGoogleEvent, signState, snapshotOf, verifyState } from '../_lib/googleCalendar.js'

const MAX_ITEMS_PER_SYNC = 50
const MAX_EVENTS_RANGE_MS = 62 * 24 * 60 * 60 * 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

function linkKey(type, id) {
  return `${type}:${id}`
}

function isValidUpsert(item) {
  return item
    && (item.type === 'surgery' || item.type === 'consultation')
    && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
    && typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 300
    && DATE_RE.test(item.date || '')
    && (item.startTime === '' || TIME_RE.test(item.startTime || ''))
    && Number.isInteger(item.durationMinutes) && item.durationMinutes >= 0 && item.durationMinutes <= 1440
    && typeof item.timeZone === 'string' && item.timeZone.length > 0 && item.timeZone.length <= 64
    && typeof item.hash === 'string' && item.hash.length > 0 && item.hash.length <= 64
}

function isValidDelete(item) {
  return item
    && (item.type === 'surgery' || item.type === 'consultation')
    && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
}

function sendError(res, error) {
  if (error instanceof NeedsReconnectError) return res.status(409).json({ error:'needs_reconnect' })
  const unauthorized = /bearer token|auth token/i.test(error.message || '')
  return res.status(unauthorized ? 401 : 500).json({ error:error.message || 'Erro na integracao com a Google Agenda.' })
}

async function handleCallback(req, res, config) {
  const back = result => res.redirect(`${config.appUrl}/app/calendar?google=${result}`)
  try {
    if (req.query.error) return back('denied')
    const userId = verifyState(req.query.state, config.stateSecret)
    if (!userId) return res.status(400).send('Estado de autorizacao invalido ou expirado.')

    const token = await exchangeCode(config, String(req.query.code))
    if (!String(token.scope || '').includes('calendar.events')) return back('scope')
    if (!token.refresh_token) return back('error')

    const profile = await fetchAccountEmail(token.access_token).catch(() => ({}))
    await saveConnection(userId, { email:profile.email || '', refreshToken:token.refresh_token })
    return back('connected')
  } catch {
    return back('error')
  }
}

async function handleStatus(req, res, config) {
  if (!isConfigured(config)) return res.status(200).json({ configured:false, connected:false })
  const user = await getAuthenticatedUser(req)
  const connection = await getConnection(user.id)
  const links = connection ? await getLinks(user.id) : []
  return res.status(200).json({
    configured:true,
    connected:connection?.status === 'connected',
    needsReconnect:connection?.status === 'needs_reconnect',
    email:connection?.account_email || '',
    links:Object.fromEntries(links.map(link => [linkKey(link.record_type, link.record_id), link.synced_hash])),
  })
}

async function handleConnect(req, res, config) {
  if (!isConfigured(config)) return res.status(503).json({ error:'Integracao Google Agenda nao configurada.' })
  const user = await getAuthenticatedUser(req)
  const state = signState(user.id, config.stateSecret)
  return res.status(200).json({ url:buildAuthUrl(config, state) })
}

async function handleDisconnect(req, res) {
  const user = await getAuthenticatedUser(req)
  await deleteConnection(user.id)
  return res.status(200).json({ ok:true })
}

async function handleEvents(req, res, config) {
  const user = await getAuthenticatedUser(req)
  const timeMin = String(req.query.timeMin || '')
  const timeMax = String(req.query.timeMax || '')
  const timeZone = String(req.query.timeZone || 'America/Sao_Paulo')
  const from = Date.parse(timeMin)
  const to = Date.parse(timeMax)
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > MAX_EVENTS_RANGE_MS) {
    return res.status(400).json({ error:'Intervalo invalido.' })
  }

  const accessToken = await getAccessToken(config, user.id)
  const items = await listEvents(accessToken, { timeMin, timeMax, timeZone })
  const links = await getLinks(user.id)
  const linkByEvent = new Map(links.map(link => [link.google_event_id, link]))

  const events = []
  for (const item of items) {
    const event = normalizeGoogleEvent(item)
    const link = linkByEvent.get(event.googleId)
    if (event.cancelled) {
      if (link && !link.detached) await markDetached(user.id, link.record_type, link.record_id)
      continue
    }
    if (!link) {
      events.push({ ...event, linked:false, externalChange:false })
      continue
    }
    events.push({ ...event, linked:true, externalChange:snapshotOf(event) !== link.remote_snapshot })
  }

  return res.status(200).json({ events })
}

async function handleSync(req, res, config) {
  const user = await getAuthenticatedUser(req)
  const upserts = Array.isArray(req.body?.upserts) ? req.body.upserts : []
  const deletes = Array.isArray(req.body?.deletes) ? req.body.deletes : []
  if (upserts.length > MAX_ITEMS_PER_SYNC || deletes.length > MAX_ITEMS_PER_SYNC) {
    return res.status(400).json({ error:'Lote grande demais.' })
  }
  if (!upserts.every(isValidUpsert) || !deletes.every(isValidDelete)) {
    return res.status(400).json({ error:'Payload invalido.' })
  }

  const accessToken = await getAccessToken(config, user.id)
  const existing = new Map((await getLinks(user.id)).map(link => [linkKey(link.record_type, link.record_id), link]))
  const result = { links:{}, deleted:[], errors:[] }

  for (const item of upserts) {
    const key = linkKey(item.type, item.id)
    try {
      const link = existing.get(key)
      if (link && !link.detached && link.synced_hash === item.hash) {
        result.links[key] = item.hash
        continue
      }

      const event = buildGoogleEvent(item)
      let eventId = link && !link.detached ? link.google_event_id : null
      if (eventId) {
        try {
          await updateEvent(accessToken, eventId, event)
        } catch (error) {
          if (error.status === 404 || error.status === 410) eventId = null
          else throw error
        }
      }
      if (!eventId) eventId = (await insertEvent(accessToken, event)).id

      await upsertLink(user.id, { type:item.type, id:item.id, googleEventId:eventId, hash:item.hash, snapshot:snapshotOf(item) })
      result.links[key] = item.hash
    } catch (error) {
      if (error instanceof NeedsReconnectError) throw error
      result.errors.push({ key, message:error.message })
    }
  }

  for (const item of deletes) {
    const key = linkKey(item.type, item.id)
    try {
      const link = existing.get(key)
      if (link && !link.detached) await deleteEvent(accessToken, link.google_event_id)
      if (link) await deleteLink(user.id, item.type, item.id)
      result.deleted.push(key)
    } catch (error) {
      if (error instanceof NeedsReconnectError) throw error
      result.errors.push({ key, message:error.message })
    }
  }

  return res.status(200).json(result)
}

export default async function handler(req, res) {
  const config = getCalendarConfig()
  try {
    if (req.method === 'GET' && (req.query?.code || req.query?.error)) return await handleCallback(req, res, config)

    const action = String(req.query?.action || '')
    const routes = {
      status:{ method:'GET', run:handleStatus },
      events:{ method:'GET', run:handleEvents },
      connect:{ method:'POST', run:handleConnect },
      disconnect:{ method:'POST', run:handleDisconnect },
      sync:{ method:'POST', run:handleSync },
    }
    const route = routes[action]
    if (!route) return res.status(404).json({ error:'Acao desconhecida.' })
    if (req.method !== route.method) {
      res.setHeader('Allow', route.method)
      return res.status(405).json({ error:'Method not allowed' })
    }
    if (action !== 'status' && action !== 'connect' && !isConfigured(config)) {
      return res.status(503).json({ error:'Integracao Google Agenda nao configurada.' })
    }
    return await route.run(req, res, config)
  } catch (error) {
    return sendError(res, error)
  }
}
