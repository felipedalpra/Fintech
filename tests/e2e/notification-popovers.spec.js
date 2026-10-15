import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
  await page.route('**/rest/v1/rpc/clinic_team', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  for (const table of ['tasks', 'opportunities']) {
    await page.route(`**/rest/v1/${table}*`, route =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.continue())
  }
})

async function expectFixedAtTopRight(page, testId) {
  const panel = page.getByTestId(testId)
  await expect(panel).toBeVisible()

  const geometry = await panel.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    return {
      position: style.position,
      top: rect.top,
      rightGap: window.innerWidth - rect.right,
      width: rect.width,
      viewportWidth: window.innerWidth,
      zIndex: Number(style.zIndex),
    }
  })

  expect(geometry.position).toBe('fixed')
  expect(geometry.top).toBeGreaterThanOrEqual(60)
  expect(geometry.rightGap).toBeGreaterThanOrEqual(10)
  expect(geometry.rightGap).toBeLessThanOrEqual(20)
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewportWidth - 24)
  expect(geometry.zIndex).toBeGreaterThan(1000)
}

test('os dois painéis de notificação abrem sobre a interface no canto superior direito', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/app/funnel')

  await page.getByRole('button', { name: 'Alertas do CRM', exact: true }).click()
  await expectFixedAtTopRight(page, 'crm-alerts-popover')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('crm-alerts-popover')).toBeHidden()

  await page.getByRole('button', { name: 'Alertas', exact: true }).click()
  await expectFixedAtTopRight(page, 'financial-alerts-popover')
})

test('painel de notificações cabe na largura do celular', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await page.goto('/app/funnel')

  await page.getByRole('button', { name: 'Alertas do CRM', exact: true }).click()
  const panel = page.getByTestId('crm-alerts-popover')
  await expect(panel).toBeVisible()

  const box = await panel.boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(12)
  expect(box.x + box.width).toBeLessThanOrEqual(378)
})
