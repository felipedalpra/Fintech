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
    { id:'v1', productId:'pdt', quantity:1, totalValue:200, saleDate:'2026-01-05', competenceDate:'2026-01-05', paymentStatus:'recebido' },
    { id:'v-cancelada', productId:'pdt', quantity:1, totalValue:500, saleDate:'2026-01-05', competenceDate:'2026-01-05', paymentStatus:'cancelado' },
  ],
  productPurchases:[
    { id:'cp1', productId:'pdt', quantity:1, totalValue:80, purchaseDate:'2026-01-03', competenceDate:'2026-01-03', dueDate:'2026-01-25', status:'pendente' },
    { id:'cp-cancelada', productId:'pdt', quantity:1, totalValue:70, purchaseDate:'2026-01-03', competenceDate:'2026-01-03', status:'cancelado' },
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
  products:[{ id:'pdt', name:'Produto', stock:0, purchasePrice:0 }],
  procedures:[], assets:[], liabilities:[], goals:[], recurrences:[],
}

test('Fase 10: DRE lê competência do razão e caixa lê liquidação', () => {
  const metrics = buildMetrics(data, {
    startDate:'2026-01-01', endDate:'2026-01-31', balanceDate:'2026-01-31',
  })

  expect(metrics.grossRevenue).toBe(1550)
  expect(metrics.surgeryCostTotal).toBe(100)
  expect(metrics.productPurchaseTotal).toBe(80)
  expect(metrics.productPurchasesTotal).toBe(80)
  expect(metrics.operationalExpenses).toBe(60)
  expect(metrics.netProfit).toBe(1310)

  // A cirurgia pertence à DRE de janeiro, mas só entra no caixa em fevereiro.
  expect(metrics.cashIn).toBe(250)
  expect(metrics.cashOut).toBe(140)
  expect(metrics.cashBalance).toBe(110)
})

test('drill-downs reconciliam a centavo com os indicadores financeiros', () => {
  const metrics = buildMetrics(data, {
    startDate:'2026-01-01', endDate:'2026-01-31', balanceDate:'2026-01-31',
  })
  const sum = key => metrics.drilldowns[key].reduce((total, item) => total + Number(item.value || 0), 0)
  const totalExpenses = metrics.surgeryCostTotal + metrics.consultationCostTotal + metrics.productCostOfSales + metrics.operationalExpenses + metrics.taxExpenses

  expect(sum('grossRevenue')).toBeCloseTo(metrics.grossRevenue, 2)
  expect(sum('totalExpenses')).toBeCloseTo(totalExpenses, 2)
  expect(sum('operatingProfit')).toBeCloseTo(metrics.operatingProfit, 2)
  expect(sum('netProfit')).toBeCloseTo(metrics.netProfit, 2)
  expect(sum('cashIn')).toBeCloseTo(metrics.cashIn, 2)
  expect(sum('cashOut')).toBeCloseTo(metrics.cashOut, 2)
  expect(sum('cashBalance')).toBeCloseTo(metrics.cashBalance, 2)
  expect(sum('receivablesOpenTotal')).toBeCloseTo(metrics.receivablesOpenTotal, 2)
  expect(sum('payablesOpenTotal')).toBeCloseTo(metrics.payablesOpenTotal, 2)
  expect(sum('prediction')).toBeCloseTo(metrics.prediction, 2)
  expect(sum('assetsTotal')).toBeCloseTo(metrics.assetsTotal, 2)
  expect(sum('liabilitiesTotal')).toBeCloseTo(metrics.liabilitiesTotal, 2)
  expect(sum('equity')).toBeCloseTo(metrics.equity, 2)
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

test('receita extra a receber preserva a origem informada na apresentação', () => {
  const pending = structuredClone(data)
  pending.extraRevenues = [{
    id:'r-origem', description:'Mentoria', category:'outras_receitas', value:100,
    date:'', competenceDate:'2026-10-12', dueDate:'2026-11-12', receivedDate:null,
    status:'pendente', originLabel:'Instagram',
  }]

  const metrics = buildMetrics(pending, {
    startDate:'2026-10-01', endDate:'2026-10-31', balanceDate:'2026-10-31',
  })

  expect(metrics.accountsReceivable.find(item => item.sourceId === 'r-origem')).toMatchObject({
    source:'outra_receita',
    originLabel:'Instagram',
  })
  expect(metrics.drilldowns.receivablesOpenTotal.find(item => item.sourceId === 'r-origem')).toMatchObject({
    origin:'Instagram',
  })
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
    id:'v-parcelada', productId:'pdt', patientName:'Ana', quantity:1, totalValue:300,
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

test('Fase 10: compra forma estoque e só a venda reconhece CMV na DRE', () => {
  const inventoryOnly = structuredClone(data)
  inventoryOnly.productSales = []
  inventoryOnly.productPurchases = [{
    id:'compra-estoque', productId:'pdt', quantity:5, totalValue:500,
    purchaseDate:'2026-01-03', competenceDate:'2026-01-03', paymentDate:'2026-01-03', status:'pago',
  }]
  inventoryOnly.surgeries = []
  inventoryOnly.consultations = []
  inventoryOnly.extraRevenues = []
  inventoryOnly.expenses = []

  const metrics = buildMetrics(inventoryOnly, {
    startDate:'2026-01-01', endDate:'2026-01-31', balanceDate:'2026-01-31',
  })

  expect(metrics.productPurchasesTotal).toBe(500)
  expect(metrics.productCostOfSales).toBe(0)
  expect(metrics.netProfit).toBe(0)
  expect(metrics.cashOut).toBe(500)
  expect(metrics.inventoryAsset).toBe(500)
})

test('recorrências são títulos do razão e não duplicam quando materializadas', () => {
  const recurring = structuredClone(data)
  recurring.surgeries = []
  recurring.consultations = []
  recurring.productSales = []
  recurring.productPurchases = []
  recurring.extraRevenues = []
  recurring.expenses = []
  recurring.recurrences = [
    { id:'11111111-1111-4111-8111-111111111111', tipo:'receita', descricao:'Mensalidade', valor:1000, categoria:'outras_receitas', frequencia:'mensal', diaExecucao:5, dataInicio:'2026-10-01', autoMarkAsPaid:false, ativo:true },
    { id:'22222222-2222-4222-8222-222222222222', tipo:'despesa', descricao:'Software', valor:400, categoria:'softwares', frequencia:'mensal', diaExecucao:10, dataInicio:'2026-10-01', autoMarkAsPaid:true, ativo:true },
  ]
  const metrics = buildMetrics(recurring, { startDate:'2026-10-01', endDate:'2026-10-31', balanceDate:'2026-10-31' })

  expect(metrics.extraRevenueTotal).toBe(1000)
  expect(metrics.operationalExpenses).toBe(400)
  expect(metrics.accountsReceivable.find(item => item.source === 'recorrencia')).toMatchObject({ value:1000, dueDate:'2026-10-05' })
  expect(metrics.exitsFinancial.find(item => item.origin === 'recorrencia_despesa')).toMatchObject({ value:400, date:'2026-10-10' })

  recurring.extraRevenues = [{ id:'r-materializada', description:'Mensalidade', value:1000, category:'outras_receitas', date:'2026-10-05', receivedDate:'', dueDate:'2026-10-05', competenceDate:'2026-10-05', status:'pendente' }]
  const materialized = buildMetrics(recurring, { startDate:'2026-10-01', endDate:'2026-10-31', balanceDate:'2026-10-31' })
  expect(materialized.extraRevenueTotal).toBe(1000)
  expect(materialized.accountsReceivable.filter(item => item.value === 1000)).toHaveLength(1)
})
