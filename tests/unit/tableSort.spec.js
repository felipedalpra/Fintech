import { expect, test } from '@playwright/test'
import { compareRows, sortRows, sortValue } from '../../src/lib/tableSort.js'

const linha = (key, cells, rawCells) => ({ key, cells, rawCells })

test('ordena pela data REAL, não pelo texto dd/mm/aaaa', () => {
  // Bug real: como texto, "01/12/2026" vem antes de "02/09/2026" — dezembro antes de setembro.
  const rows = [
    linha('dez', ['01/12/2026'], ['2026-12-01']),
    linha('set', ['02/09/2026'], ['2026-09-02']),
    linha('jan', ['15/01/2026'], ['2026-01-15']),
  ]
  expect(sortRows(rows, 0, 'asc').map(row => row.key)).toEqual(['jan', 'set', 'dez'])
  expect(sortRows(rows, 0, 'desc').map(row => row.key)).toEqual(['dez', 'set', 'jan'])
})

test('ordena por valor como número, não como "R$"', () => {
  const rows = [
    linha('mil', ['R$ 1.000,00'], [1000]),
    linha('novecentos', ['R$ 900,00'], [900]),
    linha('dez-mil', ['R$ 10.000,00'], [10000]),
  ]
  expect(sortRows(rows, 0, 'asc').map(row => row.key)).toEqual(['novecentos', 'mil', 'dez-mil'])
})

test('célula que não é texto sem rawCells não quebra a ordenação', () => {
  // Um <Badge> ou <span> vira string vazia em vez de "[object Object]".
  const rows = [linha('a', [{ tipo:'componente' }], undefined), linha('b', ['texto'], undefined)]
  expect(() => sortRows(rows, 0, 'asc')).not.toThrow()
  expect(sortValue(rows[0], 0)).toBe('')
  expect(sortValue(rows[1], 0)).toBe('texto')
})

test('rawCells tem prioridade sobre o texto exibido', () => {
  const row = linha('x', ['01/12/2026'], ['2026-12-01'])
  expect(sortValue(row, 0)).toBe('2026-12-01')
})

test('sem rawCells cai no texto, que ainda ordena acentos em português', () => {
  const rows = [linha('o', ['Órtese']), linha('a', ['Anestesia']), linha('z', ['Zero'])]
  expect(sortRows(rows, 0, 'asc').map(row => row.key)).toEqual(['a', 'o', 'z'])
})

test('rawCell zero e string vazia não são tratados como ausentes', () => {
  const zero = linha('zero', ['R$ 0,00'], [0])
  const cem = linha('cem', ['R$ 100,00'], [100])
  expect(sortValue(zero, 0)).toBe(0)
  expect(sortRows([cem, zero], 0, 'asc').map(row => row.key)).toEqual(['zero', 'cem'])
})

test('sem coluna escolhida a lista passa intacta, sem cópia desnecessária', () => {
  const rows = [linha('a', ['a']), linha('b', ['b'])]
  expect(sortRows(rows, null)).toBe(rows)
  expect(sortRows(rows, undefined)).toBe(rows)
})

test('comparar direto respeita a direção', () => {
  const a = linha('a', ['a'], [1])
  const b = linha('b', ['b'], [2])
  expect(compareRows(a, b, 0, 'asc')).toBeLessThan(0)
  expect(compareRows(a, b, 0, 'desc')).toBeGreaterThan(0)
})
