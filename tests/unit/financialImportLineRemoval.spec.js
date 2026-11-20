import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const sql = readFileSync(join(process.cwd(), 'supabase/financial_import_line_removal.sql'), 'utf8')

test('remoção individual é lógica e preserva a auditoria', () => {
  expect(sql).toContain('create or replace function public.archive_financial_import_source')
  for (const table of ['financial_installments', 'financial_entries', 'extra_revenues', 'expenses', 'financial_import_lines']) {
    expect(sql).toContain(`update public.${table}`)
  }
  expect(sql).toContain('insert into public.audit_logs')
  expect(sql).toContain("'archive_financial_import_source', 'financial_import_line'")
  expect(sql).not.toMatch(/\bdelete\s+from\b/i)
  expect(sql).not.toMatch(/\btruncate\b/i)
  expect(sql).not.toMatch(/\bdrop\s+table\b/i)
})

test('o banco exige escopo, papel financeiro e motivo', () => {
  expect(sql).toContain('public.data_owner_id()')
  expect(sql).toContain('public.finance_role_can_manage()')
  expect(sql).toContain("length(v_reason) < 3 or length(v_reason) > 500")
  expect(sql).toContain("line.source_id = p_source_id")
  expect(sql).toContain("line.review_status = 'approved'")
  expect(sql).toContain('line.archived_at is null')
})

test('todos os bloqueios são avaliados antes do primeiro arquivamento', () => {
  const explicitArchive = sql.indexOf("set_config('app.explicit_financial_import_archive', 'on', true)")
  const firstWrite = sql.indexOf('update public.financial_installments')
  expect(explicitArchive).toBeGreaterThan(0)
  expect(firstWrite).toBeGreaterThan(explicitArchive)
  for (const guard of ['if v_reconciliations > 0 then', 'if v_charges > 0 then', 'v_fiscal := public.financial_import_fiscal_block_count']) {
    expect(sql.indexOf(guard)).toBeGreaterThan(0)
    expect(sql.indexOf(guard)).toBeLessThan(explicitArchive)
  }
  expect(sql).toContain("document.status not in ('canceled', 'replaced')")
})

test('a remoção confirmada retorna a origem arquivada e o histórico ignora linhas arquivadas nos totais', () => {
  expect(sql).toContain("'source_id', p_source_id")
  expect(sql).toContain("'status', 'archived'")
  expect(sql).toContain('line.archived_at is null')
  expect(sql).toContain('public.list_financial_import_history(integer)')
})

test('a RPC fica fechada para anon e aberta só para autenticado', () => {
  for (const fn of ['archive_financial_import_source(uuid, text)', 'list_financial_import_history(integer)']) {
    expect(sql).toContain(`revoke all on function public.${fn} from public, anon;`)
    expect(sql).toContain(`grant execute on function public.${fn} to authenticated;`)
  }
})

test('a migration é transacional', () => {
  expect(sql).toContain('begin;')
  expect(sql).toContain('commit;')
})
