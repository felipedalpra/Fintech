import { expect, test } from '@playwright/test'
import { computeIdsToDelete, computeRowsToUpsert, missingRowIds, mergeById } from '../../src/lib/financeSync.js'

// MERGE por id (importar do navegador): nunca remove/sobrescreve o do servidor.
test('mergeById: adiciona só o que o servidor não tem', () => {
  const { merged, added } = mergeById([{ id: 'a', v: 1 }], [{ id: 'a', v: 9 }, { id: 'b', v: 2 }])
  expect(added).toBe(1)
  expect(merged.map(r => r.id)).toEqual(['a', 'b'])
  expect(merged.find(r => r.id === 'a').v).toBe(1) // servidor preservado (não sobrescreve)
})
test('mergeById: nada novo → added 0', () => {
  expect(mergeById([{ id: 'a' }], [{ id: 'a' }]).added).toBe(0)
})

// READ-BACK (Fase 2): confirma que cada linha enviada voltou do servidor.
test('missingRowIds: tudo confirmado → nada faltando', () => {
  expect(missingRowIds([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }])).toEqual([])
})
test('missingRowIds: linha enviada que não voltou = perda a sinalizar', () => {
  expect(missingRowIds([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }])).toEqual(['b'])
})
test('missingRowIds: entradas vazias/sem id são toleradas', () => {
  expect(missingRowIds([], [])).toEqual([])
  expect(missingRowIds([{ id: null }], [])).toEqual([])
})
test('missingRowIds: UUID em caixa diferente NÃO conta como faltando', () => {
  expect(missingRowIds([{ id: 'ABC-123' }], [{ id: 'abc-123' }])).toEqual([])
})

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

test('salvamento incremental envia somente linhas novas ou alteradas', () => {
  const baseline = [
    { id:'a', name:'Sem mudança', details:{ b:2, a:1 } },
    { id:'b', name:'Antes' },
  ]
  const current = [
    { id:'a', name:'Sem mudança', details:{ a:1, b:2 } },
    { id:'b', name:'Depois' },
    { id:'c', name:'Novo' },
  ]
  expect(computeRowsToUpsert(baseline, current).map(row => row.id)).toEqual(['b', 'c'])
})

test('sem baseline, salvamento incremental mantém carga completa segura', () => {
  const rows = [{ id:'a' }, { id:'b' }]
  expect(computeRowsToUpsert(null, rows)).toEqual(rows)
})
