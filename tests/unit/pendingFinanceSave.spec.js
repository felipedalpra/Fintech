import { expect, test } from '@playwright/test'
import { mergePendingFinanceSave } from '../../src/lib/pendingFinanceSave.js'

test('recupera um lancamento pendente sem remover linhas novas do servidor', () => {
  const serverData = {
    extraRevenues:[
      { id:'server-row', description:'Outro dispositivo' },
      { id:'edited-row', description:'Versao antiga' },
    ],
    expenses:[],
  }

  const recovered = mergePendingFinanceSave(serverData, {
    collection:'extraRevenues',
    record:{ id:'edited-row', description:'Versao editada' },
  })
  const withCreation = mergePendingFinanceSave(recovered, {
    collection:'expenses',
    record:{ id:'new-expense', description:'Despesa pendente' },
  })

  expect(withCreation.extraRevenues).toEqual([
    { id:'server-row', description:'Outro dispositivo' },
    { id:'edited-row', description:'Versao editada' },
  ])
  expect(withCreation.expenses).toEqual([{ id:'new-expense', description:'Despesa pendente' }])
})

test('ignora operacao invalida', () => {
  const data = { extraRevenues:[], expenses:[] }
  expect(mergePendingFinanceSave(data, { collection:'surgeries', record:{ id:'x' } })).toBe(data)
  expect(mergePendingFinanceSave(data, { collection:'expenses', record:{} })).toBe(data)
})
