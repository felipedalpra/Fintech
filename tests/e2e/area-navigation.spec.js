import { expect, test } from '@playwright/test'

// Em e2e o usuário é admin (bypass), então vê as 6 áreas.
const AREAS = ['Início', 'Pacientes', 'Clínico', 'Financeiro', 'Automações', 'Configurações']

// Dispensa o overlay de onboarding (fixed, z-index alto) que bloquearia os cliques.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
})

test('barra de áreas mostra as 6 áreas', async ({ page }) => {
  await page.goto('/app/dashboard')
  const bar = page.getByTestId('area-bar')
  for (const name of AREAS) {
    await expect(bar.getByRole('button', { name: new RegExp(name) })).toBeVisible()
  }
})

test('trocar de área troca a sub-navegação e navega', async ({ page }) => {
  await page.goto('/app/dashboard')
  const bar = page.getByTestId('area-bar')
  const subNav = page.getByTestId('sub-nav')

  await bar.getByRole('button', { name: /Financeiro/ }).click()
  await expect(page).toHaveURL(/\/app\/finance$/)
  await expect(subNav.getByText('Cirurgias')).toBeVisible()
  await expect(subNav.getByText('Impostos')).toBeVisible()

  await bar.getByRole('button', { name: /Pacientes/ }).click()
  await expect(page).toHaveURL(/\/app\/funnel$/)
  await expect(subNav.getByText('Funil')).toBeVisible()
  await expect(subNav.getByText('Agenda')).toBeVisible()
  // Itens do Financeiro saíram da sub-nav da área Pacientes.
  await expect(subNav.getByText('Cirurgias')).toHaveCount(0)
})

test('área "em breve" (Clínico) mostra placeholder', async ({ page }) => {
  await page.goto('/app/dashboard')
  await page.getByTestId('area-bar').getByRole('button', { name: /Clínico/ }).click()
  await expect(page).toHaveURL(/\/app\/clinico$/)
  await expect(page.getByText('Área Clínico')).toBeVisible()
})

test('deep-link /app/finance abre na área Financeiro', async ({ page }) => {
  await page.goto('/app/finance')
  await expect(page).toHaveURL(/\/app\/finance$/)
  const subNav = page.getByTestId('sub-nav')
  await expect(subNav.getByText('Procedimentos')).toBeVisible()
  await expect(subNav.getByText('Relatórios')).toBeVisible()
})

test('funil continua acessível na área Pacientes', async ({ page }) => {
  await page.goto('/app/funnel')
  await expect(page).toHaveURL(/\/app\/funnel$/)
  const subNav = page.getByTestId('sub-nav')
  await expect(subNav.getByText('Funil')).toBeVisible()
  await expect(subNav.getByText('Pacientes')).toBeVisible()
})
