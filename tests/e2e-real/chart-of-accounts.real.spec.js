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
  await revenueModal.getByRole('button', { name:'+ Criar nova categoria' }).click()
  const quickCategory = revenueModal.getByRole('group', { name:'Criar nova categoria' })
  await quickCategory.getByPlaceholder('Ex: Cursos e congressos').fill('Categoria Rápida E2E')
  const quickGroup = quickCategory.locator('option').filter({ hasText:'Grupo E2E Local' })
  await expect(quickGroup).toHaveCount(1)
  await quickCategory.locator('select').selectOption(await quickGroup.getAttribute('value'))
  await quickCategory.getByRole('button', { name:'Criar e selecionar' }).click()
  await expect(revenueModal.locator('select').nth(1).locator('option:checked')).toContainText('Categoria Rápida E2E')
  await page.screenshot({ path:'test-results/e2e-real/categoria-rapida-receita-local.png', fullPage:true })
  const revenueValue = revenueModal.locator('input[inputmode="decimal"]')
  await revenueValue.fill('12345')
  await revenueValue.press('Tab')
  await revenueModal.getByRole('button', { name:'Salvar', exact:true }).click()
  await expect(revenueModal).toBeHidden()
  await expect(page.getByText('Receita E2E Plano', { exact:true })).toBeVisible()

  await expect.poll(async () => page.evaluate(async ({ userId, anonKey }) => {
    const headers = { apikey:anonKey, Authorization:`Bearer ${anonKey}` }
    const [proceduresResponse, revenuesResponse, ledgerResponse, quickCategoryResponse] = await Promise.all([
      fetch(`/rest/v1/procedures?user_id=eq.${userId}&name=eq.Procedimento%20E2E%20Local&select=name,chart_account_id`, { headers }),
      fetch(`/rest/v1/extra_revenues?user_id=eq.${userId}&description=eq.Receita%20E2E%20Plano&select=description,chart_account_id,value`, { headers }),
      fetch(`/rest/v1/financial_entries?user_id=eq.${userId}&description=eq.Receita%20E2E%20Plano&select=description,chart_account_id,total_amount`, { headers }),
      fetch(`/rest/v1/chart_accounts?user_id=eq.${userId}&name=eq.Categoria%20R%C3%A1pida%20E2E&select=id,code,name,parent_id`, { headers }),
    ])
    const [procedures, revenues, ledger, quickCategory] = await Promise.all([
      proceduresResponse.json(), revenuesResponse.json(), ledgerResponse.json(), quickCategoryResponse.json(),
    ])
    return {
      procedures,
      revenues,
      ledger,
      quickCategory,
      linked:Boolean(quickCategory[0]?.id && revenues[0]?.chart_account_id === quickCategory[0].id && ledger[0]?.chart_account_id === quickCategory[0].id),
    }
  }, { userId:USER_ID, anonKey:ANON_KEY }), { timeout:15_000 }).toMatchObject({
    procedures:[{ name:'Procedimento E2E Local', chart_account_id:expect.any(String) }],
    revenues:[{ description:'Receita E2E Plano', chart_account_id:expect.any(String), value:12345 }],
    ledger:[{ description:'Receita E2E Plano', chart_account_id:expect.any(String), total_amount:12345 }],
    quickCategory:[{ id:expect.any(String), code:'7.90.02', name:'Categoria Rápida E2E', parent_id:expect.any(String) }],
    linked:true,
  })

  await page.evaluate(() => window.dispatchEvent(new Event('new-expense')))
  const expenseModal = page.getByRole('heading', { name:'Novo registro' }).locator('../..')
  await expenseModal.getByPlaceholder('Ex: aluguel do consultório').fill('Despesa E2E Plano')
  await expenseModal.getByRole('button', { name:'+ Criar nova categoria' }).click()
  const quickExpenseCategory = expenseModal.getByRole('group', { name:'Criar nova categoria' })
  await quickExpenseCategory.getByPlaceholder('Ex: Cursos e congressos').fill('Despesa Rápida E2E')
  const expenseGroup = quickExpenseCategory.locator('option').filter({ hasText:'7.02 ·' })
  await expect(expenseGroup).toHaveCount(1)
  await quickExpenseCategory.locator('select').selectOption(await expenseGroup.getAttribute('value'))
  await quickExpenseCategory.getByRole('button', { name:'Criar e selecionar' }).click()
  await expect(expenseModal.locator('select').nth(1).locator('option:checked')).toContainText('Despesa Rápida E2E')
  const expenseValue = expenseModal.locator('input[inputmode="decimal"]')
  await expenseValue.fill('500')
  await expenseValue.press('Tab')
  await expenseModal.getByRole('button', { name:'Salvar', exact:true }).click()
  await page.getByRole('button', { name:'Confirmar e lançar' }).click()
  await expect(expenseModal).toBeHidden()
  await expect(page.getByText('Despesa E2E Plano', { exact:true })).toBeVisible()

  await expect.poll(async () => page.evaluate(async ({ userId, anonKey }) => {
    const headers = { apikey:anonKey, Authorization:`Bearer ${anonKey}` }
    const [expensesResponse, ledgerResponse, categoryResponse] = await Promise.all([
      fetch(`/rest/v1/expenses?user_id=eq.${userId}&description=eq.Despesa%20E2E%20Plano&select=description,chart_account_id,value`, { headers }),
      fetch(`/rest/v1/financial_entries?user_id=eq.${userId}&description=eq.Despesa%20E2E%20Plano&select=description,chart_account_id,total_amount`, { headers }),
      fetch(`/rest/v1/chart_accounts?user_id=eq.${userId}&name=eq.Despesa%20R%C3%A1pida%20E2E&select=id,code,name,parent_id`, { headers }),
    ])
    const [expenses, ledger, category] = await Promise.all([expensesResponse.json(), ledgerResponse.json(), categoryResponse.json()])
    return {
      expenses,
      ledger,
      category,
      linked:Boolean(category[0]?.id && expenses[0]?.chart_account_id === category[0].id && ledger[0]?.chart_account_id === category[0].id),
    }
  }, { userId:USER_ID, anonKey:ANON_KEY }), { timeout:15_000 }).toMatchObject({
    expenses:[{ description:'Despesa E2E Plano', chart_account_id:expect.any(String), value:500 }],
    ledger:[{ description:'Despesa E2E Plano', chart_account_id:expect.any(String), total_amount:500 }],
    category:[{ id:expect.any(String), code:expect.stringMatching(/^7\.02\.\d+$/), name:'Despesa Rápida E2E', parent_id:expect.any(String) }],
    linked:true,
  })

  await page.reload()
  await expect(page.getByText('Receita E2E Plano', { exact:true })).toBeVisible()
  await page.getByRole('button', { name:'Saídas', exact:true }).click()
  await expect(page.getByText('Despesa E2E Plano', { exact:true })).toBeVisible()

  await page.getByRole('button', { name:'DRE', exact:true }).click()
  const grossRevenueRow = page.getByText('Receita bruta', { exact:true }).locator('xpath=ancestor::tr')
  await expect(grossRevenueRow).toContainText('R$ 12.345,00')
  await page.getByRole('button', { name:'Expandir Grupo E2E Local' }).click()
  const customAccountRow = page.getByText('Categoria Rápida E2E', { exact:true }).locator('xpath=ancestor::tr')
  await expect(customAccountRow).toContainText('R$ 12.345,00')
  await page.screenshot({ path:'test-results/e2e-real/dre-plano-de-contas-local.png', fullPage:true })
  await customAccountRow.click()
  await expect(page.getByText('Receita E2E Plano', { exact:true }).last()).toBeVisible()
  await expect(page.getByText('Categoria Rápida E2E', { exact:true }).last()).toBeVisible()
  await expect(page.getByText('Pago', { exact:true })).toBeVisible()
  await page.screenshot({ path:'test-results/e2e-real/dre-conta-detalhada-local.png', fullPage:true })

  expect({ errors, failedResponses }).toEqual({ errors:[], failedResponses:[] })
})

