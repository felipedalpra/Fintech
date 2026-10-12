import { expect, test } from '@playwright/test'
import { auditLedgerReadiness, buildLedger, checkLedgerInvariants, reconcileLedger } from '../../src/lib/financialLedger.js'

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

test('venda de produto: status define pago/aberto; legacy_unverified não vira recebido', () => {
  const ledger = buildLedger({
    productSales: [
      { id: 'v1', totalValue: 300, saleDate: '2026-09-07', receivedDate: '2026-09-09', paymentStatus: 'recebido', patientId: 'p9', patientName: 'Ana' },
      { id: 'v2', totalValue: 300, saleDate: '2026-09-07', paymentStatus: 'legacy_unverified', patientName: 'Antiga' },
      { id: 'v3', totalValue: 300, saleDate: '2026-09-07', paymentStatus: 'pendente' },
      { id: 'v4', totalValue: 300, saleDate: '2026-09-07', paymentStatus: 'cancelado' },
    ],
  })
  const byId = id => ledger.entries.findIndex(e => e.source_id === id)
  expect(ledger.entries[byId('v1')]).toMatchObject({ status: 'paid', party_id: 'p9', party_name_snapshot: 'Ana' })
  expect(ledger.installments[byId('v1')][0].settlement_date).toBe('2026-09-09')
  expect(ledger.entries[byId('v2')].status).toBe('pending')            // legacy NÃO é recebido
  expect(ledger.installments[byId('v2')][0].settlement_date).toBe(null)
  expect(ledger.entries[byId('v3')].status).toBe('pending')
  expect(ledger.entries[byId('v4')].status).toBe('canceled')
  expect(checkLedgerInvariants(ledger)).toEqual([])
})

test('compra de produto: status define pago/aberto; legacy não vira pago; fornecedor vinculado', () => {
  const ledger = buildLedger({
    productPurchases: [
      { id: 'cp1', totalValue: 1000, purchaseDate: '2026-09-03', paymentDate: '2026-09-04', status: 'pago', supplierId: 'f1', supplier: 'Forn X' },
      { id: 'cp2', totalValue: 500, purchaseDate: '2026-09-03', dueDate: '2026-10-03', status: 'pendente', supplierId: 'f1', supplier: 'Forn X' },
      { id: 'cp3', totalValue: 700, purchaseDate: '2026-08-01', status: 'legacy_unverified', supplier: 'Antigo' },
    ],
  })
  const byId = id => ledger.entries.findIndex(e => e.source_id === id)
  expect(ledger.entries[byId('cp1')]).toMatchObject({ direction: 'payable', status: 'paid', party_id: 'f1', party_name_snapshot: 'Forn X' })
  expect(ledger.installments[byId('cp1')][0].settlement_date).toBe('2026-09-04')
  expect(ledger.entries[byId('cp2')].status).toBe('pending')
  expect(ledger.installments[byId('cp2')][0]).toMatchObject({ due_date: '2026-10-03', settlement_date: null })
  expect(ledger.entries[byId('cp3')].status).toBe('pending') // legacy NÃO é pago
  expect(checkLedgerInvariants(ledger)).toEqual([])
})

test('custos de cirurgia viram títulos a pagar por componente (0 não gera)', () => {
  const ledger = buildLedger({
    surgeries: [{
      id: 'sx', totalValue: 10000, date: '2026-09-10', paymentStatus: 'pendente',
      hospitalCost: 2000, anesthesiaCost: 1000, materialCost: 0, otherCosts: 500,
      invoiceIssuancePercent: 10, patient: 'Ana',
    }],
  })
  const costs = ledger.entries.filter(e => e.source_type === 'surgery' && e.direction === 'payable')
  const byComp = Object.fromEntries(costs.map(e => [e.source_component, e.total_amount]))
  expect(byComp.hospital_cost).toBe(2000)
  expect(byComp.anesthesia_cost).toBe(1000)
  expect(byComp.other_cost).toBe(500)
  expect(byComp.invoice_tax).toBe(1000)          // 10% de 10.000
  expect(byComp.material_cost).toBeUndefined()   // 0 → não gera entrada
  // o título de receita da cirurgia continua existindo
  expect(ledger.entries.some(e => e.source_type === 'surgery' && e.source_component === 'revenue')).toBe(true)
  expect(checkLedgerInvariants(ledger)).toEqual([])
})

