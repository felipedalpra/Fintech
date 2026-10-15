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

  const dock = page.getByTestId('notification-bell-dock')
  await expect(dock).toBeVisible()
  const dockBox = await dock.boundingBox()
  expect(1280 - (dockBox.x + dockBox.width)).toBeLessThanOrEqual(20)
  expect(dockBox.y).toBeLessThanOrEqual(12)

  const crmButton = page.getByRole('button', { name: 'Alertas do CRM', exact: true })
  await crmButton.click()
  await expectFixedAtTopRight(page, 'crm-alerts-popover')
  const [buttonBox, panelBox] = await Promise.all([
    crmButton.boundingBox(),
    page.getByTestId('crm-alerts-popover').boundingBox(),
  ])
  expect(panelBox.y).toBeGreaterThan(buttonBox.y + buttonBox.height)
  expect(Math.abs((panelBox.x + panelBox.width) - (buttonBox.x + buttonBox.width))).toBeLessThanOrEqual(8)

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

test('sino do CRM lista cada pendência e permite rolar até a última', async ({ page }) => {
  const tasks = Array.from({ length: 12 }, (_, index) => ({
    id: `task-${index + 1}`,
    title: `Pendência ${index + 1}`,
    due_date: '2026-01-01',
    status: 'pendente',
    patients: { full_name: `Paciente ${index + 1}` },
    opportunities: null,
  }))
  await page.unroute('**/rest/v1/tasks*')
  await page.route('**/rest/v1/tasks*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tasks) }))
  await page.setViewportSize({ width: 1280, height: 620 })
  await page.goto('/app/crm-painel')

  await page.getByRole('button', { name: 'Alertas do CRM', exact: true }).click()
  await expect(page.getByTestId('crm-alert-item')).toHaveCount(12)
  await expect(page.getByTestId('crm-alerts-popover')).toContainText('12 pendências')

  const list = page.getByTestId('crm-alerts-list')
  const dimensions = await list.evaluate(element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }))
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight)
  await list.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(list.getByText('Pendência 12', { exact: true })).toBeVisible()
})
