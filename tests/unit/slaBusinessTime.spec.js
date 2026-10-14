import { expect, test } from '@playwright/test'
import { businessMinutesBetween, slaForLead, SLA_CONFIG } from '../../src/lib/slaBusinessTime.js'

// Datas locais. 2026-10-12 = segunda, 2026-10-13 = terça, 2026-10-11 = domingo.
const d = (day, h, m) => new Date(2026, 9, day, h, m, 0)

test('minutos no mesmo dia, dentro do horário', () => {
  expect(businessMinutesBetween(d(12, 10, 0), d(12, 10, 20))).toBe(20)
})

test('corta no fechamento (19h)', () => {
  expect(businessMinutesBetween(d(12, 18, 50), d(12, 19, 30))).toBe(10)
})

test('antes da abertura (8h) não conta', () => {
  expect(businessMinutesBetween(d(12, 7, 0), d(12, 8, 10))).toBe(10)
})

test('atravessa a noite: soma só o horário comercial de cada dia', () => {
  // seg 18:55→19:00 (5) + ter 08:00→08:05 (5) = 10
  expect(businessMinutesBetween(d(12, 18, 55), d(13, 8, 5))).toBe(10)
})

test('domingo não conta (fora dos dias úteis)', () => {
  expect(businessMinutesBetween(d(11, 10, 0), d(11, 11, 0))).toBe(0)
})

test('fim <= início → 0', () => {
  expect(businessMinutesBetween(d(12, 10, 0), d(12, 10, 0))).toBe(0)
  expect(businessMinutesBetween(d(12, 11, 0), d(12, 10, 0))).toBe(0)
})

// ---- slaForLead ----
test('respondido → estado respondido com minutos de resposta', () => {
  const r = slaForLead({ stage: 'primeiro_contato', status: 'aberto', created_at: d(12, 10, 0).toISOString(), first_response_at: d(12, 10, 6).toISOString() }, d(12, 11, 0))
  expect(r.state).toBe('respondido')
  expect(r.minutes).toBe(6)
})

test('aberto sem resposta, dentro do alvo → ok (minutos restantes)', () => {
  const r = slaForLead({ stage: 'primeiro_contato', status: 'aberto', created_at: d(12, 10, 0).toISOString(), first_response_at: null }, d(12, 10, 7))
  expect(r.state).toBe('ok')
  expect(r.minutes).toBe(SLA_CONFIG.targetMin - 7) // 8 restantes
})

test('aberto sem resposta, passou do alvo → late (minutos esperando)', () => {
  const r = slaForLead({ stage: 'primeiro_contato', status: 'aberto', created_at: d(12, 10, 0).toISOString(), first_response_at: null }, d(12, 10, 23))
  expect(r.state).toBe('late')
  expect(r.minutes).toBe(23)
})

test('fora de primeiro_contato e sem resposta → na (sem SLA)', () => {
  const r = slaForLead({ stage: 'consultado', status: 'aberto', created_at: d(12, 10, 0).toISOString(), first_response_at: null }, d(12, 12, 0))
  expect(r.state).toBe('na')
})

test('lead muito antigo (além de maxTrackHours) sem resposta → na (sem ruído)', () => {
  // criado seg 10h; "agora" = quinta 10h (bem > 48h) → não é mais alerta de "responder já"
  const r = slaForLead({ stage: 'primeiro_contato', status: 'aberto', created_at: d(12, 10, 0).toISOString(), first_response_at: null }, d(15, 10, 0))
  expect(r.state).toBe('na')
})

test('resposta anterior ao lead → respondido com 0 min (não vira negativo)', () => {
  const r = slaForLead({ stage: 'primeiro_contato', status: 'aberto', created_at: d(12, 10, 0).toISOString(), first_response_at: d(12, 9, 0).toISOString() }, d(12, 11, 0))
  expect(r.state).toBe('respondido')
  expect(r.minutes).toBe(0)
})

test('fim de semana → segunda: sábado conta, domingo não', () => {
  // sáb(10) 18:50→19:00 (10) + dom(11) 0 + seg(12) 08:00→08:05 (5) = 15
  expect(businessMinutesBetween(d(10, 18, 50), d(12, 8, 5))).toBe(15)
})
