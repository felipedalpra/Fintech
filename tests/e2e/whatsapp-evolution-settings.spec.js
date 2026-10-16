import { expect, test } from '@playwright/test'

test('admin cria instância Evolution por QR sem receber credenciais da infraestrutura', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_onboarded', 'true'))

  let numbers = []
  let provisionPayload
  await page.route('**/rest/v1/**', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:'[]',
  }))
  await page.route('**/rest/v1/whatsapp_numbers*', async route => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status:200, contentType:'application/json', body:'[]' })
      return
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(numbers) })
  })
  await page.route('**/api/secure-profile?action=get', route => route.fulfill({ status:200, contentType:'application/json', body:'{"profile":{}}' }))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }))
  await page.route('**/api/whatsapp?action=provision-number', async route => {
    provisionPayload = route.request().postDataJSON()
    numbers = [{
      id:'number-evolution-1',
      label:provisionPayload.label,
      phone:provisionPayload.phone,
      active:true,
      assigned_user_id:null,
      provider:'evolution',
      provider_instance_name:'surgimetrics_e2e_123',
      connection_state:'connecting',
      last_health_at:'2026-10-16T15:00:00.000Z',
      webhook_verified_at:'2026-10-16T15:00:00.000Z',
    }]
    await route.fulfill({
      status:201,
      contentType:'application/json',
      body:JSON.stringify({
        ok:true,
        number:numbers[0],
        qrcode:{ base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' },
      }),
    })
  })

  await page.goto('/app/settings')
  await page.getByRole('button', { name:'WhatsApp', exact:true }).click()

  await expect(page.getByRole('heading', { name:'Números de WhatsApp' })).toBeVisible()
  await expect(page.getByLabel('Provedor')).toHaveValue('evolution')
  await expect(page.getByText('URL da instância Z-API')).toHaveCount(0)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)

  await page.getByPlaceholder('Ex: Concierge').fill('Homologação')
  await page.getByPlaceholder('Ex: 5511999990000').fill('5511999990000')
  await page.getByRole('button', { name:'Criar e mostrar QR Code' }).click()

  await expect(page.getByTestId('evolution-qrcode')).toBeVisible()
  await expect(page.getByAltText('QR Code de Homologação')).toBeVisible()
  await expect(page.getByText('Evolution', { exact:true })).toBeVisible()
  await expect(page.getByText('aguardando QR')).toBeVisible()
  expect(provisionPayload).toEqual({ label:'Homologação', phone:'5511999990000' })
  expect(provisionPayload).not.toHaveProperty('apiKey')
  expect(provisionPayload).not.toHaveProperty('instanceUrl')
})
