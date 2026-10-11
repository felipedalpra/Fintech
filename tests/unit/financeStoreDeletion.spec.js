import { expect, test } from '@playwright/test'
import { computeIdsToDelete } from '../../src/lib/financeSync.js'

// A deleção é calculada contra o BASELINE do cliente (o que ele carregou), nunca contra o banco.
// Isso impede a perda de dados por concorrência e por estado defasado.

test('sem baseline → nunca apaga (só upsert)', () => {
  expect(computeIdsToDelete(null, [{ id: 'a' }])).toEqual([])
  expect(computeIdsToDelete(undefined, [])).toEqual([])
})

test('apaga só o que estava no baseline e foi removido', () => {
  const baseline = new Set(['a', 'b', 'c'])
  // cliente removeu 'b' (ficou com a, c)
  expect(computeIdsToDelete(baseline, [{ id: 'a' }, { id: 'c' }])).toEqual(['b'])
})

test('concorrência: NÃO apaga linha que o cliente nunca conheceu (de outro usuário)', () => {
  // Baseline do cliente B não inclui 'x' (que o cliente A acabou de criar).
  const baselineB = new Set(['a', 'b'])
  // B salva seu dataset (a, b) + um novo 'y'. 'x' não está nem no baseline nem no current → preservado.
  const currentB = [{ id: 'a' }, { id: 'b' }, { id: 'y' }]
  expect(computeIdsToDelete(baselineB, currentB)).toEqual([]) // nada apagado; 'x' sobrevive
})

test('nada a apagar quando current contém todo o baseline', () => {
  const baseline = new Set(['a', 'b'])
  expect(computeIdsToDelete(baseline, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toEqual([])
})

test('baseline vazio → nunca apaga', () => {
  expect(computeIdsToDelete(new Set(), [{ id: 'a' }])).toEqual([])
})
