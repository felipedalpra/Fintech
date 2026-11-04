import { expect, test } from '@playwright/test'
import { buildMetrics } from '../../src/financialMetrics.js'
import { encodePaymentMethod } from '../../src/lib/paymentMethodCodec.js'
import { paymentScheduleFlow } from '../../src/lib/paymentScheduleFlow.js'
import { hasChangedReceiptFields, hasRecognizedReceipt, reverseReceivableInstallment } from '../../src/lib/receivablePaymentReversal.js'

const paymentMethod = encodePaymentMethod({ payments:[
  { date:'2026-11-03', amount:3333.33, method:'pix' },
  { date:'2026-12-03', amount:3333.33, method:'pix' },
  { date:'2027-01-03', amount:3333.34, method:'pix' },
] })

function surgery(overrides = {}) {
  return {
    id:'surgery-1', patient:'Ana', totalValue:10000,
    date:'2026-11-03', competenceDate:'2026-11-03', paymentMethod,
    paymentStatus:'pendente', paymentDate:'2026-11-03',
    receiptSettlements:{
      1:{ receivedDate:'2026-11-03', amount:3333.33, method:'pix', status:'received' },
    },
    ...overrides,
  }
}

test('estorna somente a parcela escolhida e preserva histórico auditável', () => {
  const reversed = reverseReceivableInstallment(surgery(), {
    totalValue:10000,
    installmentNumber:1,
    reversedAt:'2026-11-03T15:00:00.000Z',
    reversedByRole:'admin',
  })

  expect(reversed.paymentStatus).toBe('pendente')
  expect(reversed.paymentDate).toBe(null)
  expect(reversed.receiptSettlements['1']).toMatchObject({
    status:'reversed',
    receivedDate:'2026-11-03',
    reversedAt:'2026-11-03T15:00:00.000Z',
    reversedByRole:'admin',
  })
  expect(reversed.receiptSettlements['1'].history).toHaveLength(1)

  const flow = paymentScheduleFlow(10000, reversed)
  expect(flow.paidAmount).toBe(0)
  expect(flow.openAmount).toBe(10000)
  expect(flow.openInstallments).toHaveLength(3)
})

test('estorno de uma parcela mantém os outros recebimentos ativos', () => {
  const record = surgery({
    paymentDate:'2026-12-05',
    receiptSettlements:{
      1:{ receivedDate:'2026-11-03', amount:3333.33, method:'pix', status:'received' },
      2:{ receivedDate:'2026-12-05', amount:3333.33, method:'pix', status:'received' },
    },
  })
  const reversed = reverseReceivableInstallment(record, {
    totalValue:10000,
    installmentNumber:1,
    reversedAt:'2026-12-06T10:00:00.000Z',
  })
  const flow = paymentScheduleFlow(10000, reversed)

  expect(reversed.paymentDate).toBe('2026-12-05')
  expect(flow.paidAmount).toBe(3333.33)
  expect(flow.paidInstallments.map(item => item.index + 1)).toEqual([2])
  expect(flow.openAmount).toBe(6666.67)
})

test('registro legado pago é materializado antes de estornar uma única parcela', () => {
  const legacy = surgery({ receiptSettlements:{}, paymentStatus:'pago', paymentDate:'2027-01-05' })
  const reversed = reverseReceivableInstallment(legacy, {
    totalValue:10000,
    installmentNumber:2,
    reversedAt:'2027-01-06T10:00:00.000Z',
  })
  const flow = paymentScheduleFlow(10000, reversed)

  expect(reversed.receiptSettlements['1'].status).toBe('received')
  expect(reversed.receiptSettlements['2'].status).toBe('reversed')
  expect(reversed.receiptSettlements['3'].status).toBe('received')
  expect(flow.paidInstallments.map(item => item.index + 1)).toEqual([1, 3])
  expect(flow.openInstallments.map(item => item.index + 1)).toEqual([2])
})

test('métricas removem a entrada estornada e devolvem a mesma parcela ao contas a receber', () => {
  const reversed = reverseReceivableInstallment(surgery(), {
    totalValue:10000,
    installmentNumber:1,
    reversedAt:'2026-11-03T15:00:00.000Z',
  })
  const metrics = buildMetrics({ surgeries:[reversed] }, {
    startDate:'2026-11-01', endDate:'2026-11-30', balanceDate:'2026-11-30',
  })

  expect(metrics.entriesFinancial).toHaveLength(0)
  expect(metrics.accountsReceivable).toHaveLength(3)
  expect(metrics.accountsReceivable.find(item => item.installmentNumber === 1)).toMatchObject({
    value:3333.33,
    dueDate:'2026-11-03',
  })
  expect(metrics.receivablesOpenTotal).toBe(10000)
})