test('recupera os lancamentos ao recarregar durante a gravacao', async ({ page }) => {
  const revenueDescription = 'Receita Recarga Protegida'
  const expenseDescription = 'Despesa Recarga Protegida'
  let delayedRevenue = false
  let delayedExpense = false

  await page.addInitScript(() => {
    localStorage.setItem('surgimetrics_onboarded', 'true')
  })
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ connected:false }),
  }))
  await page.route('**/rest/v1/extra_revenues*', async route => {
    const request = route.request()
    if (request.method() !== 'GET' && request.postData()?.includes(revenueDescription) && !delayedRevenue) {
      delayedRevenue = true
      await new Promise(resolve => setTimeout(resolve, 1_500))
    }
    await route.continue()
  })
  await page.route('**/rest/v1/expenses*', async route => {
    const request = route.request()
    if (request.method() !== 'GET' && request.postData()?.includes(expenseDescription) && !delayedExpense) {
      delayedExpense = true
      await new Promise(resolve => setTimeout(resolve, 1_500))
    }
    await route.continue()
  })
  page.on('dialog', dialog => dialog.accept())

  await page.goto('/app/finance')
  await page.getByRole('button', { name:'+ Outra receita' }).click()
  const modal = page.getByRole('heading', { name:'Novo registro' }).locator('../..')
  await modal.getByPlaceholder('Ex: contrato mensal de consultoria').fill(revenueDescription)
  const category = modal.locator('select').nth(1).locator('option').filter({ hasText:'4.07.99 ·' })
  await expect(category).toHaveCount(1)
  await modal.locator('select').nth(1).selectOption(await category.getAttribute('value'))
  await modal.locator('input[inputmode="decimal"]').fill('321')

  await modal.getByRole('button', { name:'Salvar', exact:true }).click()
  await page.reload({ waitUntil:'domcontentloaded' })

  expect(delayedRevenue).toBe(true)
  await expect(page.getByText(revenueDescription, { exact:true })).toBeVisible({ timeout:30_000 })

  await page.reload()
  await expect(page.getByText(revenueDescription, { exact:true })).toBeVisible()

  await page.evaluate(() => window.dispatchEvent(new Event('new-expense')))
  const expenseModal = page.getByRole('heading', { name:'Novo registro' }).locator('../..')
  await expenseModal.getByPlaceholder('Ex: aluguel do consultório').fill(expenseDescription)
  const expenseCategory = expenseModal.locator('select').nth(1).locator('option').filter({ hasText:'7.02.99 ·' })
  await expect(expenseCategory).toHaveCount(1)
  await expenseModal.locator('select').nth(1).selectOption(await expenseCategory.getAttribute('value'))
  await expenseModal.locator('input[inputmode="decimal"]').fill('654')
  await expenseModal.getByRole('button', { name:'Salvar', exact:true }).click()
  await page.getByRole('button', { name:'Confirmar e lançar' }).click()
  await page.reload({ waitUntil:'domcontentloaded' })

  expect(delayedExpense).toBe(true)
  await page.getByRole('button', { name:'Saídas', exact:true }).click()
  await expect(page.getByText(expenseDescription, { exact:true })).toBeVisible({ timeout:30_000 })

  await page.reload()
  await page.getByRole('button', { name:'Saídas', exact:true }).click()
  await expect(page.getByText(expenseDescription, { exact:true })).toBeVisible()
  await expect.poll(async () => page.evaluate(async ({ userId, anonKey, revenueDescription, expenseDescription }) => {
    const headers = { apikey:anonKey, Authorization:`Bearer ${anonKey}` }
    const [revenueResponse, expenseResponse] = await Promise.all([
      fetch(`/rest/v1/extra_revenues?user_id=eq.${userId}&description=eq.${encodeURIComponent(revenueDescription)}&select=description,value`, { headers }),
      fetch(`/rest/v1/expenses?user_id=eq.${userId}&description=eq.${encodeURIComponent(expenseDescription)}&select=description,value`, { headers }),
    ])
    return {
      revenues:await revenueResponse.json(),
      expenses:await expenseResponse.json(),
    }
  }, { userId:USER_ID, anonKey:ANON_KEY, revenueDescription, expenseDescription }), { timeout:15_000 }).toEqual({
    revenues:[{ description:revenueDescription, value:321 }],
    expenses:[{ description:expenseDescription, value:654 }],
  })
})
