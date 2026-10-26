// tests/unit/metaAnalysisPeriod.spec.js
import { expect, test } from '@playwright/test'
import { parseMetaAnalysisPeriod } from '../../api/financial-assistant.js'

const TODAY = '2026-10-26'

test('período fixo "month": resolve since/until/label', () => {
  const r = parseMetaAnalysisPeriod('month', TODAY)
  expect(r.key).toBe('month')
  expect(r.until).toBe(TODAY)
  expect(r.since).toBe('2026-10-01')
  expect(r.label).toBe('Este mês')
})

test('período fixo "30d": since é 29 dias antes de hoje', () => {
  const r = parseMetaAnalysisPeriod('30d', TODAY)
  expect(r.since).toBe('2026-09-27')
  expect(r.until).toBe(TODAY)
})

test('período fixo "quarter": since é 89 dias antes de hoje', () => {
  const r = parseMetaAnalysisPeriod('quarter', TODAY)
  expect(r.since).toBe('2026-07-29')
})

test('período personalizado válido: decodifica since/until e monta label', () => {
  const r = parseMetaAnalysisPeriod('custom:2026-01-01:2026-06-30', TODAY)
  expect(r.key).toBe('custom:2026-01-01:2026-06-30')
  expect(r.since).toBe('2026-01-01')
  expect(r.until).toBe('2026-06-30')
  expect(r.label).toContain('2026-01-01')
  expect(r.label).toContain('2026-06-30')
})

test('período personalizado com until no futuro: inválido (null)', () => {
  expect(parseMetaAnalysisPeriod('custom:2026-01-01:2027-01-01', TODAY)).toBeNull()
})

test('período personalizado com since depois de until: inválido (null)', () => {
  expect(parseMetaAnalysisPeriod('custom:2026-06-30:2026-01-01', TODAY)).toBeNull()
})

test('período personalizado maior que 400 dias: inválido (null)', () => {
  expect(parseMetaAnalysisPeriod('custom:2024-01-01:2026-10-26', TODAY)).toBeNull()
})

test('período personalizado malformado: inválido (null)', () => {
  expect(parseMetaAnalysisPeriod('custom:01/01/2026:2026-10-26', TODAY)).toBeNull()
  expect(parseMetaAnalysisPeriod('custom:2026-01-01', TODAY)).toBeNull()
})

test('período desconhecido (nem fixo, nem custom válido): inválido (null)', () => {
  expect(parseMetaAnalysisPeriod('ano-inteiro', TODAY)).toBeNull()
  expect(parseMetaAnalysisPeriod('', TODAY)).toBeNull()
  expect(parseMetaAnalysisPeriod(undefined, TODAY)).toBeNull()
})
