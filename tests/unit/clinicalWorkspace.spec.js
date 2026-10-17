import { expect, test } from '@playwright/test'
import {
  buildClinicalDaySchedule,
  millisecondsUntilNextLocalDay,
  patientAge,
  patientInitials,
  resolveSchedulePatient,
} from '../../src/lib/clinicalWorkspace.js'

test('monta a agenda clínica do dia em ordem e ignora cancelamentos', () => {
  const schedule = buildClinicalDaySchedule({
    consultations:[
      { id:'c-late', patient:'Beatriz', patientId:'p2', date:'2026-10-17', startTime:'14:00', consultationType:'retorno' },
      { id:'c-cancelled', patient:'Cancelada', date:'2026-10-17', startTime:'08:00', paymentStatus:'cancelado' },
    ],
    surgeries:[
      { id:'s-early', patient:'Ana', patientId:'p1', date:'2026-10-17', startTime:'09:00', durationMinutes:120 },
      { id:'s-other-day', patient:'Outro dia', date:'2026-10-18', startTime:'07:00' },
    ],
  }, '2026-10-17')

  expect(schedule.map(item => item.id)).toEqual(['surgery:s-early', 'consultation:c-late'])
  expect(schedule[0]).toMatchObject({ patientName:'Ana', label:'Cirurgia', durationMinutes:120 })
  expect(schedule[1]).toMatchObject({ patientName:'Beatriz', label:'Retorno' })
})

test('resolve o paciente somente pelo vínculo explícito da agenda', () => {
  const patients = [
    { id:'p1', full_name:'Ana Vitória' },
    { id:'p2', full_name:'Maria Silva' },
    { id:'p3', full_name:'Maria Silva' },
  ]

  expect(resolveSchedulePatient({ patientId:'p1', patientName:'Nome antigo' }, patients)?.id).toBe('p1')
  expect(resolveSchedulePatient({ patientId:'inativo', patientName:'Ana Vitória' }, patients)).toBeNull()
  expect(resolveSchedulePatient({ patientName:'ana vitoria' }, patients)).toBeNull()
  expect(resolveSchedulePatient({ patientName:'Maria Silva' }, patients)).toBeNull()
})

test('calcula a atualização da agenda na próxima virada do dia local', () => {
  expect(millisecondsUntilNextLocalDay(new Date(2026, 9, 17, 23, 59, 59, 500))).toBe(550)
  expect(millisecondsUntilNextLocalDay(new Date(2026, 9, 17, 12, 0, 0, 0))).toBe(43_200_050)
})

test('calcula identificação compacta do paciente', () => {
  expect(patientInitials('Ana Maria Souza')).toBe('AS')
  expect(patientAge('1990-10-18', new Date(2026, 9, 17))).toBe(35)
  expect(patientAge('1990-10-17', new Date(2026, 9, 17))).toBe(36)
})
