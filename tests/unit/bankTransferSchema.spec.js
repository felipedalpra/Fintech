import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('schema de transferência exige duas linhas, duas contas e RPC protegida', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/bank_internal_transfers_schema.sql'), 'utf8')
  expect(sql).toContain('create table if not exists public.bank_internal_transfers')
  expect(sql).toContain('source_line_id uuid not null')
  expect(sql).toContain('destination_line_id uuid not null')
  expect(sql).toContain('create or replace function public.confirm_bank_internal_transfer')
  expect(sql).toContain('public.bank_reconciliation_can_manage()')
  expect(sql).toContain('review_status = \'ignored\'')
})
