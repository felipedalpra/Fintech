import { expect, test } from '@playwright/test'
import { buildLedger } from '../../src/lib/financialLedger.js'
import { prepareFinancialEntryRows, prepareFinancialInstallmentRows } from '../../src/lib/ledgerPersistence.js'

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('payload persistido preserva chave idempotente, liquidação e forma de pagamento', () => {
  const ledger = buildLedger({
    expenses:[{
      id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', description:'Software', category:'softwares',
      value:250, competenceDate:'2026-10-01', dueDate:'2026-10-10', paymentDate:'2026-10-12',
      paymentMethod:'pix', status:'pago',
    }],
  })
  const entries = prepareFinancialEntryRows(OWNER, ledger)
  const persisted = entries.map((entry, index) => ({
    ...entry,
    id:`cccccccc-cccc-4ccc-8ccc-ccccccccccc${index}`,
  }))
  const installments = prepareFinancialInstallmentRows(OWNER, ledger, persisted)

  expect(entries[0]).toMatchObject({
    user_id:OWNER,
    source_type:'expense',
    source_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    source_component:'revenue',
    status:'paid',
    total_amount:250,
    archived_at:null,
  })
  expect(installments[0]).toMatchObject({
    user_id:OWNER,
    financial_entry_id:'cccccccc-cccc-4ccc-8ccc-ccccccccccc0',
    installment_number:1,
    amount:250,
    paid_amount:250,
    due_date:'2026-10-10',
    settlement_date:'2026-10-12',
    payment_method:'pix',
    status:'paid',
    archived_at:null,
  })
  expect(installments[0]).not.toHaveProperty('financial_account_id')
})

test('projeção sem conta omite a coluna para não apagar a conta já conciliada', () => {
  const ledger = buildLedger({
    extraRevenues:[{
      id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', description:'Consulta', value:500,
      competenceDate:'2026-10-13', dueDate:'2026-10-13', receivedDate:'2026-10-13', status:'recebido',
    }],
  })
  const entries = prepareFinancialEntryRows(OWNER, ledger).map(entry => ({ ...entry, id:'ffffffff-ffff-4fff-8fff-ffffffffffff' }))
  const [row] = prepareFinancialInstallmentRows(OWNER, ledger, entries)
  expect(row).not.toHaveProperty('financial_account_id')
})

test('payload exige id retornado pelo upsert antes de criar parcelas', () => {
  const ledger = buildLedger({ expenses:[{ id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd', value:10, dueDate:'2026-10-10', status:'aberto' }] })
  expect(() => prepareFinancialInstallmentRows(OWNER, ledger, [])).toThrow(/Título não persistido/)
})
