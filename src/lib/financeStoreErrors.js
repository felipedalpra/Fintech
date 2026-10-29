// Classificação PURA dos erros da camada de persistência financeira (sem dependência de rede),
// para ser testável e para que nenhuma falha de gravação/leitura possa ser confundida com
// "não tem dado". Regra de fidedignidade: dado errado é pior que dado nenhum, e dataset vazio
// por erro engolido é a forma mais perigosa de dado errado.

const MISSING_RELATION_CODES = new Set([
  '42P01',    // Postgres: relation does not exist
  'PGRST205', // PostgREST: tabela não encontrada no schema cache
])

const SCHEMA_CACHE_CODES = new Set([
  'PGRST204', // PostgREST: coluna não encontrada no schema cache
])

function errorCode(error) {
  return String(error?.code || '')
}

function errorMessage(error) {
  return String(error?.message || '').toLowerCase()
}

// A tabela não existe neste banco. É uma ausência estrutural legítima (deploy híbrido: o
// armazenamento legado pode simplesmente não ter sido criado), e NÃO uma falha de leitura.
export function isMissingRelationError(error) {
  if (!error) return false
  if (MISSING_RELATION_CODES.has(errorCode(error))) return true
  const message = errorMessage(error)
  return message.includes('does not exist') || message.includes('could not find the table')
}

// O audit é secundário: se a tabela não existe ou está fora do schema cache, seguir sem registro
// é aceitável. Qualquer OUTRO erro (violação de RLS, permissão, rede) é defeito de configuração e
// precisa ficar visível.
//
// ATENÇÃO: não voltar a testar por substring da mensagem. O Postgres cita a própria tabela no
// erro de RLS ('... for table "audit_logs"'), então um teste por substring engole exatamente o
// erro que precisava aparecer. Foi assim que o audit trail ficou morto sem ninguém notar.
export function isIgnorableAuditLogError(error) {
  if (!error) return true
  if (isMissingRelationError(error)) return true
  if (SCHEMA_CACHE_CODES.has(errorCode(error))) return true
  return errorMessage(error).includes('schema cache')
}

// As tabelas são gravadas em paralelo: quando uma falha, as outras já estão em voo e podem ter
// gravado. O erro precisa nomear o que falhou e avisar que a gravação pode ter ficado PARCIAL,
// em vez de estourar com a primeira mensagem e esconder o resto.
export function aggregateTableSyncFailures(tables = [], results = []) {
  const failures = results
    .map((result, index) => ({ table:tables[index], result }))
    .filter(item => item.result?.status === 'rejected')

  if (failures.length === 0) return null

  const failedTables = failures.map(item => item.table)
  const reasons = failures
    .map(item => String(item.result?.reason?.message || '').trim())
    .filter(Boolean)
  const detail = reasons.length ? ` ${reasons[0]}` : ''
  const error = new Error(
    `Gravação falhou em ${failures.length} de ${results.length} tabela(s) (${failedTables.join(', ')}).${detail}`
    + ' As demais tabelas podem ter gravado, então os dados podem estar parcialmente salvos — não feche a tela e tente novamente.',
  )
  error.failedTables = failedTables
  return error
}
