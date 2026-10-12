import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
})

test('conferência do razão mostra a integridade da fonte ativa e as reconciliações', async ({ page }) => {
  await page.goto('/app/ledger-check')

  await expect(page.getByRole('heading', { name:'Conferência do Razão' }).first()).toBeVisible()
  await expect(page.getByText('Integridade da fonte financeira')).toBeVisible()
  await expect(page.getByText('A) Razão × Fonte — reconciliação (deve bater a centavo)')).toBeVisible()
  await expect(page.getByText('B) Razão × Métricas — consistência dos consumidores')).toBeVisible()
  await expect(page.getByText('Fonte ativa · dados íntegros', { exact:false })).toBeVisible()
})
