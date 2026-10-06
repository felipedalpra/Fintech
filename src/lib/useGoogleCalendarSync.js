import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  startGoogleCalendarConnection,
  syncGoogleCalendar,
} from './googleCalendarClient.js'
import { MAX_SYNC_BATCH, collectSyncChanges, getBrowserTimeZone, localTodayIso } from './googleCalendarPayload.js'

const SYNC_DEBOUNCE_MS = 1500
const INITIAL_STATUS = { loading:true, configured:false, connected:false, needsReconnect:false, email:'' }

// `enabled` deve ser true somente depois que o dataset foi carregado, para nunca
// interpretar "ainda não carregou" como "o usuário apagou tudo".
export function useGoogleCalendarSync({ data, enabled }) {
  const [status, setStatus] = useState(INITIAL_STATUS)
  const [syncError, setSyncError] = useState('')
  const [tick, setTick] = useState(0)
  const linksRef = useRef({})
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const timeZone = useMemo(() => getBrowserTimeZone(), [])

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getGoogleCalendarStatus()
      linksRef.current = next.links || {}
      setStatus({
        loading:false,
        configured:Boolean(next.configured),
        connected:Boolean(next.connected),
        needsReconnect:Boolean(next.needsReconnect),
        email:next.email || '',
      })
    } catch {
      setStatus(current => ({ ...current, loading:false }))
    }
  }, [])

  const markNeedsReconnect = useCallback(() => {
    setStatus(current => ({ ...current, connected:false, needsReconnect:true }))
  }, [])

  useEffect(() => {
    if (enabled) refreshStatus()
  }, [enabled, refreshStatus])

  useEffect(() => {
    if (!enabled || !status.connected) return undefined

    const timer = setTimeout(async () => {
      if (inFlightRef.current) {
        pendingRef.current = true
        return
      }

      const { upserts, deletes } = collectSyncChanges({
        data,
        links:linksRef.current,
        todayIso:localTodayIso(),
        timeZone,
      })
      if (upserts.length === 0 && deletes.length === 0) return

      inFlightRef.current = true
      try {
        const result = await syncGoogleCalendar({
          upserts:upserts.slice(0, MAX_SYNC_BATCH),
          deletes:deletes.slice(0, MAX_SYNC_BATCH),
        })
        const nextLinks = { ...linksRef.current, ...result.links }
        for (const key of result.deleted || []) delete nextLinks[key]
        linksRef.current = nextLinks
        setSyncError(result.errors?.length ? 'Alguns itens não foram enviados à Google Agenda.' : '')
        if (upserts.length > MAX_SYNC_BATCH || deletes.length > MAX_SYNC_BATCH) pendingRef.current = true
      } catch (error) {
        if (error.needsReconnect) markNeedsReconnect()
        setSyncError('Não foi possível sincronizar com a Google Agenda.')
      } finally {
        inFlightRef.current = false
        if (pendingRef.current) {
          pendingRef.current = false
          setTick(value => value + 1)
        }
      }
    }, SYNC_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [data, enabled, status.connected, timeZone, tick, markNeedsReconnect])

  const connect = useCallback(async () => {
    const { url } = await startGoogleCalendarConnection()
    window.location.assign(url)
  }, [])

  const disconnect = useCallback(async () => {
    await disconnectGoogleCalendar()
    linksRef.current = {}
    setSyncError('')
    setStatus(current => ({ ...current, connected:false, needsReconnect:false, email:'' }))
  }, [])

  return { status, syncError, timeZone, connect, disconnect, refreshStatus, markNeedsReconnect }
}
