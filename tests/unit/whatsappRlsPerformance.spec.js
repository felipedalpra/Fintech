import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const root = process.cwd()
const migration = readFileSync(join(root, 'supabase/whatsapp_rls_performance.sql'), 'utf8')
const canonical = readFileSync(join(root, 'supabase/whatsapp_ownership_schema.sql'), 'utf8')

for (const [name, sql] of [['migration', migration], ['canonical schema', canonical]]) {
  test(`${name} avalia identidade e escopo uma vez por statement`, () => {
    expect(sql).toContain('(select public.data_owner_id())')
    expect(sql).toContain('(select public.is_clinic_admin())')
    expect(sql).toContain('(select auth.uid())')
    expect(sql).not.toMatch(/user_id\s*=\s*public\.data_owner_id\(\)/)
    expect(sql).not.toMatch(/assigned_user_id\s*=\s*auth\.uid\(\)/)
  })
}

test('migration de performance não contém operação destrutiva sobre dados', () => {
  expect(migration).not.toMatch(/\b(delete\s+from|truncate|drop\s+table|alter\s+table)\b/i)
  expect(migration).toContain('begin;')
  expect(migration).toContain('commit;')
})

test('migration habilita as tabelas assinadas no Realtime de forma idempotente', () => {
  expect(migration).toContain("array['whatsapp_messages', 'whatsapp_numbers']")
  expect(migration).toContain('alter publication supabase_realtime add table')
  expect(migration).toContain('when duplicate_object then null')
  expect(migration).toContain('when undefined_object then null')
})
