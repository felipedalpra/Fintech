import { expect, test } from '@playwright/test'
import { isBankReconciliationSchemaMissing } from '../../src/lib/supabaseErrorMessage.js'

// Em produção (31/10/2026) a tela respondeu "Migração necessária" — com uma
// lista de migrations para rodar, todas já aplicadas — quando o banco na
// verdade recusou a reserva de uma linha por um motivo de negócio. A heurística
// bastava a mensagem CITAR o nome da função. O conselho era errado E escondia a
// causa real.

test('erro de negócio que cita o nome da função NÃO é schema faltando', () => {
  expect(isBankReconciliationSchemaMissing({
    code:'40001',
    message:'Uma ou mais linhas já foram reservadas ou conciliadas. Atualize a conciliação.',
  })).toBe(false)

  // Mesmo quando o nome da função aparece no texto (PostgREST costuma incluir).
  expect(isBankReconciliationSchemaMissing({
    code:'23505',
    message:'claim_bank_statement_lines_for_creation: Existe outra movimentação com a mesma data, valor e descrição.',
  })).toBe(false)
})

test('ausência de verdade continua sendo detectada', () => {
  expect(isBankReconciliationSchemaMissing({ code:'42P01', message:'relation does not exist' })).toBe(true)
  expect(isBankReconciliationSchemaMissing({ code:'PGRST202', message:'' })).toBe(true)
  expect(isBankReconciliationSchemaMissing({
    code:'PGRST204',
    message:"Could not find the 'movement_fingerprint' column of 'bank_statement_lines' in the schema cache",
  })).toBe(true)
  // Sem código, mas com palavra de ausência e nome do schema.
  expect(isBankReconciliationSchemaMissing({
    message:'column bank_statement_lines.review_claim_token does not exist',
  })).toBe(true)
})

test('ausência em outro módulo não vira migração da conciliação', () => {
  expect(isBankReconciliationSchemaMissing({
    message:'column patients.cpf does not exist',
  })).toBe(false)
})

test('details e hint também são considerados', () => {
  expect(isBankReconciliationSchemaMissing({
    message:'erro',
    details:"Could not find the 'review_status' column of 'bank_statement_lines' in the schema cache",
  })).toBe(true)
})

test('erro nulo ou vazio não vira migração necessária', () => {
  expect(isBankReconciliationSchemaMissing(null)).toBe(false)
  expect(isBankReconciliationSchemaMissing({})).toBe(false)
})

// ---------------------------------------------------------------------------
// Tabela nova não pode derrubar o Financeiro antes da migration rodar
// ---------------------------------------------------------------------------
// `finance_indicator_inputs` passou a ser lida e gravada pelo financeStore. Num
// banco onde a migration ainda não rodou, a tabela não existe. Sem tolerância,
// a leitura lança (a tela não carrega) e a gravação falha DEPOIS das 11 tabelas
// gravarem — reproduzindo o alarme de "gravação parcial" de 31/10/2026.

test('tabela de indicadores ausente é tolerada, não derruba o Financeiro', async () => {
  const { isIndicatorInputsSchemaMissing } = await import('../../src/lib/supabaseErrorMessage.js')
  expect(isIndicatorInputsSchemaMissing({ code:'42P01' })).toBe(true)
  expect(isIndicatorInputsSchemaMissing({ code:'PGRST205' })).toBe(true)
  expect(isIndicatorInputsSchemaMissing({
    message:"Could not find the table 'public.finance_indicator_inputs' in the schema cache",
  })).toBe(true)
})

test('erro real de gravação NÃO é confundido com tabela ausente', async () => {
  const { isIndicatorInputsSchemaMissing } = await import('../../src/lib/supabaseErrorMessage.js')
  // Uma recusa de RLS precisa estourar: silenciá-la faria o usuário acreditar
  // que os indicadores salvaram quando não salvaram.
  expect(isIndicatorInputsSchemaMissing({
    code:'42501',
    message:'new row violates row-level security policy for table "finance_indicator_inputs"',
  })).toBe(false)
  expect(isIndicatorInputsSchemaMissing({ code:'23514', message:'check constraint' })).toBe(false)
  expect(isIndicatorInputsSchemaMissing(null)).toBe(false)
})
