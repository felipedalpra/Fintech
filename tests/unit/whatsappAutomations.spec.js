import { expect, test } from '@playwright/test'
import {
  addDays, formatBR, renderTemplate, planReminders, planFollowups,
  formatBRL, receivableDueDate, planPayments,
} from '../../api/_lib/whatsappAutomations.js'

test('addDays: soma/subtrai sem drift de fuso, cruza mês e ano', () => {
  expect(addDays('2026-10-11', 1)).toBe('2026-10-12')
  expect(addDays('2026-10-11', 2)).toBe('2026-10-13')
  expect(addDays('2026-10-11', -2)).toBe('2026-10-09')
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01')   // vira o mês
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')   // vira o ano
  expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')  // fev não-bissexto
})

test('formatBR: ISO -> DD/MM/YYYY', () => {
  expect(formatBR('2026-10-12')).toBe('12/10/2026')
})

test('renderTemplate: substitui variáveis; faltantes/desconhecidas viram vazio', () => {
  expect(renderTemplate('Olá {patient_name}, dia {date}', { patient_name: 'Ana', date: '12/10/2026' }))
    .toBe('Olá Ana, dia 12/10/2026')
  // {time} ausente não deixa literal nem "undefined"
  expect(renderTemplate('às {time}h', {})).toBe('às h')
  expect(renderTemplate('{foo}', {})).toBe('')
})

test('planReminders: pula quem não tem telefone; usa primeiro nome e hora HH:MM', () => {
  const events = [
    { id: 'c1', ref_type: 'consultation', patient_id: 'p1', start_time: '14:30:00', patients: { full_name: 'Ana Maria Souza', phone: '5511999999999' } },
    { id: 's1', ref_type: 'surgery', patient_id: 'p2', start_time: null, patients: { full_name: 'João', phone: null } }, // sem telefone -> pula
    { id: 'c2', ref_type: 'consultation', patient_id: null, start_time: null, patients: { full_name: 'Bia', phone: '5511888888888' } },
  ]
  const plan = planReminders({
    events,
    template: 'Oi {patient_name}, dia {date} {time}',
    targetDate: '2026-10-12',
  })
  expect(plan).toHaveLength(2) // João foi pulado (sem telefone)
  expect(plan[0]).toMatchObject({ ref_type: 'consultation', ref_id: 'c1', patient_id: 'p1', phone: '5511999999999' })
  expect(plan[0].message).toBe('Oi Ana, dia 12/10/2026 14:30')
  // sem start_time, {time} fica vazio (sem "undefined" nem trailing estranho além do espaço do template)
  expect(plan[1].message).toBe('Oi Bia, dia 12/10/2026 ')
})

test('planFollowups: sem eventos -> lista vazia; evento sem nome usa fallback', () => {
  expect(planFollowups({ events: [], template: 'x', targetDate: '2026-10-09' })).toEqual([])
  const plan = planFollowups({
    events: [{ id: 'c9', ref_type: 'consultation', patient_id: 'p9', start_time: null, patients: { full_name: '', phone: '551130000000' } }],
    template: 'Olá {patient_name}!',
    targetDate: '2026-10-09',
  })
  expect(plan[0].message).toBe('Olá tudo bem!')
})

test('formatBRL: moeda determinística pt-BR', () => {
  expect(formatBRL(1234.5)).toBe('R$ 1.234,50')
  expect(formatBRL(0)).toBe('R$ 0,00')
  expect(formatBRL(999)).toBe('R$ 999,00')
  expect(formatBRL('2500')).toBe('R$ 2.500,00')
})

test('receivableDueDate: usa due_date (vencimento) com fallback igual à migração', () => {
  // cirurgia: due_date || date
  expect(receivableDueDate({ due_date: '2026-10-20', date: '2026-10-01' }, 'surgery')).toBe('2026-10-20')
  expect(receivableDueDate({ due_date: null, date: '2026-10-01' }, 'surgery')).toBe('2026-10-01')
  // consulta: due_date || forecast_payment_date || date
  expect(receivableDueDate({ due_date: null, forecast_payment_date: '2026-10-15', date: '2026-10-02' }, 'consultation')).toBe('2026-10-15')
  expect(receivableDueDate({ due_date: null, forecast_payment_date: null, date: '2026-10-02' }, 'consultation')).toBe('2026-10-02')
})

test('planPayments: só vencimento = alvo, com telefone; usa valor e data do vencimento', () => {
  const items = [
    // vence no alvo (consulta, por forecast) -> entra
    { id: 'c1', source: 'consultation', patient_id: 'p1', due_date: null, forecast_payment_date: '2026-10-20', date: '2026-10-01', value: 300, patients: { full_name: 'Ana Souza', phone: '5511999' } },
    // vence no alvo (cirurgia por due_date) mas sem telefone -> pula
    { id: 's1', source: 'surgery', patient_id: 'p2', due_date: '2026-10-20', date: '2026-10-05', value: 5000, patients: { full_name: 'João', phone: null } },
    // vence em outro dia -> fora
    { id: 'c2', source: 'consultation', patient_id: 'p3', due_date: '2026-10-25', date: '2026-10-03', value: 400, patients: { full_name: 'Bia', phone: '5511888' } },
  ]
  const plan = planPayments({ items, template: '{patient_name}: {value} vence {date}', targetDueDate: '2026-10-20' })
  expect(plan).toHaveLength(1)
  expect(plan[0]).toMatchObject({ ref_type: 'consultation', ref_id: 'c1', patient_id: 'p1', phone: '5511999' })
  expect(plan[0].message).toBe('Ana: R$ 300,00 vence 20/10/2026')
})
