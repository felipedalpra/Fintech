import { expect, test } from '@playwright/test'
import { transferCandidates, transferPairKey, transferRecord, validateInternalTransferPair } from '../../src/lib/bankTransfer.js'

const debit = { id:'debit', amount:-500, posted_date:'2026-11-21', financial_account_id:'account-a', description:'Transferência interna' }
const credit = { id:'credit', amount:500, posted_date:'2026-11-21', financial_account_id:'account-b', description:'Transferência interna' }

test('valida transferência entre contas como par oposto e idêntico', () => {
  expect(validateInternalTransferPair(debit, credit)).toEqual({ valid:true, errors:[] })
  expect(transferRecord(debit, credit)).toMatchObject({ amount:500, sourceFinancialAccountId:'account-a', destinationFinancialAccountId:'account-b' })
})

test('não aceita transferência na mesma conta, data diferente ou mesmo sentido', () => {
  expect(validateInternalTransferPair(debit, { ...credit, financial_account_id:'account-a' }).valid).toBe(false)
  expect(validateInternalTransferPair(debit, { ...credit, posted_date:'2026-11-22' }).valid).toBe(false)
  expect(validateInternalTransferPair(debit, { ...credit, amount:-500 }).valid).toBe(false)
})

test('candidatos e chave do par são determinísticos', () => {
  expect(transferCandidates(debit, [credit, { ...credit, id:'other', amount:510 }])).toEqual([credit])
  expect(transferPairKey('credit', 'debit')).toBe('credit:debit')
})
