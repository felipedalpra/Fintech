import { findChartAccount, normalizeChartAccount } from './chartOfAccounts.js'
import { statementMovementFingerprint } from './statementParser.js'

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function metadataOf(line) {
  return line?.source_metadata || line?.sourceMetadata || {}
}

function allowedNatures(direction) {
  return direction === 'receivable'
    ? new Set(['revenue', 'financial_revenue', 'unclassified'])
    : new Set(['revenue_deduction', 'direct_cost', 'operating_expense', 'depreciation', 'financial_expense', 'income_tax', 'unclassified'])
}

function compatibleAccount(account, direction) {
  if (!account) return null
  const normalizedAccount = normalizeChartAccount(account)
  return normalizedAccount.nodeType === 'account' && normalizedAccount.isActive && allowedNatures(direction).has(normalizedAccount.nature)
    ? normalizedAccount
    : null
}

function accountByName(accounts, names, direction) {
  const terms = names.map(normalized)
  const validNatures = allowedNatures(direction)
  return accounts.map(normalizeChartAccount).find(account => account.nodeType === 'account'
    && account.isActive
    && validNatures.has(account.nature)
    && terms.some(term => normalized(account.name).includes(term))) || null
}

function mappedAccount(accounts, category, direction) {
  const key = normalized(category)
  const mappings = [
    { test:/honorarios medicos|cirurgia/, systemKey:'revenue_surgery_default', names:['outras cirurgias'] },
    { test:/consulta/, systemKey:'revenue_consultation', names:['consulta de cirurgia plastica', 'outras consultas'] },
    { test:/malha cirurgica|protese|produto/, systemKey:'revenue_product', names:['malhas, meias e sutias', 'outros produtos'] },
    { test:/receita financeira|rendimento/, names:['rendimentos de aplicacoes', 'juros recebidos'] },
    { test:/desp bancaria|tarifa/, names:['tarifas bancarias'] },
    { test:/despesa com pessoal/, names:['outras despesas com pessoal'] },
    { test:/desp operacional/, names:['outras despesas operacionais'] },
    { test:/ressarcimento/, systemKey:'revenue_other', names:['outras receitas operacionais'] },
  ]
  const mapped = mappings.find(item => item.test.test(key))
  if (mapped?.systemKey) {
    const bySystem = compatibleAccount(findChartAccount(accounts, { systemKey:mapped.systemKey, direction }), direction)
    if (bySystem && normalized(bySystem.name) !== 'receita a classificar' && normalized(bySystem.name) !== 'pagamento a classificar') return bySystem
  }
  if (mapped?.names) {
    const byName = accountByName(accounts, mapped.names, direction)
    if (byName) return byName
  }
  return compatibleAccount(findChartAccount(accounts, { direction }), direction)
}

function installmentEntry(installment) {
  return installment?.financial_entries || installment?.financial_entry || installment?.entry || {}
}

export function probableInternalTransfer(line) {
  const metadata = metadataOf(line)
  if (String(metadata.category || '').trim()) return false
  const text = normalized(`${line?.description || ''} ${metadata.reference || ''} ${metadata.observation || ''}`)
  return /\b(pix interno|transferencia interna|entre contas|aplicacao|resgate)\b/.test(text)
}

function sensitiveCategory(category) {
  const key = normalized(category)
  return /\b(impostos|desp pessoal|pessoal socios|distribuicao|pro labore)\b/.test(key)
}

export function statementLineSignature(line) {
  return line?.movement_fingerprint || line?.movementFingerprint || statementMovementFingerprint(line)
}

export function duplicateLineIds(lines = []) {
  const groups = new Map()
  lines.forEach(line => {
    const signature = statementLineSignature(line)
    const values = groups.get(signature) || []
    values.push(line.id || line.sourceLineKey)
    groups.set(signature, values)
  })
  return new Set([...groups.values()].filter(values => values.length > 1).flat())
}

