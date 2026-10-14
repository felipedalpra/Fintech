import { expect, test } from '@playwright/test'

const USER_ID = process.env.E2E_USER_ID || '11111111-1111-4111-8111-111111111111'
const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY
const OTHER_CLINIC_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzMzMzMzMzMy0zMzMzLTQzMzMtODMzMy0zMzMzMzMzMzMzMzMiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6NDEwMjQ0NDgwMH0.ccTdCNFmg0TNHDdfD5pcPPmJBen0FzknKZJReQIJcoo'

test('persiste importação, vínculo e reversão no PostgreSQL local real', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"connected":false}' }))

  await page.goto('/app/bank-reconciliation')
  await expect(page.getByRole('heading', { name:'Conciliação Bancária' })).toBeVisible()
  await page.getByLabel('Conta financeira').selectOption(ACCOUNT_ID)
  await page.getByLabel('Arquivo OFX ou CSV').setInputFiles({
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
      fetch(`/rest/v1/financial_installments?user_id=eq.${userId}&select=id,amount,paid_amount,due_date,settlement_date,status`, { headers }),
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
  expect(stored.installments).toEqual([expect.objectContaining({ amount:500, paid_amount:500, settlement_date:'2026-10-13', status:'paid' })])

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
})