test('venda de produto é estornada sem excluir a venda', () => {
  const sale = {
    id:'sale-1', totalValue:300, saleDate:'2026-11-01', competenceDate:'2026-11-01',
    paymentStatus:'recebido', receivedDate:'2026-12-03', paymentMethod:encodePaymentMethod({ payments:[
      { date:'2026-11-03', amount:100, method:'pix' },
      { date:'2026-12-03', amount:200, method:'cartao' },
    ] }),
    receiptSettlements:{
      1:{ receivedDate:'2026-11-03', amount:100, method:'pix', status:'received' },
      2:{ receivedDate:'2026-12-03', amount:200, method:'cartao', status:'received' },
    },
  }
  const reversed = reverseReceivableInstallment(sale, {
    totalValue:300,
    installmentNumber:1,
    paidStatus:'recebido',
    receivedDateField:true,
    reversedAt:'2026-11-04T10:00:00.000Z',
  })

  expect(reversed.id).toBe('sale-1')
  expect(reversed.paymentStatus).toBe('pendente')
  expect(reversed.receivedDate).toBe('2026-12-03')
  expect(reversed.receiptSettlements['1'].status).toBe('reversed')
  expect(reversed.receiptSettlements['2'].status).toBe('received')
})

test('mudanças financeiras alternativas são detectadas depois de haver recebimento', () => {
  const original = surgery()
  expect(hasRecognizedReceipt(original)).toBe(true)
  expect(hasRecognizedReceipt({ paymentStatus:'pago', paymentDate:'2026-11-03' })).toBe(true)
  expect(hasRecognizedReceipt({ paymentStatus:'pago', paymentDate:null, receiptSettlements:{} })).toBe(true)
  expect(hasRecognizedReceipt({ paymentStatus:'recebido', receivedDate:null, receiptSettlements:{} })).toBe(true)
  expect(hasRecognizedReceipt({ paymentStatus:'pendente', receiptSettlements:{ 1:{ receivedDate:'2026-11-03', status:'reversed' } } })).toBe(false)
  expect(hasRecognizedReceipt({ paymentStatus:'pendente', paymentDate:null })).toBe(false)
  expect(hasChangedReceiptFields(original, { ...original, notes:'ajuste operacional' }, ['totalValue', 'paymentMethod', 'paymentStatus', 'paymentDate', 'dueDate'])).toBe(false)
  expect(hasChangedReceiptFields(original, { ...original, paymentStatus:'pago' }, ['totalValue', 'paymentMethod', 'paymentStatus', 'paymentDate', 'dueDate'])).toBe(true)
  expect(hasChangedReceiptFields(original, { ...original, totalValue:9000 }, ['totalValue', 'paymentMethod', 'paymentStatus', 'paymentDate', 'dueDate'])).toBe(true)
})

test('recebimento originado por cobrança exige o fluxo do provedor', () => {
  expect(() => reverseReceivableInstallment(surgery({
    receiptSettlements:{ 1:{ receivedDate:'2026-11-03', amount:3333.33, method:'pix', chargeId:'charge-1' } },
  }), {
    totalValue:10000,
    installmentNumber:1,
    reversedAt:'2026-11-03T15:00:00.000Z',
  })).toThrow(/fluxo da cobrança/)
})

test('identidade da parcela não muda quando as datas do cronograma estão fora de ordem', () => {
  const record = surgery({
    totalValue:300,
    paymentMethod:encodePaymentMethod({ payments:[
      { date:'2026-12-03', amount:200, method:'cartao' },
      { date:'2026-11-03', amount:100, method:'pix' },
    ] }),
    receiptSettlements:{ 1:{ receivedDate:'2026-12-04', amount:200, method:'cartao', status:'received' } },
    paymentDate:'2026-12-04',
  })
  const metrics = buildMetrics({ surgeries:[record] }, {
    startDate:'2026-11-01', endDate:'2026-12-31', balanceDate:'2026-12-31',
  })
  const cashRow = metrics.entriesFinancial[0]

  expect(cashRow.installmentNumber).toBe(2)
  expect(cashRow.sourceInstallmentNumber).toBe(1)
  expect(cashRow.installmentDisplayNumber).toBe(2)
  const reversed = reverseReceivableInstallment(record, {
    totalValue:300,
    installmentNumber:cashRow.sourceInstallmentNumber,
    reversedAt:'2026-12-05T10:00:00.000Z',
  })
  expect(paymentScheduleFlow(300, reversed).paidAmount).toBe(0)
})

test('cobrança usa a identidade persistida e settlement usa a identidade original fora de ordem', () => {
  const record = surgery({
    totalValue:300,
    paymentStatus:'pendente',
    paymentDate:null,
    paymentMethod:encodePaymentMethod({ payments:[
      { date:'2026-12-03', amount:200, method:'cartao' },
      { date:'2026-11-03', amount:100, method:'pix' },
    ] }),
    receiptSettlements:{},
  })
  const metrics = buildMetrics({ surgeries:[record] }, {
    startDate:'2026-11-01', endDate:'2026-12-31', balanceDate:'2026-11-30',
  })
  const november = metrics.accountsReceivable.find(item => item.dueDate === '2026-11-03')

  expect(november).toMatchObject({
    installmentNumber:1,
    sourceInstallmentNumber:2,
    value:100,
  })
  expect(november.openInstallmentRows[0]).toMatchObject({
    installmentNumber:1,
    sourceInstallmentNumber:2,
    amount:100,
  })
})