export function proposalForStatementLine(line, accounts = [], fileName = '') {
  const metadata = metadataOf(line)
  const isRevenue = Number(line.amount) > 0
  const direction = isRevenue ? 'receivable' : 'payable'
  const category = String(metadata.category || '').trim()
  const costCenter = String(metadata.costCenter || '').trim()
  const reference = String(metadata.reference || '').trim()
  const observation = String(metadata.observation || '').trim()
  const explicitAccount = metadata.chartAccountId
    ? compatibleAccount(findChartAccount(accounts, { id:metadata.chartAccountId, direction }), direction)
    : null
  const account = explicitAccount || mappedAccount(accounts, category, direction)
  const accountName = account?.name || (isRevenue ? 'Receita a classificar' : 'Pagamento a classificar')
  const unclassified = account?.nature === 'unclassified' || !account?.id
  const reasons = []
  if (!category) reasons.push('Categoria ausente na planilha.')
  if (unclassified) reasons.push('Plano de contas precisa ser confirmado.')
  if (probableInternalTransfer(line)) reasons.push('Possível transferência entre contas; não deve entrar automaticamente na DRE.')
  if (sensitiveCategory(category)) reasons.push('Classificação contábil sensível; confirme antes de lançar.')
  const date = line.postedDate || line.posted_date
  const source = `Importação ${fileName || 'de planilha'} · linha ${metadata.excelRow || line.line_index || line.lineIndex || ''}`.trim()
  const description = String(line.description || '').trim() || `${isRevenue ? 'Receita' : 'Despesa'} importada`
  const common = {
    id:line.id,
    description,
    category:category || (isRevenue ? 'outras_receitas' : 'outros'),
    value:Math.abs(Number(line.amount) || 0),
    competenceDate:date,
    dueDate:date,
    costCenter,
    originLabel:source,
    chartAccountId:account?.id || null,
    importReference:reference,
    importObservation:observation,
  }
  const record = isRevenue
    ? { ...common, date, receivedDate:date, status:'recebido' }
    : { ...common, paymentDate:date, status:'pago' }
  return {
    collection:isRevenue ? 'extraRevenues' : 'expenses',
    direction,
    record,
    account,
    accountName,
    category:category || 'Sem categoria',
    costCenter:costCenter || 'Sem centro de custo',
    reference,
    observation,
    assumedDates:true,
    requiresReview:reasons.length > 0,
    reasons,
  }
}

export function buildStatementImportReview(matches = [], accounts = [], options = {}) {
  const lines = matches.map(item => item.line)
  const duplicates = duplicateLineIds(lines)
  return matches.map(match => {
    const lineId = match.line.id || match.line.sourceLineKey
    const proposal = proposalForStatementLine(match.line, accounts, options.fileName)
    const ignored = match.line.review_status === 'ignored'
    const processing = match.line.review_status === 'processing'
    const duplicate = duplicates.has(lineId) || options.overlappingFingerprints?.has(statementLineSignature(match.line))
    const createdCandidate = match.recommendedCandidate
      && installmentEntry(match.recommendedCandidate.installment).source_id === lineId
    let reviewStatus = 'new'
    if (match.status === 'reconciled') reviewStatus = 'reconciled'
    else if (ignored) reviewStatus = 'ignored'
    else if (options.matchingUnavailable) reviewStatus = 'review'
    else if (processing && createdCandidate) reviewStatus = 'existing'
    else if (processing) reviewStatus = 'review'
    else if (duplicate || match.ambiguous || match.conflict || (match.status === 'suggestion' && !match.recommendedCandidate)) reviewStatus = 'possible_duplicate'
    else if (match.recommendedCandidate) reviewStatus = 'existing'
    else if (proposal.requiresReview) reviewStatus = 'review'

    const recommended = match.recommendedCandidate
    const safeExisting = reviewStatus === 'existing'
      && Boolean(recommended?.installment?.financial_account_id)
      && Number(recommended?.score || 0) >= 70
    const safeNew = reviewStatus === 'new' && !proposal.requiresReview
    return {
      ...match,
      reviewStatus,
      duplicate,
      processing,
      createdCandidate:Boolean(createdCandidate),
      proposal,
      safeForBulk:!options.matchingUnavailable && !processing && (safeExisting || safeNew),
      selectedAction:reviewStatus === 'existing' ? 'link' : reviewStatus === 'new' ? 'create' : null,
    }
  })
}

export function mergeApprovedStatementRecords(data, reviewItems = []) {
  const additions = { extraRevenues:[], expenses:[] }
  reviewItems.filter(item => item.reviewStatus === 'new').forEach(item => {
    additions[item.proposal.collection].push(item.proposal.record)
  })
  const next = { ...data }
  for (const collection of ['extraRevenues', 'expenses']) {
    const current = Array.isArray(data?.[collection]) ? data[collection] : []
    const known = new Set(current.map(item => item.id))
    next[collection] = [...current, ...additions[collection].filter(item => !known.has(item.id))]
  }
  return next
}

export function summarizeStatementReview(items = []) {
  return items.reduce((summary, item) => {
    summary[item.reviewStatus] = (summary[item.reviewStatus] || 0) + 1
    if (item.reviewStatus === 'new') {
      if (item.line.amount > 0) summary.newReceipts += Number(item.line.amount)
      else summary.newExpenses += Math.abs(Number(item.line.amount))
    }
    return summary
  }, { reconciled:0, existing:0, new:0, possible_duplicate:0, review:0, ignored:0, newReceipts:0, newExpenses:0 })
}
