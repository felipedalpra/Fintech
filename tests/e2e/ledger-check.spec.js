import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
})

test('conferência do razão mostra o gate de prontidão e as reconciliações', async ({ page }) => {
  await page.goto('/app/ledger-check')

  await expect(page.getByRole('heading', { name:'Conferência do Razão' }).first()).toBeVisible()
  await expect(page.getByText('Gate da Fase 10 — prontidão dos dados')).toBeVisible()
  await expect(page.getByText('A) Razão × Fonte — reconciliação (deve bater a centavo)')).toBeVisible()
  await expect(page.getByText('B) Razão × Dashboard — comparativo (diferenças esperadas anotadas)')).toBeVisible()
  await expect(page.getByText('Pronto para revisão final', { exact:false })).toBeVisible()
})
