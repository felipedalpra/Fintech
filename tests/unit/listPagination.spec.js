import { expect, test } from '@playwright/test'
import { DEFAULT_PAGE_SIZE, paginate, paginationSummary } from '../../src/lib/listPagination.js'

const lista = n => Array.from({ length:n }, (_, index) => ({ id:index + 1 }))

test('a página padrão tem 25 lançamentos', () => {
  expect(DEFAULT_PAGE_SIZE).toBe(25)
  const view = paginate(lista(60))
  expect(view.rows).toHaveLength(25)
  expect(view.rows[0].id).toBe(1)
  expect(view.totalPages).toBe(3)
  expect(view.from).toBe(1)
  expect(view.to).toBe(25)
})

test('a última página traz só o resto', () => {
  const view = paginate(lista(60), 3)
  expect(view.rows).toHaveLength(10)
  expect(view.rows[0].id).toBe(51)
  expect(view.from).toBe(51)
  expect(view.to).toBe(60)
  expect(view.hasNext).toBe(false)
  expect(view.hasPrevious).toBe(true)
})

test('filtrar não pode deixar a pessoa numa página vazia', () => {
  // Estava na página 5 e um filtro reduziu a lista a 10 itens: cai na última página,
  // não numa tela em branco que parece "os dados sumiram".
  const view = paginate(lista(10), 5)
  expect(view.page).toBe(1)
  expect(view.rows).toHaveLength(10)
  expect(view.total).toBe(10)
})

test('página inválida nunca quebra a lista', () => {
  for (const page of [0, -3, NaN, undefined, null, 1.7]) {
    const view = paginate(lista(60), page)
    expect(view.page).toBeGreaterThanOrEqual(1)
    expect(view.page).toBeLessThanOrEqual(view.totalPages)
    expect(view.rows.length).toBeGreaterThan(0)
  }
})

test('lista vazia não vira página fantasma', () => {
  const view = paginate([], 3)
  expect(view.rows).toEqual([])
  expect(view.page).toBe(1)
  expect(view.totalPages).toBe(1)
  expect(view.from).toBe(0)
  expect(view.to).toBe(0)
  expect(view.needed).toBe(false)
  expect(view.hasNext).toBe(false)
})

test('nenhum item é perdido nem repetido ao percorrer todas as páginas', () => {
  // A invariante que importa: paginar não pode esconder lançamento nenhum.
  const total = 137
  const vistos = []
  const totalPages = paginate(lista(total)).totalPages
  for (let page = 1; page <= totalPages; page += 1) vistos.push(...paginate(lista(total), page).rows.map(row => row.id))
  expect(vistos).toHaveLength(total)
  expect(new Set(vistos).size).toBe(total)
  expect(vistos[0]).toBe(1)
  expect(vistos.at(-1)).toBe(total)
})

test('até 25 itens a paginação não aparece', () => {
  expect(paginate(lista(25)).needed).toBe(false)
  expect(paginate(lista(26)).needed).toBe(true)
})

test('tamanho de página customizado é respeitado, e lixo cai no padrão', () => {
  expect(paginate(lista(30), 1, 10).rows).toHaveLength(10)
  for (const size of [0, -5, NaN, null]) expect(paginate(lista(30), 1, size).pageSize).toBe(25)
})

test('o resumo do rodapé fala português correto, inclusive no zero e no singular', () => {
  expect(paginationSummary(paginate([]))).toBe('Nenhum lançamento')
  expect(paginationSummary(paginate(lista(1)))).toBe('1 lançamento')
  expect(paginationSummary(paginate(lista(7)))).toBe('7 lançamentos')
  expect(paginationSummary(paginate(lista(60), 2))).toBe('26–50 de 60 lançamentos')
  expect(paginationSummary(null)).toBe('Nenhum lançamento')
})

test('entrada que não é lista não derruba a tela', () => {
  expect(paginate(null).rows).toEqual([])
  expect(paginate(undefined).total).toBe(0)
})
