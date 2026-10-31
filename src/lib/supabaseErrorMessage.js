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
