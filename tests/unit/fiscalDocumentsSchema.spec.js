import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const sql = readFileSync(join(process.cwd(), 'supabase/fiscal_documents_schema.sql'), 'utf8')
const postgresSpec = readFileSync(join(process.cwd(), 'tests/postgres/fiscalDocuments.spec.sql'), 'utf8')

test.describe('schema de documentos fiscais', () => {
  test('é aditivo e vincula documentos ao título, não às parcelas', () => {
    expect(sql).toContain('create table if not exists public.fiscal_documents')
    expect(sql).toContain('create table if not exists public.fiscal_document_allocations')
    expect(sql).toContain('financial_entry_id uuid not null references public.financial_entries(id)')
    expect(sql).not.toMatch(/delete from public\.financial_/i)
  })

  test('impede alocação acima do valor do título e usa RLS da clínica', () => {
    expect(sql).toContain('v_existing + v_allocated > v_entry.total_amount + 0.01')
    expect(sql).toContain('user_id = (select public.data_owner_id())')
    expect(sql).toContain('for update;')
    expect(sql).toContain('if v_allocated > v_total then')
    expect(sql).toContain('(select public.finance_role_can_manage())')
    expect(sql).toContain('drop policy if exists "Fiscal documents clinic read"')
    expect(sql).toContain('drop policy if exists "Fiscal allocations clinic read"')
    expect(sql).toMatch(/auth\.uid\(\) is null or v_owner is null or not public\.finance_role_can_manage\(\)/)
  })

  test('expõe somente a RPC autenticada de criação atômica', () => {
    expect(sql).toContain('create or replace function public.create_fiscal_document_for_entry')
    expect(sql).toContain('security definer')
    expect(sql).toContain('grant execute on function public.create_fiscal_document_for_entry(uuid, jsonb) to authenticated')
    expect(sql).toContain('create or replace function public.set_fiscal_document_status')
    expect(sql).toContain('grant execute on function public.set_fiscal_document_status(uuid, text) to authenticated')
    expect(sql).toContain('for select to authenticated')
    expect(sql).not.toContain('for all to authenticated')
    expect(sql).toContain("v_document.status in ('canceled','replaced') and p_status <> v_document.status")
  })

  test('teste PostgreSQL cobre papel operacional, tenant, limite e reativação', () => {
    expect(postgresSpec).toContain("set request.jwt.claim.finance_manage = 'false'")
    expect(postgresSpec).toContain('Perfil operacional criou documento fiscal')
    expect(postgresSpec).toContain('Alocação maior que a nota foi aceita')
    expect(postgresSpec).toContain('Documento cancelado foi reativado')
    expect(postgresSpec).toContain('RLS expôs documentos de outra clínica')
    expect(postgresSpec.match(/\\ir \.\.\/\.\.\/supabase\/fiscal_documents_schema\.sql/g)).toHaveLength(2)
  })
})

