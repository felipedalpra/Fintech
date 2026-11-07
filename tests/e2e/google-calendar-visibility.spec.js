import { expect, test } from '@playwright/test'

async function base(page) {
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ } })
  await page.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'content-range': '0-0/0' }, body: '[]' }))
  await page.route('**/rpc/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

async function statusResponde(page, { status = 200, body = {} } = {}) {
  // O Playwright casa as rotas da ULTIMA registrada para a primeira. O catch-all tem que
  // vir ANTES da rota especifica, senao ele engole o status e o teste mede outra coisa.
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
  await page.route('**/api/google/calendar**', route => {
    if (!route.request().url().includes('action=status')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test('falha ao consultar o status avisa, em vez de esconder o botão', async ({ page }) => {
  // O sintoma relatado: "o botão de conectar o Google não aparece". Some por erro,
  // e a tela ficava indistinguível de uma clínica sem a integração.
  await base(page)
  await statusResponde(page, { status: 500, body: { error: 'relation "google_calendar_connections" does not exist' } })
  await page.goto('/app/calendar')
  const aviso = page.getByTestId('google-status-error')
  await expect(aviso).toBeVisible()
  await expect(aviso.locator('button')).toHaveAttribute('title', /não foi possível verificar/i)
})

test('clínica sem a integração continua sem ver nada do Google', async ({ page }) => {
  // "Não configurado" de verdade: esconder é o comportamento certo e não é erro.
  await base(page)
  await statusResponde(page, { body: { configured: false, connected: false } })
  await page.goto('/app/calendar')
  await expect(page.locator('.cal-toolbar')).toBeVisible()
  await expect(page.getByTestId('google-status-error')).toHaveCount(0)
  await expect(page.locator('.google-calendar-button')).toHaveCount(0)
})

test('sem permissão o botão aparece desabilitado e explica — não some', async ({ page }) => {
  await base(page)
  await statusResponde(page, { body: { configured: true, connected: false, canManage: false } })
  await page.goto('/app/calendar')
  const botao = page.locator('.google-calendar-button')
  await expect(botao).toBeVisible()
  await expect(botao).toBeDisabled()
  await expect(botao).toHaveAttribute('title', /administrador da clínica/i)
})

test('com permissão aparece o botão de conectar', async ({ page }) => {
  await base(page)
  await statusResponde(page, { body: { configured: true, connected: false, canManage: true } })
  await page.goto('/app/calendar')
  const botao = page.locator('.google-calendar-button')
  await expect(botao).toBeVisible()
  await expect(botao).toBeEnabled()
  await expect(botao).toContainText('Conectar')
})
