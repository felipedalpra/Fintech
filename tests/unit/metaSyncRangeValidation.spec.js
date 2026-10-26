// tests/unit/metaSyncRangeValidation.spec.js
import { expect, test } from '@playwright/test'
import { validateMetaSyncRange } from '../../api/_lib/metaInsights.js'

const TODAY = '2026-10-26'

test('intervalo válido dentro do limite: aceita', () => {
  expect(validateMetaSyncRange('2026-01-01', '2026-10-26', TODAY)).toEqual({ ok: true })
})

test('since/until fora do formato YYYY-MM-DD: rejeita', () => {
  expect(validateMetaSyncRange('01/01/2026', '2026-10-26', TODAY).ok).toBe(false)
  expect(validateMetaSyncRange('2026-01-01', '26-10-2026', TODAY).ok).toBe(false)
  expect(validateMetaSyncRange('', '2026-10-26', TODAY).ok).toBe(false)
})

test('since depois de until: rejeita', () => {
  const r = validateMetaSyncRange('2026-10-26', '2026-01-01', TODAY)
  expect(r.ok).toBe(false)
  expect(r.error).toMatch(/depois de until/)
})

test('until no futuro: rejeita (nunca pede dado que o Meta ainda não tem)', () => {
  const r = validateMetaSyncRange('2026-01-01', '2027-01-01', TODAY)
  expect(r.ok).toBe(false)
  expect(r.error).toMatch(/futuro/)
})

test('intervalo maior que 400 dias: rejeita', () => {
  const r = validateMetaSyncRange('2024-01-01', '2026-10-26', TODAY)
  expect(r.ok).toBe(false)
  expect(r.error).toMatch(/400 dias/)
})

test('exatamente 400 dias: aceita (limite inclusivo)', () => {
  // 2025-09-21 até 2026-10-26 = 400 dias
  expect(validateMetaSyncRange('2025-09-21', TODAY, TODAY)).toEqual({ ok: true })
})

test('401 dias: rejeita (um a mais que o limite)', () => {
  // 2025-09-20 até 2026-10-26 = 401 dias
  const r = validateMetaSyncRange('2025-09-20', TODAY, TODAY)
  expect(r.ok).toBe(false)
  expect(r.error).toMatch(/400 dias/)
})

test('since igual a until (um único dia): aceita', () => {
  expect(validateMetaSyncRange(TODAY, TODAY, TODAY)).toEqual({ ok: true })
})
