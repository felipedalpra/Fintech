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
  expect(mergePendingFinanceSave(data, { collection:'unknown', record:{ id:'x' } })).toBe(data)
  expect(mergePendingFinanceSave(data, { collection:'expenses', record:{} })).toBe(data)
})

test('recupera um lote de importacao financeira sem apagar dados existentes', () => {
  const data = { extraRevenues:[{ id:'existing', description:'Mantida' }], expenses:[] }
  const recovered = mergePendingFinanceSave(data, {
    operations:[
      { collection:'extraRevenues', record:{ id:'new-revenue', description:'Receita importada' } },
      { collection:'expenses', record:{ id:'new-expense', description:'Despesa importada' } },
    ],
  })
  expect(recovered.extraRevenues.map(item => item.id)).toEqual(['existing', 'new-revenue'])
  expect(recovered.expenses.map(item => item.id)).toEqual(['new-expense'])
})

test('retoma baixa conciliada em qualquer origem operacional', () => {
  const data = { surgeries:[], consultations:[], productSales:[], productPurchases:[], extraRevenues:[], expenses:[] }
  const recovered = mergePendingFinanceSave(data, {
    operations:[
      { collection:'surgeries', record:{ id:'s1', paymentStatus:'pago' } },
      { collection:'consultations', record:{ id:'c1', paymentStatus:'pago' } },
      { collection:'productSales', record:{ id:'v1', paymentStatus:'recebido' } },
      { collection:'productPurchases', record:{ id:'p1', status:'pago' } },
    ],
  })
  expect(recovered.surgeries[0].paymentStatus).toBe('pago')
  expect(recovered.consultations[0].paymentStatus).toBe('pago')
  expect(recovered.productSales[0].paymentStatus).toBe('recebido')
  expect(recovered.productPurchases[0].status).toBe('pago')
})
