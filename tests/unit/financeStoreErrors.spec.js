import { expect, test } from '@playwright/test'
import {
  aggregateTableSyncFailures,
  isIgnorableAuditLogError,
  isMissingRelationError,
} from '../../src/lib/financeStoreErrors.js'

// ---------------------------------------------------------------------------
// isMissingRelationError: distingue "tabela não existe neste banco" (ausência
// legítima, tratável) de "a leitura falhou" (RLS, rede, permissão) — que NUNCA
// pode ser confundida com dataset vazio.
// ---------------------------------------------------------------------------
test('tabela inexistente (42P01) é ausência de relação', () => {
  expect(isMissingRelationError({ code:'42P01', message:'relation "public.user_finance_data" does not exist' })).toBe(true)
})

test('tabela fora do schema cache do PostgREST é ausência de relação', () => {
  expect(isMissingRelationError({ code:'PGRST205', message:"Could not find the table 'public.user_finance_data'" })).toBe(true)
})

test('violação de RLS NÃO é ausência de relação', () => {
  expect(isMissingRelationError({ code:'42501', message:'new row violates row-level security policy for table "expenses"' })).toBe(false)
})

test('falha de rede NÃO é ausência de relação', () => {
  expect(isMissingRelationError({ message:'Failed to fetch' })).toBe(false)
  expect(isMissingRelationError(null)).toBe(false)
})

// ---------------------------------------------------------------------------
// isIgnorableAuditLogError: o audit é secundário e pode faltar no banco, mas
// uma violação de RLS é um defeito de configuração e precisa ficar VISÍVEL.
// Regressão real: a mensagem do Postgres cita a própria tabela ("... for table
// \"audit_logs\""), então um teste por substring engolia justamente o erro que
// precisava aparecer — e o audit trail ficou morto sem ninguém notar.
// ---------------------------------------------------------------------------
test('audit ausente no banco é ignorável', () => {
  expect(isIgnorableAuditLogError({ code:'42P01', message:'relation "public.audit_logs" does not exist' })).toBe(true)
})

test('audit fora do schema cache é ignorável', () => {
  expect(isIgnorableAuditLogError({ code:'PGRST204', message:'schema cache' })).toBe(true)
})

test('violação de RLS no audit NÃO é ignorável, mesmo citando audit_logs', () => {
  expect(isIgnorableAuditLogError({
    code:'42501',
    message:'new row violates row-level security policy for table "audit_logs"',
  })).toBe(false)
})

test('erro desconhecido no audit NÃO é ignorável', () => {
  expect(isIgnorableAuditLogError({ message:'Failed to fetch' })).toBe(false)
})

// ---------------------------------------------------------------------------
// aggregateTableSyncFailures: a gravação dispara todas as tabelas em paralelo,
// então uma falha não impede as outras de gravarem. O erro precisa nomear o que
// falhou E avisar que a gravação pode ter ficado parcial.
// ---------------------------------------------------------------------------
const ok = value => ({ status:'fulfilled', value })
const fail = message => ({ status:'rejected', reason:new Error(message) })

test('todas as tabelas gravaram → sem erro', () => {
  expect(aggregateTableSyncFailures(['expenses', 'goals'], [ok(), ok()])).toBeNull()
})

test('uma tabela falhou → erro nomeia a tabela', () => {
  const error = aggregateTableSyncFailures(['expenses', 'goals'], [fail('coluna ausente'), ok()])
  expect(error).toBeInstanceOf(Error)
  expect(error.failedTables).toEqual(['expenses'])
  expect(error.message).toContain('expenses')
  expect(error.message).toContain('coluna ausente')
})

test('várias tabelas falharam → erro nomeia todas e avisa gravação parcial', () => {
  const error = aggregateTableSyncFailures(
    ['expenses', 'goals', 'assets'],
    [fail('coluna ausente'), ok(), fail('RLS')],
  )
  expect(error.failedTables).toEqual(['expenses', 'assets'])
  expect(error.message).toContain('expenses')
  expect(error.message).toContain('assets')
  expect(error.message.toLowerCase()).toContain('parcial')
})

test('erro sem mensagem não quebra a agregação', () => {
  const error = aggregateTableSyncFailures(['expenses'], [{ status:'rejected', reason:null }])
  expect(error).toBeInstanceOf(Error)
  expect(error.failedTables).toEqual(['expenses'])
})
