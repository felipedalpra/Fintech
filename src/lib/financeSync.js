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
