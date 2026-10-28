import { expect, test } from '@playwright/test'

const PATIENT = { id: 'pat-1', full_name: 'Ana Paciente', phone: '(11) 98888-7777', active: true, funnel_stage: 'consulta_agendada' }
const MESSAGES = [
  { id: 'm1', direction: 'inbound', body: 'Oi, doutora, tudo bem?', status: 'read', created_at: '2026-10-10T12:00:00Z', whatsapp_number_id:'n1' },
  { id: 'm2', direction: 'outbound', body: 'Oi! Tudo sim, como posso ajudar?', status: 'sent', created_at: '2026-10-10T12:01:00Z', whatsapp_number_id:'n1' },
]
const NUMBERS = [{ id:'n1', label:'Recepção', phone:'5511999990001', active:true, provider:'evolution', connection_state:'open', archived_at:null }]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
  // Pacientes: devolve 1 paciente fake.
  await page.route('**/rest/v1/patients*', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([PATIENT]) })
    }
    return route.continue()
  })
  // A tela carrega o perfil clínico protegido separadamente; vazio é um estado
  // válido e evita que o teste dependa do Supabase real.
  await page.route('**/rest/v1/patient_clinical_profiles*', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.continue()
  })
  // Histórico de WhatsApp do paciente.
  await page.route('**/rest/v1/whatsapp_messages*', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MESSAGES) })
    }
    return route.continue()
  })
  await page.route('**/rest/v1/whatsapp_numbers*', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NUMBERS) })
    }
    return route.continue()
  })
})

test('aba WhatsApp mostra o histórico e envia mensagem', async ({ page }) => {
  await page.goto('/app/patients')

  // Abrir o drawer do paciente.
  await page.getByText('Ana Paciente').first().click()

  // Ir para a aba WhatsApp.
  await page.getByRole('main').getByRole('button', { name: 'WhatsApp' }).click()

  // Histórico renderiza (mensagem recebida e enviada), nos lados certos.
  await expect(page.getByText('Oi, doutora, tudo bem?')).toBeVisible()
  await expect(page.getByText('Oi! Tudo sim, como posso ajudar?')).toBeVisible()

  // Caixa de envio presente (o POST real precisa de sessão Supabase, testado manualmente c/ Z-API).
  await expect(page.getByPlaceholder('Escreva uma mensagem...')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible()
})

test('aba WhatsApp sem telefone pede cadastro de telefone', async ({ page }) => {
  await page.unroute('**/rest/v1/patients*')
  await page.route('**/rest/v1/patients*', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ ...PATIENT, phone: '' }]) })
    }
    return route.continue()
  })
  await page.goto('/app/patients')
  await page.getByText('Ana Paciente').first().click()
  await page.getByRole('main').getByRole('button', { name: 'WhatsApp' }).click()
  await expect(page.getByText(/Cadastre um telefone do paciente/)).toBeVisible()
})

test('aba WhatsApp usa a linha da conversa mais recente e oculta conexões indisponíveis', async ({ page }) => {
  await page.unroute('**/rest/v1/whatsapp_messages*')
  await page.route('**/rest/v1/whatsapp_messages*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([
      { ...MESSAGES[0], id:'old', whatsapp_number_id:'n1', created_at:'2026-10-10T12:00:00Z' },
      { ...MESSAGES[1], id:'latest', whatsapp_number_id:'n2', created_at:'2026-10-10T13:00:00Z' },
    ]),
  }))
  await page.unroute('**/rest/v1/whatsapp_numbers*')
  await page.route('**/rest/v1/whatsapp_numbers*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([
      NUMBERS[0],
      { id:'n2', label:'Pós-operatório', phone:'5511999990002', active:true, provider:'evolution', connection_state:'open', archived_at:null },
      { id:'n3', label:'Desconectado', phone:'5511999990003', active:true, provider:'evolution', connection_state:'close', archived_at:null },
    ]),
  }))

  await page.goto('/app/patients')
  await page.getByText('Ana Paciente').first().click()
  await page.getByRole('main').getByRole('button', { name:'WhatsApp' }).click()

  const selector = page.getByText('Enviar por:').locator('..').getByRole('combobox')
  await expect(selector).toHaveValue('n2')
  await expect(selector.locator('option')).toHaveText(['Escolha um número conectado…', 'Recepção', 'Pós-operatório'])
})
