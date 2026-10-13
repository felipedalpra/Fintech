import { expect, test } from '@playwright/test'
import {
  accountPath,
  buildAccountTree,
  canMoveAccount,
  findChartAccount,
  flattenDefaultChart,
  nextChildAccountCode,
  postingAccountOptions,
  postingGroupOptions,
} from '../../src/lib/chartOfAccounts.js'
import { buildLedger } from '../../src/lib/financialLedger.js'
import { buildMetrics } from '../../src/financialMetrics.js'

function stableIdFactory() {
  let next = 0
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
}

test('plano padrão tem códigos e chaves automáticas únicas', () => {
  const rows = flattenDefaultChart('owner-1', stableIdFactory())
  const codes = rows.map(row => row.code.toLowerCase())
  const systemKeys = rows.map(row => row.system_key).filter(Boolean)

  expect(rows.length).toBeGreaterThan(90)
  expect(new Set(codes).size).toBe(codes.length)
  expect(new Set(systemKeys).size).toBe(systemKeys.length)
  expect(rows.some(row => row.system_key === 'revenue_surgery_default')).toBe(true)
  expect(rows.some(row => row.system_key === 'expense_other')).toBe(true)
})

test('árvore, caminho e proteção contra ciclo preservam a hierarquia', () => {
  const accounts = [
    { id:'root', code:'1', name:'Raiz', nodeType:'group', parentId:null, sortOrder:10 },
    { id:'child', code:'1.01', name:'Grupo', nodeType:'group', parentId:'root', sortOrder:10 },
    { id:'leaf', code:'1.01.01', name:'Conta', nodeType:'account', parentId:'child', sortOrder:10 },
  ]

  expect(buildAccountTree(accounts)[0].children[0].children[0].id).toBe('leaf')
  expect(accountPath(accounts, 'leaf').map(item => item.name)).toEqual(['Raiz', 'Grupo', 'Conta'])
  expect(canMoveAccount(accounts, 'root', 'leaf')).toBe(false)
  expect(canMoveAccount(accounts, 'leaf', 'root')).toBe(true)
})

test('seletores aceitam só contas lançáveis compatíveis com a direção', () => {
  const accounts = [
    { id:'group', code:'4', name:'Receitas', nodeType:'group', nature:'revenue', isActive:true },
    { id:'revenue', code:'4.01', name:'Consultas', nodeType:'account', nature:'revenue', isActive:true },
    { id:'expense', code:'7.01', name:'Aluguel', nodeType:'account', nature:'operating_expense', isActive:true },
    { id:'inactive', code:'7.02', name:'Inativa', nodeType:'account', nature:'operating_expense', isActive:false },
  ]

  expect(postingAccountOptions(accounts, 'receivable').map(item => item.value)).toEqual(['revenue'])
  expect(postingAccountOptions(accounts, 'payable').map(item => item.value)).toEqual(['expense'])
})

test('criação rápida oferece grupos compatíveis e gera o próximo código livre', () => {
  const accounts = [
    { id:'revenue-root', code:'4', name:'Receitas', nodeType:'group', nature:'revenue', isActive:true },
    { id:'revenue-group', parentId:'revenue-root', code:'4.01', name:'Cirurgias', nodeType:'group', nature:'revenue', isActive:true },
    { id:'revenue-1', parentId:'revenue-group', code:'4.01.01', name:'Corporal', nodeType:'account', nature:'revenue', isActive:true },
    { id:'revenue-3', parentId:'revenue-group', code:'4.01.03', name:'Facial', nodeType:'account', nature:'revenue', isActive:true },
    { id:'expense-group', code:'7.01', name:'Pessoal', nodeType:'group', nature:'operating_expense', isActive:true },
    { id:'inactive-group', code:'7.02', name:'Inativo', nodeType:'group', nature:'operating_expense', isActive:false },
    { id:'unclassified-group', code:'11.01', name:'Receitas a classificar', nodeType:'group', nature:'unclassified', isActive:true },
  ]

  expect(postingGroupOptions(accounts, 'receivable').map(item => item.value)).toEqual(['revenue-root', 'revenue-group'])
  expect(postingGroupOptions(accounts, 'payable').map(item => item.value)).toEqual(['expense-group'])
  expect(nextChildAccountCode(accounts, 'revenue-group')).toBe('4.01.02')
  expect(nextChildAccountCode(accounts, 'missing')).toBe('')
})

