import { expect, test } from '@playwright/test'
import { buildStatementImportReview, duplicateLineIds, mergeApprovedStatementRecords, proposalForStatementLine } from '../../src/lib/statementImportReview.js'

const accounts = [
  { id:'surgery', code:'4.01.99', name:'Outras cirurgias', nature:'revenue', dreSection:'gross_revenue', nodeType:'account', systemKey:'revenue_surgery_default', isActive:true },
  { id:'bank-fee', code:'8.02.04', name:'Tarifas bancárias', nature:'financial_expense', dreSection:'financial_result', nodeType:'account', isActive:true },
  { id:'unknown-revenue', code:'10.01', name:'Receita a classificar', nature:'unclassified', dreSection:'unclassified', nodeType:'account', systemKey:'unclassified_revenue', isActive:true },
  { id:'unknown-expense', code:'10.02', name:'Pagamento a classificar', nature:'unclassified', dreSection:'unclassified', nodeType:'account', systemKey:'unclassified_expense', isActive:true },
]

function line(id, overrides = {}) {
  return { id, postedDate:'2026-09-03', amount:1000, description:'CREDITO PIX MARIA', line_index:4, financial_account_id:'account', source_metadata:{ category:'HONORÁRIOS MÉDICOS', costCenter:'CIRURGIA', reference:'Maria' }, ...overrides }
}

test('monta lançamento canônico idempotente com plano de contas e três datas explícitas', () => {
  const proposal = proposalForStatementLine(line('line-1'), accounts, 'MOV.xlsx')
  expect(proposal).toMatchObject({ collection:'extraRevenues', accountName:'Outras cirurgias', requiresReview:false })
  expect(proposal.record).toMatchObject({ id:'line-1', value:1000, competenceDate:'2026-09-03', dueDate:'2026-09-03', receivedDate:'2026-09-03', status:'recebido', chartAccountId:'surgery' })
  const once = mergeApprovedStatementRecords({ extraRevenues:[], expenses:[] }, [{ reviewStatus:'new', proposal }])
  const twice = mergeApprovedStatementRecords(once, [{ reviewStatus:'new', proposal }])
  expect(twice.extraRevenues).toHaveLength(1)
})

test('detecta duplicidades no arquivo sem descartar movimentos iguais', () => {
  const a = line('a', { amount:-9, description:'TARIFA ENVIO VALORES PIX' })
  const b = line('b', { amount:-9, description:'TARIFA ENVIO VALORES PIX' })
  expect([...duplicateLineIds([a, b])].sort()).toEqual(['a', 'b'])
  const reviews = buildStatementImportReview([
    { line:a, status:'unmatched', candidates:[] },
    { line:b, status:'unmatched', candidates:[] },
  ], accounts)
  expect(reviews.every(item => item.reviewStatus === 'possible_duplicate')).toBe(true)
  expect(reviews.every(item => !item.safeForBulk)).toBe(true)
})

test('distingue existente seguro, transferência e linha ignorada', () => {
  const existingLine = line('existing')
  const transfer = line('transfer', { amount:-50000, description:'DEBITO PIX INTERNO', source_metadata:{} })
  const ignored = line('ignored', { postedDate:'2026-09-04', description:'CREDITO PIX ANA', review_status:'ignored' })
  const installment = { id:'inst', amount:1000, financial_account_id:'account' }
  const reviews = buildStatementImportReview([
    { line:existingLine, status:'suggestion', recommendedCandidate:{ installmentId:'inst', installment, score:95, reasons:['valor exato'] }, candidates:[] },
    { line:transfer, status:'unmatched', candidates:[] },
    { line:ignored, status:'unmatched', candidates:[] },
  ], accounts)
  expect(reviews[0]).toMatchObject({ reviewStatus:'existing', safeForBulk:true })
  expect(reviews[1]).toMatchObject({ reviewStatus:'review', safeForBulk:false })
  expect(reviews[1].proposal.reasons.join(' ')).toContain('transferência')
  expect(reviews[2]).toMatchObject({ reviewStatus:'ignored', safeForBulk:false })
})

test('nunca aprova despesa em conta de receita e bloqueia novos quando o matching está indisponível', () => {
  const expense = line('expense', { amount:-800, description:'DEBITO HONORARIOS', source_metadata:{ category:'HONORÁRIOS MÉDICOS', costCenter:'CIRURGIA' } })
  const [review] = buildStatementImportReview([{ line:expense, status:'unmatched', candidates:[] }], accounts)
  expect(review).toMatchObject({ reviewStatus:'review', safeForBulk:false, proposal:{ accountName:'Pagamento a classificar', requiresReview:true } })

  const [unavailable] = buildStatementImportReview([{ line:line('new'), status:'unmatched', candidates:[] }], accounts, { matchingUnavailable:true })
  expect(unavailable).toMatchObject({ reviewStatus:'review', safeForBulk:false })
})

test('extrato sobreposto vira possível duplicidade e criação reservada só retoma sua própria origem', () => {
  const existing = installment => ({ installmentId:installment.id, installment, score:90, reasons:['valor exato'] })
  const reserved = buildStatementImportReview([{ line:line('reserved'), status:'reserved_match', conflict:true, candidates:[], recommendedCandidate:null }], accounts)
  expect(reserved[0]).toMatchObject({ reviewStatus:'possible_duplicate', safeForBulk:false })

  const createdInstallment = { id:'created-installment', amount:1000, financial_account_id:null, financial_entries:{ source_id:'processing', direction:'receivable' } }
  const processing = buildStatementImportReview([{
    line:line('processing', { review_status:'processing' }),
    status:'suggestion',
    recommendedCandidate:existing(createdInstallment),
    candidates:[],
  }], accounts)
  expect(processing[0]).toMatchObject({ reviewStatus:'existing', processing:true, createdCandidate:true, safeForBulk:false })

  const repeatedAcrossImports = line('overlap', { movement_fingerprint:'2026-09-03|receivable|1000.00|credito maria' })
  const overlapping = buildStatementImportReview(
    [{ line:repeatedAcrossImports, status:'unmatched', candidates:[] }],
    accounts,
    { overlappingFingerprints:new Set([repeatedAcrossImports.movement_fingerprint]) },
  )
  expect(overlapping[0]).toMatchObject({ reviewStatus:'possible_duplicate', duplicate:true, safeForBulk:false })
})
