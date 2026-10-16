import { buildLedger } from './financialLedger.js'
import { matchBankStatementLines } from './bankReconciliationMatch.js'
import { buildStatementImportReview } from './statementImportReview.js'

function hashHex(input) {
  let hash = 2166136261
  const text = String(input)
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function financialImportUuid(seed) {
  const raw = [hashHex(`${seed}:a`), hashHex(`${seed}:b`), hashHex(`${seed}:c`), hashHex(`${seed}:d`)].join('').slice(0, 32)
  const chars = raw.split('')
  chars[12] = '4'
  chars[16] = '89ab'[parseInt(chars[16], 16) & 3]
  const hex = chars.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function prepareFinancialImportLines(parsed) {
  const fileIdentity = parsed?.fileHash || parsed?.fileName || 'planilha'
  return (parsed?.lines || []).map(line => ({
    ...line,
    id:financialImportUuid(`${fileIdentity}:${line.sourceLineKey}`),
  }))
}

export function ledgerInstallmentsForFinancialImport(data = {}) {
  const ledger = buildLedger(data)
  return ledger.entries.flatMap((entry, entryIndex) => (ledger.installments[entryIndex] || []).map((installment, installmentIndex) => ({
    ...installment,
    id:`${entry.source_type}:${entry.source_id}:${entry.source_component}:${installmentIndex + 1}`,
    financial_entries:entry,
  })))
}

export function buildFinancialImportReview(lines = [], data = {}, fileName = '') {
  const installments = ledgerInstallmentsForFinancialImport(data)
  const matches = matchBankStatementLines(lines, installments, [], { windowDays:3 })
  const existingSourceIds = new Set([
    ...(data.extraRevenues || []).map(item => item.id),
    ...(data.expenses || []).map(item => item.id),
  ])
  return buildStatementImportReview(matches, data.chartAccounts || [], { fileName }).map(item => existingSourceIds.has(item.line.id)
    ? { ...item, reviewStatus:'existing', safeForBulk:false, selectedAction:null }
    : item)
}

export function approvableFinancialImportItem(item) {
  if (!item || item.processing) return false
  if (!['new', 'review'].includes(item.reviewStatus)) return false
  return !item.proposal?.reasons?.some(reason => reason.toLowerCase().includes('transferência'))
}
