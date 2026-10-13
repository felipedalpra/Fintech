import { expect, test } from '@playwright/test'

// Duas conversas em números diferentes, cada um com um responsável.
const MESSAGES = [
  { id: 'm1', phone: '5551900001111', direction: 'inbound', body: 'Oi, quero agendar uma avaliação', status: 'read',
    created_at: '2026-10-13T14:00:00Z', patient_id: 'p1', whatsapp_number_id: 'N1', patients: { full_name: 'Ana Silva' } },
  { id: 'm2', phone: '5551900002222', direction: 'inbound', body: 'Qual o valor da rino?', status: 'read',
    created_at: '2026-10-13T13:00:00Z', patient_id: 'p2', whatsapp_number_id: 'N2', patients: { full_name: 'Bruno Costa' } },
]
const NUMBERS = [
  { id: 'N1', label: 'Secretária', phone: '5551', assigned_user_id: 'u-sumary' },
  { id: 'N2', label: 'Concierge', phone: '5552', assigned_user_id: 'u-jonas' },
]
const TEAM = [
  { user_id: 'u-sumary', member_email: 'sumary@clinica.com', role: 'equipe' },
  { user_id: 'u-jonas', member_email: 'jonas@clinica.com', role: 'concierge' },
]
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ } })
  await page.route('**/rest/v1/whatsapp_messages*', r => r.request().method() === 'GET' ? r.fulfill(json(MESSAGES)) : r.continue())
  await page.route('**/rest/v1/whatsapp_numbers*', r => r.request().method() === 'GET' ? r.fulfill(json(NUMBERS)) : r.continue())
  await page.route('**/rest/v1/rpc/clinic_team*', r => r.fulfill(json(TEAM))) // roster via RPC
  await page.route('**/rest/v1/opportunities*', r => r.request().method() === 'GET' ? r.fulfill(json([])) : r.continue())
})

test('inbox mostra chip de responsável por conversa', async ({ page }) => {
  await page.goto('/app/inbox')
  await expect(page.getByText('Ana Silva')).toBeVisible()
  await expect(page.getByText('Bruno Costa')).toBeVisible()
  // chip do dono (prefixo do e-mail) em cada conversa — span, não a opção do filtro
  await expect(page.locator('span').filter({ hasText: /^sumary$/ })).toBeVisible()
  await expect(page.locator('span').filter({ hasText: /^jonas$/ })).toBeVisible()
})

test('admin filtra o inbox por responsável (monitoramento)', async ({ page }) => {
  await page.goto('/app/inbox')
  await expect(page.getByText('Bruno Costa')).toBeVisible()
  // filtro "Resp." só aparece para admin (bypass e2e = admin)
  const respSelect = page.locator('select[title="Monitorar por responsável"]')
  await expect(respSelect).toBeVisible()
  await respSelect.selectOption({ label: 'sumary' })
  // fica só a conversa do número da Sumary
  await expect(page.getByText('Ana Silva')).toBeVisible()
  await expect(page.getByText('Bruno Costa')).toHaveCount(0)
})
