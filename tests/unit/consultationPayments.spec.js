import { expect, test } from '@playwright/test'
import { decodePaymentMethod } from '../../src/lib/paymentMethodCodec.js'
import {
  generateConsultationInstallments,
  prepareConsultationPayment,
  shiftInstallmentDate,
} from '../../src/lib/consultationPayments.js'

test('gera parcelas mensais sem pular fevereiro e fecha o total a centavo', () => {
  expect(shiftInstallmentDate('2026-01-31', 1, 'mensal')).toBe('2026-02-28')
  const rows = generateConsultationInstallments({
    total:1000,
    count:3,
    firstDate:'2026-01-31',
    frequency:'mensal',
    method:'pix',
  })
  expect(rows.map(row => row.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(1000)
})

test('prepara consulta parcelada preservando competência e vencimentos independentes', () => {
  const prepared = prepareConsultationPayment({
    date:'2026-01-10',
    paymentScheduleMode:'parcelas',
    paymentStatus:'pendente',
    paymentMode:'unico',
    paymentMethod:'pix',
    schedulePayments:[
      { date:'2026-03-10', amount:300, method:'boleto' },
      { date:'2026-01-10', amount:300, method:'pix' },
      { date:'2026-02-10', amount:400, method:'cartao' },
    ],
  }, 1000)

  expect(prepared).toMatchObject({
    scheduleValid:true,
    competenceDate:'2026-01-10',
    dueDate:'2026-01-10',
    forecastPaymentDate:'2026-01-10',
  })
  expect(decodePaymentMethod(prepared.paymentMethod).payments).toEqual([
    { date:'2026-01-10', amount:300, method:'pix' },
    { date:'2026-02-10', amount:400, method:'cartao' },
    { date:'2026-03-10', amount:300, method:'boleto' },
  ])
})

test('impede salvar cronograma cuja soma difere do valor da consulta', () => {
  const prepared = prepareConsultationPayment({
    date:'2026-01-10',
    paymentScheduleMode:'parcelas',
    paymentStatus:'pendente',
    schedulePayments:[
      { date:'2026-01-10', amount:200, method:'pix' },
      { date:'2026-02-10', amount:200, method:'pix' },
    ],
  }, 500)
  expect(prepared.scheduleValid).toBe(false)
})

test('não inventa data de caixa ao marcar cronograma como pago', () => {
  const prepared = prepareConsultationPayment({
    date:'2026-01-10',
    paymentScheduleMode:'parcelas',
    paymentStatus:'pago',
    paymentDate:'',
    schedulePayments:[
      { date:'2026-01-10', amount:250, method:'pix' },
      { date:'2026-02-10', amount:250, method:'pix' },
    ],
  }, 500)
  expect(prepared.scheduleValid).toBe(false)
  expect(prepared.paymentDate).toBe('')
})
