import { expect, test } from '@playwright/test'
import { applyBankSettlement, validateSettlementAdjustments } from '../../src/lib/bankSettlement.js'

const line = { posted_date:'2026-11-20', financial_account_id:'account-1' }

test('baixa uma receita extra com data, método e conta do extrato', () => {
  const data = { extraRevenues:[{ id:'revenue-1', value:250, date:'2026-11-01', dueDate:'2026-11-10', status:'pendente' }] }
  const candidate = { id:'installment-1', status:'pending', amount:250, financial_entries:{ source_type:'extra_revenue', source_id:'revenue-1' } }
  const next = applyBankSettlement(data, candidate, line, 'cartao_link')
  expect(next.extraRevenues[0]).toMatchObject({ status:'recebido', receivedDate:'2026-11-20', paymentMethod:'cartao_link', financialAccountId:'account-1' })
  expect(data.extraRevenues[0].status).toBe('pendente')
})

test('baixa uma despesa como pagamento na data efetiva do extrato', () => {
  const data = { expenses:[{ id:'expense-1', value:90, dueDate:'2026-11-05', status:'aberto' }] }
  const candidate = { id:'installment-2', status:'pending', amount:90, financial_entries:{ source_type:'expense', source_id:'expense-1' } }
  const next = applyBankSettlement(data, candidate, line, 'transferencia')
  expect(next.expenses[0]).toMatchObject({ status:'pago', paymentDate:'2026-11-20', paymentMethod:'transferencia', financialAccountId:'account-1' })
})

test('recusa baixa sem método suportado ou origem inexistente', () => {
  const candidate = { id:'installment-3', amount:10, financial_entries:{ source_type:'expense', source_id:'missing' } }
  expect(() => applyBankSettlement({ expenses:[] }, candidate, line, 'manual')).toThrow()
})

test('valida pagamento líquido mantendo o título bruto e separando taxa', () => {
  const candidate = { amount:1000, financial_entries:{ direction:'receivable' } }
  expect(validateSettlementAdjustments(candidate, { amount:970 }, { feesAmount:30 })).toMatchObject({ valid:true, expected:970, bank:970 })
  expect(validateSettlementAdjustments(candidate, { amount:970 }, { feesAmount:20 }).valid).toBe(false)
})
