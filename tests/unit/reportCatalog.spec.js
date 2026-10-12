import { expect, test } from '@playwright/test'
import XLSXStyle from 'xlsx-js-style'
import { buildAllReports, buildReport, getReportDefinitions } from '../../src/lib/reportCatalog.js'
import { createCompleteWorkbook, createReportWorkbook } from '../../src/lib/reportWorkbook.js'

const RANGE = { start:'2026-10-01', end:'2026-10-31' }

function baseData() {
  return {
    procedures:[{ id:'procedure-1', name:'Rinoplastia' }],
    surgeries:[], consultations:[], products:[], productSales:[], productPurchases:[],
    extraRevenues:[], expenses:[], assets:[], liabilities:[], goals:[],
  }
}

test('catálogo expõe relatórios únicos e todos podem ser construídos', () => {
  const definitions = getReportDefinitions()
  expect(definitions).toHaveLength(22)
  expect(new Set(definitions.map(item => item.id)).size).toBe(definitions.length)

  const reports = buildAllReports({ data:baseData(), patients:[], recurrences:[], range:RANGE })
  expect(reports).toHaveLength(definitions.length)
  expect(reports.every(item => Array.isArray(item.rows) && Array.isArray(item.columns))).toBeTruthy()
})

test('contas a receber exporta somente parcelas ainda abertas no vencimento selecionado', () => {
  const data = baseData()
  data.surgeries = [
    {
      id:'surgery-open', procedureId:'procedure-1', patient:'Ana', totalValue:1000,
      date:'2026-10-02', competenceDate:'2026-10-02', dueDate:'2026-10-20',
      paymentStatus:'pendente', paymentMethod:'pix',
    },
    {
      id:'surgery-paid', procedureId:'procedure-1', patient:'Beatriz', totalValue:2000,
      date:'2026-10-03', competenceDate:'2026-10-03', dueDate:'2026-10-10',
      paymentStatus:'pago', paymentDate:'2026-10-10', paymentMethod:'pix',
    },
  ]

  const report = buildReport('accounts-receivable', { data, range:RANGE })
  expect(report.rows).toHaveLength(1)
  expect(report.rows[0]).toMatchObject({ customer:'Ana', value:1000, dueDate:'2026-10-20' })
})

test('DRE usa competência e não a data de recebimento', () => {
  const data = baseData()
  data.surgeries = [{
    id:'surgery-1', procedureId:'procedure-1', patient:'Ana', totalValue:5000,
    date:'2026-09-20', competenceDate:'2026-10-01', dueDate:'2026-11-01',
    paymentStatus:'pendente', paymentMethod:'pix', hospitalCost:1000,
  }, {
    id:'surgery-cancelled', procedureId:'procedure-1', patient:'Cancelada', totalValue:9000,
    date:'2026-10-05', competenceDate:'2026-10-05', dueDate:'2026-10-05',
    paymentStatus:'cancelado', paymentMethod:'pix',
  }]
  data.consultations = [{
    id:'consultation-cancelled', patient:'Cancelada', value:1000,
    date:'2026-10-06', competenceDate:'2026-10-06', paymentStatus:'cancelado', paymentMethod:'pix',
  }]

  const report = buildReport('dre', { data, range:RANGE })
  expect(report.summary[0]).toEqual(['Receita bruta', 5000])
  expect(report.summary[1]).toEqual(['Resultado líquido', 4000])
})

test('posição de estoque respeita a data-base', () => {
  const data = baseData()
  data.products = [{ id:'product-1', name:'Cinta', category:'modelador', stock:5, purchasePrice:100, salePrice:200, active:true }]
  data.productPurchases = [
    { id:'purchase-before', productId:'product-1', quantity:3, totalValue:300, purchaseDate:'2026-10-05' },
    { id:'purchase-after', productId:'product-1', quantity:10, totalValue:1000, purchaseDate:'2026-11-05' },
  ]
  data.productSales = [{ id:'sale-1', productId:'product-1', quantity:2, totalValue:400, saleDate:'2026-10-10' }]

  const report = buildReport('stock-position', { data, range:RANGE })
  expect(report.rows[0]).toMatchObject({ stock:6, inventoryValue:600, potentialRevenue:1200 })
})

test('auditoria sinaliza ausência estrutural de liquidação em produtos', () => {
  const data = baseData()
  data.productSales = [{ id:'sale-1', productId:'product-1', patientName:'Ana', quantity:1, totalValue:200, saleDate:'2026-10-10' }]
  data.productPurchases = [{ id:'purchase-1', productId:'product-1', supplier:'Fornecedor', quantity:1, totalValue:100, purchaseDate:'2026-10-01' }]

  const report = buildReport('data-quality', { data, range:RANGE })
  expect(report.rows.filter(item => item.severity === 'Estrutural')).toHaveLength(2)
  expect(report.rows.map(item => item.issue)).toContain('Sem status/data de recebimento')
  expect(report.rows.map(item => item.issue)).toContain('Sem status/data de pagamento')
})

test('gera workbooks individuais e consolidados com auditoria', () => {
  const context = { data:baseData(), patients:[], recurrences:[], range:RANGE, generatedAt:'2026-10-12T12:00:00.000Z' }
  const report = buildReport('accounts-receivable', context)
  const individual = createReportWorkbook(report)
  expect(individual.SheetNames).toEqual(['Resumo', 'Contas a receber', 'Auditoria'])

  const complete = createCompleteWorkbook(buildAllReports(context), RANGE)
  expect(complete.SheetNames[0]).toBe('Índice')
  expect(complete.SheetNames.at(-1)).toBe('Auditoria')
  expect(new Set(complete.SheetNames).size).toBe(complete.SheetNames.length)
  const bytes = XLSXStyle.write(complete, { bookType:'xlsx', type:'buffer' })
  expect(bytes.length).toBeGreaterThan(10_000)
})