test('imposto de NF congelado (invoiceTaxAmount) prevalece sobre a alíquota', () => {
  const ledger = buildLedger({
    surgeries: [{
      id: 'sy', totalValue: 10000, date: '2026-09-10', paymentStatus: 'pendente',
      invoiceIssuancePercent: 10, invoiceTaxAmount: 850, patient: 'Bia', // congelado 850, não 1000
    }],
  })
  const tax = ledger.entries.find(e => e.source_type === 'surgery' && e.source_component === 'invoice_tax')
  expect(tax.total_amount).toBe(850)
})

test('reconcileLedger: razão × fonte bate a centavo (diff 0 em toda origem)', () => {
  const { sources } = reconcileLedger(data)
  for (const row of sources) {
    expect(row.diff, `origem ${row.label}`).toBe(0)
  }
  // confirma que de fato comparou cirurgias (receita > 0 no dataset de exemplo)
  expect(sources.find(s => s.label.startsWith('Cirurgias')).ledger).toBeGreaterThan(0)
})

test('auditLedgerReadiness bloqueia a virada quando a liquidação ainda é inferida', () => {
  const audit = auditLedgerReadiness({
    ...data,
    expenses:[...data.expenses, {
      id:'e-sem-data', value:100, dueDate:'2026-09-18', competenceDate:'2026-09-18',
      status:'pago', description:'Despesa paga sem data',
    }],
  })
  const codes = audit.blockers.map(item => item.code)

  expect(audit.ready).toBe(false)
  expect(codes).toContain('legacy_product_sale')
  expect(codes).toContain('legacy_product_purchase')
  expect(codes).toContain('missing_settlement_date')
  expect(audit.invariantProblems).toEqual([])
})

test('data legada da receita extra é liquidação válida e vira somente aviso', () => {
  const audit = auditLedgerReadiness({
    extraRevenues:[{
      id:'r-legada', value:500, date:'2026-09-04', competenceDate:'2026-09-01',
      dueDate:'2026-09-04', status:'recebido', receivedDate:'',
    }],
  })

  expect(audit.ready).toBe(true)
  expect(audit.blockers.map(item => item.code)).not.toContain('missing_settlement_date')
  expect(audit.warnings.map(item => item.code)).toContain('legacy_extra_revenue_date')
})

test('venda recebida com receivedDate usa a data real e não bloqueia a prontidão', () => {
  const audit = auditLedgerReadiness({
    productSales:[{
      id:'v-confirmada', totalValue:250, saleDate:'2026-09-01', competenceDate:'2026-09-01',
      dueDate:'2026-09-05', receivedDate:'2026-09-08', paymentStatus:'recebido',
      patientId:'p1', patientName:'Ana',
    }],
  })
  const index = audit.reconciliation.sources.findIndex(item => item.label === 'Vendas de produto')

  expect(audit.blockers.map(item => item.code)).not.toContain('product_sale_assumed_settlement')
  expect(audit.reconciliation.sources[index].diff).toBe(0)
})

test('auditLedgerReadiness libera revisão final com situações e datas confirmadas', () => {
  const audit = auditLedgerReadiness({
    surgeries:[{
      id:'s-ok', totalValue:1000, date:'2026-09-01', competenceDate:'2026-09-01', dueDate:'2026-09-05',
      paymentStatus:'pago', paymentDate:'2026-09-05', patient:'Ana', patientId:'p1',
    }],
    consultations:[{
      id:'c-ok', value:300, date:'2026-09-02', competenceDate:'2026-09-02', dueDate:'2026-09-02',
      paymentStatus:'pago', paymentDate:'2026-09-02', patient:'Bia', patientId:'p2',
    }],
    productSales:[{
      id:'v-ok', totalValue:200, saleDate:'2026-09-03', competenceDate:'2026-09-03',
      paymentStatus:'pendente', patientId:'p3', patientName:'Cida',
    }],
    productPurchases:[{
      id:'cp-ok', totalValue:100, purchaseDate:'2026-09-03', competenceDate:'2026-09-03', dueDate:'2026-09-10',
      status:'pendente', supplierId:'f1', supplier:'Fornecedor',
    }],
    extraRevenues:[{
      id:'r-ok', value:50, date:'2026-09-04', competenceDate:'2026-09-04', dueDate:'2026-09-12', status:'pendente',
    }],
    expenses:[{
      id:'e-ok', value:80, dueDate:'2026-09-15', competenceDate:'2026-09-05', status:'pendente', supplierId:'f2',
    }],
  })

  expect(audit.ready).toBe(true)
  expect(audit.blockers).toEqual([])
  expect(audit.warnings).toEqual([])
})
