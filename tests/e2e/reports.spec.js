import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
})

test('central organiza relatórios por área e permite buscar', async ({ page }) => {
  await page.goto('/app/reports')

  await expect(page.getByRole('heading', { name:'Central de Relatórios' }).first()).toBeVisible()
  await expect(page.getByText('Contas a receber', { exact:true })).toBeVisible()
  await expect(page.getByText('Posição financeira do estoque', { exact:true })).toBeVisible()
  await expect(page.getByText('Cadastro de clientes', { exact:true })).toBeVisible()

  await page.locator('input[placeholder="Ex.: estoque, clientes, DRE…"]').fill('curva abc')
  await expect(page.getByText('Curva ABC de produtos', { exact:true })).toBeVisible()
  await expect(page.getByText('Curva ABC de clientes', { exact:true })).toBeVisible()
  await expect(page.getByText('Contas a receber', { exact:true })).toHaveCount(0)
})

test('período personalizado exige datas válidas antes de exportar', async ({ page }) => {
  await page.goto('/app/reports')
  await page.locator('select').first().selectOption('custom')

  await expect(page.getByText('Informe um período válido para calcular e exportar os relatórios.')).toBeVisible()
  await expect(page.getByRole('button', { name:/Exportar pacote completo/ })).toBeDisabled()
})
