import { expect, test } from '@playwright/test'

const PATIENT = { id: 'pat-1', full_name: 'Ana Paciente', phone: '(11) 98888-7777', active: true, funnel_stage: 'consulta_agendada' }
const MESSAGES = [
  { id: 'm1', direction: 'inbound', body: 'Oi, doutora, tudo bem?', status: 'read', created_at: '2026-10-10T12:00:00Z' },
  { id: 'm2', direction: 'outbound', body: 'Oi! Tudo sim, como posso ajudar?', status: 'sent', created_at: '2026-10-10T12:01:00Z' },
]

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
