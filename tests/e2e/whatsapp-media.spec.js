import { expect, test } from '@playwright/test'

// Uma conversa com texto + imagem + áudio + documento recebidos.
const MESSAGES = [
  { id: 'd1', phone: '5551900000001', direction: 'inbound', body: 'exames.pdf', status: 'read', created_at: '2026-10-13T10:03:00Z', patient_id: 'p1', whatsapp_number_id: 'N1', msg_type: 'document', media_url: 'https://ex/exames.pdf', media_mime: 'application/pdf', patients: { full_name: 'Ana Paula' } },
  { id: 'a1', phone: '5551900000001', direction: 'inbound', body: '', status: 'read', created_at: '2026-10-13T10:02:00Z', patient_id: 'p1', whatsapp_number_id: 'N1', msg_type: 'audio', media_url: 'https://ex/audio.ogg', media_mime: 'audio/ogg', patients: { full_name: 'Ana Paula' } },
  { id: 'i1', phone: '5551900000001', direction: 'inbound', body: 'minha foto', status: 'read', created_at: '2026-10-13T10:01:00Z', patient_id: 'p1', whatsapp_number_id: 'N1', msg_type: 'image', media_url: 'https://ex/foto.jpg', media_mime: 'image/jpeg', patients: { full_name: 'Ana Paula' } },
  { id: 't1', phone: '5551900000001', direction: 'inbound', body: 'Oi, tudo bem?', status: 'read', created_at: '2026-10-13T10:00:00Z', patient_id: 'p1', whatsapp_number_id: 'N1', msg_type: 'text', media_url: null, media_mime: null, patients: { full_name: 'Ana Paula' } },
]
const NUMBERS = [{ id: 'N1', label: 'Secretária', phone: '5551', assigned_user_id: null }]
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ } })
  await page.route('**/rest/v1/whatsapp_messages*', r => r.request().method() === 'GET' ? r.fulfill(json(MESSAGES)) : r.continue())
  await page.route('**/rest/v1/whatsapp_numbers*', r => r.request().method() === 'GET' ? r.fulfill(json(NUMBERS)) : r.continue())
  await page.route('**/rest/v1/rpc/clinic_team*', r => r.fulfill(json([])))
  await page.route('**/rest/v1/opportunities*', r => r.request().method() === 'GET' ? r.fulfill(json([])) : r.continue())
})

test('inbox renderiza imagem, áudio e documento recebidos', async ({ page }) => {
  await page.goto('/app/inbox')
  await page.getByText('Ana Paula').first().click()
  await expect(page.locator('img[src="https://ex/foto.jpg"]')).toBeVisible()
  await expect(page.locator('audio')).toHaveCount(1)
  await expect(page.getByRole('link', { name: /exames\.pdf/ })).toBeVisible()
  await expect(page.getByText('Oi, tudo bem?')).toBeVisible()
})

test('lista mostra rótulo de mídia no preview da conversa', async ({ page }) => {
  await page.goto('/app/inbox')
  // última mensagem é o documento → preview mostra o rótulo de mídia
  await expect(page.getByText(/📄 Documento/)).toBeVisible()
})

test('composer tem seletor de emoji que insere no texto', async ({ page }) => {
  await page.goto('/app/inbox')
  await page.getByText('Ana Paula').first().click()
  await page.getByRole('button', { name: 'Inserir emoji' }).click()
  await page.getByRole('button', { name: '🎉' }).click()
  await expect(page.locator('input[placeholder="Responder..."]')).toHaveValue(/🎉/)
})
