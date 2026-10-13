import { expect, test } from '@playwright/test'
import {
  buildDrePresentation,
  defaultExpandedDreKeys,
  flattenVisibleDreRows,
} from '../../src/lib/drePresentation.js'

const account = (id, parentId, code, name, nodeType, nature, dreSection, extra = {}) => ({
  id,
  parentId,
  code,
  name,
  nodeType,
  nature,
  dreSection,
  isActive:true,
  sortOrder:10,
  ...extra,
})

const chartAccounts = [
  account('assets', null, '1', 'Ativo', 'group', 'asset', 'balance'),
  account('cash', 'assets', '1.01', 'Caixa', 'account', 'asset', 'balance'),
  account('revenue-root', null, '4', 'Receita bruta', 'group', 'revenue', 'gross_revenue'),
  account('surgeries', 'revenue-root', '4.01', 'Cirurgias', 'group', 'revenue', 'gross_revenue'),
  account('surgery', 'surgeries', '4.01.01', 'Cirurgia corporal', 'account', 'revenue', 'gross_revenue'),
  account('custom-group', null, '4.90', 'Receitas personalizadas', 'group', 'revenue', 'gross_revenue'),
  account('custom-revenue', 'custom-group', '4.90.01', 'Programa premium', 'account', 'revenue', 'gross_revenue'),
  account('deductions', null, '5', 'Deduções da receita', 'group', 'revenue_deduction', 'revenue_deductions'),
  account('iss', 'deductions', '5.01', 'ISS', 'account', 'revenue_deduction', 'revenue_deductions'),
  account('costs', null, '6', 'Custos diretos e CMV', 'group', 'direct_cost', 'direct_costs'),
  account('hospital', 'costs', '6.01', 'Hospital', 'account', 'direct_cost', 'direct_costs'),
  account('expenses', null, '7', 'Despesas operacionais', 'group', 'operating_expense', 'administrative'),
  account('rent', 'expenses', '7.01', 'Aluguel', 'account', 'operating_expense', 'administrative'),
  account('inactive-expense', 'expenses', '7.02', 'Conta histórica', 'account', 'operating_expense', 'administrative', { isActive:false }),
  account('financial', null, '8', 'Resultado financeiro', 'group', 'unclassified', 'financial_result'),
  account('yield', 'financial', '8.01', 'Rendimentos', 'account', 'financial_revenue', 'financial_result'),
  account('interest', 'financial', '8.02', 'Juros', 'account', 'financial_expense', 'financial_result'),
  account('taxes', null, '9', 'Tributos sobre o lucro', 'group', 'income_tax', 'income_taxes'),
  account('irpj', 'taxes', '9.01', 'IRPJ', 'account', 'income_tax', 'income_taxes'),
]

const detail = (id, chartAccountId, value, direction, accountNature) => ({
  id,
  chartAccountId,
  value,
  direction,
  accountNature,
})

const metrics = {
  grossRevenue:1200,
  revenueDeductions:100,
  netRevenue:1100,
  surgeryCostTotal:200,
  consultationCostTotal:0,
  productCostOfSales:0,
  additionalDirectCosts:0,
  operationalExpenses:300,
  operatingProfit:600,
  financialRevenue:50,
  financialExpenses:20,
  profitBeforeTax:630,
  taxExpenses:30,
  netProfit:600,
  drilldowns:{
    grossRevenue:[
      detail('r1', 'surgery', 1000, 'receivable', 'revenue'),
      detail('r2', 'custom-revenue', 200, 'receivable', 'revenue'),
    ],
    revenueDeductions:[detail('d1', 'iss', 100, 'payable', 'revenue_deduction')],
    netRevenue:[],
    surgeryCostTotal:[detail('c1', 'hospital', 200, 'payable', 'direct_cost')],
    consultationCostTotal:[],
    productCostOfSales:[],
    additionalDirectCosts:[],
    operationalExpenses:[detail('e1', 'rent', 300, 'payable', 'operating_expense')],
    operatingProfit:[],
    financialRevenue:[detail('f1', 'yield', 50, 'receivable', 'financial_revenue')],
    financialExpenses:[detail('f2', 'interest', 20, 'payable', 'financial_expense')],
    profitBeforeTax:[],
    taxExpenses:[detail('t1', 'irpj', 30, 'payable', 'income_tax')],
    netProfit:[],
  },
}

test('DRE dinâmica segue grupos e contas editáveis e exclui contas patrimoniais', () => {
  const rows = buildDrePresentation(chartAccounts, metrics)
  const expanded = new Set(defaultExpandedDreKeys(rows))
  const firstLevel = flattenVisibleDreRows(rows, expanded)

  expect(firstLevel.map(row => row.label)).toContain('Receitas personalizadas')
  expect(firstLevel.map(row => row.label)).toContain('Cirurgias')
  expect(firstLevel.map(row => row.label)).not.toContain('Ativo')
  expect(firstLevel.map(row => row.label)).not.toContain('Caixa')

  expanded.add('account:custom-group')
  const expandedRows = flattenVisibleDreRows(rows, expanded)
  const customRevenue = expandedRows.find(row => row.accountId === 'custom-revenue')
  expect(customRevenue).toMatchObject({ label:'Programa premium', value:200, depth:2 })
  expect(customRevenue.details).toHaveLength(1)
})

test('DRE dinâmica mantém subtotais contábeis e resultado financeiro líquido', () => {
  const rows = buildDrePresentation(chartAccounts, metrics)
  const byKey = new Map(rows.map(row => [row.key, row]))

  expect(byKey.get('section:gross_revenue')?.value).toBe(1200)
  expect(byKey.get('subtotal:net_revenue')?.value).toBe(1100)
  expect(byKey.get('subtotal:gross_profit')?.value).toBe(900)
  expect(byKey.get('subtotal:operating_profit')?.value).toBe(600)
  expect(byKey.get('section:financial_result')?.value).toBe(30)
  expect(byKey.get('subtotal:profit_before_tax')?.value).toBe(630)
  expect(byKey.get('subtotal:net_profit')?.value).toBe(600)
})

test('conta inativa continua visível para preservar a leitura histórica', () => {
  const rows = buildDrePresentation(chartAccounts, metrics)
  const expanded = new Set(defaultExpandedDreKeys(rows))
  expanded.add('account:expenses')
  const visible = flattenVisibleDreRows(rows, expanded)

  expect(visible.find(row => row.accountId === 'inactive-expense')).toMatchObject({
    label:'Conta histórica',
    isActive:false,
    value:0,
  })
})
