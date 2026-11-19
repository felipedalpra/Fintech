import { expect, test } from '@playwright/test'
import { decodePaymentMethod } from '../../src/lib/paymentMethodCodec.js'
import { prepareProductSalePayment } from '../../src/lib/productSalePayments.js'

test('prepara venda de produto parcelada com vencimento inicial e soma exata', () => {
  const prepared = prepareProductSalePayment({
    saleDate:'2026-01-10',
    dueDate:'2026-01-10',
    paymentScheduleMode:'parcelas',
    paymentStatus:'parcelado',
    schedulePayments:[
      { date:'2026-03-10', amount:300, method:'boleto' },
      { date:'2026-01-10', amount:300, method:'pix' },
      { date:'2026-02-10', amount:400, method:'cartao' },
    ],
  }, 1000)

  expect(prepared).toMatchObject({ scheduleValid:true, dueDate:'2026-01-10' })
  expect(decodePaymentMethod(prepared.paymentMethod).payments).toEqual([
    { date:'2026-01-10', amount:300, method:'pix' },
    { date:'2026-02-10', amount:400, method:'cartao' },
    { date:'2026-03-10', amount:300, method:'boleto' },
  ])
})

test('rejeita venda parcelada cuja soma não fecha o valor total', () => {
  const prepared = prepareProductSalePayment({
    saleDate:'2026-01-10',
    paymentScheduleMode:'parcelas',
    paymentStatus:'parcelado',
    schedulePayments:[
      { date:'2026-01-10', amount:200, method:'pix' },
      { date:'2026-02-10', amount:200, method:'pix' },
    ],
  }, 500)

  expect(prepared.scheduleValid).toBe(false)
})
