// tests/unit/metaInsightsExpiry.spec.js
import { expect, test } from '@playwright/test'
import { metaConnectionStatusAfterSync } from '../../api/_lib/metaInsights.js'

const DAY_MS = 24 * 60 * 60 * 1000

test('sem token_expires_at: sync bem-sucedido mantém "conectado"', () => {
  expect(metaConnectionStatusAfterSync(null, Date.now())).toBe('conectado')
})

test('vencimento a mais de 7 dias: continua "conectado"', () => {
  const now = Date.now()
  const expiresAt = new Date(now + 10 * DAY_MS).toISOString()
  expect(metaConnectionStatusAfterSync(expiresAt, now)).toBe('conectado')
})

test('vencimento em até 7 dias: vira "expirando"', () => {
  const now = Date.now()
  const expiresAt = new Date(now + 3 * DAY_MS).toISOString()
  expect(metaConnectionStatusAfterSync(expiresAt, now)).toBe('expirando')
})

test('já vencido: vira "erro" (nunca usa token morto)', () => {
  const now = Date.now()
  const expiresAt = new Date(now - DAY_MS).toISOString()
  expect(metaConnectionStatusAfterSync(expiresAt, now)).toBe('erro')
})
