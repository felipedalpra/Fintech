import { expect, test } from '@playwright/test'
import { groupTasksByDue } from '../../src/lib/taskGroups.js'

const TODAY = new Date('2026-10-11T09:00:00')

test('classifica por vencimento: atrasada / hoje / semana / futura', () => {
  const g = groupTasksByDue([
    { id: 'a', status: 'pendente', due_date: '2026-10-09' },  // atrasada
    { id: 'b', status: 'pendente', due_date: '2026-10-11' },  // hoje
    { id: 'c', status: 'pendente', due_date: '2026-10-15' },  // esta semana
    { id: 'd', status: 'pendente', due_date: '2026-11-30' },  // futura
    { id: 'e', status: 'pendente', due_date: null },          // sem data → futura
  ], TODAY)
  expect(g.atrasadas.map(t => t.id)).toEqual(['a'])
  expect(g.hoje.map(t => t.id)).toEqual(['b'])
  expect(g.semana.map(t => t.id)).toEqual(['c'])
  expect(g.futuras.map(t => t.id).sort()).toEqual(['d', 'e'])
})

test('concluídas saem dos grupos de pendentes', () => {
  const g = groupTasksByDue([
    { id: 'x', status: 'feita', due_date: '2026-10-09' },     // atrasada no due, mas feita
    { id: 'y', status: 'pendente', due_date: '2026-10-11' },
  ], TODAY)
  expect(g.concluidas.map(t => t.id)).toEqual(['x'])
  expect(g.atrasadas).toHaveLength(0)
  expect(g.hoje.map(t => t.id)).toEqual(['y'])
})

test('limite da semana é inclusivo (+7 dias)', () => {
  const g = groupTasksByDue([{ id: 'w', status: 'pendente', due_date: '2026-10-18' }], TODAY) // +7
  expect(g.semana.map(t => t.id)).toEqual(['w'])
})

test('lista vazia → todos os grupos vazios', () => {
  const g = groupTasksByDue([], TODAY)
  expect([g.atrasadas, g.hoje, g.semana, g.futuras, g.concluidas].every(a => a.length === 0)).toBe(true)
})
