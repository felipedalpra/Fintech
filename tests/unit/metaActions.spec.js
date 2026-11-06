import { expect, test } from '@playwright/test'
import {
  actionLabel, conversionBreakdown, costPerResult, engagementFromActions,
  leadsFromActions, sumActions,
} from '../../src/lib/metaActions.js'

const acoes = pares => pares.map(([action_type, value]) => ({ action_type, value }))

test('o lead não é somado duas vezes quando a Meta devolve o mesmo sob nomes diferentes', () => {
  // A Meta repete o mesmo lead como `lead` e `onsite_conversion.lead_grouped`. Somar os dois
  // dobraria o resultado e faria o CPL parecer metade do real.
  expect(leadsFromActions(acoes([['lead', '7'], ['onsite_conversion.lead_grouped', '7']]))).toBe(7)
  expect(leadsFromActions(acoes([['onsite_conversion.lead_grouped', '3']]))).toBe(3)
  expect(leadsFromActions(acoes([['link_click', '50']]))).toBe(0)
  expect(leadsFromActions(null)).toBe(0)
})

test('soma os actions de vários dias num mapa só', () => {
  const total = sumActions([
    { actions: acoes([['lead', '2'], ['link_click', '10']]) },
    { actions: acoes([['lead', '3'], ['post_engagement', '8']]) },
  ])
  expect(total.get('lead')).toBe(5)
  expect(total.get('link_click')).toBe(10)
  expect(total.get('post_engagement')).toBe(8)
})

test('valor não numérico da API é ignorado em vez de virar NaN na tela', () => {
  const total = sumActions([{ actions: acoes([['lead', 'abc'], ['link_click', '4']]) }])
  expect(total.has('lead')).toBe(false)
  expect(total.get('link_click')).toBe(4)
})

test('engajamento ausente é null, não zero', () => {
  // "Zero engajamento" e "a Meta não informou" são coisas diferentes.
  expect(engagementFromActions(sumActions([{ actions: acoes([['lead', '2']]) }]))).toBeNull()
  expect(engagementFromActions(sumActions([{ actions: acoes([['post_engagement', '9'], ['comment', '3']]) }]))).toBe(12)
})

test('conversões por tipo não incluem engajamento', () => {
  const mapa = sumActions([{ actions: acoes([['lead', '5'], ['link_click', '40'], ['post_engagement', '90']]) }])
  const lista = conversionBreakdown(mapa)
  expect(lista.map(item => item.type)).toEqual(['link_click', 'lead'])
  expect(lista.find(item => item.type === 'post_engagement')).toBeUndefined()
  // Maior primeiro.
  expect(lista[0].value).toBe(40)
})

test('tipo sem valor não vira linha fantasma', () => {
  const mapa = sumActions([{ actions: acoes([['lead', '0'], ['link_click', '4']]) }])
  expect(conversionBreakdown(mapa).map(item => item.type)).toEqual(['link_click'])
})

test('tipo desconhecido aparece com nome cru em vez de sumir', () => {
  expect(actionLabel('lead')).toBe('Leads')
  expect(actionLabel('algum_tipo_novo')).toBe('algum tipo novo')
  expect(actionLabel(undefined)).toBe('')
})

test('custo por resultado sem resultado é indefinido, nunca R$ 0,00', () => {
  // Gastar R$ 500 e não gerar lead NÃO é custo zero — é custo indefinido, e tratar como zero
  // faria essa campanha parecer a melhor do painel.
  expect(costPerResult(500, 0)).toBeNull()
  expect(costPerResult(500, null)).toBeNull()
  expect(costPerResult(500, 'abc')).toBeNull()
  expect(costPerResult(500, 10)).toBe(50)
  expect(costPerResult(0, 10)).toBe(0)
})

test('entrada vazia não quebra nenhuma função', () => {
  expect(sumActions().size).toBe(0)
  expect(sumActions([null, {}]).size).toBe(0)
  expect(conversionBreakdown(null)).toEqual([])
  expect(engagementFromActions(null)).toBeNull()
})
