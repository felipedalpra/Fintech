import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/rest/v1/**', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/api/secure-profile?action=get', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ profile:{ clinic:{ tradeName:'Clínica Teste' } } }),
  }))
})

test('exportação da funcionalidade aceita trimestre histórico e baixa o arquivo identificado', async ({ page }) => {
  await page.goto('/app/patients')
  await page.getByRole('button', { name:'Escolher período para exportar esta funcionalidade em Excel' }).click()

  await page.getByLabel('Período dos dados').selectOption('quarter')
  await page.getByLabel('Ano').fill('2025')
  await page.getByLabel('Trimestre').selectOption('2')
  await expect(page.getByText('2º trimestre de 2025')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name:'↓ Baixar Excel' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/Pacientes_2025-T2_.*\.xlsx$/)
})

test('exportação completa nas Configurações permite escolher um mês histórico', async ({ page }) => {
  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Exportação', exact:true }).click()

  await page.getByLabel('Período dos dados').selectOption('month')
  await page.getByLabel('Escolha o mês').fill('2024-03')

  await expect(page.getByText('Março de 2024')).toBeVisible()
  await expect(page.getByRole('button', { name:'↓ Exportar tudo em Excel' })).toBeEnabled()
})
