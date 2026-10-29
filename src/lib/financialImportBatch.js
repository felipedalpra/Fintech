// Lógica PURA do lote de importação financeira retroativa (sem rede, para ser testável).
//
// Spec: docs/superpowers/plans/2026-10-29-financial-import-review-persistence.md
//
// FIDEDIGNIDADE: nada aqui produz valor financeiro. O lote e suas linhas ficam inteiramente ANTES
// da fonte canônica (extra_revenues/expenses) — revisar, editar e rejeitar não tocam DRE, fluxo,
// contas, metas nem dashboard. Só a aprovação cria origem, e ela continua indo pelo saveDataNow.

import { statementMovementFingerprint } from './statementParser.js'

const DECISIONS = new Set(['reject', 'reopen', 'edit', 'approve'])

function metadataOf(line) {
  return line?.sourceMetadata || line?.source_metadata || {}
}

function datesOf(lines) {
  return (lines || []).map(line => line?.postedDate || line?.posted_date).filter(Boolean).sort()
}

// Cabeçalho do lote. `imported_by` é quem SUBIU o arquivo (auth.uid()), não o dono da clínica:
// gravar o dono como autor perderia a autoria real, e a policy de INSERT exige o ator verdadeiro.
export function buildBatchRecord({ ownerId, actorId, parsed }) {
  const lines = parsed?.lines || []
  const dates = datesOf(lines)
  return {
    user_id:ownerId,
    imported_by:actorId,
    file_name:parsed?.fileName || 'planilha.xlsx',
    file_hash:parsed?.fileHash || '',
    // String vazia, nunca NULL: o índice único usa coalesce(sheet_name,'') e a busca compara
    // com '' — NULL não casaria com nenhum dos dois.
    sheet_name:parsed?.sheetName || '',
    column_mapping:parsed?.mapping || {},
    expected_line_count:lines.length,
    line_count:lines.length,
    status:'reviewing',
    period_start:dates[0] || null,
    period_end:dates[dates.length - 1] || null,
  }
}

// O `id` da linha é o UUID determinístico já calculado por financialImportUuid(fileHash:lineKey) —
// o MESMO id que a origem financeira recebe na aprovação. É o que mantém a criação idempotente e
// dá o vínculo linha↔lançamento sem tabela de ligação.
export function buildBatchLineRows({ ownerId, batchId, lines = [] }) {
  return lines.map(line => ({
    id:line.id,
    user_id:ownerId,
    batch_id:batchId,
    source_line_key:line.sourceLineKey || '',
    line_index:line.lineIndex,
    posted_date:line.postedDate,
    amount:line.amount,
    description:line.description || '',
    normalized_description:line.normalizedDescription || '',
    movement_fingerprint:line.movementFingerprint || statementMovementFingerprint(line),
    source_metadata:metadataOf(line),
    review_status:'pending',
    chart_account_id:metadataOf(line).chartAccountId || null,
    reviewed_by:null,
    reviewed_at:null,
  }))
}

// Reconstrói o estado da revisão a partir das linhas do banco, na forma camelCase que a tela e
// buildFinancialImportReview já consomem — para a retomada reaproveitar toda a lógica existente.
export function restoreReviewState(rows = []) {
  const active = rows.filter(row => !row.archived_at)
  return {
    lines:active.map(row => ({
      id:row.id,
      sourceLineKey:row.source_line_key,
      lineIndex:row.line_index,
      postedDate:row.posted_date,
      amount:Number(row.amount),
      description:row.description || '',
      normalizedDescription:row.normalized_description || '',
      movementFingerprint:row.movement_fingerprint,
      sourceMetadata:{
        ...(row.source_metadata || {}),
        ...(row.chart_account_id ? { chartAccountId:row.chart_account_id } : {}),
      },
    })),
    approvedIds:active.filter(row => row.review_status === 'approved').map(row => row.id),
    rejectedIds:active.filter(row => row.review_status === 'rejected').map(row => row.id),
  }
}

export function lineDecisionPatch({ decision, actorId, now = new Date().toISOString() }) {
  if (!DECISIONS.has(decision)) {
    throw new Error(`Decisão de revisão desconhecida: ${decision}`)
  }
  // Reabrir é a reversão: volta a pendente e APAGA a decisão anterior, para o histórico não
  // sugerir que alguém rejeitou uma linha que está ativa de novo.
  if (decision === 'reopen') {
    return { review_status:'pending', reviewed_by:null, reviewed_at:null }
  }
  if (decision === 'approve') {
    return { review_status:'approved', reviewed_by:actorId, reviewed_at:now }
  }
  return {
    review_status:decision === 'reject' ? 'rejected' : 'edited',
    reviewed_by:actorId,
    reviewed_at:now,
  }
}

// O que ainda falta aprovar. É a base da retomada: uma confirmação que morreu no lote 2 de 4
// retoma exatamente nos lotes restantes, porque o que já gravou está 'approved' no banco.
// `edited` continua pendente de aprovação — editar não aprova.
export function linesPendingApproval(rows = []) {
  return rows.filter(row => !row.archived_at
    && row.review_status !== 'approved'
    && row.review_status !== 'rejected')
}

export function batchProgress(rows = []) {
  const active = rows.filter(row => !row.archived_at)
  const count = status => active.filter(row => row.review_status === status).length
  const approved = count('approved')
  const rejected = count('rejected')
  return {
    total:active.length,
    pending:count('pending'),
    edited:count('edited'),
    rejected,
    approved,
    reviewed:approved + rejected,
    remaining:linesPendingApproval(active).length,
  }
}
