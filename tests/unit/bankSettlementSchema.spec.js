import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('campos de conta usados pela baixa existem no schema e na migração', () => {
  const root = process.cwd()
  const schema = readFileSync(join(root, 'supabase/erp_relational_schema.sql'), 'utf8')
  const migration = readFileSync(join(root, 'supabase/bank_settlement_source_fields.sql'), 'utf8')
  for (const table of ['product_sales', 'product_purchases', 'extra_revenues', 'expenses']) {
    expect(schema).toContain(`create table if not exists public.${table}`)
    expect(migration).toContain(`public.${table}`)
  }
  expect(schema.match(/financial_account_id uuid/g)?.length).toBeGreaterThanOrEqual(4)
})
