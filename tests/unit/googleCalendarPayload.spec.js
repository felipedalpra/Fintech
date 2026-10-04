import { expect, test } from '@playwright/test'
import {
  applyExternalChanges,
  buildEventTitle,
  buildSyncPayload,
  collectSyncChanges,
  normalizeDuration,
} from '../../src/lib/googleCalendarPayload.js'

const procedures = [{ id:'p1', name:'Rinoplastia' }]
const TZ = 'America/Sao_Paulo'

test('titulo usa nome completo e procedimento', () => {
  const title = buildEventTitle('surgery', { patient:'Maria da Silva', procedureId:'p1' }, procedures)
  expect(title).toBe('Maria da Silva — Rinoplastia')
})

test('titulo de consulta usa o rotulo do tipo', () => {
  const title = buildEventTitle('consultation', { patient:'João Souza', consultationType:'retorno' }, procedures)
  expect(title).toBe('João Souza — Retorno')
})

test('payload sem horario vira dia inteiro (duracao 0)', () => {
  const payload = buildSyncPayload('consultation', { id:'c1', patient:'Ana', date:'2026-10-05', consultationType:'avaliacao' }, procedures, TZ)
  expect(payload).toMatchObject({ type:'consultation', id:'c1', date:'2026-10-05', startTime:'', durationMinutes:0, timeZone:TZ })
})

test('payload com horario usa duracao informada ou o padrao do tipo', () => {
  const surgery = buildSyncPayload('surgery', { id:'s1', patient:'Ana', date:'2026-10-05', startTime:'08:00:00', procedureId:'p1' }, procedures, TZ)
  expect(surgery.startTime).toBe('08:00')
  expect(surgery.durationMinutes).toBe(180)
  const consultation = buildSyncPayload('consultation', { id:'c1', patient:'Ana', date:'2026-10-05', startTime:'14:30', durationMinutes:45 }, procedures, TZ)
  expect(consultation.durationMinutes).toBe(45)
})

test('hash muda quando horario muda e e estavel caso contrario', () => {
  const base = { id:'c1', patient:'Ana', date:'2026-10-05', startTime:'14:30', durationMinutes:60 }
  const a = buildSyncPayload('consultation', base, procedures, TZ)
  const b = buildSyncPayload('consultation', { ...base }, procedures, TZ)
  const c = buildSyncPayload('consultation', { ...base, startTime:'15:00' }, procedures, TZ)
  expect(a.hash).toBe(b.hash)
  expect(a.hash).not.toBe(c.hash)
})

test('normalizeDuration rejeita valores invalidos', () => {
  expect(normalizeDuration(0, 'consultation')).toBe(60)
  expect(normalizeDuration(-5, 'surgery')).toBe(180)
  expect(normalizeDuration(5000, 'surgery')).toBe(180)
  expect(normalizeDuration('90', 'consultation')).toBe(90)
})

test('collectSyncChanges ignora passado sem vinculo e envia futuro novo', () => {
  const data = {
    procedures,
    surgeries:[],
    consultations:[
      { id:'old', patient:'A', date:'2026-01-01' },
      { id:'new', patient:'B', date:'2026-10-10' },
    ],
  }
  const { upserts, deletes } = collectSyncChanges({ data, links:{}, todayIso:'2026-10-03', timeZone:TZ })
  expect(upserts.map(item => item.id)).toEqual(['new'])
  expect(deletes).toEqual([])
})

test('collectSyncChanges pula itens ja sincronizados e detecta exclusoes', () => {
  const data = { procedures, surgeries:[], consultations:[{ id:'c1', patient:'B', date:'2026-10-10' }] }
  const synced = buildSyncPayload('consultation', data.consultations[0], procedures, TZ)
  const links = { 'consultation:c1':synced.hash, 'surgery:gone':'abc' }
  const { upserts, deletes } = collectSyncChanges({ data, links, todayIso:'2026-10-03', timeZone:TZ })
  expect(upserts).toEqual([])
  expect(deletes).toEqual([{ type:'surgery', id:'gone' }])
})

test('collectSyncChanges nao exclui em massa (mais de 25)', () => {
  const links = {}
  for (let i = 0; i < 26; i += 1) links[`consultation:x${i}`] = 'h'
  const { deletes } = collectSyncChanges({ data:{ procedures, surgeries:[], consultations:[] }, links, todayIso:'2026-10-03', timeZone:TZ })
  expect(deletes).toEqual([])
})

test('applyExternalChanges atualiza data e horario de evento vinculado alterado no Google', () => {
  const data = { surgeries:[], consultations:[{ id:'c1', patient:'B', date:'2026-10-10', startTime:'10:00', durationMinutes:60 }] }
  const events = [{ linked:true, externalChange:true, recordType:'consultation', recordId:'c1', date:'2026-10-11', startTime:'11:30', durationMinutes:45 }]
  const result = applyExternalChanges(data, events)
  expect(result.changed).toBe(1)
  expect(result.data.consultations[0]).toMatchObject({ date:'2026-10-11', startTime:'11:30', durationMinutes:45 })
})

test('applyExternalChanges ignora eventos sem mudanca externa', () => {
  const data = { surgeries:[], consultations:[{ id:'c1', patient:'B', date:'2026-10-10', startTime:'10:00', durationMinutes:60 }] }
  const events = [{ linked:true, externalChange:false, recordType:'consultation', recordId:'c1', date:'2026-10-11', startTime:'11:30', durationMinutes:45 }]
  const result = applyExternalChanges(data, events)
  expect(result.changed).toBe(0)
  expect(result.data).toBe(data)
})
