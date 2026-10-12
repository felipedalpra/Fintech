import { expect, test } from '@playwright/test'
import { buildLedger, checkLedgerInvariants } from '../../src/lib/financialLedger.js'

const data = {
  surgeries: [
    { id: 's1', totalValue: 10000, date: '2026-09-10', competenceDate: '2026-09-10', paymentStatus: 'pago', paymentDate: '2026-09-12', patient: 'Ana', patientId: 'p1' },
    { id: 's2', totalValue: 5000, date: '2026-09-20', paymentStatus: 'pendente', dueDate: '2026-10-20', patient: 'Bia', patientId: 'p2' },
    { id: 's3', totalValue: 8000, date: '2026-09-01', paymentStatus: 'cancelado', patient: 'Cida', patientId: 'p3' },
  ],
  consultations: [
    { id: 'c1', value: 300, date: '2026-09-05', paymentStatus: 'pago', paymentDate: '2026-09-05', patient: 'Dora', patientId: 'p4' },
  ],
  productSales: [{ id: 'ps1', totalValue: 200, saleDate: '2026-09-07', patient: 'Eva', patientId: 'p5' }],
  productPurchases: [{ id: 'pp1', totalValue: 1000, purchaseDate: '2026-09-03', supplier: 'Fornecedor X' }],
  extraRevenues: [{ id: 'er1', value: 1500, date: '2026-09-02', status: 'recebido', description: 'Pix avulso' }],
  expenses: [
    { id: 'e1', value: 400, dueDate: '2026-09-15', status: 'pendente', description: 'Aluguel', category: 'aluguel' },
    { id: 'e2', value: 600, dueDate: '2026-09-10', status: 'pago', paymentDate: '2026-09-11', description: 'Luz', category: 'utilidades' },
  ],
}

test('buildLedger: um título por registro, parcelas alinhadas', () => {
  const { entries, installments } = buildLedger(data)
  expect(entries).toHaveLength(9) // 3 cir + 1 cons + 1 venda + 1 compra + 1 receita + 2 despesas
  expect(installments).toHaveLength(9)
})

test('título pago (cirurgia) → parcela liquidada na data de pagamento', () => {
  const { entries, installments } = buildLedger(data)
  const i = entries.findIndex(e => e.source_type === 'surgery' && e.source_id === 's1')
  expect(entries[i]).toMatchObject({ direction: 'receivable', status: 'paid', total_amount: 10000, party_name_snapshot: 'Ana' })
  expect(installments[i]).toHaveLength(1)
  expect(installments[i][0]).toMatchObject({ amount: 10000, settlement_date: '2026-09-12', status: 'paid' })
})

test('título em aberto (cirurgia) → parcela sem liquidação, vencimento preservado', () => {
  const { entries, installments } = buildLedger(data)
  const i = entries.findIndex(e => e.source_id === 's2')
  expect(entries[i].status).toBe('pending')
  expect(installments[i][0]).toMatchObject({ amount: 5000, due_date: '2026-10-20', settlement_date: null, status: 'pending' })
})

test('cancelado → status canceled, não entra como pago nem aberto', () => {
  const { entries, installments } = buildLedger(data)
  const i = entries.findIndex(e => e.source_id === 's3')
  expect(entries[i].status).toBe('canceled')
  expect(installments[i].every(r => r.status === 'canceled')).toBe(true)
})

test('despesa paga → payable liquidado; despesa pendente → em aberto', () => {
  const { entries, installments } = buildLedger(data)
  const paidIdx = entries.findIndex(e => e.source_id === 'e2')
  const openIdx = entries.findIndex(e => e.source_id === 'e1')
  expect(entries[paidIdx]).toMatchObject({ direction: 'payable', status: 'paid' })
  expect(installments[paidIdx][0]).toMatchObject({ settlement_date: '2026-09-11', status: 'paid' })
  expect(entries[openIdx].status).toBe('pending')
  expect(installments[openIdx][0].settlement_date).toBe(null)
})

test('invariantes: soma das parcelas = total e pago+aberto = total (sem problemas)', () => {
  const ledger = buildLedger(data)
  expect(checkLedgerInvariants(ledger)).toEqual([])
})
