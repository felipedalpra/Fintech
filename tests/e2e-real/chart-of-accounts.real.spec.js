import { expect, test } from '@playwright/test'

const USER_ID = process.env.E2E_USER_ID || '11111111-1111-4111-8111-111111111111'
const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY || 'local-e2e-key'

test('cria, edita e persiste categorias no banco local real', async ({ page }) => {
  const errors = []
  const failedResponses = []
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`)
  })

  await page.addInitScript(() => {
    localStorage.setItem('surgimetrics_onboarded', 'true')
  })
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ connected:false }),
  }))

  await page.goto('/app/chart-of-accounts')
  await expect(page.getByText('Preparando o plano padrão da clínica…')).toBeHidden({ timeout:30_000 })
  await expect(page.getByText('Ativo', { exact:true }).first()).toBeVisible()

  const categoriesCard = page.getByText('Categorias', { exact:true }).locator('..')
  await expect(categoriesCard).toContainText('161')

  const search = page.getByPlaceholder('Buscar código, grupo ou categoria…')
  await search.fill('Receita bruta')
  await expect(page.getByText('Receita bruta', { exact:true })).toBeVisible()
  await search.clear()

  await page.getByRole('button', { name:'+ Novo grupo' }).click()
  await page.getByPlaceholder('7.04.09').fill('7.90')
  await page.getByPlaceholder('Nome da categoria').fill('Grupo E2E Local')
  await page.locator('select').nth(2).selectOption('revenue')
  await page.locator('select').nth(3).selectOption('gross_revenue')
  await page.getByRole('button', { name:'Salvar', exact:true }).click()
  await expect(page.getByText('Grupo E2E Local', { exact:true }).first()).toBeVisible()

  await page.getByRole('button', { name:'Adicionar abaixo' }).click()
  await page.getByPlaceholder('7.04.09').fill('7.90.01')
  await page.getByPlaceholder('Nome da categoria').fill('Categoria E2E Local')
  await page.getByRole('button', { name:'Salvar', exact:true }).click()
  await expect(page.getByText('Categoria E2E Local', { exact:true }).first()).toBeVisible()

  await page.getByRole('button', { name:'Editar', exact:true }).click()
  await page.getByPlaceholder('Nome da categoria').fill('Categoria E2E Validada')
  await page.getByRole('button', { name:'Salvar', exact:true }).click()
  await expect(page.getByText('Categoria E2E Validada', { exact:true }).first()).toBeVisible()

  const persisted = await page.evaluate(async ({ userId, anonKey }) => {
    const response = await fetch(`/rest/v1/chart_accounts?user_id=eq.${userId}&code=in.(7.90,7.90.01)&select=code,name,node_type,parent_id`, {
      headers:{ apikey:anonKey, Authorization:`Bearer ${anonKey}` },
    })
    return { status:response.status, rows:await response.json() }
  }, { userId:USER_ID, anonKey:ANON_KEY })

  expect(persisted.status).toBe(200)
  expect(persisted.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ code:'7.90', name:'Grupo E2E Local', node_type:'group' }),
    expect.objectContaining({ code:'7.90.01', name:'Categoria E2E Validada', node_type:'account' }),
  ]))
  expect(persisted.rows.find(row => row.code === '7.90.01')?.parent_id).toBeTruthy()

  await page.screenshot({ path:'test-results/e2e-real/plano-de-contas-local.png', fullPage:true })

  await page.goto('/app/plans')
  await page.getByRole('button', { name:'+ Novo Procedimento' }).click()
  await page.getByPlaceholder('Ex: Mamoplastia').fill('Procedimento E2E Local')
  const price = page.getByPlaceholder('0')
  await price.fill('15000')
  await price.press('Tab')
  const procedureCategory = page.locator('select').last().locator('option').filter({ hasText:'Categoria E2E Validada' })
  await expect(procedureCategory).toHaveCount(1)
  await page.locator('select').last().selectOption(await procedureCategory.getAttribute('value'))
  await page.getByRole('button', { name:'Criar procedimento' }).click()
  await expect(page.getByText('Procedimento E2E Local', { exact:true })).toBeVisible()
  await expect(page.getByText('7.90.01 · Categoria E2E Validada', { exact:true })).toBeVisible()
  await expect.poll(async () => page.evaluate(async ({ userId, anonKey }) => {
    const response = await fetch(`/rest/v1/procedures?user_id=eq.${userId}&name=eq.Procedimento%20E2E%20Local&select=name,chart_account_id`, {
      headers:{ apikey:anonKey, Authorization:`Bearer ${anonKey}` },
    })
    return response.json()
  }, { userId:USER_ID, anonKey:ANON_KEY }), { timeout:15_000 }).toEqual([
    { name:'Procedimento E2E Local', chart_account_id:expect.any(String) },
  ])

  await page.goto('/app/finance')
  await page.getByRole('button', { name:'+ Outra receita' }).click()
  const revenueModal = page.getByRole('heading', { name:'Novo registro' }).locator('../..')
  await revenueModal.getByPlaceholder('Ex: contrato mensal de consultoria').fill('Receita E2E Plano')
  const revenueCategory = revenueModal.locator('select').nth(1).locator('option').filter({ hasText:'Categoria E2E Validada' })
  await expect(revenueCategory).toHaveCount(1)
  await revenueModal.locator('select').nth(1).selectOption(await revenueCategory.getAttribute('value'))
  const revenueValue = revenueModal.locator('input[inputmode="decimal"]')
  await revenueValue.fill('12345')
  await revenueValue.press('Tab')
  await revenueModal.getByRole('button', { name:'Salvar', exact:true }).click()
  await expect(page.getByText('Receita E2E Plano', { exact:true })).toBeVisible()

  await expect.poll(async () => page.evaluate(async ({ userId, anonKey }) => {
    const headers = { apikey:anonKey, Authorization:`Bearer ${anonKey}` }
    const [proceduresResponse, revenuesResponse, ledgerResponse] = await Promise.all([
      fetch(`/rest/v1/procedures?user_id=eq.${userId}&name=eq.Procedimento%20E2E%20Local&select=name,chart_account_id`, { headers }),
      fetch(`/rest/v1/extra_revenues?user_id=eq.${userId}&description=eq.Receita%20E2E%20Plano&select=description,chart_account_id,value`, { headers }),
      fetch(`/rest/v1/financial_entries?user_id=eq.${userId}&description=eq.Receita%20E2E%20Plano&select=description,chart_account_id,total_amount`, { headers }),
    ])
    return {
      procedures:await proceduresResponse.json(),
      revenues:await revenuesResponse.json(),
      ledger:await ledgerResponse.json(),
    }
  }, { userId:USER_ID, anonKey:ANON_KEY }), { timeout:15_000 }).toMatchObject({
    procedures:[{ name:'Procedimento E2E Local', chart_account_id:expect.any(String) }],
    revenues:[{ description:'Receita E2E Plano', chart_account_id:expect.any(String), value:12345 }],
    ledger:[{ description:'Receita E2E Plano', chart_account_id:expect.any(String), total_amount:12345 }],
  })

  await page.getByRole('button', { name:'DRE', exact:true }).click()
  const grossRevenueRow = page.getByText('Receita bruta total', { exact:true }).locator('..')
  await expect(grossRevenueRow).toContainText('R$ 12.345,00')
  await grossRevenueRow.click()
  await expect(page.getByText('Receita E2E Plano', { exact:true }).last()).toBeVisible()
  await expect(page.getByText('Categoria E2E Validada', { exact:true }).last()).toBeVisible()
  await expect(page.getByText('Pago', { exact:true })).toBeVisible()
  await page.screenshot({ path:'test-results/e2e-real/dre-plano-de-contas-local.png', fullPage:true })

  expect({ errors, failedResponses }).toEqual({ errors:[], failedResponses:[] })
})
