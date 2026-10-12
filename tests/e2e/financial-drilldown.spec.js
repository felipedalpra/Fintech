import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
})

test('indicador financeiro abre o modal com lançamentos e conferência', async ({ page }) => {
  await page.goto('/app/dashboard')

  await page.getByRole('button', { name:'Ver lançamentos de Faturamento bruto' }).click()

  await expect(page.getByRole('heading', { name:'Faturamento bruto' })).toBeVisible()
  await expect(page.getByText('Valor do indicador')).toBeVisible()
  await expect(page.getByText('Lançamentos', { exact:true })).toBeVisible()
  await expect(page.getByText('Total reconciliado')).toBeVisible()
  await expect(page.getByPlaceholder('Buscar por origem, descrição, pessoa, categoria ou status…')).toBeVisible()
})
