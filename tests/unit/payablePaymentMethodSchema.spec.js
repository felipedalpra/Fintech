import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canonical = readFileSync(join(process.cwd(), 'supabase/erp_relational_schema.sql'), 'utf8')
const migration = readFileSync(join(process.cwd(), 'supabase/payable_payment_method.sql'), 'utf8')

test('contas a pagar possui forma de pagamento no schema canonico e na migration aditiva', () => {
  expect(canonical).toMatch(/create table if not exists public\.product_purchases[\s\S]*?payment_method text[\s\S]*?purchase_date date/i)
  expect(canonical).toMatch(/create table if not exists public\.expenses[\s\S]*?payment_date date[\s\S]*?payment_method text/i)
  expect(migration).toContain('alter table public.expenses')
  expect(migration).toContain('alter table public.product_purchases')
  expect(migration).toMatch(/add column if not exists payment_method text/gi)
})
