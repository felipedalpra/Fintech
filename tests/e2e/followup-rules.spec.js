import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ } })
  await page.route('**/rest/v1/followup_rules*', route =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      : route.continue())
})

test('admin vê a aba Régua de follow-up e o formulário de nova regra', async ({ page }) => {
  await page.goto('/app/settings')
  await page.getByRole('button', { name: 'Régua de follow-up' }).click()
  await expect(page.getByText('Nova regra')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Adicionar regra' })).toBeVisible()
  // Campo de estágio e de dias presentes.
  await expect(page.getByText('Ao entrar em', { exact: false })).toHaveCount(0) // sem regras ainda
})
