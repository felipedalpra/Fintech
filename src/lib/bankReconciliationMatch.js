import { normalizeStatementDescription } from './statementParser.js'

const DAY_MS = 86_400_000

function toCents(value) {
  return Math.round((Number(value) || 0) * 100)
}

function isoDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function daysBetween(left, right) {
  const a = isoDay(left)
  const b = isoDay(right)
  if (!a || !b) return Number.POSITIVE_INFINITY
  return Math.abs(Math.round((a.getTime() - b.getTime()) / DAY_MS))
}

function entryOf(installment) {
  return installment.financial_entry || installment.financial_entries || installment.entry || {}
}

export function installmentReferenceDate(installment) {
  const entry = entryOf(installment)
  return installment.settlement_date || installment.due_date || entry.issue_date || null
}

function tokens(value) {
  return new Set(normalizeStatementDescription(value).split(' ').filter(token => token.length > 1))
}

export function descriptionSimilarity(left, right) {
  const a = tokens(left)
  const b = tokens(right)
  if (!a.size || !b.size) return 0
  let intersection = 0
  a.forEach(token => { if (b.has(token)) intersection += 1 })
  return intersection / Math.max(a.size, b.size)
}

function candidateDescription(installment) {
  const entry = entryOf(installment)
  return [entry.description, entry.party_name_snapshot, entry.category, entry.origin_label].filter(Boolean).join(' ')
}

function lineDirection(line) {
  return Number(line.amount) > 0 ? 'receivable' : 'payable'
}

function candidateDirection(installment) {
  return entryOf(installment).direction
}

function activeCandidate(installment) {
  const entry = entryOf(installment)
  return !installment.archived_at && !entry.archived_at && !['canceled', 'refunded'].includes(installment.status) && !['canceled', 'refunded'].includes(entry.status)
}

function rankCandidate(line, installment, windowDays) {
  if (!activeCandidate(installment)) return null
  if (lineDirection(line) !== candidateDirection(installment)) return null
  const amountDifferenceCents = Math.abs(Math.abs(toCents(line.amount)) - Math.abs(toCents(installment.amount)))
  if (amountDifferenceCents > 1) return null
  const referenceDate = installmentReferenceDate(installment)
  const differenceDays = daysBetween(line.postedDate, referenceDate)
  if (!Number.isFinite(differenceDays) || differenceDays > windowDays) return null
  const similarity = descriptionSimilarity(line.normalizedDescription || line.description, candidateDescription(installment))
  const datePoints = Math.max(0, 30 - (differenceDays * 6))
  const descriptionPoints = Math.round(similarity * 15)
  const score = 55 + datePoints + descriptionPoints
  return {
    installment,
    installmentId:installment.id,
    score,
    differenceAmount:amountDifferenceCents / 100,
    differenceDays,
    descriptionSimilarity:similarity,
    reasons:[
      'valor exato',
      differenceDays === 0 ? 'mesma data' : `${differenceDays} dia(s) de diferença`,
      similarity > 0 ? `descrição ${Math.round(similarity * 100)}% semelhante` : 'descrição sem termos em comum',
    ],
  }
}

export function matchBankStatementLines(lines = [], installments = [], activeReconciliations = [], options = {}) {
  const windowDays = Math.min(7, Math.max(0, Number(options.windowDays ?? 3)))
  const minimumScore = Number(options.minimumScore ?? 70)
  const minimumMargin = Number(options.minimumMargin ?? 8)
  const reconciliationByLine = new Map()
  const usedInstallments = new Set()
  activeReconciliations.filter(item => !item.reversed_at).forEach(item => {
    reconciliationByLine.set(item.statement_line_id, item)
    usedInstallments.add(item.financial_installment_id)
  })

  const pending = []
  const resultByLine = new Map()
  ;[...lines].sort((a, b) => String(a.id || a.sourceLineKey).localeCompare(String(b.id || b.sourceLineKey))).forEach(line => {
    const lineId = line.id || line.sourceLineKey
    const reconciliation = reconciliationByLine.get(lineId)
    if (reconciliation) {
      resultByLine.set(lineId, { line, status:'reconciled', reconciliation, candidates:[] })
      return
    }
    const candidates = installments
      .filter(installment => !usedInstallments.has(installment.id))
      .map(installment => rankCandidate(line, installment, windowDays))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.differenceDays - b.differenceDays || String(a.installmentId).localeCompare(String(b.installmentId)))
    if (!candidates.length) {
      resultByLine.set(lineId, { line, status:'unmatched', candidates:[] })
      return
    }
    const margin = candidates[0].score - (candidates[1]?.score ?? 0)
    pending.push({ line, lineId, candidates, margin, eligible:candidates[0].score >= minimumScore && margin >= minimumMargin })
  })

  pending.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.candidates[0].score - a.candidates[0].score || b.margin - a.margin || a.lineId.localeCompare(b.lineId))
  pending.forEach(item => {
    const top = item.candidates[0]
    const canRecommend = item.eligible && !usedInstallments.has(top.installmentId)
    if (canRecommend) usedInstallments.add(top.installmentId)
    resultByLine.set(item.lineId, {
      line:item.line,
      status:'suggestion',
      candidates:item.candidates,
      recommendedCandidate:canRecommend ? top : null,
      ambiguous:!canRecommend,
      conflict: item.eligible && !canRecommend,
    })
  })

  return lines.map(line => resultByLine.get(line.id || line.sourceLineKey))
}

export function validateManualReconciliation(line, installment, options = {}) {
  const warnings = []
  const errors = []
  if (!activeCandidate(installment)) errors.push('A parcela está cancelada, estornada ou arquivada.')
  if (lineDirection(line) !== candidateDirection(installment)) errors.push('Créditos só podem ser vinculados a contas a receber e débitos a contas a pagar.')
  const differenceAmount = Math.abs(Math.abs(Number(line.amount) || 0) - Math.abs(Number(installment.amount) || 0))
  const differenceDays = daysBetween(line.postedDate, installmentReferenceDate(installment))
  if (differenceAmount > 0.01) warnings.push(`Valor divergente em R$ ${differenceAmount.toFixed(2).replace('.', ',')}.`)
  if (Number.isFinite(differenceDays) && differenceDays > Number(options.windowDays ?? 3)) warnings.push(`Data divergente em ${differenceDays} dia(s).`)
  if (!Number.isFinite(differenceDays)) warnings.push('A parcela não possui data de referência válida.')
  return { valid:errors.length === 0, requiresJustification:warnings.length > 0, errors, warnings, differenceAmount, differenceDays }
}
