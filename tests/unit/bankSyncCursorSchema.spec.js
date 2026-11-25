import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('cursor de sincronização automática é por conta/provedor e retentável', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/bank_sync_cursors_schema.sql'), 'utf8')
  expect(sql).toContain('create table if not exists public.bank_sync_cursors')
  expect(sql).toContain('unique (user_id, financial_account_id, provider)')
  expect(sql).toContain("status in ('ready','syncing','error','paused')")
  expect(sql).toContain('consecutive_failures')
  expect(sql).toContain('public.data_owner_id()')
})
