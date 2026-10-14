import { expect, test } from '@playwright/test'

const NUMBERS = [{ id: 'n1', label: 'Concierge', phone: '5511999990000' }]
const MESSAGES = [
  { id: 'm3', phone: '5511977776666', direction: 'inbound', body: 'Quero fazer rino', status: 'read', created_at: '2026-10-10T13:00:00Z', patient_id: null, whatsapp_number_id: 'n1', patients: null },
  { id: 'm2', phone: '5511988887777', direction: 'outbound', body: 'Oi! Como ajudo?\nPode me contar o que procura?', status: 'read', created_at: '2026-10-10T12:05:00Z', patient_id: 'p1', whatsapp_number_id: 'n1', patients: { full_name: 'Ana Silva' } },
  { id: 'm1', phone: '5511988887777', direction: 'inbound', body: 'Oi, doutora', status: 'read', created_at: '2026-10-10T12:00:00Z', patient_id: 'p1', whatsapp_number_id: 'n1', patients: { full_name: 'Ana Silva' } },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
  await page.route('**/rest/v1/whatsapp_messages*', route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MESSAGES) })
    return route.continue()
  })
  await page.route('**/rest/v1/whatsapp_numbers*', route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NUMBERS) })
    return route.continue()
  })
})

test('inbox lista conversas (inclusive não atribuídas) e abre os threads', async ({ page }) => {
  await page.goto('/app/inbox')
  await expect(page).toHaveURL(/\/app\/inbox$/)
  await expect(page.getByRole('heading', { name: 'WhatsApp' })).toBeVisible()

  // Conversa atribuída (Ana) e a não atribuída (número cru) aparecem na lista.
  const sidebar = page.locator('.wa-sidebar')
  await expect(sidebar.getByText('Ana Silva')).toBeVisible()
  await expect(sidebar.getByText('5511977776666')).toBeVisible()
  await expect(page.getByText(/não atribuída/).first()).toBeVisible()

  // Abrir a conversa da Ana → thread com as duas mensagens + caixa de resposta.
  await sidebar.getByText('Ana Silva').click()
  await expect(page.getByText('Oi, doutora').first()).toBeVisible()
  const multiline = page.locator('.wa-message-text').filter({ hasText: /Oi! Como ajudo\?\s+Pode me contar o que procura\?/ })
  await expect(multiline).toBeVisible()
  await expect(multiline).toHaveCSS('white-space', 'pre-wrap')
  await expect(page.locator('[title="Lida"]')).toBeVisible()
  await expect(page.getByPlaceholder('Responder...')).toBeVisible()

  // Abrir a conversa NÃO atribuída → dá pra responder mesmo sem paciente vinculado.
  await sidebar.getByText('5511977776666').click()
  await expect(page.getByText('Quero fazer rino').first()).toBeVisible()
  await expect(page.getByPlaceholder('Responder...')).toBeVisible()
})
