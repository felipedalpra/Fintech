import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const sql = readFileSync(join(process.cwd(), 'supabase/financial_import_atomic_approval.sql'), 'utf8')

test('migration aprova origem, razao, parcela e progresso numa unica RPC', () => {
  expect(sql).toContain('create or replace function public.approve_financial_import_lines')
  expect(sql).toContain('insert into public.extra_revenues')
  expect(sql).toContain('insert into public.expenses')
  expect(sql).toContain('insert into public.financial_entries')
  expect(sql).toContain('insert into public.financial_installments')
  expect(sql).toContain("set review_status = 'approved'")
  expect(sql).toContain("'approve_financial_import_lines'")
})

test('migration preserva dados e bloqueia arquivamento implicito de importacoes', () => {
  expect(sql).not.toMatch(/\bdelete\s+from\b/i)
  expect(sql).not.toMatch(/\btruncate\b/i)
  expect(sql).toContain('prevent_implicit_financial_import_archive')
  expect(sql).toContain("current_setting('app.explicit_financial_import_archive', true)")
  expect(sql).toContain('trg_financial_entries_protect_import_archive')
  expect(sql).toContain("line.review_status = 'approved'")
  expect(sql).toContain('trg_financial_import_lines_source_id')
  expect(sql).toContain('is_financial_import boolean not null default false')
  expect(sql).toContain('trg_extra_revenues_preserve_import_marker')
})

test('ids historicos aprovados sao preservados e novas linhas recebem source_id proprio', () => {
  expect(sql).toContain('then line.id')
  expect(sql).toContain('else gen_random_uuid()')
  expect(sql).toContain('alter column source_id set not null')
  expect(sql).toContain("if v_line.review_status = 'approved' then")
})
