import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const sql = readFileSync(join(process.cwd(), 'supabase/financial_import_batch_cancellation.sql'), 'utf8')

test('o cancelamento é lógico: arquiva parcela, título e origem sem apagar nada', () => {
  expect(sql).toContain('create or replace function public.cancel_financial_import_batch')
  expect(sql).toContain('update public.financial_installments')
  expect(sql).toContain('update public.financial_entries')
  expect(sql).toContain('update public.extra_revenues')
  expect(sql).toContain('update public.expenses')
  expect(sql).toMatch(/set archived_at = v_now/)
  // Prontuário/LGPD e a regra do projeto: nenhuma remoção física, nunca.
  expect(sql).not.toMatch(/\bdelete\s+from\b/i)
  expect(sql).not.toMatch(/\btruncate\b/i)
  expect(sql).not.toMatch(/\bdrop\s+table\b/i)
})

test('arquivar origem importada passa pela ação explícita e auditável', () => {
  // Sem este set_config o trigger prevent_implicit_financial_import_archive recusaria o UPDATE.
  expect(sql).toContain("set_config('app.explicit_financial_import_archive', 'on', true)")
  expect(sql).toContain("'cancel_financial_import_batch', 'financial_import_batch'")
  expect(sql).toContain('insert into public.audit_logs')
  expect(sql).toContain('cancellation_reason')
})

test('todo bloqueio é avaliado ANTES da primeira escrita', () => {
  const guard = sql.indexOf("set_config('app.explicit_financial_import_archive'")
  expect(guard).toBeGreaterThan(0)
  for (const check of ['if v_reconciliations > 0 then', 'if v_charges > 0 then', 'v_fiscal := public.financial_import_fiscal_block_count']) {
    expect(sql.indexOf(check)).toBeGreaterThan(0)
    expect(sql.indexOf(check)).toBeLessThan(guard)
  }
  // Persistência incompleta aborta antes de arquivar: um lote meio gravado não vira meio cancelado.
  expect(sql.indexOf('v_sources <> v_approved')).toBeLessThan(guard)
})

test('escopo, papel e motivo são exigidos pelo banco, não pela tela', () => {
  expect(sql).toContain('public.data_owner_id()')
  expect(sql).toContain('public.finance_role_can_manage()')
  expect(sql).toContain('length(v_reason) < 3 or length(v_reason) > 500')
  expect(sql).toContain("raise exception 'Acesso financeiro nao autorizado.'")
  expect(sql).toContain("status not in ('reviewing', 'ready')")
})

test('repetir o cancelamento devolve o mesmo resumo em vez de arquivar de novo', () => {
  expect(sql).toContain("if v_batch.status = 'canceled' then")
  expect(sql).toContain("'already_canceled', true")
})

test('cancelar libera o arquivo para nova importação', () => {
  expect(sql).toContain("where archived_at is null and status not in ('archived', 'canceled')")
  expect(sql).toContain("check (status in ('creating', 'reviewing', 'ready', 'canceled', 'archived'))")
})

test('o bloqueio fiscal não quebra bancos sem o schema fiscal e não aceita dono por parâmetro', () => {
  expect(sql).toContain("to_regclass('public.fiscal_document_allocations') is null")
  expect(sql).toContain('create or replace function public.financial_import_fiscal_block_count(\n  p_batch_id uuid\n)')
  expect(sql).toContain('v_owner uuid := public.data_owner_id()')
  expect(sql).toContain("document.status not in ('canceled', 'replaced')")
})

test('as RPCs ficam fechadas para anon e abertas só para autenticado', () => {
  for (const fn of ['cancel_financial_import_batch(uuid, text)', 'list_financial_import_history(integer)', 'financial_import_fiscal_block_count(uuid)']) {
    expect(sql).toContain(`revoke all on function public.${fn} from public, anon;`)
    expect(sql).toContain(`grant execute on function public.${fn} to authenticated;`)
  }
})

test('a migration é transacional', () => {
  expect(sql.trimStart().startsWith('--') || sql.includes('begin;')).toBe(true)
  expect(sql).toContain('begin;')
  expect(sql).toContain('commit;')
})
