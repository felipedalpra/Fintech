import { expect, test } from '@playwright/test'
import { shouldWriteIndicatorInputs } from '../../src/lib/financeSync.js'

const EMPTY = { indicatorInputs:{}, indicatorInputsByPeriod:{} }

test('perfil Equipe: nada de indicador mudou, então a tabela protegida NÃO é tocada', () => {
  // Era aqui que o save inteiro do Jonas morria: RLS exige papel financeiro e o autosave
  // pedia a escrita mesmo sem nenhuma alteração, derrubando junto o trabalho de CRM.
  expect(shouldWriteIndicatorInputs(EMPTY, EMPTY)).toBe(false)
})

test('sem baseline, só grava se houver algo de verdade para persistir', () => {
  expect(shouldWriteIndicatorInputs(EMPTY, null)).toBe(false)
  expect(shouldWriteIndicatorInputs({ indicatorInputs:{ estoque:1000 }, indicatorInputsByPeriod:{} }, null)).toBe(true)
  expect(shouldWriteIndicatorInputs({ indicatorInputs:{}, indicatorInputsByPeriod:{ '2026-11':{ estoque:5 } } }, null)).toBe(true)
})

test('mudança real continua sendo gravada', () => {
  const baseline = { indicatorInputs:{ estoque:1000 }, indicatorInputsByPeriod:{} }
  expect(shouldWriteIndicatorInputs({ indicatorInputs:{ estoque:1200 }, indicatorInputsByPeriod:{} }, baseline)).toBe(true)
  expect(shouldWriteIndicatorInputs({ indicatorInputs:{}, indicatorInputsByPeriod:{} }, baseline)).toBe(true)
  expect(shouldWriteIndicatorInputs({ indicatorInputs:{ estoque:1000, divida:50 }, indicatorInputsByPeriod:{} }, baseline)).toBe(true)
})

test('mudança só no recorte por período também é gravada', () => {
  const baseline = { indicatorInputs:{ estoque:1000 }, indicatorInputsByPeriod:{ '2026-10':{ estoque:900 } } }
  const next = { indicatorInputs:{ estoque:1000 }, indicatorInputsByPeriod:{ '2026-10':{ estoque:950 } } }
  expect(shouldWriteIndicatorInputs(next, baseline)).toBe(true)
})

test('ordem das chaves não conta como mudança — não pode gerar escrita fantasma', () => {
  const baseline = { indicatorInputs:{ estoque:1000, divida:50 }, indicatorInputsByPeriod:{ '2026-10':{ a:1, b:2 } } }
  const next = { indicatorInputs:{ divida:50, estoque:1000 }, indicatorInputsByPeriod:{ '2026-10':{ b:2, a:1 } } }
  expect(shouldWriteIndicatorInputs(next, baseline)).toBe(false)
})

test('valor aninhado idêntico não gera escrita, valor aninhado diferente gera', () => {
  const baseline = { indicatorInputs:{ metas:{ meses:[1, 2, 3] } }, indicatorInputsByPeriod:{} }
  expect(shouldWriteIndicatorInputs({ indicatorInputs:{ metas:{ meses:[1, 2, 3] } }, indicatorInputsByPeriod:{} }, baseline)).toBe(false)
  expect(shouldWriteIndicatorInputs({ indicatorInputs:{ metas:{ meses:[1, 2, 4] } }, indicatorInputsByPeriod:{} }, baseline)).toBe(true)
  // Ordem dentro de array É significativa: é dado, não chave de objeto.
  expect(shouldWriteIndicatorInputs({ indicatorInputs:{ metas:{ meses:[3, 2, 1] } }, indicatorInputsByPeriod:{} }, baseline)).toBe(true)
})

test('payload ou baseline incompletos não explodem nem geram escrita à toa', () => {
  expect(shouldWriteIndicatorInputs({}, {})).toBe(false)
  expect(shouldWriteIndicatorInputs({}, null)).toBe(false)
  expect(shouldWriteIndicatorInputs({ indicatorInputs:undefined, indicatorInputsByPeriod:undefined }, EMPTY)).toBe(false)
})
