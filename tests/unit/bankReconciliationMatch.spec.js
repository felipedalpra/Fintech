import { expect, test } from '@playwright/test'
import { descriptionSimilarity, matchBankStatementLines, validateManualReconciliation } from '../../src/lib/bankReconciliationMatch.js'

function installment(id, overrides = {}) {
  return {
    id,
    amount:500,
    due_date:'2026-10-13',
    settlement_date:'2026-10-13',
    status:'paid',
    archived_at:null,
    financial_account_id:'account-a',
    financial_entry:{ direction:'receivable', description:'Consulta Maria', party_name_snapshot:'Maria', status:'paid', archived_at:null, issue_date:'2026-10-13' },
    ...overrides,
  }
}

function line(id, overrides = {}) {
  return { id, postedDate:'2026-10-13', amount:500, description:'PIX MARIA', normalizedDescription:'maria', financial_account_id:'account-a', ...overrides }
}

test('recomenda por valor, direção, data e descrição com motivos explicáveis', () => {
  const result = matchBankStatementLines([line('line-1')], [installment('inst-1')])
  expect(result[0].status).toBe('suggestion')
  expect(result[0].recommendedCandidate.installmentId).toBe('inst-1')
  expect(result[0].recommendedCandidate.reasons).toContain('valor exato')
})

test('não cruza crédito com conta a pagar nem tolera valor diferente automaticamente', () => {
  const payable = installment('payable', { financial_entry:{ direction:'payable', description:'Maria', status:'paid' } })
  const wrongAmount = installment('wrong', { amount:499.5 })
  const result = matchBankStatementLines([line('line-1')], [payable, wrongAmount])
  expect(result[0]).toMatchObject({ status:'unmatched', candidates:[] })
})

test('empate fica ambíguo e nunca pré-confirma candidato', () => {
  const result = matchBankStatementLines([line('line-1')], [installment('a'), installment('b')])
  expect(result[0].status).toBe('suggestion')
  expect(result[0].ambiguous).toBe(true)
  expect(result[0].recommendedCandidate).toBeNull()
})

test('uma parcela não é recomendada a duas linhas no mesmo lote', () => {
  const result = matchBankStatementLines([line('a'), line('b')], [installment('only')])
  expect(result.filter(item => item.recommendedCandidate)).toHaveLength(1)
  expect(result.filter(item => item.conflict)).toHaveLength(1)
})

test('preserva como conflito parcela conciliada e ignora cancelada ou arquivada', () => {
  const reconciliations = [{ id:'rec', statement_line_id:'done', financial_installment_id:'used', reversed_at:null }]
  const result = matchBankStatementLines(
    [line('done'), line('new')],
    [installment('used'), installment('canceled', { status:'canceled' }), installment('archived', { archived_at:'2026-10-14T00:00:00Z' })],
    reconciliations,
  )
  expect(result[0].status).toBe('reconciled')
  expect(result[1]).toMatchObject({ status:'reserved_match', conflict:true })
})

test('mantém parcelas de outros extratos na detecção, mas bloqueia novo vínculo', () => {
  const result = matchBankStatementLines([line('new')], [installment('used')], [], { reservedInstallmentIds:['used'] })
  expect(result[0]).toMatchObject({ status:'reserved_match', conflict:true, recommendedCandidate:null, reservedCandidate:{ installmentId:'used' } })
})

test('prefere candidato livre claramente melhor que uma parcela já reservada', () => {
  const reserved = installment('used', { financial_entry:{ direction:'receivable', description:'Pagamento sem relação', status:'paid', archived_at:null } })
  const available = installment('free', { financial_entry:{ direction:'receivable', description:'PIX MARIA', party_name_snapshot:'Maria', status:'paid', archived_at:null } })
  const result = matchBankStatementLines([line('new')], [reserved, available], [], { reservedInstallmentIds:['used'] })
  expect(result[0]).toMatchObject({ status:'suggestion', recommendedCandidate:{ installmentId:'free' } })
  expect(result[0].candidates.map(candidate => candidate.installmentId)).toEqual(['free'])
})

test('não sugere nem permite vínculo manual com outra conta financeira', () => {
  const otherAccount = installment('other', { financial_account_id:'account-b' })
  const result = matchBankStatementLines([line('line')], [otherAccount])
  expect(result[0]).toMatchObject({ status:'unmatched', candidates:[] })
  expect(validateManualReconciliation(line('line'), otherAccount).valid).toBe(false)
})

test('parcela sem conta exige justificativa e ainda pode ser vinculada manualmente', () => {
  const validation = validateManualReconciliation(line('line'), installment('no-account', { financial_account_id:null }))
  expect(validation.valid).toBe(true)
  expect(validation.requiresJustification).toBe(true)
  expect(validation.warnings).toContain('A parcela não possui conta financeira informada.')
})

test('não usa data de emissão como referência financeira', () => {
  const noFinancialDate = installment('no-date', { due_date:null, settlement_date:null })
  const result = matchBankStatementLines([line('line')], [noFinancialDate])
  expect(result[0]).toMatchObject({ status:'unmatched', candidates:[] })
  const validation = validateManualReconciliation(line('line'), noFinancialDate)
  expect(validation.requiresJustification).toBe(true)
  expect(validation.warnings).toContain('A parcela não possui data de referência válida.')
})

test('respeita a janela selecionada de até sete dias', () => {
  const result = matchBankStatementLines(
    [line('line', { postedDate:'2026-10-17' })],
    [installment('inst', { financial_entry:{ direction:'receivable', description:'PIX MARIA', status:'paid', archived_at:null, issue_date:'2026-10-13' } })],
    [],
    { windowDays:5 },
  )
  expect(result[0].recommendedCandidate).toMatchObject({ installmentId:'inst', differenceDays:4 })
  expect(validateManualReconciliation(line('line', { postedDate:'2026-10-17' }), installment('inst'), { windowDays:5 }).requiresJustification).toBe(false)
})

test('normalização de acento e ruído bancário preserva o nome útil', () => {
  expect(descriptionSimilarity('PIX transferência José da Silva 123456789', 'José da Silva')).toBeGreaterThan(0.5)
})

test('vínculo manual divergente exige justificativa e direção incompatível é bloqueada', () => {
  const divergent = validateManualReconciliation(line('line', { amount:490, postedDate:'2026-10-20' }), installment('inst'))
  expect(divergent.valid).toBe(true)
  expect(divergent.requiresJustification).toBe(true)
  expect(divergent.warnings).toHaveLength(2)
  const wrongDirection = validateManualReconciliation(line('line'), installment('inst', { financial_entry:{ direction:'payable', status:'paid' } }))
  expect(wrongDirection.valid).toBe(false)
})
