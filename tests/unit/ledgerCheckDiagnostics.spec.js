import { expect, test } from '@playwright/test'
import { buildLedgerConsumerComparison } from '../../src/lib/ledgerCheckDiagnostics.js'

const account = (id, name, nature, systemKey = '') => ({
  id, name, code:id, nodeType:'account', nature, systemKey, isActive:true,
})

test('conferência separa receita financeira da receita bruta operacional', () => {
  const data = {
    chartAccounts:[
      account('operating', 'Outras receitas operacionais', 'revenue', 'revenue_other'),
      account('financial', 'Rendimentos de aplicação', 'financial_revenue'),
    ],
    extraRevenues:[
      { id:'operating-entry', description:'Serviço adicional', chartAccountId:'operating', value:1000, date:'2026-11-10', competenceDate:'2026-11-10', status:'recebido' },
      { id:'financial-entry', description:'Rendimento bancário', chartAccountId:'financial', value:576.28, date:'2026-11-10', competenceDate:'2026-11-10', status:'recebido' },
    ],
  }

  const comparison = buildLedgerConsumerComparison(data, '2026-11-11')

  expect(comparison.metrics.grossRevenue).toBe(1000)
  expect(comparison.operatingGrossRevenue).toBe(1000)
  expect(comparison.metrics.financialRevenue).toBe(576.28)
  expect(comparison.financialRevenue).toBe(576.28)
  expect(comparison.totalRevenueInLedger).toBe(1576.28)
  expect(comparison.financialRevenueDetails).toEqual([expect.objectContaining({
    description:'Rendimento bancário',
    account:'Rendimentos de aplicação',
    value:576.28,
  })])
})

test('sem plano de contas todas as receitas continuam operacionais', () => {
  const data = {
    extraRevenues:[{ id:'legacy-entry', description:'Receita legada', value:250, date:'2026-11-10', status:'recebido' }],
  }

  const comparison = buildLedgerConsumerComparison(data, '2026-11-11')

  expect(comparison.operatingGrossRevenue).toBe(250)
  expect(comparison.financialRevenue).toBe(0)
  expect(comparison.financialRevenueDetails).toEqual([])
})

