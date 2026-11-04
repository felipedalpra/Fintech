import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const sql = readFileSync(join(process.cwd(), 'supabase/financial_import_batch_discard.sql'), 'utf8')

test('descartar nunca apaga: arquiva lote e linhas e registra auditoria', () => {
  expect(sql).toContain('create or replace function public.discard_financial_import_batch')
  expect(sql).toContain('update public.financial_import_lines')
  expect(sql).toContain('update public.financial_import_batches')
  expect(sql).toContain("set status = 'archived'")
  expect(sql).toContain("'discard_financial_import_batch', 'financial_import_batch'")
  expect(sql).not.toMatch(/\bdelete\s+from\b/i)
  expect(sql).not.toMatch(/\btruncate\b/i)
})

test('o guard de lote sem lançamento é avaliado ANTES de arquivar', () => {
  const guard = sql.indexOf('if v_approved > 0 then')
  const firstWrite = sql.indexOf('update public.financial_import_lines')
  expect(guard).toBeGreaterThan(0)
  expect(guard).toBeLessThan(firstWrite)
  expect(sql).toContain("review_status = 'approved'")
  expect(sql).toContain("using errcode = '55000'")
})

test('escopo e papel financeiro são exigidos pelo banco', () => {
  expect(sql).toContain('public.data_owner_id()')
  expect(sql).toContain('public.finance_role_can_manage()')
  expect(sql).toContain("raise exception 'Acesso financeiro nao autorizado.'")
  expect(sql).toContain('for update')
})

test('repetir o descarte é inofensivo e um lote cancelado não é descartável', () => {
  expect(sql).toContain("if v_batch.status = 'archived' then")
  expect(sql).toContain("'already_discarded', true")
  expect(sql).toContain("if v_batch.status = 'canceled' then")
})

test('a RPC fica fechada para anon e aberta só para autenticado', () => {
  expect(sql).toContain('revoke all on function public.discard_financial_import_batch(uuid, text) from public, anon;')
  expect(sql).toContain('grant execute on function public.discard_financial_import_batch(uuid, text) to authenticated;')
  expect(sql).toContain('begin;')
  expect(sql).toContain('commit;')
})
