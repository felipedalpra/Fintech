import { expect, test } from '@playwright/test'
import { approvableFinancialImportItem, buildFinancialImportReview, financialImportUuid, prepareFinancialImportLines } from '../../src/lib/financialImport.js'

const accounts = [
  { id:'revenue', code:'4.01', name:'Consultas', nature:'revenue', dreSection:'gross_revenue', nodeType:'account', isActive:true },
  { id:'expense', code:'8.01', name:'Tarifas bancárias', nature:'financial_expense', dreSection:'financial_result', nodeType:'account', isActive:true },
]

test('prepara ids UUID determinísticos para o mesmo arquivo e linha', () => {
  const parsed = { fileHash:'abc', lines:[{ sourceLineKey:'linha-2' }] }
  const first = prepareFinancialImportLines(parsed)[0].id
  const second = prepareFinancialImportLines(parsed)[0].id
  expect(first).toBe(second)
  expect(first).toBe(financialImportUuid('abc:linha-2'))
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('separa lançamento já existente de novo lançamento aprovável', () => {
  const data = {
    chartAccounts:accounts,
    extraRevenues:[{ id:'11111111-1111-4111-8111-111111111111', description:'Consulta Maria', value:500, date:'2026-09-01', competenceDate:'2026-09-01', dueDate:'2026-09-01', receivedDate:'2026-09-01', status:'recebido', chartAccountId:'revenue' }],
    expenses:[], surgeries:[], consultations:[], productSales:[], productPurchases:[], recurrences:[], procedures:[],
  }
  const lines = [
    { id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sourceLineKey:'a', lineIndex:2, postedDate:'2026-09-01', amount:500, description:'Consulta Maria', normalizedDescription:'consulta maria', sourceMetadata:{ category:'Consultas', chartAccountId:'revenue' } },
    { id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sourceLineKey:'b', lineIndex:3, postedDate:'2026-09-02', amount:-90, description:'Tarifa bancária', normalizedDescription:'tarifa bancaria', sourceMetadata:{ category:'Tarifa', chartAccountId:'expense' } },
  ]
  const reviews = buildFinancialImportReview(lines, data, 'MOV.xlsx')
  expect(reviews[0].reviewStatus).toBe('existing')
  expect(approvableFinancialImportItem(reviews[0])).toBe(false)
  expect(reviews[1].reviewStatus).toBe('new')
  expect(reviews[1].proposal.record).toMatchObject({ id:lines[1].id, value:90, paymentDate:'2026-09-02', chartAccountId:'expense' })
  expect(approvableFinancialImportItem(reviews[1])).toBe(true)
})

test('reimportação com o mesmo UUID nunca sobrescreve silenciosamente um lançamento editado', () => {
  const id = financialImportUuid('arquivo:linha-2')
  const data = {
    chartAccounts:accounts,
    extraRevenues:[{ id, description:'Versão aprovada', value:500, date:'2026-09-01', receivedDate:'2026-09-01', status:'recebido' }],
    expenses:[], surgeries:[], consultations:[], productSales:[], productPurchases:[], recurrences:[], procedures:[],
  }
  const changed = { id, sourceLineKey:'linha-2', lineIndex:2, postedDate:'2026-10-01', amount:900, description:'Versão alterada', normalizedDescription:'versao alterada', sourceMetadata:{} }
  const [review] = buildFinancialImportReview([changed], data, 'MOV.xlsx')
  expect(review.reviewStatus).toBe('existing')
  expect(approvableFinancialImportItem(review)).toBe(false)
})