test('razão usa ID e classificação do plano sem perder o nome da categoria', () => {
  const accounts = [
    { id:'revenue-other', code:'4.07.99', name:'Parcerias', nodeType:'account', nature:'revenue', dreSection:'gross_revenue', systemKey:'revenue_other', isActive:true },
    { id:'expense-rent', code:'7.02.01', name:'Aluguel da clínica', nodeType:'account', nature:'operating_expense', dreSection:'administrative', isActive:true },
    { id:'unclassified-expense', code:'10.02', name:'Pagamento a classificar', nodeType:'account', nature:'unclassified', dreSection:'unclassified', systemKey:'unclassified_expense', isActive:true },
  ]
  const ledger = buildLedger({
    chartAccounts:accounts,
    extraRevenues:[{ id:'r1', description:'Parceria', category:'legado', chartAccountId:'revenue-other', value:100, date:'2026-10-12', status:'recebido' }],
    expenses:[{ id:'e1', description:'Locação', category:'legado', chartAccountId:'expense-rent', value:50, dueDate:'2026-10-12', status:'aberto', costCenter:'Administrativo', originLabel:'Contrato' }],
  })

  const revenue = ledger.entries.find(entry => entry.source_id === 'r1')
  const expense = ledger.entries.find(entry => entry.source_id === 'e1')
  expect(revenue).toMatchObject({ chart_account_id:'revenue-other', category:'Parcerias', account_nature:'revenue', dre_section:'gross_revenue' })
  expect(expense).toMatchObject({ chart_account_id:'expense-rent', category:'Aluguel da clínica', cost_center:'Administrativo', origin_label:'Contrato' })
  expect(findChartAccount(accounts, { legacyCategory:'qualquer', direction:'payable' })?.id).toBe('unclassified-expense')
})

test('DRE respeita deduções, custos e resultado financeiro definidos no plano', () => {
  const account = (id, name, nature, dreSection, systemKey = '') => ({ id, code:id, name, nodeType:'account', nature, dreSection, systemKey, isActive:true })
  const chartAccounts = [
    account('revenue-surgery', 'Cirurgias', 'revenue', 'gross_revenue', 'revenue_surgery_default'),
    account('revenue-other', 'Outras receitas', 'revenue', 'gross_revenue', 'revenue_other'),
    account('deduction', 'ISS', 'revenue_deduction', 'revenue_deductions', 'deduction_invoice_tax'),
    account('hospital', 'Hospital', 'direct_cost', 'direct_costs', 'cost_surgery_hospital'),
    account('direct', 'Comissão', 'direct_cost', 'direct_costs'),
    account('operating', 'Aluguel', 'operating_expense', 'administrative'),
    account('fin-revenue', 'Rendimento', 'financial_revenue', 'financial_result'),
    account('fin-expense', 'Juros', 'financial_expense', 'financial_result'),
    account('income-tax', 'IRPJ', 'income_tax', 'income_taxes'),
    account('unclassified-expense', 'A classificar', 'unclassified', 'unclassified', 'unclassified_expense'),
  ]
  const expenses = [
    ['direct-expense', 'direct', 50], ['operating-expense', 'operating', 30],
    ['financial-expense', 'fin-expense', 10], ['tax-expense', 'income-tax', 5],
  ].map(([id, chartAccountId, value]) => ({ id, chartAccountId, description:id, value, dueDate:'2026-10-12', competenceDate:'2026-10-12', status:'aberto' }))
  const metrics = buildMetrics({
    chartAccounts,
    surgeries:[{ id:'s1', totalValue:1000, hospitalCost:100, invoiceIssuancePercent:10, date:'2026-10-12', competenceDate:'2026-10-12', paymentStatus:'pendente', patient:'Ana' }],
    extraRevenues:[{ id:'rf1', chartAccountId:'fin-revenue', description:'Aplicação', value:20, date:'2026-10-12', competenceDate:'2026-10-12', status:'recebido' }],
    expenses,
  }, { startDate:'2026-10-01', endDate:'2026-10-31', balanceDate:'2026-10-31' })

  expect(metrics).toMatchObject({
    grossRevenue:1000,
    revenueDeductions:100,
    netRevenue:900,
    surgeryCostTotal:100,
    additionalDirectCosts:50,
    operationalExpenses:30,
    operatingProfit:720,
    financialRevenue:20,
    financialExpenses:10,
    profitBeforeTax:730,
    taxExpenses:5,
    netProfit:725,
    totalExpenses:295,
  })
})

test('cirurgia herda a categoria configurada no procedimento', () => {
  const chartAccounts = [
    { id:'mama', code:'4.01.02', name:'Cirurgia de mama', nodeType:'account', nature:'revenue', dreSection:'gross_revenue', isActive:true },
    { id:'fallback', code:'4.01.99', name:'Outras cirurgias', nodeType:'account', nature:'revenue', dreSection:'gross_revenue', systemKey:'revenue_surgery_default', isActive:true },
  ]
  const ledger = buildLedger({
    chartAccounts,
    procedures:[{ id:'procedure-1', name:'Mamoplastia', chartAccountId:'mama' }],
    surgeries:[{ id:'surgery-1', procedureId:'procedure-1', totalValue:1000, date:'2026-10-12', paymentStatus:'pendente', patient:'Ana' }],
  })

  expect(ledger.entries[0]).toMatchObject({ chart_account_id:'mama', category:'Cirurgia de mama' })
})
