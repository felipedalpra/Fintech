function lineDate(line) { return line?.postedDate || line?.posted_date || '' }
function lineAmount(line) { return Number(line?.amount || 0) }

export function transferPairKey(leftId, rightId) {
  return [String(leftId || ''), String(rightId || '')].sort().join(':')
}

export function validateInternalTransferPair(left, right) {
  const errors = []
  if (!left?.id || !right?.id || left.id === right.id) errors.push('Selecione duas linhas bancárias diferentes.')
  if (left?.financial_account_id && right?.financial_account_id && left.financial_account_id === right.financial_account_id) {
    errors.push('A transferência precisa envolver duas contas bancárias diferentes.')
  }
  if (lineAmount(left) === 0 || lineAmount(right) === 0 || Math.abs(Math.abs(lineAmount(left)) - Math.abs(lineAmount(right))) > 0.005) {
    errors.push('As duas linhas precisam ter o mesmo valor em sentidos opostos.')
  }
  if (Math.sign(lineAmount(left)) === Math.sign(lineAmount(right))) errors.push('Uma linha deve ser entrada e a outra saída.')
  if (lineDate(left) !== lineDate(right)) errors.push('As duas linhas precisam ocorrer na mesma data.')
  return { valid:errors.length === 0, errors }
}

export function transferCandidates(line, lines = []) {
  return lines
    .filter(candidate => candidate?.id !== line?.id)
    .filter(candidate => validateInternalTransferPair(line, candidate).valid)
    .sort((left, right) => Math.abs(Number(left.amount || 0)) - Math.abs(Number(right.amount || 0)))
}

export function transferRecord(left, right, justification = '') {
  const validation = validateInternalTransferPair(left, right)
  if (!validation.valid) throw new Error(validation.errors.join(' '))
  return {
    statementLineId:left.id,
    counterpartyLineId:right.id,
    amount:Math.abs(lineAmount(left)),
    sourceFinancialAccountId:lineAmount(left) < 0 ? left.financial_account_id : right.financial_account_id,
    destinationFinancialAccountId:lineAmount(left) > 0 ? left.financial_account_id : right.financial_account_id,
    postedDate:lineDate(left),
    justification:String(justification || '').trim(),
  }
}
