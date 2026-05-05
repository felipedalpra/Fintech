import { expect, test } from '@playwright/test'

const LAST_APP_PATH_KEY = 'surgimetrics_last_app_path'
const DRAFT_KEY = 'surgimetrics_workspace_draft_e2e-user-id'

test('restaura a ultima tela ao entrar em /app', async ({ page }) => {
  await page.addInitScript(([routeKey, routeValue]) => {
    window.sessionStorage.setItem(routeKey, routeValue)
  }, [LAST_APP_PATH_KEY, '/app/reports'])

  await page.goto('/app')
  await expect(page).toHaveURL(/\/app\/reports$/)
})

test('mantem e restaura rascunho da sessao no workspace', async ({ page }) => {
  const draftPayload = {
    procedures:[],
    surgeries:[],
    consultations:[],
    products:[],
    productSales:[],
    productPurchases:[],
    extraRevenues:[],
    expenses:[{
      id:'expense-e2e',
      description:'Despesa de rascunho E2E',
      category:'outros',
      value:123.45,
      dueDate:'2026-05-05',
      paymentDate:'',
      status:'aberto',
    }],
    assets:[],
    liabilities:[],
    goals:[],
  }

  await page.addInitScript(([routeKey, routeValue, draftKey, draftValue]) => {
    window.sessionStorage.setItem(routeKey, routeValue)
    window.sessionStorage.setItem(draftKey, draftValue)
  }, [LAST_APP_PATH_KEY, '/app/finance', DRAFT_KEY, JSON.stringify(draftPayload)])

  await page.goto('/app')
  await expect(page).toHaveURL(/\/app\/finance$/)
  await expect(page.getByRole('heading', { name:'Financeiro' })).toBeVisible()

  const storedDraft = await page.evaluate((draftKey) => {
    const raw = window.sessionStorage.getItem(draftKey)
    return raw ? JSON.parse(raw) : null
  }, DRAFT_KEY)

  expect(storedDraft?.expenses?.length).toBe(1)
  expect(storedDraft?.expenses?.[0]?.description).toBe('Despesa de rascunho E2E')
})

test('restaura modal aberto com digitacao apos reload', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('surgimetrics_onboarded', 'true')
  })

  await page.goto('/app/finance')
  await expect(page).toHaveURL(/\/app\/finance$/)

  await page.getByRole('button', { name:/Outra receita/i }).click()
  await expect(page.getByRole('heading', { name:'Novo registro' })).toBeVisible()

  const descriptionInput = page.getByPlaceholder('Ex: contrato mensal de consultoria')
  await descriptionInput.fill('Receita modal persistida E2E')
  await page.reload()

  await expect(page).toHaveURL(/\/app\/finance$/)
  await expect(page.getByRole('heading', { name:'Novo registro' })).toBeVisible()
  await expect(page.getByPlaceholder('Ex: contrato mensal de consultoria')).toHaveValue('Receita modal persistida E2E')
})
