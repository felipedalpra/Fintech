import { expect, test } from '@playwright/test'
import { buildMetrics } from '../../src/financialMetrics.js'
import { buildCalendarFinancialPatch } from '../../src/lib/calendarFinancialDetails.js'
import { flattenDefaultChart } from '../../src/lib/chartOfAccounts.js'
import { withClinicalCostSettlementDefaults } from '../../src/lib/clinicalCosts.js'
import { buildLedger, checkLedgerInvariants, reconcileLedger } from '../../src/lib/financialLedger.js'

function chartAccounts() {
  let id = 0
  return flattenDefaultChart('owner', () => `account-${++id}`)
}

test('compra, venda e CMV preservam estoque, caixa e DRE no mesmo critério', () => {
  const data = {
    chartAccounts:chartAccounts(),
    products:[{ id:'produto', name:'Cinta', stock:10, purchasePrice:10, salePrice:40 }],
    productPurchases:[{
      id:'compra', productId:'produto', quantity:10, totalValue:200,
      purchaseDate:'2026-11-02', competenceDate:'2026-11-02', dueDate:'2026-11-02',
      paymentDate:'2026-11-02', status:'pago',
    }],
    productSales:[{
      id:'venda', productId:'produto', patientId:'paciente', patientName:'Paciente', quantity:5,
      unitValue:40, totalValue:200, saleDate:'2026-11-05', competenceDate:'2026-11-05',
      dueDate:'2026-11-05', receivedDate:'2026-11-05', paymentStatus:'recebido', paymentMethod:'pix',
    }],
    procedures:[], surgeries:[], consultations:[], extraRevenues:[], expenses:[],
    assets:[], liabilities:[], goals:[], recurrences:[],
  }

  const metrics = buildMetrics(data, { startDate:'2026-11-01', endDate:'2026-11-30', balanceDate:'2026-11-30' })
  const ledger = buildLedger(data)

  expect(metrics.productSalesRevenue).toBe(200)
  expect(metrics.productPurchasesTotal).toBe(200)
  expect(metrics.productCostOfSales).toBe(75)
  expect(metrics.inventoryAsset).toBe(225)
  expect(metrics.cashIn).toBe(200)
  expect(metrics.cashOut).toBe(200)
  expect(ledger.entries.find(entry => entry.source_type === 'product_purchase')).toMatchObject({
    direction:'payable', account_nature:'asset', total_amount:200,
  })
  expect(checkLedgerInvariants(ledger)).toEqual([])
  expect(reconcileLedger(data).sources.every(row => row.diff === 0)).toBe(true)
})

test('cirurgia e consulta criadas pela Agenda geram receita, custos e dedução de NF sem baixa presumida', () => {
  const surgeryPatch = buildCalendarFinancialPatch('surgery', {
    date:'2026-11-10', totalValue:1000, dueDate:'2026-11-20', paymentMethod:'pix', paymentStatus:'pendente',
    invoiceIssuancePercent:10, hospitalCost:100, anesthesiaCost:50, materialCost:0, otherCosts:0,
  })
  const consultationPatch = buildCalendarFinancialPatch('consultation', {
    date:'2026-11-11', value:200, dueDate:'2026-11-11', paymentMethod:'pix', paymentStatus:'pago',
    paymentDate:'2026-11-11', invoiceIssuancePercent:5, paymentType:'particular', insurance:'',
  })
  const surgery = withClinicalCostSettlementDefaults({
    id:'cirurgia', patient:'Paciente', patientId:'paciente', date:'2026-11-10', competenceDate:'2026-11-10',
    ...surgeryPatch,
  }, 'surgery')
  const consultation = withClinicalCostSettlementDefaults({
    id:'consulta', patient:'Paciente', patientId:'paciente', date:'2026-11-11', competenceDate:'2026-11-11',
    ...consultationPatch,
  }, 'consultation')
  const data = {
    chartAccounts:chartAccounts(), procedures:[], products:[], productSales:[], productPurchases:[],
    surgeries:[surgery], consultations:[consultation], extraRevenues:[], expenses:[], assets:[],
    liabilities:[], goals:[], recurrences:[],
  }

  const metrics = buildMetrics(data, { startDate:'2026-11-01', endDate:'2026-11-30', balanceDate:'2026-11-30' })
  const ledger = buildLedger(data)
  const surgeryTax = ledger.entries.find(entry => entry.source_type === 'surgery' && entry.source_component === 'invoice_tax')
  const consultationTax = ledger.entries.find(entry => entry.source_type === 'consultation' && entry.source_component === 'invoice_tax')

  expect(surgery.invoiceTaxAmount).toBe(100)
  expect(consultation.invoiceTaxAmount).toBe(10)
  expect(surgery.costSettlements.hospital_cost.status).toBe('pendente')
  expect(surgery.costSettlements.invoice_tax.status).toBe('pendente')
  expect(consultation.costSettlements.invoice_tax.status).toBe('pendente')
  expect(surgeryTax).toMatchObject({ account_nature:'revenue_deduction', total_amount:100, status:'pending' })
  expect(consultationTax).toMatchObject({ account_nature:'revenue_deduction', total_amount:10, status:'pending' })
  expect(metrics.grossRevenue).toBe(1200)
  expect(metrics.revenueDeductions).toBe(110)
  expect(metrics.netRevenue).toBe(1090)
  expect(metrics.surgeryCostTotal).toBe(150)
  expect(metrics.cashIn).toBe(200)
  expect(metrics.payablesOpenTotal).toBe(260)
  expect(checkLedgerInvariants(ledger)).toEqual([])
  expect(reconcileLedger(data).sources.every(row => row.diff === 0)).toBe(true)
})

