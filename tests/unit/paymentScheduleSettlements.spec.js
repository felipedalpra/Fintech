import { expect, test } from '@playwright/test'
import { encodePaymentMethod } from '../../src/lib/paymentMethodCodec.js'
import { paymentScheduleFlow } from '../../src/lib/paymentScheduleFlow.js'
import { buildLedger } from '../../src/lib/financialLedger.js'

const method = encodePaymentMethod({ payments:[
  { date:'2026-10-10', amount:400, method:'pix' },
  { date:'2026-11-10', amount:600, method:'boleto' },
] })

test('liquidação por parcela preserva vencimento e usa data real de caixa', () => {
  const flow = paymentScheduleFlow(1000, {
    paymentMethod:method,
    paymentStatus:'pendente',
    receiptSettlements:{ '1':{ receivedDate:'2026-10-16', amount:400, method:'pix' } },
  })
  expect(flow.paidInstallments[0]).toMatchObject({ dueDate:'2026-10-10', settlementDate:'2026-10-16', amount:400 })
  expect(flow.openInstallments[0]).toMatchObject({ dueDate:'2026-11-10', amount:600 })
  expect(flow.paidAmount).toBe(400)
  expect(flow.openAmount).toBe(600)
})

test('razão persiste vencimento e recebimento em campos distintos sem perder total', () => {
  const ledger = buildLedger({ surgeries:[{
    id:'11111111-1111-4111-8111-111111111111', patient:'Ana', totalValue:1000,
    date:'2026-10-01', paymentMethod:method, paymentStatus:'pendente',
    receiptSettlements:{ '1':{ receivedDate:'2026-10-16', amount:400, method:'pix' } },
  }] })
  expect(ledger.installments[0]).toEqual([
    expect.objectContaining({ installment_number:1, amount:400, due_date:'2026-10-10', settlement_date:'2026-10-16', status:'paid' }),
    expect.objectContaining({ installment_number:2, amount:600, due_date:'2026-11-10', settlement_date:null, status:'pending' }),
  ])
  expect(ledger.entries[0].status).toBe('partially_paid')
})

test('settlements explícitos não inferem outra parcela só porque ela venceu antes da data real', () => {
  const flow = paymentScheduleFlow(1000, {
    paymentMethod:method,
    paymentStatus:'pendente',
    paymentDate:'2026-12-12',
    receiptSettlements:{ '1':{ receivedDate:'2026-12-12', amount:400, method:'pix' } },
  })
  expect(flow.paidInstallments).toHaveLength(1)
  expect(flow.openInstallments).toHaveLength(1)
  expect(flow.openAmount).toBe(600)
})

test('liquidação explícita preserva o valor histórico recebido', () => {
  const changedSchedule = encodePaymentMethod({ payments:[
    { date:'2026-10-10', amount:100, method:'pix' },
    { date:'2026-11-10', amount:900, method:'boleto' },
  ] })
  const flow = paymentScheduleFlow(1000, {
    paymentMethod:changedSchedule,
    paymentStatus:'pendente',
    receiptSettlements:{ '1':{ receivedDate:'2026-10-16', amount:400, method:'pix' } },
  })
  expect(flow.paidInstallments[0]).toMatchObject({ amount:400, settlementDate:'2026-10-16' })
  expect(flow.paidAmount).toBe(400)
  expect(flow.openInstallments).toEqual([expect.objectContaining({ amount:600 })])
  expect(flow.openAmount).toBe(600)
  expect([...flow.paidInstallments, ...flow.openInstallments].reduce((sum, item) => sum + item.amount, 0)).toBe(1000)
})

test('liquidação histórica menor que a parcela redistribui todo o saldo sem perder valor', () => {
  const flow = paymentScheduleFlow(1000, {
    paymentMethod:encodePaymentMethod({ payments:[
      { date:'2026-10-10', amount:500, method:'pix' },
      { date:'2026-11-10', amount:500, method:'boleto' },
    ] }),
    paymentStatus:'pendente',
    receiptSettlements:{ '1':{ receivedDate:'2026-10-16', amount:300, method:'pix' } },
  })
  expect(flow.paidAmount).toBe(300)
  expect(flow.openAmount).toBe(700)
  expect(flow.openInstallments).toEqual([expect.objectContaining({ amount:700, dueDate:'2026-11-10' })])
  expect([...flow.paidInstallments, ...flow.openInstallments].reduce((sum, item) => sum + item.amount, 0)).toBe(1000)
})
