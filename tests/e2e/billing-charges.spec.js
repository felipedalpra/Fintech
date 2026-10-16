import { expect, test } from '@playwright/test'

const DRAFT_KEY = 'surgimetrics_workspace_draft_e2e-user-id'

test('emite Pix da parcela exata sem permitir editar valor ou vencimento', async ({ page }) => {
  const draft = {
    procedures:[], surgeries:[], consultations:[], products:[], productSales:[], productPurchases:[],
    extraRevenues:[{
      id:'11111111-1111-4111-8111-111111111111',
      description:'Consulta especial', category:'outras_receitas', value:350,
      patient:'Ana Souza', patientId:'22222222-2222-4222-8222-222222222222',
      date:'2026-10-01', competenceDate:'2026-10-01', dueDate:'2026-10-30',
      receivedDate:null, status:'pendente',
    }],
    expenses:[], assets:[], liabilities:[], goals:[], chartAccounts:[],
  }
  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem('surgimetrics_onboarded', 'true')
    window.sessionStorage.setItem(key, value)
  }, [DRAFT_KEY, JSON.stringify(draft)])

  let requestBody
  let syncBody
  await page.route('**/api/financial/analysis?action=billing-*', async route => {
    const action = new URL(route.request().url()).searchParams.get('action')
    if (action === 'billing-sync') {
      syncBody = route.request().postDataJSON()
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ synced:true, charge:{
        id:'33333333-3333-4333-8333-333333333333', provider:'asaas', billingType:'PIX', amount:350,
        dueDate:'2026-10-30', status:'received', paidAt:'2026-10-16T12:00:00-03:00',
        invoiceUrl:'https://pay.example/charge', pixPayload:'00020126580014br.gov.bcb.pix', feeAmount:1.5,
      } }) })
      return
    }
    requestBody = route.request().postDataJSON()
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ charge:{
      id:'33333333-3333-4333-8333-333333333333', billingType:'PIX', amount:350,
      dueDate:'2026-10-30', status:'pending', invoiceUrl:'https://pay.example/charge',
      pixPayload:'00020126580014br.gov.bcb.pix', feeAmount:0,
    } }) })
  })

  await page.goto('/app/finance')
  await page.getByRole('button', { name:'A receber', exact:true }).click()
  const row = page.getByRole('row').filter({ hasText:'Consulta especial' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name:'Emitir cobrança' }).click()

  const dialog = page.getByRole('heading', { name:'Emitir cobrança' }).locator('..').locator('..')
  await expect(dialog.getByText('R$ 350,00')).toBeVisible()
  await expect(dialog.getByText('30/10/2026')).toBeVisible()
  await expect(dialog.getByLabel(/valor/i)).toHaveCount(0)
  await expect(dialog.getByLabel(/vencimento/i)).toHaveCount(0)
  await dialog.getByRole('button', { name:'Emitir Pix' }).click()

  await expect(dialog.getByText('Cobrança emitida')).toBeVisible()
  await expect(dialog.getByRole('link', { name:'Abrir link de pagamento' })).toHaveAttribute('href', 'https://pay.example/charge')
  await expect(dialog.locator('input[value="00020126580014br.gov.bcb.pix"]')).toBeVisible()
  expect(requestBody).toMatchObject({
    sourceType:'extra_revenue',
    sourceId:'11111111-1111-4111-8111-111111111111',
    installmentNumber:1,
    billingType:'PIX',
  })
  expect(requestBody).not.toHaveProperty('amount')
  expect(requestBody).not.toHaveProperty('dueDate')

  await dialog.getByRole('button', { name:'Consultar status' }).click()
  await expect(dialog.getByText('Cobrança recebida')).toBeVisible()
  await expect(dialog.getByRole('button', { name:'Cancelar cobrança' })).toHaveCount(0)
  expect(syncBody).toEqual({ chargeId:'33333333-3333-4333-8333-333333333333' })
})

test('admin conecta o Asaas e recebe confirmação do webhook sem expor a chave', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/secure-profile?action=get', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ profile:{} }) }))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }))
  let connected = false
  let connectPayload
  await page.route('**/api/financial/analysis?action=billing-*', async route => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('action') === 'billing-connect') {
      connectPayload = route.request().postDataJSON()
      connected = true
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, environment:'sandbox', webhookConfigured:true, apiKeyLast4:'7890' }) })
      return
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(connected
      ? { configured:true, connection:{ environment:'sandbox', apiKeyLast4:'7890', status:'connected', webhookConfigured:true } }
      : { configured:false, connection:null }) })
  })

  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Cobranças', exact:true }).click()
  await expect(page.getByRole('heading', { name:'Cobranças e banco' })).toBeVisible()
  await expect(page.getByText('Banco direto', { exact:true })).toBeVisible()
  const keyInput = page.locator('input[type="password"]')
  await expect(keyInput).toHaveAttribute('type', 'password')
  await keyInput.fill('$aact_test_1234567890')
  await page.getByRole('button', { name:'Conectar Asaas' }).click()
  await expect(page.getByText('Conta validada e webhook configurado automaticamente.')).toBeVisible()
  await expect(page.getByText(/Asaas conectado/)).toBeVisible()
  await expect(keyInput).toHaveValue('')
  expect(connectPayload).toEqual({ provider:'asaas', environment:'sandbox', apiKey:'$aact_test_1234567890' })
})
