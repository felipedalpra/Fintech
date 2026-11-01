import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const root = process.cwd()

test('campos manuais dos indicadores têm leitura, escrita confirmada e schema com RLS', () => {
  const store = readFileSync(join(root, 'src/lib/financeStore.js'), 'utf8')
  const sql = readFileSync(join(root, 'supabase/finance_indicator_inputs_schema.sql'), 'utf8')

  expect(store).toContain("from('finance_indicator_inputs')")
  expect(store).toContain('indicator_inputs_by_period')
  expect(store).toContain("select('user_id')")
  expect(sql).toContain('create table if not exists public.finance_indicator_inputs')
  expect(sql).toContain('enable row level security')
  expect(sql).toContain('public.finance_role_can_manage()')
})

test('importação financeira falha fechada quando a revisão não pode persistir', () => {
  const component = readFileSync(join(root, 'src/components/FinancialImport.jsx'), 'utf8')
  const missingSchemaBranch = component.match(/if \(existing\.schemaMissing\) \{([\s\S]*?)\n    \}/)?.[1] || ''
  const createMissingBranch = component.match(/if \(created\.schemaMissing\) \{([\s\S]*?)\n    \}/)?.[1] || ''

  expect(missingSchemaBranch).toContain('throw new Error')
  expect(createMissingBranch).toContain('throw new Error')
  expect(missingSchemaBranch).not.toContain('resetReview')
  expect(createMissingBranch).not.toContain('resetReview')
  expect(component).toContain('financial-import-persistence-blocked')
})
