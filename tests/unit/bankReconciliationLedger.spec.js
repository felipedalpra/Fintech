import { expect, test } from '@playwright/test'
import { missingPersistedLedgerInstallments } from '../../src/lib/bankReconciliationLedger.js'

const revenue = { id:'11111111-1111-4111-8111-111111111111', description:'Receita', value:500, date:'2026-10-13', receivedDate:'2026-10-13', dueDate:'2026-10-13', competenceDate:'2026-10-13', status:'recebido' }

test('bloqueia quando uma parcela canônica ainda não existe no razão persistido', () => {
  const missing = missingPersistedLedgerInstallments({ extraRevenues:[revenue] }, [])
  expect(missing).toEqual([expect.objectContaining({ sourceType:'extra_revenue', sourceId:revenue.id, installmentNumber:1 })])
})

test('libera quando a parcela persistida corresponde à mesma origem canônica', () => {
  const persisted = [{
    id:'installment', installment_number:1, archived_at:null,
    financial_entries:{ source_type:'extra_revenue', source_id:revenue.id, source_component:'revenue' },
  }]
  expect(missingPersistedLedgerInstallments({ extraRevenues:[revenue] }, persisted)).toEqual([])
})
