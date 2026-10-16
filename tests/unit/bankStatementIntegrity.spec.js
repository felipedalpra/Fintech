import { expect, test } from '@playwright/test'
import { accountMatchesStatement, evaluateStatementIntegrity, suggestStatementAccount, summarizeReconciliationCoverage } from '../../src/lib/bankStatementIntegrity.js'

const account = { id:'account-a', institution_code:'341', account_number_suffix:'8765' }

test('bloqueia extrato OFX de outra conta e sugere a conta exata', () => {
  const metadata = { institutionCode:'341', accountNumberSuffix:'8765' }
  expect(accountMatchesStatement(account, metadata)).toBe(true)
  expect(suggestStatementAccount([account, { id:'other', institution_code:'001', account_number_suffix:'0001' }], metadata)).toBe(account)
  const result = evaluateStatementIntegrity({ format:'ofx', statementMetadata:{ ...metadata, accountNumberSuffix:'9999', currency:'BRL' }, lines:[{ postedDate:'2026-10-10', amount:100 }] }, account)
  expect(result.canImport).toBe(false)
  expect(result.verificationStatus).toBe('mismatch')
  expect(result.errors.join(' ')).toContain('não corresponde')
})

test('confere saldo final contra o extrato anterior e movimento líquido', () => {
  const parsed = {
    format:'ofx',
    statementMetadata:{ institutionCode:'341', accountNumberSuffix:'8765', currency:'BRL', periodStart:'2026-10-01', periodEnd:'2026-10-31', closingBalance:1150 },
    lines:[{ postedDate:'2026-10-10', amount:200 }, { postedDate:'2026-10-11', amount:-50 }],
  }
  const previous = [{ id:'previous', financial_account_id:'account-a', status:'ready', closing_balance:1000, balance_date:'2026-09-30', period_start:'2026-09-01', period_end:'2026-09-30' }]
  const result = evaluateStatementIntegrity(parsed, account, previous)
  expect(result).toMatchObject({ canImport:true, verificationStatus:'verified', controlDifference:0, net:150 })
})

test('detecta lacuna de saldo e sobreposição sem descartar as linhas', () => {
  const parsed = { format:'csv', lines:[{ postedDate:'2026-10-10', amount:100 }] }
  const previous = [{ id:'overlap', financial_account_id:'account-a', status:'ready', period_start:'2026-10-01', period_end:'2026-10-15' }]
  const result = evaluateStatementIntegrity(parsed, account, previous)
  expect(result.canImport).toBe(true)
  expect(result.verificationStatus).toBe('unverified')
  expect(result.overlappingImportIds).toEqual(['overlap'])
  expect(result.warnings.join(' ')).toContain('sobrepõe')
})

test('resume cobertura sem contar linha ignorada como conciliada', () => {
  const lines = [
    { id:'a', amount:100, review_status:'pending' },
    { id:'b', amount:-20, review_status:'ignored' },
    { id:'c', amount:-10, review_status:'pending' },
  ]
  const summary = summarizeReconciliationCoverage(lines, [{ statement_line_id:'a', reversed_at:null }])
  expect(summary).toEqual({ total:3, reconciled:1, ignored:1, pending:1, credits:100, debits:30, net:70, decidedPercent:67 })
})
