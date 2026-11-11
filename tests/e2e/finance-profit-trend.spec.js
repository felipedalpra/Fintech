import { expect, test } from '@playwright/test'

const year = new Date().getFullYear()
const iso = (month, day = 10) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
const CHART = [
  { id:'revenue-root', code:'4', name:'Receitas', node_type:'group', nature:'revenue', dre_section:'gross_revenue', parent_id:null, is_active:true },
  { id:'revenue', code:'4.01', name:'Receitas clínicas', node_type:'account', nature:'revenue', dre_section:'gross_revenue', parent_id:'revenue-root', is_active:true },
  { id:'expense-root', code:'6', name:'Despesas', node_type:'group', nature:'expense', dre_section:'operating_expenses', parent_id:null, is_active:true },
  { id:'expense', code:'6.01', name:'Despesas administrativas', node_type:'account', nature:'expense', dre_section:'operating_expenses', parent_id:'expense-root', is_active:true },
]
const revenues = [1, 2, 3, 4].map(month => ({
  id:`revenue-${month}`, description:`Receita ${month}`, value:month * 10000,
  date:iso(month), competence_date:iso(month), due_date:iso(month), received_date:iso(month),
  status:'recebido', chart_account_id:'revenue',
}))
const expenses = [1, 2, 3, 4].map(month => ({
  id:`expense-${month}`, description:`Despesa ${month}`, value:month * 3000,
  competence_date:iso(month), due_date:iso(month), payment_date:iso(month),
  status:'pago', chart_account_id:'expense',
}))

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ json:{ configured:false, connected:false } }))
  await page.route('**/rest/v1/**', route => {
    const table = new URL(route.request().url()).pathname.split('/').pop()
    const body = table === 'chart_accounts' ? CHART : table === 'extra_revenues' ? revenues : table === 'expenses' ? expenses : []
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/0' }, body:JSON.stringify(body) })
  })
})

test('visão geral mostra evolução da rentabilidade e detalhes no hover', async ({ page }) => {
  await page.goto('/app/finance')
  await page.getByRole('button', { name:'Este ano', exact:true }).click()

  const chart = page.getByRole('region', { name:'Evolução da rentabilidade' })
  await expect(chart).toBeVisible()
  await expect(chart.getByRole('heading', { name:'Evolução da rentabilidade' })).toBeVisible()
  await expect(chart.getByText('Margem líquida')).toBeVisible()
  await expect(chart.getByText('Melhor resultado')).toBeVisible()

  const svg = chart.locator('svg')
  const box = await svg.boundingBox()
  await svg.hover({ position:{ x:box.width * 0.28, y:box.height * 0.45 }, force:true })
  await expect(chart.locator('.finance-trend__tooltip')).toBeVisible()
  await expect(chart.locator('.finance-trend__tooltip').getByText('Receita líquida')).toBeVisible()
  await expect(chart.locator('.finance-trend__tooltip').getByText('Lucro líquido')).toBeVisible()
})
