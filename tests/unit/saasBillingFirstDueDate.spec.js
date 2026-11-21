import { expect, test } from '@playwright/test'
import { resolveFirstDueDate } from '../../api/_lib/saasBilling.js'

test('sem data informada, usa amanhã por padrão', () => {
  const expected = new Date()
  expected.setUTCDate(expected.getUTCDate() + 1)
  expect(resolveFirstDueDate('')).toBe(expected.toISOString().slice(0, 10))
})

test('aceita uma data futura escolhida pela clínica (ex.: já pagou o mês atual por Pix)', () => {
  const future = new Date()
  future.setUTCFullYear(future.getUTCFullYear() + 1)
  const key = future.toISOString().slice(0, 10)
  expect(resolveFirstDueDate(key)).toBe(key)
})

test('rejeita data no passado', () => {
  expect(() => resolveFirstDueDate('2000-01-01')).toThrow('passado')
})

test('rejeita formato inválido', () => {
  expect(() => resolveFirstDueDate('02/12/2026')).toThrow('inválida')
})
