import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const canonical = readFileSync(join(root, 'supabase', 'clinical_intake_consents_schema.sql'), 'utf8')
const hotfix = readFileSync(join(root, 'supabase', 'clinical_intake_pgcrypto_search_path.sql'), 'utf8')

const cryptoFunctions = [
  'create_clinical_consent_template',
  'create_clinical_intake_request',
  'get_public_clinical_intake',
  'submit_public_clinical_intake',
]

function functionDefinition(sql, name) {
  const match = sql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\n\\$\\$;`, 'i'))
  expect(match, `definicao de ${name}`).toBeTruthy()
  return match[0]
}

test('RPCs criptograficas incluem o schema extensions no search_path canonico', () => {
  for (const name of cryptoFunctions) {
    expect(functionDefinition(canonical, name)).toContain('set search_path = public, extensions, pg_temp')
  }
})

test('hotfix corrige todas as RPCs sem reescrever dados clinicos', () => {
  for (const name of cryptoFunctions) {
    expect(hotfix).toMatch(new RegExp(`alter function public\\.${name}[\\s\\S]*?set search_path = public, extensions, pg_temp;`, 'i'))
  }
  expect(hotfix).not.toMatch(/\b(delete|truncate|drop\s+table|update|insert)\b/i)
})
