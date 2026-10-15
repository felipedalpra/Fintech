import { expect, test } from '@playwright/test'
import { buildCalendarFinancialPatch, createCalendarFinancialDraft } from '../../src/lib/calendarFinancialDetails.js'

test('rascunho financeiro preserva método avançado existente até alteração explícita', () => {
  const draft = createCalendarFinancialDraft('consultation', {
    value:350,
    paymentMethod:'pagamentos:%5B%7B%22date%22%3A%222026-10-20%22%2C%22amount%22%3A350%2C%22method%22%3A%22pix%22%7D%5D',
    dueDate:'2026-10-20',
  }, '2026-10-15')

  expect(draft.hasAdvancedPaymentMethod).toBe(true)
  expect(draft.paymentMethod).toBe('__advanced__')
  expect(buildCalendarFinancialPatch('consultation', draft).paymentMethod).toBe(draft.originalPaymentMethod)
  expect(buildCalendarFinancialPatch('consultation', { ...draft, paymentMethod:'pix', paymentMethodTouched:true }).paymentMethod).toBe('pix')
})

test('consulta normaliza campos financeiros no mesmo registro', () => {
  const patch = buildCalendarFinancialPatch('consultation', {
    date:'2026-10-15', value:'450', dueDate:'2026-10-22', paymentMethod:'cartao', paymentMethodTouched:true,
    paymentStatus:'pago', paymentDate:'2026-10-16', invoiceIssuancePercent:'8.5', paymentType:'unimed', insurance:' Unimed POA ',
  })

  expect(patch).toEqual({
    value:450, dueDate:'2026-10-22', forecastPaymentDate:'2026-10-22', paymentMethod:'cartao', paymentStatus:'pago',
    paymentDate:'2026-10-16', invoiceIssuancePercent:8.5, paymentType:'unimed', insurance:'Unimed POA',
  })
})

test('cirurgia limita percentuais e normaliza valores e custos', () => {
  const patch = buildCalendarFinancialPatch('surgery', {
    date:'2026-10-15', totalValue:'18000', dueDate:'', paymentMethod:'pix', paymentStatus:'pendente', paymentDate:'2026-10-16',
    invoiceIssuancePercent:130, hospitalCost:'3000', anesthesiaCost:'2000', materialCost:'500', otherCosts:'250',
  })

  expect(patch).toMatchObject({
    totalValue:18000, dueDate:'2026-10-15', paymentMethod:'pix', paymentStatus:'pendente', paymentDate:'',
    invoiceIssuancePercent:100, hospitalCost:3000, anesthesiaCost:2000, materialCost:500, otherCosts:250,
  })
})
