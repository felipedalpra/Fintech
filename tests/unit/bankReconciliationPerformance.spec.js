import { expect, test } from '@playwright/test'
import { matchBankStatementLines } from '../../src/lib/bankReconciliationMatch.js'

test('matching preserva sugestões em volume alto usando candidatos por valor e sentido', () => {
  const installments = Array.from({ length:2000 }, (_, index) => ({
    id:`other-${index}`, amount:100 + index, due_date:'2026-10-13', settlement_date:'2026-10-13', status:'paid', financial_account_id:'account-a',
    financial_entry:{ direction:'receivable', description:'Outro', status:'paid', archived_at:null },
  }))
  installments.push({ id:'target', amount:500, due_date:'2026-10-13', settlement_date:'2026-10-13', status:'paid', financial_account_id:'account-a', financial_entry:{ direction:'receivable', description:'PIX Maria', party_name_snapshot:'Maria', status:'paid', archived_at:null } })
  const result = matchBankStatementLines([{ id:'line', postedDate:'2026-10-13', amount:500, description:'PIX Maria', normalizedDescription:'maria', financial_account_id:'account-a' }], installments)
  expect(result[0].recommendedCandidate.installmentId).toBe('target')
})
