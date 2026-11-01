// src/lib/supabaseErrorMessage.js
// Transforma um erro do Supabase/Postgres em mensagem que alguem consegue usar.
//
// Modulo proprio, sem importar o cliente do Supabase, para poder ser testado:
// `supabase.js` le `import.meta.env` e nao carrega nos testes unitarios.

// O Postgres devolve a parte util do erro em `details`/`hint`/`code`, e o
// `message` sozinho costuma ser generico demais para alguem agir. Sem isso, um
// "violates not-null constraint" chega a tela sem dizer QUAL coluna.
export function describeImportFailure(error) {
  if (!error) return new Error('A importação do extrato falhou sem detalhe do sistema.')
  const partes = [error.message, error.details, error.hint]
    .map(parte => String(parte || '').trim())
    .filter(Boolean)
  const vistos = []
  for (const parte of partes) if (!vistos.includes(parte)) vistos.push(parte)
  const codigo = String(error.code || '').trim()
  const texto = vistos.join(' · ') || 'Falha desconhecida ao gravar o extrato.'
  const detalhado = new Error(codigo ? `${texto} (código ${codigo})` : texto)
  detalhado.code = error.code
  detalhado.details = error.details
  detalhado.hint = error.hint
  detalhado.cause = error
  return detalhado
}

// Nomes de objetos do schema da conciliacao. Citar um deles NAO basta para
// concluir "falta migration": a mensagem precisa falar de AUSENCIA.
const SCHEMA_OBJECT_NAMES = [
  'bank_statement_', 'bank_reconciliation', 'review_status', 'review_claim_token',
  'movement_fingerprint', 'statement_metadata', 'verification_status',
  'institution_code', 'provider_transaction_id', 'create_financial_bank_account',
  'set_bank_statement_lines_review', 'claim_bank_statement_lines_for_creation',
  'release_bank_statement_line_claims', 'recover_bank_statement_line_claim',
]

// Codigos que, por si so, significam objeto ausente.
const MISSING_OBJECT_CODES = ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']

const ABSENCE_WORDING = /(does not exist|schema cache|could not find|undefined (table|column|function)|nao existe|não existe)/

// Decide se o erro significa "este banco esta sem parte do schema".
//
// A versao anterior bastava a mensagem CITAR o nome de uma coluna ou funcao.
// Resultado em producao (31/10/2026): o banco recusou a reserva de uma linha
// por um motivo de negocio, a mensagem mencionava o nome da funcao, e a tela
// respondeu "Migracao necessaria" com uma lista de migrations para rodar --
// todas ja aplicadas. O conselho era errado E escondia a causa real.
export function isBankReconciliationSchemaMissing(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (MISSING_OBJECT_CODES.includes(code)) return true
  const text = [error.message, error.details, error.hint]
    .map(parte => String(parte || '').toLowerCase())
    .join(' ')
  // Sem palavra de ausencia, nao e schema faltando -- e um erro de negocio.
  if (!ABSENCE_WORDING.test(text)) return false
  return SCHEMA_OBJECT_NAMES.some(nome => text.includes(nome))
}

// A tabela dos indicadores e NOVA. Enquanto a migration nao estiver aplicada em
// um banco, ela simplesmente nao existe -- e o Financeiro inteiro nao pode
// deixar de carregar nem de salvar por causa disso. O mesmo cuidado ja existe
// para `chart_accounts`.
//
// Sem esta tolerancia, publicar o cliente antes do SQL quebra a tela para todo
// mundo: a leitura lanca e o salvamento falha DEPOIS das 11 tabelas gravarem,
// reproduzindo o alarme de "gravacao parcial" que assustou a clinica em
// 31/10/2026.
export function isIndicatorInputsSchemaMissing(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST204'
    || (message.includes('finance_indicator_inputs') && message.includes('schema cache'))
}
