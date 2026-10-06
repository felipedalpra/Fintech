import { expect, test } from '@playwright/test'
import {
  buildGoogleEvent,
  normalizeGoogleEvent,
  signState,
  snapshotOf,
  verifyState,
} from '../../api/_lib/googleCalendar.js'

const base = { type:'consultation', id:'c1', title:'Ana — Avaliação', timeZone:'America/Sao_Paulo' }

test('buildGoogleEvent com horario', () => {
  const event = buildGoogleEvent({ ...base, date:'2026-10-05', startTime:'14:30', durationMinutes:90 })
  expect(event.summary).toBe('Ana — Avaliação')
  expect(event.start).toEqual({ dateTime:'2026-10-05T14:30:00', timeZone:'America/Sao_Paulo' })
  expect(event.end).toEqual({ dateTime:'2026-10-05T16:00:00', timeZone:'America/Sao_Paulo' })
  expect(event.extendedProperties.private).toEqual({ surgimetricsType:'consultation', surgimetricsId:'c1' })
})

test('buildGoogleEvent cruzando meia-noite', () => {
  const event = buildGoogleEvent({ ...base, date:'2026-10-05', startTime:'23:30', durationMinutes:90 })
  expect(event.end.dateTime).toBe('2026-10-06T01:00:00')
})

test('buildGoogleEvent dia inteiro termina no dia seguinte', () => {
  const event = buildGoogleEvent({ ...base, date:'2026-12-31', startTime:'', durationMinutes:0 })
  expect(event.start).toEqual({ date:'2026-12-31' })
  expect(event.end).toEqual({ date:'2027-01-01' })
})

test('normalizeGoogleEvent evento com horario', () => {
  const normalized = normalizeGoogleEvent({
    id:'g1',
    summary:'Reunião',
    start:{ dateTime:'2026-10-05T14:30:00-03:00' },
    end:{ dateTime:'2026-10-05T16:00:00-03:00' },
    extendedProperties:{ private:{ surgimetricsType:'consultation', surgimetricsId:'c1' } },
  })
  expect(normalized).toMatchObject({
    googleId:'g1', title:'Reunião', date:'2026-10-05', startTime:'14:30',
    durationMinutes:90, allDay:false, cancelled:false, recordType:'consultation', recordId:'c1',
  })
})

test('normalizeGoogleEvent dia inteiro e cancelado', () => {
  const allDay = normalizeGoogleEvent({ id:'g2', summary:'Feriado', start:{ date:'2026-10-12' }, end:{ date:'2026-10-13' } })
  expect(allDay).toMatchObject({ date:'2026-10-12', startTime:'', durationMinutes:0, allDay:true })
  const cancelled = normalizeGoogleEvent({ id:'g3', status:'cancelled' })
  expect(cancelled.cancelled).toBe(true)
})

test('snapshotOf trata dia inteiro sem duracao', () => {
  expect(snapshotOf({ date:'2026-10-05', startTime:'14:30', durationMinutes:60 })).toBe('2026-10-05|14:30|60')
  expect(snapshotOf({ date:'2026-10-05', startTime:'', durationMinutes:0 })).toBe('2026-10-05||')
})

test('state assinado valida, rejeita adulterado e expirado', () => {
  const now = 1_000_000
  const state = signState('user-1', 'segredo', now)
  expect(verifyState(state, 'segredo', now + 1000)).toBe('user-1')
  expect(verifyState(state, 'outro-segredo', now + 1000)).toBeNull()
  expect(verifyState(`${state}x`, 'segredo', now + 1000)).toBeNull()
  expect(verifyState(state, 'segredo', now + 11 * 60 * 1000)).toBeNull()
  expect(verifyState('', 'segredo', now)).toBeNull()
})
