import { expect, test } from '@playwright/test'

// Uma conversa com texto + imagem + áudio + documento recebidos.
const MESSAGES = [
  { id: 'd1', phone: '5551900000001', direction: 'inbound', body: 'exames.pdf', status: 'read', created_at: '2026-10-13T10:03:00Z', patient_id: 'p1', whatsapp_number_id: 'N1', msg_type: 'document', media_url: 'https://ex/exames.pdf', media_mime: 'application/pdf', patients: { full_name: 'Ana Paula' } },
  { id: 'a1', phone: '5551900000001', direction: 'inbound', body: '', status: 'read', created_at: '2026-10-13T10:02:00Z', patient_id: 'p1', whatsapp_number_id: 'N1', msg_type: 'audio', media_url: 'https://ex/audio.ogg', media_mime: 'audio/ogg', patients: { full_name: 'Ana Paula' } },
  { id: 'i1', phone: '5551900000001', direction: 'inbound', body: 'minha foto', status: 'read', created_at: '2026-10-13T10:01:00Z', patient_id: 'p1', whatsapp_number_id: 'N1', msg_type: 'image', media_url: 'https://ex/foto.jpg', media_mime: 'image/jpeg', patients: { full_name: 'Ana Paula' } },
  { id: 't1', phone: '5551900000001', direction: 'inbound', body: 'Oi, tudo bem?', status: 'read', created_at: '2026-10-13T10:00:00Z', patient_id: 'p1', whatsapp_number_id: 'N1', msg_type: 'text', media_url: null, media_mime: null, patients: { full_name: 'Ana Paula' } },
]
const NUMBERS = [{ id: 'N1', label: 'Secretária', phone: '5551', assigned_user_id: null, active:true, provider:'evolution', connection_state:'open', archived_at:null }]
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

test('mídia clínica privada só é aberta por URL assinada autenticada', async ({ page }) => {
  const privateMessage = [{ ...MESSAGES[2], id:'private-1', media_url:'storage://wa-media-inbound/owner/incoming/N1/foto.jpg' }]
  let requestedMessageId = null
  await page.route('**/rest/v1/whatsapp_messages*', route => route.fulfill(json(privateMessage)))
  await page.route('**/api/whatsapp?action=media-url', async route => {
    requestedMessageId = route.request().postDataJSON()?.messageId
    await route.fulfill(json({ url:'https://signed.example/foto.jpg', expiresIn:300 }))
  })
  await page.goto('/app/inbox')
  await page.getByText('Ana Paula').first().click()
  await expect(page.locator('img[src="https://signed.example/foto.jpg"]')).toBeVisible()
  expect(requestedMessageId).toBe('private-1')
})

test('lista mostra rótulo de mídia no preview da conversa', async ({ page }) => {
  await page.goto('/app/inbox')
  // última mensagem é o documento → preview mostra o rótulo de mídia
  await expect(page.getByText(/^Documento: exames\.pdf$/)).toBeVisible()
})

test('composer tem seletor de emoji que insere no texto', async ({ page }) => {
  await page.goto('/app/inbox')
  await page.getByText('Ana Paula').first().click()
  await page.getByRole('button', { name: 'Inserir emoji' }).click()
  await page.getByRole('button', { name: '🎉' }).click()
  await expect(page.locator('textarea[placeholder="Responder..."]')).toHaveValue(/🎉/)
})

test('composer oferece anexo e gravação de áudio', async ({ page }) => {
  await page.goto('/app/inbox')
  await page.getByText('Ana Paula').first().click()
  await expect(page.getByRole('button', { name: 'Anexar arquivo' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gravar áudio' })).toBeVisible()
})

test('upload de vídeo envia somente referência privada ao backend', async ({ page }) => {
  let payload = null
  await page.route('**/storage/v1/object/wa-media/**', route => route.fulfill(json({ Key:'owner/video.mp4' })))
  await page.route('**/api/whatsapp?action=message', async route => {
    payload = route.request().postDataJSON()
    await route.fulfill(json({ ok:true, messageId:'sent-video' }))
  })
  await page.goto('/app/inbox')
  await page.getByText('Ana Paula').first().click()
  await page.locator('input[type="file"]').setInputFiles({ name:'video.mp4', mimeType:'video/mp4', buffer:Buffer.from('video') })
  await expect.poll(() => payload).not.toBeNull()
  expect(payload.type).toBe('video')
  expect(payload.mediaUrl).toMatch(/^storage:\/\/wa-media\//)
  expect(payload.mediaUrl).not.toContain('https://')
})
