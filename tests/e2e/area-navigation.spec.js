import { expect, test } from '@playwright/test'

// Em e2e o usuário é admin (bypass), então vê todas as áreas ativas.
const AREAS = ['Hoje', 'Relacionamento', 'Atendimentos', 'Clínico', 'Financeiro', 'Configurações']

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
  await expect(subNav.getByText('Financeiro', { exact:true })).toBeVisible()
  await expect(subNav.getByText('Relatórios')).toBeVisible()
  await expect(subNav.getByText('Impostos')).toHaveCount(0)

  await bar.getByRole('button', { name: /Relacionamento/ }).click()
  await expect(page).toHaveURL(/\/app\/funnel$/)
  await expect(subNav.getByText('Funil')).toBeVisible()
  // Itens exclusivos do Financeiro saíram da sub-nav da área Pacientes.
  await expect(subNav.getByText('Relatórios')).toHaveCount(0)
})

test('área Clínica abre o prontuário ativo', async ({ page }) => {
  await page.route('**/api/secure-profile?action=get', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ profile:{ doctor:{ fullName:'Dra. Vitória', registrationId:'CRM-SP 123' } } }) }))
  await page.route('**/rest/v1/patients*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify([{ id:'p1', full_name:'Ana Clínica', date_of_birth:'1990-04-10', active:true, start_date:'2026-01-10' }]) }))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill({ status:200, contentType:'application/json', body:'true' }))
  await page.route('**/rest/v1/medical_records*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/medical_record_addenda*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.goto('/app/dashboard')
  await page.getByTestId('area-bar').getByRole('button', { name: /Clínico/ }).click()
  await expect(page).toHaveURL(/\/app\/clinical-records$/)
  await expect(page.getByTestId('clinical-records-page')).toBeVisible()
  await page.getByRole('button', { name:/Ana Clínica/ }).click()
  await expect(page.getByTestId('medical-record')).toBeVisible()
  await expect(page.getByRole('button', { name:'+ Nova evolução' })).toBeEnabled()
})

test('deep-link /app/finance abre na área Financeiro', async ({ page }) => {
  await page.goto('/app/finance')
  await expect(page).toHaveURL(/\/app\/finance$/)
  const subNav = page.getByTestId('sub-nav')
  await expect(subNav.getByText('Procedimentos')).toBeVisible()
  await expect(subNav.getByText('Relatórios')).toBeVisible()
})

test('deep-link antigo de impostos redireciona para o dashboard', async ({ page }) => {
  await page.goto('/app/impostos')
  await expect(page).toHaveURL(/\/app\/dashboard$/)
  await expect(page.getByTestId('sub-nav').getByText('Impostos')).toHaveCount(0)
})

test('funil continua acessível na área Pacientes', async ({ page }) => {
  await page.goto('/app/funnel')
  await expect(page).toHaveURL(/\/app\/funnel$/)
  const subNav = page.getByTestId('sub-nav')
  await expect(subNav.getByText('Funil')).toBeVisible()
  await expect(subNav.getByText('Pacientes')).toBeVisible()
})
