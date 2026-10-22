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
  await page.route('**/api/whatsapp?action=list-numbers', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ numbers, pendingEvents:[] }),
  }))

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

test('admin conecta três instâncias distintas e a quarta é recusada', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_onboarded', 'true'))
  let numbers = []

  await page.route('**/rest/v1/**', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/api/secure-profile?action=get', route => route.fulfill({ status:200, contentType:'application/json', body:'{"profile":{}}' }))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }))
  await page.route('**/api/whatsapp?action=list-numbers', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ numbers, pendingEvents:[] }),
  }))
  await page.route('**/api/whatsapp?action=provision-number', async route => {
    const payload = route.request().postDataJSON()
    if (numbers.length >= 3) {
      await route.fulfill({ status:409, contentType:'application/json', body:JSON.stringify({ error:'A clínica já possui o limite de 3 números.' }) })
      return
    }
    const index = numbers.length + 1
    const number = {
      id:`number-${index}`,
      label:payload.label,
      phone:payload.phone,
      active:true,
      assigned_user_id:null,
      provider:'evolution',
      provider_instance_name:`surgimetrics_clinic_${index}`,
      connection_state:'connecting',
    }
    numbers = [...numbers, number]
    await route.fulfill({
      status:201,
      contentType:'application/json',
      body:JSON.stringify({ ok:true, number, qrcode:{ pairingCode:`PAIR-${index}` } }),
    })
  })

  await page.goto('/app/settings')
  await page.getByRole('button', { name:'WhatsApp', exact:true }).click()

  for (const [label, phone] of [['Recepção','5511999990001'], ['Comercial','5511999990002'], ['Pós-operatório','5511999990003']]) {
    await page.getByPlaceholder('Ex: Concierge').fill(label)
    await page.getByPlaceholder('Ex: 5511999990000').fill(phone)
    await page.getByRole('button', { name:'Criar e mostrar QR Code' }).click()
    await expect(page.getByText(label, { exact:true })).toBeVisible()
  }

  expect(new Set(numbers.map(number => number.provider_instance_name)).size).toBe(3)
  await page.getByPlaceholder('Ex: Concierge').fill('Quarto número')
  await page.getByRole('button', { name:'Criar e mostrar QR Code' }).click()
  await expect(page.getByText('A clínica já possui o limite de 3 números.')).toBeVisible()
  expect(numbers).toHaveLength(3)
})

test('acompanha o QR sozinho até "open" e fecha o diálogo automaticamente, mesmo começando inativo', async ({ page }) => {
  await page.clock.install()
  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_onboarded', 'true'))

  // Reproduz exatamente o caso do bug real: o número volta inativo do connect-instance
  // (ex.: a Evolution ainda não confirmou "open" na resposta síncrona) e só o
  // connection.update assíncrono (aqui simulado via polling de list-numbers) o ativa.
  let number = {
    id:'number-evolution-1', label:'Jonas Concierge', phone:'5511999990000', active:false,
    assigned_user_id:null, provider:'evolution', provider_instance_name:'surgimetrics_e2e_123',
    connection_state:'connecting',
  }
  let connected = false
  await page.route('**/rest/v1/**', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/api/secure-profile?action=get', route => route.fulfill({ status:200, contentType:'application/json', body:'{"profile":{}}' }))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }))
  await page.route('**/api/whatsapp?action=connect-instance', route => route.fulfill({
    status:200, contentType:'application/json',
    body:JSON.stringify({ ok:true, state:'connecting', qrcode:{ base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } }),
  }))
  await page.route('**/api/whatsapp?action=list-numbers', route => {
    // `connected` só vira true depois que o teste avança o relógio — simula o
    // connection.update real chegando entre um tick de polling e o outro.
    const current = connected ? { ...number, active:true, connection_state:'open' } : number
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ numbers:[current], pendingEvents:[] }) })
  })

  await page.goto('/app/settings')
  await page.getByRole('button', { name:'WhatsApp', exact:true }).click()
  await expect(page.getByText('Jonas Concierge')).toBeVisible()

  await page.getByRole('button', { name:'Conectar / novo QR' }).click()
  await expect(page.getByTestId('evolution-qrcode')).toBeVisible()

  await page.clock.runFor(3000)
  await expect(page.getByTestId('evolution-qrcode')).toBeVisible()
  connected = true
  await page.clock.runFor(3000)

  await expect(page.getByTestId('evolution-qrcode')).toHaveCount(0)
  await expect(page.getByText('"Jonas Concierge" conectado com sucesso.')).toBeVisible()
  await expect(page.getByText('ativo', { exact:true })).toBeVisible()
})

test('avisa quando o QR expira sem ninguém escanear, sem travar a tela em "conectando"', async ({ page }) => {
  await page.clock.install()
  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_onboarded', 'true'))

  const number = {
    id:'number-evolution-1', label:'Sumary Secretária', phone:'5511999990000', active:false,
    assigned_user_id:null, provider:'evolution', provider_instance_name:'surgimetrics_e2e_456',
    connection_state:'connecting',
  }
  await page.route('**/rest/v1/**', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/api/secure-profile?action=get', route => route.fulfill({ status:200, contentType:'application/json', body:'{"profile":{}}' }))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }))
  await page.route('**/api/whatsapp?action=connect-instance', route => route.fulfill({
    status:200, contentType:'application/json',
    body:JSON.stringify({ ok:true, state:'connecting', qrcode:{ base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } }),
  }))
  // Nunca abre: o celular nunca escaneou o QR nesta simulação.
  await page.route('**/api/whatsapp?action=list-numbers', route => route.fulfill({
    status:200, contentType:'application/json', body:JSON.stringify({ numbers:[number], pendingEvents:[] }),
  }))

  await page.goto('/app/settings')
  await page.getByRole('button', { name:'WhatsApp', exact:true }).click()
  await page.getByRole('button', { name:'Conectar / novo QR' }).click()
  await expect(page.getByTestId('evolution-qrcode')).toBeVisible()

  await page.clock.runFor(40 * 3000)

  await expect(page.getByText('QR Code expirado. Clique em "Conectar / novo QR" para gerar outro.')).toBeVisible()
  // A tela não força o fechamento do QR; o admin ainda pode gerar outro pelo mesmo botão.
  await expect(page.getByRole('button', { name:'Conectar / novo QR' })).toBeEnabled()
})
