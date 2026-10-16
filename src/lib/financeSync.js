// Lógica PURA de reconciliação do financeiro (sem dependências de rede/supabase, para ser testável).
//
// Regra de ouro (fidedignidade — ver docs/superpowers/specs/2026-10-11-data-persistence-safety-review.md):
// a deleção é calculada contra o BASELINE do cliente (o que ele carregou/persistiu nesta sessão),
// NUNCA contra o estado atual do banco. Assim, nunca apagamos uma linha que o cliente não conhecia
// (ex.: lançamento criado por outro usuário da mesma clínica, ou estado defasado por cache).
//
// baselineIds: Set<string> | null  — ids que o cliente conhecia. null/undefined ⇒ não apaga nada.
// currentRows: array de linhas atuais (cada uma com .id).
export function computeIdsToDelete(baselineIds, currentRows) {
  if (!baselineIds) return []
  const currentIds = new Set((currentRows || []).map(r => r.id))
  return [...baselineIds].filter(id => !currentIds.has(id))
}

// READ-BACK (blindagem Fase 2): depois de gravar, confere que CADA linha enviada voltou
// confirmada pelo servidor. Devolve os ids que foram enviados mas NÃO voltaram (ex.: rejeitados
// por RLS, escopo errado) — se a lista não for vazia, a gravação não pode ser dada como sucesso.
export function missingRowIds(sentRows, savedRows) {
  // Normaliza (lowercase) dos dois lados: o Postgres devolve UUID em minúsculas; um id enviado em
  // caixa diferente não pode ser confundido com "não persistido".
  const norm = id => (id == null ? null : String(id).toLowerCase())
  const savedIds = new Set((savedRows || []).map(r => norm(r.id)))
  return (sentRows || []).filter(r => r.id != null && !savedIds.has(norm(r.id))).map(r => r.id)
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key])
      return result
    }, {})
  }
  return value
}

// Retorna somente linhas novas ou realmente alteradas. Sem baseline, mantém o comportamento
// conservador anterior e envia tudo. Com baseline, evita regravar centenas de lançamentos
// intactos a cada pequena edição, sem enfraquecer o read-back nem a proteção contra exclusões.
export function computeRowsToUpsert(baselineRows, currentRows) {
  if (!Array.isArray(baselineRows)) return currentRows || []
  const signature = row => JSON.stringify(stableValue(row))
  const baselineById = new Map(baselineRows.map(row => [String(row?.id || '').toLowerCase(), signature(row)]))
  return (currentRows || []).filter(row => baselineById.get(String(row?.id || '').toLowerCase()) !== signature(row))
}

// MERGE por id (importar do navegador, Fase 2): mantém tudo do `current` (servidor) e acrescenta
// só os itens de `incoming` cujo id ainda não existe. NUNCA remove nem sobrescreve o do servidor.
export function mergeById(current, incoming) {
  const ids = new Set((current || []).map(r => r?.id))
  const extra = (incoming || []).filter(r => r && r.id != null && !ids.has(r.id))
  return { merged: [...(current || []), ...extra], added: extra.length }
}
