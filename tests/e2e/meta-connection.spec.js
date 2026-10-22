import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
  await page.route('**/rest/v1/**', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/api/secure-profile?action=get', route => route.fulfill({ status:200, contentType:'application/json', body:'{"profile":{}}' }))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }))
})

test('mostra "Continuar com Facebook" quando desconectado', async ({ page }) => {
  await page.route('**/rest/v1/meta_connections*', route => route.fulfill({ status:200, contentType:'application/json', body:'null' }))
  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Meta Ads', exact:true }).click()
  await expect(page.getByRole('button', { name:'Continuar com Facebook' })).toBeVisible()
})

test('clicar em conectar chama meta-connect e navega pra URL do Meta', async ({ page }) => {
  await page.route('**/rest/v1/meta_connections*', route => route.fulfill({ status:200, contentType:'application/json', body:'null' }))
  await page.route('**/api/whatsapp?action=meta-connect', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ url:'https://www.facebook.com/v26.0/dialog/oauth?mock=1' }) }))
  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Meta Ads', exact:true }).click()
  const navigation = page.waitForURL(/facebook\.com/, { timeout:5000 }).catch(() => null)
  await page.getByRole('button', { name:'Continuar com Facebook' }).click()
  await navigation
  expect(page.url()).toContain('facebook.com')
})

test('callback com 1 Página conecta direto e mostra status conectado', async ({ page }) => {
  let pendingCalled = false
  await page.route('**/rest/v1/meta_connections*', route => route.fulfill({
    status:200, contentType:'application/json',
    body:JSON.stringify({ ad_account_id:'act_1', page_id:'page-1', status:'conectado', token_expires_at:'2026-12-20T00:00:00Z' }),
  }))
  await page.route('**/api/whatsapp?action=meta-pending', async route => { pendingCalled = true; await route.fulfill({ status:200, contentType:'application/json', body:'{"pages":[],"adAccounts":[]}' }) })
  await page.goto('/app/settings?meta=connected')
  await expect(page.getByText('Meta Ads conectado com sucesso.')).toBeVisible()
  await page.getByRole('button', { name:'Meta Ads', exact:true }).click()
  await expect(page.getByText('● Conectado')).toBeVisible()
  await expect(page.getByRole('button', { name:'Desconectar' })).toBeVisible()
  expect(pendingCalled).toBe(false)
})

test('callback com múltiplas Páginas mostra a tela de seleção e confirma com meta-select', async ({ page }) => {
  await page.route('**/rest/v1/meta_connections*', route => route.fulfill({
    status:200, contentType:'application/json',
    body:JSON.stringify({ ad_account_id:null, page_id:null, status:'selecionando', token_expires_at:null }),
  }))
  await page.route('**/api/whatsapp?action=meta-pending', route => route.fulfill({
    status:200, contentType:'application/json',
    body:JSON.stringify({ pages:[{ id:'page-1', name:'Clínica A' }, { id:'page-2', name:'Clínica B' }], adAccounts:[{ id:'act_1', name:'Conta Principal' }] }),
  }))
  let selectPayload = null
  await page.route('**/api/whatsapp?action=meta-select', async route => {
    selectPayload = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' })
  })

  await page.goto('/app/settings?meta=selecting')
  await page.getByRole('button', { name:'Meta Ads', exact:true }).click()
  await expect(page.getByText('Escolha a Página e a Conta de Anúncios abaixo para concluir a conexão.')).toBeVisible()
  await page.getByLabel('Página do Facebook').selectOption('page-2')
  await page.getByLabel('Conta de Anúncios (opcional por enquanto)').selectOption('act_1')
  await page.getByRole('button', { name:'Confirmar seleção' }).click()

  await expect.poll(() => selectPayload).toEqual({ pageId:'page-2', adAccountId:'act_1' })
})

test('token perto do vencimento mostra aviso de reconexão em vez de "Conectado"', async ({ page }) => {
  await page.route('**/rest/v1/meta_connections*', route => route.fulfill({
    status:200, contentType:'application/json',
    body:JSON.stringify({ ad_account_id:'act_1', page_id:'page-1', status:'expirando', token_expires_at:'2026-10-24T00:00:00Z' }),
  }))
  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Meta Ads', exact:true }).click()
  await expect(page.getByText('⚠ Expirando — reconecte')).toBeVisible()
  await expect(page.getByRole('button', { name:'Continuar com Facebook' })).toBeVisible()
})

test('desconectar chama meta-disconnect e some o status conectado', async ({ page }) => {
  let disconnected = false
  await page.route('**/rest/v1/meta_connections*', route => route.fulfill({
    status:200, contentType:'application/json',
    body:disconnected
      ? 'null'
      : JSON.stringify({ ad_account_id:'act_1', page_id:'page-1', status:'conectado', token_expires_at:'2026-12-20T00:00:00Z' }),
  }))
  await page.route('**/api/whatsapp?action=meta-disconnect', async route => {
    disconnected = true
    await route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' })
  })

  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Meta Ads', exact:true }).click()
  await expect(page.getByText('● Conectado')).toBeVisible()
  await page.getByRole('button', { name:'Desconectar' }).click()
  await expect(page.getByRole('button', { name:'Continuar com Facebook' })).toBeVisible()
})
