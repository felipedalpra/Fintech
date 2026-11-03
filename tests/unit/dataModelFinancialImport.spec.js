import { expect, test } from '@playwright/test'
import { normalizeData } from '../../src/dataModel.js'
import { mapExpensesRows, mapExtraRevenuesRows } from '../../src/lib/financeStoreRows.js'

const OWNER = '10000000-0000-4000-8000-000000000001'

test('marcador de importacao sobrevive normalizacao e serializacao de receita e despesa', () => {
  const normalized = normalizeData({
    extraRevenues:[{
      id:'20000000-0000-4000-8000-000000000001',
      description:'Receita importada', value:100, date:'2026-11-01',
      originLabel:'', isFinancialImport:true,
    }],
    expenses:[{
      id:'30000000-0000-4000-8000-000000000001',
      description:'Despesa importada', value:50, dueDate:'2026-11-01',
      originLabel:'', isFinancialImport:true,
    }],
  })

  expect(normalized.extraRevenues[0].isFinancialImport).toBe(true)
  expect(normalized.expenses[0].isFinancialImport).toBe(true)
  expect(mapExtraRevenuesRows(OWNER, normalized)[0].is_financial_import).toBe(true)
  expect(mapExpensesRows(OWNER, normalized)[0].is_financial_import).toBe(true)
})

