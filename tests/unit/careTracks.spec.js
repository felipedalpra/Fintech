import { expect, test } from '@playwright/test'
import { describeOffset, sortTrackSteps } from '../../src/lib/careTracks.js'

test('o rótulo do passo é lido sem pensar', () => {
  expect(describeOffset(-7)).toBe('D-7')
  expect(describeOffset(1)).toBe('D+1')
  expect(describeOffset(30)).toBe('D+30')
  expect(describeOffset(0)).toBe('no dia')
})

test('valor ausente ou inválido não vira rótulo quebrado', () => {
  for (const value of [null, undefined, '', 'abc', NaN]) {
    expect(describeOffset(value)).toBe('no dia')
  }
})

test('a esteira é exibida na ordem em que o cuidado acontece, não na de cadastro', () => {
  // A clínica cadastra fora de ordem: D+30 primeiro, depois lembra do D-7.
  const steps = [
    { id:'d30', offset_days:30, sort_order:1 },
    { id:'dmenos7', offset_days:-7, sort_order:2 },
    { id:'d1', offset_days:1, sort_order:3 },
  ]
  expect(sortTrackSteps(steps).map(step => step.id)).toEqual(['dmenos7', 'd1', 'd30'])
})

test('passos no mesmo dia seguem a ordem que a clínica definiu', () => {
  const steps = [
    { id:'b', offset_days:1, sort_order:2 },
    { id:'a', offset_days:1, sort_order:1 },
  ]
  expect(sortTrackSteps(steps).map(step => step.id)).toEqual(['a', 'b'])
})

test('ordenar não altera a lista original', () => {
  const steps = [{ id:'b', offset_days:5 }, { id:'a', offset_days:1 }]
  sortTrackSteps(steps)
  expect(steps.map(step => step.id)).toEqual(['b', 'a'])
})

test('lista vazia ou ausente não quebra', () => {
  expect(sortTrackSteps([])).toEqual([])
  expect(sortTrackSteps(undefined)).toEqual([])
})
