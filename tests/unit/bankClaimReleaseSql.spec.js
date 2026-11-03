import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migrationPath = join(root, 'supabase', 'bank_reconciliation_idempotent_claim_release.sql')
const canonicalPaths = [
  join(root, 'supabase', 'bank_reconciliation_schema.sql'),
  join(root, 'supabase', 'bank_reconciliation_xlsx_review_schema.sql'),
  join(root, 'supabase', 'bank_reconciliation_missing_claim_functions.sql'),
]

function releaseFunction(sql) {
  const match = sql.match(/create or replace function public\.release_bank_statement_line_claims[\s\S]*?\n\$\$;/i)
  expect(match, 'definicao de release_bank_statement_line_claims').toBeTruthy()
  return match[0]
}

test('hotfix torna a liberacao idempotente sem apagar dados ou relaxar protecoes', () => {
  const sql = readFileSync(migrationPath, 'utf8')
  const fn = releaseFunction(sql)

  expect(fn).toContain("l.user_id = owner_now")
  expect(fn).toContain("l.archived_at is null")
  expect(fn).toContain("l.review_status = 'processing'")
  expect(fn).toContain('l.review_claim_token = p_claim_token')
  expect(fn).toContain('l.reviewed_by = auth.uid()')
  expect(fn).toContain('not exists (')
  expect(fn).toContain('public.bank_reconciliations')
  expect(fn).toContain('public.financial_entries')
  expect(fn).toContain('public.extra_revenues')
  expect(fn).toContain('public.expenses')
  expect(fn).toContain('return expected_count;')
  expect(fn).not.toMatch(/raise exception 'A reserva mudou/i)
  expect(fn).not.toMatch(/for update/i)
  expect(sql).not.toMatch(/\b(delete|truncate|drop\s+table)\b/i)
})

test('definicoes canonicas preservam a mesma semantica idempotente', () => {
  for (const path of canonicalPaths) {
    const fn = releaseFunction(readFileSync(path, 'utf8'))
    expect(fn).toContain('return expected_count;')
    expect(fn).not.toMatch(/raise exception 'A reserva mudou/i)
    expect(fn).not.toMatch(/for update/i)
  }
})
