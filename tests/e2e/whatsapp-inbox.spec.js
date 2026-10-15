import { expect, test } from '@playwright/test'

const NUMBERS = [{ id: 'n1', label: 'Concierge', phone: '5511999990000' }]
const MESSAGES = [
  { id: 'm3', phone: '5511977776666', direction: 'inbound', body: 'Quero fazer rino', status: 'read', created_at: '2026-10-10T13:00:00Z', patient_id: null, whatsapp_number_id: 'n1', patients: null },
  { id: 'm2', phone: '5511988887777', direction: 'outbound', body: 'Oi! Como ajudo?\nPode me contar o que procura?', status: 'read', created_at: '2026-10-10T12:05:00Z', patient_id: 'p1', whatsapp_number_id: 'n1', patients: { full_name: 'Ana Silva' } },
  { id: 'm1', phone: '5511988887777', direction: 'inbound', body: 'Oi, doutora', status: 'read', created_at: '2026-10-10T12:00:00Z', patient_id: 'p1', whatsapp_number_id: 'n1', patients: { full_name: 'Ana Silva' } },
]

const LONG_MESSAGES = [
  ...Array.from({ length: 36 }, (_, index) => ({
    id: `long-${index}`,
    phone: '5511988887777',
    direction: index % 3 === 0 ? 'outbound' : 'inbound',
    body: `Mensagem de acompanhamento ${36 - index}\nCom conteúdo suficiente para validar a rolagem do histórico.`,
    status: 'read',
    created_at: new Date(Date.UTC(2026, 9, 10, 18, 0) - index * 60_000).toISOString(),
    patient_id: 'p1',
    whatsapp_number_id: 'n1',
    patients: { full_name: 'Ana Silva' },
  })),
  ...Array.from({ length: 18 }, (_, index) => ({
    id: `contact-${index}`,
    phone: `5511977${String(index).padStart(6, '0')}`,
    direction: 'inbound',
    body: `Nova conversa ${index + 1}`,
    status: 'read',
    created_at: new Date(Date.UTC(2026, 9, 10, 16, 0) - index * 60_000).toISOString(),
    patient_id: `patient-${index}`,
    whatsapp_number_id: 'n1',
    patients: { full_name: `Contato ${String(index + 1).padStart(2, '0')}` },
  })),
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
  await page.route('**/rest/v1/rpc/clinic_team*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
})

test('mantém lista e histórico roláveis com o compositor sempre visível', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.unroute('**/rest/v1/whatsapp_messages*')
  await page.route('**/rest/v1/whatsapp_messages*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LONG_MESSAGES) }))

  await page.goto('/app/inbox')
  await expect(page.getByPlaceholder('Responder...')).toBeVisible()
  await expect(page.locator('.wa-brand-icon [data-testid="whatsapp-brand-logo"]')).toBeVisible()

  const geometry = await page.evaluate(() => {
    const inbox = document.querySelector('.wa-inbox').getBoundingClientRect()
    const composer = document.querySelector('.wa-composer').getBoundingClientRect()
    const messages = document.querySelector('.wa-messages')
    const list = document.querySelector('.wa-conversation-list')
    return {
      inboxBottom: inbox.bottom,
      composerBottom: composer.bottom,
      viewportHeight: window.innerHeight,
      mainOverflow: getComputedStyle(document.querySelector('main[data-page="inbox"]')).overflow,
      messagesOverflow: getComputedStyle(messages).overflowY,
      messagesClientHeight: messages.clientHeight,
      messagesScrollHeight: messages.scrollHeight,
      listClientHeight: list.clientHeight,
      listScrollHeight: list.scrollHeight,
    }
  })

  expect(geometry.mainOverflow).toBe('hidden')
  expect(geometry.messagesOverflow).toBe('auto')
  expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.inboxBottom + 1)
  expect(geometry.inboxBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
  expect(geometry.messagesScrollHeight).toBeGreaterThan(geometry.messagesClientHeight)
  expect(geometry.listScrollHeight).toBeGreaterThan(geometry.listClientHeight)

  const messages = page.locator('.wa-messages')
  await messages.evaluate(element => { element.scrollTop = 0 })
  await expect.poll(() => messages.evaluate(element => element.scrollTop)).toBe(0)
  await messages.evaluate(element => { element.scrollTop = 120 })
  await expect.poll(() => messages.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

  const list = page.locator('.wa-conversation-list')
  await list.evaluate(element => { element.scrollTop = 160 })
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
})

test('mantém o campo de resposta acessível no celular', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await page.unroute('**/rest/v1/whatsapp_messages*')
  await page.route('**/rest/v1/whatsapp_messages*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LONG_MESSAGES) }))

  await page.goto('/app/inbox')
  const composer = page.locator('.wa-composer')
  await expect(composer).toBeVisible()
  const box = await composer.boundingBox()
  expect(box.y + box.height).toBeLessThanOrEqual(701)
  await expect(page.locator('.wa-messages')).toHaveCSS('overflow-y', 'auto')
})

test('inbox lista conversas (inclusive não atribuídas) e abre os threads', async ({ page }) => {
  await page.goto('/app/inbox')
  await expect(page).toHaveURL(/\/app\/inbox$/)
  await expect(page.locator('.wa-sidebar-title').getByText('Conversas')).toBeVisible()

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
