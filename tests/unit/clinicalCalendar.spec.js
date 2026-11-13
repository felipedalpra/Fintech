import { expect, test } from '@playwright/test'
import {
  buildClinicalCalendarEvents,
  calendarCityColor,
  calendarCityLabel,
  calendarEventConflicts,
  calendarMonthCells,
  calendarRange,
  filterClinicalCalendarEvents,
  moveCalendarFocus,
} from '../../src/lib/clinicalCalendar.js'

test('grade mensal sempre cobre seis semanas e inclui dias adjacentes', () => {
  const cells = calendarMonthCells('2026-05-15')
  expect(cells).toHaveLength(42)
  expect(cells[0]).toBe('2026-04-26')
  expect(cells.at(-1)).toBe('2026-06-06')
})

test('intervalos e navegação respeitam cada visualização', () => {
  expect(calendarRange('week', '2026-05-15')).toEqual({ start:'2026-05-10', end:'2026-05-17' })
  expect(calendarRange('day', '2026-05-15')).toEqual({ start:'2026-05-15', end:'2026-05-16' })
  expect(calendarRange('agenda', '2026-05-15')).toEqual({ start:'2026-05-15', end:'2026-07-14' })
  expect(moveCalendarFocus('2026-05-15', 'month', 1)).toBe('2026-06-15')
  expect(moveCalendarFocus('2026-05-15', 'week', -1)).toBe('2026-05-08')
})

test('eventos clínicos usam a fonte real e não duplicam o vínculo do Google', () => {
  const data = {
    procedures:[{ id:'p1', name:'Rinoplastia' }],
    surgeries:[{ id:'s1', date:'2026-05-15', startTime:'08:00', durationMinutes:180, patient:'Ana', procedureId:'p1' }],
    consultations:[{ id:'c1', date:'2026-05-15', startTime:'09:00', durationMinutes:60, patient:'Bia', consultationType:'retorno' }],
  }
  const events = buildClinicalCalendarEvents(data, [
    { googleId:'linked', recordId:'s1', date:'2026-05-15', title:'Ana — Rinoplastia' },
    { googleId:'external', date:'2026-05-16', startTime:'10:00', title:'Reunião' },
  ])

  expect(events).toHaveLength(3)
  expect(events.find(item => item.id === 'surgery:s1')).toMatchObject({ title:'Ana', subtitle:'Rinoplastia' })
  expect(events.find(item => item.id === 'consultation:c1')).toMatchObject({ title:'Bia', subtitle:'Retorno' })
  expect(events.find(item => item.id === 'google:external')).toBeTruthy()
})

test('busca e filtros combinam tipo, paciente e procedimento', () => {
  const events = [
    { type:'surgery', title:'Ana', subtitle:'Rinoplastia' },
    { type:'consultation', title:'Bruno', subtitle:'Avaliação' },
  ]
  expect(filterClinicalCalendarEvents(events, { query:'rino', visibleTypes:['surgery'] })).toHaveLength(1)
  expect(filterClinicalCalendarEvents(events, { query:'ana', visibleTypes:['consultation'] })).toHaveLength(0)
})

test('cidade propaga do registro pro evento e nunca classifica por default', () => {
  const data = {
    procedures:[],
    surgeries:[{ id:'s1', date:'2026-05-15', patient:'Ana', city:'goiania', locationDetail:'Hospital X' }],
    consultations:[{ id:'c1', date:'2026-05-15', patient:'Bia' }],
  }
  const events = buildClinicalCalendarEvents(data)
  expect(events.find(item => item.id === 'surgery:s1')).toMatchObject({ city:'goiania', locationDetail:'Hospital X' })
  expect(events.find(item => item.id === 'consultation:c1')).toMatchObject({ city:null, locationDetail:'' })
})

test('cor e rótulo de cidade cobrem goiania, brasilia e sem cidade', () => {
  expect(calendarCityColor('goiania')).toBeTruthy()
  expect(calendarCityColor('brasilia')).toBeTruthy()
  expect(calendarCityColor(null)).toBeNull()
  expect(calendarCityLabel('goiania')).toBe('Goiânia')
  expect(calendarCityLabel(null)).toBe('Cidade a definir')
})

test('filtro por cidade nunca esconde o Google (evento externo sem city próprio)', () => {
  const events = [
    { type:'surgery', title:'Ana', subtitle:'Rinoplastia', city:'goiania' },
    { type:'surgery', title:'Bia', subtitle:'Mamoplastia', city:'brasilia' },
    { type:'consultation', title:'Caio', subtitle:'Avaliação', city:null },
    { type:'google', title:'Evento externo', subtitle:'Google Agenda', city:null },
  ]
  const onlyGoiania = filterClinicalCalendarEvents(events, { visibleCities:['goiania'] })
  expect(onlyGoiania.map(item => item.title)).toEqual(['Ana', 'Evento externo'])

  const semCidade = filterClinicalCalendarEvents(events, { visibleCities:['sem_cidade'] })
  expect(semCidade.map(item => item.title)).toEqual(['Caio', 'Evento externo'])
})

test('conflitos consideram apenas sobreposição real no mesmo dia', () => {
  const conflicts = calendarEventConflicts([
    { id:'a', date:'2026-05-15', startTime:'09:00', durationMinutes:60 },
    { id:'b', date:'2026-05-15', startTime:'09:30', durationMinutes:30 },
    { id:'c', date:'2026-05-15', startTime:'10:00', durationMinutes:60 },
    { id:'d', date:'2026-05-16', startTime:'09:30', durationMinutes:30 },
  ])
  expect([...conflicts].sort()).toEqual(['a', 'b'])
})
