import { expect, test } from '@playwright/test'

const USER_ID = process.env.E2E_USER_ID || '11111111-1111-4111-8111-111111111111'
const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY
const OTHER_CLINIC_TOKEN = process.env.E2E_OTHER_CLINIC_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzMzMzMzMzMy0zMzMzLTQzMzMtODMzMy0zMzMzMzMzMzMzMzMiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6NDEwMjQ0NDgwMH0.ccTdCNFmg0TNHDdfD5pcPPmJBen0FzknKZJReQIJcoo'

test('persiste importação, vínculo e reversão no PostgreSQL local real', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"connected":false}' }))

  await page.goto('/app/bank-reconciliation')
  await expect(page.getByRole('heading', { name:'Conciliação Bancária' })).toBeVisible()
  await page.getByLabel('Conta financeira').selectOption(ACCOUNT_ID)
  await page.getByLabel('Arquivo OFX, CSV, Excel ou extrato do BRB').setInputFiles({
    name:'extrato-real-e2e.ofx',
    mimeType:'application/x-ofx',
    buffer:Buffer.from(`OFXHEADER:100\n<OFX><BANKTRANLIST>
      <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261013<TRNAMT>500.00<FITID>real-e2e-fit-1<MEMO>PIX MARIA E2E</STMTTRN>
      <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261014<TRNAMT>-18.90<FITID>real-e2e-fit-2<MEMO>TARIFA BANCO E2E</STMTTRN>
    </BANKTRANLIST></OFX>`),
  })
  await expect(page.getByTestId('statement-preview')).toContainText('2 linha(s) válida(s)')
  await page.getByRole('button', { name:'Confirmar importação' }).click()
  await expect(page.getByTestId('statement-line-suggestion')).toContainText('PIX MARIA E2E')

  await page.getByTestId('statement-line-suggestion').getByRole('button', { name:'Conferir e vincular' }).click()
  await page.getByRole('button', { name:'Confirmar vínculo', exact:true }).click()
  await expect(page.getByTestId('statement-line-reconciled')).toContainText('Vínculo confirmado')
  await page.screenshot({ path:'test-results/e2e-real/conciliacao-bancaria-real.png', fullPage:true })

  await page.reload()
  await expect(page.getByTestId('statement-line-reconciled')).toContainText('PIX MARIA E2E')

  const stored = await page.evaluate(async ({ userId, anonKey }) => {
    const headers = { apikey:anonKey, Authorization:`Bearer ${anonKey}` }
    const [importsResponse, linesResponse, reconciliationsResponse, metricsResponse] = await Promise.all([
      fetch(`/rest/v1/bank_statement_imports?user_id=eq.${userId}&select=id,status,line_count,file_hash`, { headers }),
      fetch(`/rest/v1/bank_statement_lines?user_id=eq.${userId}&select=id,posted_date,amount,description`, { headers }),
      fetch(`/rest/v1/bank_reconciliations?user_id=eq.${userId}&select=id,statement_line_id,financial_installment_id,reversed_at`, { headers }),
      fetch(`/rest/v1/financial_installments?user_id=eq.${userId}&select=id,amount,paid_amount,due_date,settlement_date,financial_account_id,status`, { headers }),
    ])
    return {
      imports:await importsResponse.json(),
      lines:await linesResponse.json(),
      reconciliations:await reconciliationsResponse.json(),
      installments:await metricsResponse.json(),
    }
  }, { userId:USER_ID, anonKey:ANON_KEY })
  expect(stored.imports).toEqual([expect.objectContaining({ status:'ready', line_count:2 })])
  expect(stored.lines).toHaveLength(2)
  expect(stored.reconciliations).toEqual([expect.objectContaining({ reversed_at:null })])
  expect(stored.installments).toEqual([expect.objectContaining({ amount:500, paid_amount:500, settlement_date:'2026-10-13', financial_account_id:ACCOUNT_ID, status:'paid' })])

  const expenseLineId = stored.lines.find(item => Number(item.amount) === -18.9)?.id
  const activeImportId = stored.imports[0]?.id
  const existingInstallmentId = stored.installments[0]?.id
  expect(expenseLineId).toBeTruthy()
  const claimGuardrails = await page.evaluate(async ({ anonKey, expenseLineId:lineId, importId, installmentId }) => {
    const headers = { apikey:anonKey, Authorization:`Bearer ${anonKey}`, 'Content-Type':'application/json' }
    const call = async (name, body) => {
      const response = await fetch(`/rest/v1/rpc/${name}`, { method:'POST', headers, body:JSON.stringify(body) })
      return { status:response.status, body:await response.json().catch(() => null) }
    }
    const firstToken = '12121212-1212-4121-8121-121212121212'
    const otherToken = '34343434-3434-4343-8343-343434343434'
    const firstClaim = await call('claim_bank_statement_lines_for_creation', { p_line_ids:[lineId], p_claim_token:firstToken, p_allow_overlap:false })
    const competingClaim = await call('claim_bank_statement_lines_for_creation', { p_line_ids:[lineId], p_claim_token:otherToken, p_allow_overlap:false })
    const genericReopen = await call('set_bank_statement_lines_review', { p_line_ids:[lineId], p_status:'pending', p_reason:null })
    const archiveWhileClaimed = await call('archive_bank_statement_import', { p_import_id:importId })
    const wrongRelease = await call('release_bank_statement_line_claims', { p_line_ids:[lineId], p_claim_token:otherToken })
    const correctRelease = await call('release_bank_statement_line_claims', { p_line_ids:[lineId], p_claim_token:firstToken })
    const ignore = await call('set_bank_statement_lines_review', { p_line_ids:[lineId], p_status:'ignored', p_reason:'guardrail real' })
    const staleConfirm = await call('confirm_bank_reconciliation', {
      p_line_id:lineId, p_installment_id:installmentId, p_method:'manual', p_score:null,
      p_reasons:[], p_justification:'tentativa obsoleta', p_window_days:3,
    })
    const reopen = await call('set_bank_statement_lines_review', { p_line_ids:[lineId], p_status:'pending', p_reason:null })
    return { firstClaim, competingClaim, genericReopen, archiveWhileClaimed, wrongRelease, correctRelease, ignore, staleConfirm, reopen }
  }, { anonKey:ANON_KEY, expenseLineId, importId:activeImportId, installmentId:existingInstallmentId })
  expect(claimGuardrails.firstClaim).toMatchObject({ status:200, body:1 })
  expect(claimGuardrails.competingClaim.status).toBe(400)
  expect(claimGuardrails.genericReopen.status).toBe(400)
  expect(claimGuardrails.archiveWhileClaimed).toMatchObject({ status:400, body:{ message:expect.stringContaining('criações em andamento') } })
  expect(claimGuardrails.wrongRelease.status).toBe(400)
  expect(claimGuardrails.correctRelease).toMatchObject({ status:200, body:1 })
  expect(claimGuardrails.ignore).toMatchObject({ status:200, body:1 })
  expect(claimGuardrails.staleConfirm).toMatchObject({ status:400, body:{ message:expect.stringContaining('Reabra a linha ignorada') } })
  expect(claimGuardrails.reopen).toMatchObject({ status:200, body:1 })

  const crossTenant = await page.evaluate(async ({ otherToken }) => {
    const response = await fetch('/rest/v1/bank_statement_imports?select=id,status', { headers:{ apikey:otherToken, Authorization:`Bearer ${otherToken}` } })
    return { status:response.status, rows:await response.json() }
  }, { otherToken:OTHER_CLINIC_TOKEN })
  expect(crossTenant).toEqual({ status:200, rows:[] })

  await page.getByTestId('statement-line-reconciled').getByRole('button', { name:'Desconciliar' }).click()
  await page.getByText('Motivo').locator('..').getByRole('textbox').fill('Reversão real E2E')
  await page.getByRole('button', { name:'Desconciliar', exact:true }).last().click()
  await expect(page.getByTestId('statement-line-suggestion')).toContainText('PIX MARIA E2E')
  await page.reload()
  await expect(page.getByTestId('statement-line-suggestion')).toContainText('PIX MARIA E2E')

  const reversed = await page.evaluate(async ({ userId, anonKey }) => {
    const response = await fetch(`/rest/v1/bank_reconciliations?user_id=eq.${userId}&select=reversed_at,reversal_reason`, { headers:{ apikey:anonKey, Authorization:`Bearer ${anonKey}` } })
    return response.json()
  }, { userId:USER_ID, anonKey:ANON_KEY })
  expect(reversed).toEqual([expect.objectContaining({ reversed_at:expect.any(String), reversal_reason:'Reversão real E2E' })])

  const revenueLineId = stored.lines.find(item => Number(item.amount) === 500)?.id
  expect(revenueLineId).toBeTruthy()
  const databaseGuardrails = await page.evaluate(async ({ anonKey, lineId, accountId }) => {
    const headers = { apikey:anonKey, Authorization:`Bearer ${anonKey}`, 'Content-Type':'application/json', Prefer:'return=representation' }
    const post = async (path, body) => {
      const response = await fetch(path, { method:'POST', headers, body:JSON.stringify(body) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(`${path}: ${payload?.message || response.status}`)
      return payload
    }
    const rpc = async body => {
      const response = await fetch('/rest/v1/rpc/confirm_bank_reconciliation', { method:'POST', headers, body:JSON.stringify(body) })
      return { status:response.status, body:await response.json().catch(() => null) }
    }
    const reverse = reconciliationId => post('/rest/v1/rpc/reverse_bank_reconciliation', { p_reconciliation_id:reconciliationId, p_reason:'Reversão do guardrail E2E' })

    const otherAccountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await post('/rest/v1/financial_accounts', { id:otherAccountId, user_id:'11111111-1111-4111-8111-111111111111', name:'Outra conta E2E', account_type:'checking' })
    const fixtures = [
      { suffix:'1', description:'Conta divergente', dueDate:'2026-10-13', installmentAccount:otherAccountId },
      { suffix:'2', description:'Janela de cinco dias', dueDate:'2026-10-17', installmentAccount:accountId },
      { suffix:'3', description:'Parcela antiga sem conta', dueDate:'2026-10-13', installmentAccount:null },
    ]
    for (const fixture of fixtures) {
      const entryId = `88888888-8888-4888-8888-88888888888${fixture.suffix}`
      const sourceId = `77777777-7777-4777-8777-77777777777${fixture.suffix}`
      await post('/rest/v1/financial_entries', {
        id:entryId, user_id:'11111111-1111-4111-8111-111111111111', direction:'receivable', source_type:'review_e2e',
        source_id:sourceId, source_component:'revenue', description:fixture.description, issue_date:'2026-10-13', total_amount:500, status:'paid',
      })
      await post('/rest/v1/financial_installments', {
        id:`99999999-9999-4999-8999-99999999999${fixture.suffix}`, user_id:'11111111-1111-4111-8111-111111111111',
        financial_entry_id:entryId, installment_number:1, amount:500, paid_amount:500,
        due_date:fixture.dueDate, settlement_date:fixture.dueDate, financial_account_id:fixture.installmentAccount, status:'paid',
      })
    }

    const base = { p_line_id:lineId, p_method:'manual', p_score:null, p_reasons:[], p_justification:null, p_window_days:3 }
    const accountMismatch = await rpc({ ...base, p_installment_id:'99999999-9999-4999-8999-999999999991', p_justification:'conta revisada' })
    const windowFive = await rpc({ ...base, p_installment_id:'99999999-9999-4999-8999-999999999992', p_method:'suggested', p_score:80, p_window_days:5 })
    if (windowFive.status === 200) await reverse(windowFive.body.id)
    const invalidWindow = await rpc({ ...base, p_installment_id:'99999999-9999-4999-8999-999999999992', p_window_days:8 })
    const accountMissing = await rpc({ ...base, p_installment_id:'99999999-9999-4999-8999-999999999993' })
    const justifiedMissing = await rpc({ ...base, p_installment_id:'99999999-9999-4999-8999-999999999993', p_justification:'parcela antiga sem conta' })
    if (justifiedMissing.status === 200) await reverse(justifiedMissing.body.id)
    return { accountMismatch, windowFive, invalidWindow, accountMissing, justifiedMissing }
  }, { anonKey:ANON_KEY, lineId:revenueLineId, accountId:ACCOUNT_ID })

  expect(databaseGuardrails.accountMismatch).toMatchObject({ status:400, body:{ message:expect.stringContaining('outra conta financeira') } })
  expect(databaseGuardrails.windowFive).toMatchObject({ status:200, body:{ difference_days:4 } })
  expect(databaseGuardrails.invalidWindow).toMatchObject({ status:400, body:{ message:expect.stringContaining('Janela de datas inválida') } })
  expect(databaseGuardrails.accountMissing).toMatchObject({ status:400, body:{ message:expect.stringContaining('exige justificativa') } })
  expect(databaseGuardrails.justifiedMissing).toMatchObject({ status:200, body:{ financial_installment_id:'99999999-9999-4999-8999-999999999993' } })

})
