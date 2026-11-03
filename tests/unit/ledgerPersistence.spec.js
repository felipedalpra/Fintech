import { expect, test } from '@playwright/test'
import { buildLedger } from '../../src/lib/financialLedger.js'
import { buildLedgerPersistenceDelta, prepareFinancialEntryRows, prepareFinancialInstallmentRows } from '../../src/lib/ledgerPersistence.js'
import { encodePaymentMethod } from '../../src/lib/paymentMethodCodec.js'

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

test('razão incremental não regrava títulos inalterados', () => {
  const baseline = {
    expenses:[
      { id:'11111111-1111-4111-8111-111111111111', description:'Aluguel', value:1000, dueDate:'2026-10-10', status:'pago', paymentDate:'2026-10-10' },
      { id:'22222222-2222-4222-8222-222222222222', description:'Internet', value:200, dueDate:'2026-10-11', status:'pago', paymentDate:'2026-10-11' },
    ],
  }
  const current = {
    ...baseline,
    expenses:baseline.expenses.map(item => item.id.startsWith('2222') ? { ...item, value:250 } : item),
  }
  const delta = buildLedgerPersistenceDelta(current, baseline)
  expect(delta.ledger.entries).toHaveLength(1)
  expect(delta.ledger.entries[0].source_id).toBe('22222222-2222-4222-8222-222222222222')
  expect(delta.archive).toEqual([])
})

test('razão incremental arquiva remoção sem reenviar títulos restantes', () => {
  const removed = { id:'33333333-3333-4333-8333-333333333333', description:'Removida', value:90, dueDate:'2026-10-12', status:'aberto' }
  const kept = { id:'44444444-4444-4444-8444-444444444444', description:'Mantida', value:120, dueDate:'2026-10-13', status:'aberto' }
  const delta = buildLedgerPersistenceDelta({ expenses:[kept] }, { expenses:[removed, kept] })
  expect(delta.ledger.entries).toEqual([])
  expect(delta.archive.map(entry => entry.source_id)).toEqual([removed.id])
})

test('razão incremental não arquiva origem importada ausente do estado da aba', () => {
  const imported = {
    id:'55555555-5555-4555-8555-555555555555',
    description:'Receita importada',
    category:'outras_receitas',
    value:300,
    date:'2026-10-14',
    receivedDate:'2026-10-14',
    status:'recebido',
    originLabel:'Importação MOV.xlsx · linha 2',
  }
  const delta = buildLedgerPersistenceDelta({ extraRevenues:[] }, { extraRevenues:[imported] })
  expect(delta.archive).toEqual([])
})

test('persistência da consulta mantém competência e vencimento de cada parcela', () => {
  const ledger = buildLedger({
    consultations:[{
      id:'66666666-6666-4666-8666-666666666666', patient:'Ana', value:900,
      date:'2026-01-15', competenceDate:'2026-01-15', paymentStatus:'parcelado',
      paymentMethod:encodePaymentMethod({ payments:[
        { date:'2026-01-20', amount:300, method:'pix' },
        { date:'2026-02-20', amount:300, method:'cartao' },
        { date:'2026-03-20', amount:300, method:'boleto' },
      ] }),
    }],
  })
  const entries = prepareFinancialEntryRows(OWNER, ledger).map(entry => ({ ...entry, id:'77777777-7777-4777-8777-777777777777' }))
  const installments = prepareFinancialInstallmentRows(OWNER, ledger, entries)

  expect(entries[0]).toMatchObject({ competence_date:'2026-01-15', total_amount:900 })
  expect(installments.map(item => ({ dueDate:item.due_date, amount:item.amount, method:item.payment_method }))).toEqual([
    { dueDate:'2026-01-20', amount:300, method:'pix' },
    { dueDate:'2026-02-20', amount:300, method:'cartao' },
    { dueDate:'2026-03-20', amount:300, method:'boleto' },
  ])
})

test('persistência mantém separadas a ordem do vencimento e a identidade da origem', () => {
  const ledger = buildLedger({
    consultations:[{
      id:'88888888-8888-4888-8888-888888888888', patient:'Ana', value:300,
      date:'2026-11-01', competenceDate:'2026-11-01', paymentStatus:'parcelado',
      paymentMethod:encodePaymentMethod({ payments:[
        { date:'2026-12-03', amount:200, method:'cartao' },
        { date:'2026-11-03', amount:100, method:'pix' },
      ] }),
    }],
  })
  const entries = prepareFinancialEntryRows(OWNER, ledger).map(entry => ({ ...entry, id:'99999999-9999-4999-8999-999999999999' }))
  const installments = prepareFinancialInstallmentRows(OWNER, ledger, entries)

  expect(installments.map(item => ({
    ledger:item.installment_number,
    source:item.source_installment_number,
    dueDate:item.due_date,
  }))).toEqual([
    { ledger:1, source:2, dueDate:'2026-11-03' },
    { ledger:2, source:1, dueDate:'2026-12-03' },
  ])
})
