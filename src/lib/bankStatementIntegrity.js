function clean(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function cents(value) {
  return Math.round((Number(value) || 0) * 100)
}

function dateRange(lines = []) {
  const dates = lines.map(line => line.postedDate || line.posted_date).filter(Boolean).sort()
  return { start:dates[0] || null, end:dates.at(-1) || null }
}

export function accountMatchesStatement(account, statementMetadata = {}) {
  if (!account) return false
  const institution = clean(account.institution_code)
  const statementInstitution = clean(statementMetadata.institutionCode)
  const suffix = clean(account.account_number_suffix || account.account_number_masked).slice(-4)
  const statementSuffix = clean(statementMetadata.accountNumberSuffix || statementMetadata.accountNumberMasked).slice(-4)
  if (!institution || !statementInstitution || institution !== statementInstitution) return false
  return Boolean(suffix && statementSuffix && suffix === statementSuffix)
}

export function suggestStatementAccount(accounts = [], statementMetadata = {}) {
  const exact = accounts.filter(account => accountMatchesStatement(account, statementMetadata))
  return exact.length === 1 ? exact[0] : null
}

export function evaluateStatementIntegrity(parsed, account, previousImports = []) {
  const metadata = parsed?.statementMetadata || {}
  const lines = parsed?.lines || []
  const errors = []
  const warnings = []
  const evidence = []
  const range = dateRange(lines)
  const format = String(parsed?.format || '')

  if (!account) errors.push('Selecione a conta financeira que receberá este extrato.')
  if (metadata.currency && metadata.currency !== 'BRL') errors.push(`A moeda do extrato é ${metadata.currency}; esta conciliação aceita somente BRL.`)

  const accountInstitution = clean(account?.institution_code)
  const statementInstitution = clean(metadata.institutionCode)
  if (accountInstitution && statementInstitution) {
    if (accountInstitution !== statementInstitution) errors.push('A instituição do OFX não corresponde à conta selecionada.')
    else evidence.push('instituição conferida')
  }

  const accountSuffix = clean(account?.account_number_suffix || account?.account_number_masked).slice(-4)
  const statementSuffix = clean(metadata.accountNumberSuffix || metadata.accountNumberMasked).slice(-4)
  if (accountSuffix && statementSuffix) {
    if (accountSuffix !== statementSuffix) errors.push('O final da conta do OFX não corresponde à conta selecionada.')
    else evidence.push('conta conferida')
  }

  if (metadata.periodStart && range.start && range.start < metadata.periodStart) errors.push('Há movimentação anterior ao período declarado pelo OFX.')
  if (metadata.periodEnd && range.end && range.end > metadata.periodEnd) errors.push('Há movimentação posterior ao período declarado pelo OFX.')
  if (metadata.periodStart && metadata.periodEnd) evidence.push('período declarado pelo banco')

  const sameAccountImports = previousImports.filter(item => item.financial_account_id === account?.id && item.status === 'ready')
  const overlaps = sameAccountImports.filter(item => range.start && range.end && item.period_start && item.period_end
    && item.period_start <= range.end && item.period_end >= range.start)
  if (overlaps.length) warnings.push(`O período se sobrepõe a ${overlaps.length} importação(ões) existente(s); as duplicidades serão revisadas por linha.`)

  const net = lines.reduce((total, line) => total + Number(line.amount || 0), 0)
  const previous = sameAccountImports
    .filter(item => item.closing_balance != null && item.balance_date && (!range.start || item.balance_date < range.start))
    .sort((left, right) => String(right.balance_date).localeCompare(String(left.balance_date)))[0]
  let controlDifference = null
  if (metadata.closingBalance != null && previous?.closing_balance != null) {
    controlDifference = (cents(metadata.closingBalance) - cents(previous.closing_balance) - cents(net)) / 100
    if (Math.abs(controlDifference) > 0.01) errors.push(`O saldo não fecha com o extrato anterior; diferença de R$ ${Math.abs(controlDifference).toFixed(2).replace('.', ',')}.`)
    else evidence.push('saldo fechado com o extrato anterior')
  } else if (metadata.closingBalance != null) {
    warnings.push('O OFX informa saldo final, mas ainda não existe um saldo anterior verificado para conferir a equação.')
  } else if (format === 'ofx') {
    warnings.push('O OFX não informa saldo final; a completude financeira não pôde ser comprovada.')
  }

  if (format !== 'ofx') warnings.push('CSV não comprova sozinho a origem bancária; confirme conta e período antes de importar.')
  if (format === 'ofx' && (!statementInstitution || !statementSuffix)) warnings.push('O OFX não trouxe identificação suficiente da conta.')

  const identityVerified = accountInstitution && statementInstitution && accountInstitution === statementInstitution
    && accountSuffix && statementSuffix && accountSuffix === statementSuffix
  const balanceVerified = controlDifference != null && Math.abs(controlDifference) <= 0.01
  const verificationStatus = errors.length
    ? 'mismatch'
    : identityVerified && balanceVerified
      ? 'verified'
      : format === 'ofx' && (identityVerified || metadata.closingBalance != null)
        ? 'partially_verified'
        : 'unverified'

  return {
    canImport:errors.length === 0,
    verificationStatus,
    errors,
    warnings,
    evidence,
    net:Math.round(net * 100) / 100,
    controlDifference,
    periodStart:metadata.periodStart || range.start,
    periodEnd:metadata.periodEnd || range.end,
    overlappingImportIds:overlaps.map(item => item.id),
  }
}

export function summarizeReconciliationCoverage(lines = [], reconciliations = []) {
  const activeByLine = new Set(reconciliations.filter(item => !item.reversed_at).map(item => item.statement_line_id))
  const totals = { total:lines.length, reconciled:0, ignored:0, pending:0, credits:0, debits:0, net:0 }
  lines.forEach(line => {
    const amount = Number(line.amount || 0)
    if (amount > 0) totals.credits += amount
    else totals.debits += Math.abs(amount)
    totals.net += amount
    if (activeByLine.has(line.id)) totals.reconciled += 1
    else if (line.review_status === 'ignored') totals.ignored += 1
    else totals.pending += 1
  })
  totals.credits = Math.round(totals.credits * 100) / 100
  totals.debits = Math.round(totals.debits * 100) / 100
  totals.net = Math.round(totals.net * 100) / 100
  totals.decidedPercent = totals.total ? Math.round(((totals.reconciled + totals.ignored) / totals.total) * 100) : 0
  return totals
}
