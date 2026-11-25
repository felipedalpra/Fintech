import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('schema de conciliação agrupada valida soma, segurança e reversão', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/bank_reconciliation_groups_schema.sql'), 'utf8')
  expect(sql).toContain('create table if not exists public.bank_reconciliation_groups')
  expect(sql).toContain('create table if not exists public.bank_reconciliation_group_lines')
  expect(sql).toContain('create or replace function public.confirm_bank_reconciliation_group')
  expect(sql).toContain('create or replace function public.reverse_bank_reconciliation_group')
  expect(sql).toContain('sum(abs(l.amount))')
  expect(sql).toContain('public.bank_reconciliation_can_manage()')
})
