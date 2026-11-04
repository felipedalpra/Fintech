// Helpers puros do histórico de importações financeiras.
//
// Espelham, no navegador, as MESMAS regras que o banco impõe em
// `cancel_financial_import_batch` (supabase/financial_import_batch_cancellation.sql). A tela só
// esconde um botão; a decisão real é do banco, que erra alto se a regra for violada. Manter as duas
// em pé evita o pior dos mundos: um botão habilitado que estoura, ou um bloqueio sem explicação.

// Retira do estado local as origens que o banco ACABOU de arquivar no cancelamento.
// Só mexe nas coleções que a importação cria (extraRevenues/expenses) — nenhuma outra.
export function removeCanceledImportSources(data, sourceIds = []) {
  const canceled = new Set(sourceIds.map(id => String(id || '').toLowerCase()).filter(Boolean))
  if (!canceled.size) return data
  const keep = row => !canceled.has(String(row?.id || '').toLowerCase())
  return {
    ...data,
    extraRevenues:(data?.extraRevenues || []).filter(keep),
    expenses:(data?.expenses || []).filter(keep),
  }
}

export function importHistoryStatus(batch) {
  if (batch?.status === 'canceled') return { label:'Cancelada', tone:'red' }
  if (batch?.status === 'archived') return { label:'Descartada', tone:'muted' }
  if (batch?.status === 'ready') return { label:'Concluída', tone:'green' }
  if (batch?.status === 'reviewing') return { label:'Em revisão', tone:'yellow' }
  return { label:'Incompleta', tone:'yellow' }
}

const COUNT = (batch, key) => Number(batch?.[key] || 0)

// Vínculos que IMPEDEM o cancelamento. Cada um é um registro vivo apontando para a parcela ou o
// título que o cancelamento arquivaria: arquivar por baixo deixaria o vínculo órfão (e, no caso do
// documento fiscal, uma nota emitida apontando para um lançamento que saiu do financeiro).
export function importCancelBlockers(batch) {
  const blockers = []
  const reconciliations = COUNT(batch, 'active_reconciliation_count')
  const charges = COUNT(batch, 'active_charge_count')
  const fiscal = COUNT(batch, 'active_fiscal_document_count')
  if (reconciliations > 0) blockers.push({ kind:'reconciliation', count:reconciliations, label:`${reconciliations} conciliação(ões) bancária(s)` })
  if (charges > 0) blockers.push({ kind:'charge', count:charges, label:`${charges} cobrança(s) ativa(s)` })
  if (fiscal > 0) blockers.push({ kind:'fiscal', count:fiscal, label:`${fiscal} documento(s) fiscal(is)` })
  return blockers
}

export function importCancelBlockedMessage(batch) {
  const blockers = importCancelBlockers(batch)
  if (!blockers.length) return ''
  return `Desvincule antes de cancelar: ${blockers.map(item => item.label).join(' · ')}.`
}

// Um lote só é cancelável se ESTÁ no financeiro (tem linha aprovada), ainda está em um status que o
// banco aceita cancelar, e nenhum vínculo vivo depende dele.
export function canCancelImport(batch) {
  return ['reviewing', 'ready'].includes(batch?.status)
    && COUNT(batch, 'approved_count') > 0
    && importCancelBlockers(batch).length === 0
}

// Descartar: só faz sentido para um lote que NUNCA entrou no financeiro. Com linha aprovada a ação
// correta é cancelar, que retira os lançamentos; descartar deixaria origens vivas sem lote
// cancelável. O banco impõe a mesma regra em discard_financial_import_batch.
export function canDiscardImport(batch) {
  return ['creating', 'reviewing', 'ready'].includes(batch?.status)
    && COUNT(batch, 'approved_count') === 0
}

// Retomar a revisão de um lote que ficou pela metade. Um lote cancelado/descartado nunca reabre, e
// um 'creating' pode estar sem todas as linhas (a tela recusa e oferece descarte).
export function canResumeImport(batch) {
  if (batch?.status !== 'reviewing') return false
  return COUNT(batch, 'pending_count') + COUNT(batch, 'rejected_count') + COUNT(batch, 'approved_count') > 0
}
