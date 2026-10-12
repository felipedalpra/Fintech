import { expect, test } from '@playwright/test'
import { buildMetrics } from '../../src/financialMetrics.js'
import { encodePaymentMethod } from '../../src/lib/paymentMethodCodec.js'

const data = {
  surgeries:[{
    id:'s1', patient:'Ana', patientId:'p1', totalValue:1000,
    date:'2026-01-10', competenceDate:'2026-01-10', dueDate:'2026-02-10',
    paymentStatus:'pago', paymentDate:'2026-02-10', hospitalCost:100,
  }],
  consultations:[{
    id:'c1', patient:'Bia', patientId:'p2', value:300,
    date:'2026-01-12', competenceDate:'2026-01-12', dueDate:'2026-01-20', paymentStatus:'pendente',
  }],
  productSales:[
    { id:'v1', productId:'pdt', totalValue:200, saleDate:'2026-01-05', competenceDate:'2026-01-05', paymentStatus:'recebido' },
    { id:'v-cancelada', productId:'pdt', totalValue:500, saleDate:'2026-01-05', competenceDate:'2026-01-05', paymentStatus:'cancelado' },
  ],
  productPurchases:[
    { id:'cp1', productId:'pdt', totalValue:80, purchaseDate:'2026-01-03', competenceDate:'2026-01-03', dueDate:'2026-01-25', status:'pendente' },
    { id:'cp-cancelada', productId:'pdt', totalValue:70, purchaseDate:'2026-01-03', competenceDate:'2026-01-03', status:'cancelado' },
  ],
  extraRevenues:[
    { id:'r1', description:'Receita', value:50, date:'2026-01-06', receivedDate:'2026-01-06', competenceDate:'2026-01-06', status:'recebido' },
    { id:'r-cancelada', description:'Cancelada', value:90, date:'2026-01-06', competenceDate:'2026-01-06', status:'cancelado' },
  ],
  expenses:[
    { id:'e1', description:'Paga', category:'outros', value:40, dueDate:'2026-01-08', competenceDate:'2026-01-08', paymentDate:'2026-01-09', status:'pago' },
    { id:'e2', description:'Aberta', category:'outros', value:20, dueDate:'2026-01-22', competenceDate:'2026-01-08', status:'aberto' },
    { id:'e-cancelada', description:'Cancelada', category:'outros', value:60, dueDate:'2026-01-08', competenceDate:'2026-01-08', status:'cancelado' },
  ],
  products:[{ id:'pdt', name:'Produto', stock:0 }],
  procedures:[], assets:[], liabilities:[], goals:[], recurrences:[],
}

test('Fase 10: DRE lê competência do razão e caixa lê liquidação', () => {
  const metrics = buildMetrics(data, {
    startDate:'2026-01-01', endDate:'2026-01-31', balanceDate:'2026-01-31',
  })

  expect(metrics.grossRevenue).toBe(1550)
  expect(metrics.surgeryCostTotal).toBe(100)
  expect(metrics.productPurchaseTotal).toBe(80)
  expect(metrics.operationalExpenses).toBe(60)
  expect(metrics.netProfit).toBe(1310)

  // A cirurgia pertence à DRE de janeiro, mas só entra no caixa em fevereiro.
  expect(metrics.cashIn).toBe(250)
  expect(metrics.cashOut).toBe(140)
  expect(metrics.cashBalance).toBe(110)
})

test('Fase 10: posição histórica mantém título aberto até a data da liquidação', () => {
  const january = buildMetrics(data, {
    startDate:'2026-01-01', endDate:'2026-01-31', balanceDate:'2026-01-31',
  })
  const february = buildMetrics(data, {
    startDate:'2026-02-01', endDate:'2026-02-28', balanceDate:'2026-02-28',
  })

  expect(january.receivablesOpenTotal).toBe(1300)
  expect(january.payablesOpenTotal).toBe(100)
  expect(february.cashIn).toBe(1000)
  expect(february.receivablesOpenTotal).toBe(300)
})

test('Fase 10: cancelados não entram em DRE, caixa nem obrigações', () => {
  const metrics = buildMetrics(data, { balanceDate:'2026-12-31' })

  expect(metrics.entriesFinancial.some(item => item.referenceId === 'v-cancelada')).toBe(false)
  expect(metrics.entriesFinancial.some(item => item.referenceId === 'r-cancelada')).toBe(false)
  expect(metrics.exitsFinancial.some(item => item.referenceId === 'cp-cancelada')).toBe(false)
  expect(metrics.exitsFinancial.some(item => item.referenceId === 'e-cancelada')).toBe(false)
  expect(metrics.accountsReceivable.some(item => item.sourceId === 'v-cancelada')).toBe(false)
  expect(metrics.accountsPayable.some(item => item.sourceId === 'cp-cancelada')).toBe(false)
})

test('Fase 10: cronograma de venda de produto gera caixa e saldo aberto por parcela', () => {
  const scheduled = structuredClone(data)
  scheduled.productSales = [{
    id:'v-parcelada', productId:'pdt', patientName:'Ana', totalValue:300,
    saleDate:'2026-01-05', competenceDate:'2026-01-05', paymentStatus:'recebido',
    paymentMethod:encodePaymentMethod({ payments:[
      { date:'2026-01-10', amount:100, method:'pix' },
      { date:'2026-02-10', amount:200, method:'cartao' },
    ] }),
  }]

  const january = buildMetrics(scheduled, {
    startDate:'2026-01-01', endDate:'2026-01-31', balanceDate:'2026-01-31',
  })

  expect(january.entriesFinancial.filter(item => item.referenceId === 'v-parcelada').reduce((sum, item) => sum + item.value, 0)).toBe(100)
  expect(january.accountsReceivable.find(item => item.sourceId === 'v-parcelada')).toMatchObject({ value:200, dueDate:'2026-02-10' })
})
