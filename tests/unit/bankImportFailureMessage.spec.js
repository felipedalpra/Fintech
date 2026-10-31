import { expect, test } from '@playwright/test'
import { describeImportFailure } from '../../src/lib/supabaseErrorMessage.js'

// Contexto: ao importar o extrato do BRB em produção (31/10/2026) a tela
// mostrou "o.rpc(...).catch is not a function". Esse era o crash do ROLLBACK
// -- `supabase.rpc()` devolve um thenable sem `.catch` -- e ele substituía a
// mensagem do erro que de fato tinha derrubado a importação. O usuário via o
// tratamento de erro quebrado, nunca a causa.

test('o detalhe do Postgres chega junto, não só a mensagem genérica', () => {
  const erro = describeImportFailure({
    message:'null value in column "movement_fingerprint" violates not-null constraint',
    details:'Failing row contains (…).',
    hint:null,
    code:'23502',
  })
  expect(erro.message).toContain('movement_fingerprint')
  expect(erro.message).toContain('Failing row contains')
  expect(erro.message).toContain('código 23502')
  expect(erro.code).toBe('23502')
})

test('o erro original fica acessível como causa', () => {
  const original = { message:'falhou', code:'42703' }
  expect(describeImportFailure(original).cause).toBe(original)
})

test('campos repetidos não viram mensagem duplicada', () => {
  const erro = describeImportFailure({ message:'mesma coisa', details:'mesma coisa', code:'' })
  expect(erro.message).toBe('mesma coisa')
})

test('erro sem nenhum texto ainda produz mensagem utilizável', () => {
  expect(describeImportFailure({}).message).toContain('Falha desconhecida')
  expect(describeImportFailure(null).message).toContain('sem detalhe')
})
