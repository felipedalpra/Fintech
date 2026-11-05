import { expect, test } from '@playwright/test'

// Reproduz a tela do cliente: receitas de cirurgia lançadas como "Outra receita", com conta
// contábil do grupo Cirurgias. Antes o painel dizia "Cirurgias 0%" acima delas.
const CHART = [
  { id:'acc-root', user_id:'e2e-user-id', code:'4', name:'Receita bruta', node_type:'group', nature:'revenue', dre_section:'gross_revenue', parent_id:null, is_active:true },
  { id:'acc-cir', user_id:'e2e-user-id', code:'4.01', name:'Cirurgias', node_type:'group', nature:'revenue', dre_section:'gross_revenue', parent_id:'acc-root', is_active:true },
  { id:'acc-cir-comb', user_id:'e2e-user-id', code:'4.01.04', name:'Cirurgia combinada', node_type:'account', nature:'revenue', dre_section:'gross_revenue', parent_id:'acc-cir', is_active:true },
  { id:'acc-outras', user_id:'e2e-user-id', code:'4.09', name:'Outras receitas operacionais', node_type:'group', nature:'revenue', dre_section:'gross_revenue', parent_id:'acc-root', is_active:true },
  { id:'acc-classificar', user_id:'e2e-user-id', code:'4.09.99', name:'Receita a classificar', node_type:'account', nature:'revenue', dre_section:'gross_revenue', parent_id:'acc-outras', is_active:true },
]

// O período padrão da tela é o MÊS corrente: datas fixas sairiam do range e o painel apareceria
// vazio — foi o que aconteceu na primeira versão deste teste.
const HOJE = new Date().toISOString().slice(0, 10)
const receita = (id, description, value, chartAccountId) => ({
  id, user_id:'e2e-user-id', description, category:'outras_receitas', value,
  date:HOJE, received_date:HOJE, competence_date:HOJE, due_date:HOJE,
  status:'recebido', chart_account_id:chartAccountId, origin_label:'',
})

const EXTRA_REVENUES = [
  receita('r1', 'KATIA Z MARTINS', 7000, 'acc-cir-comb'),
  receita('r2', 'CREDITO PIX - MAIS S GRAFICAS', 17955, 'acc-cir-comb'),
  receita('r3', 'CREDITO PIX - Sumary', 3000, 'acc-classificar'),
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"configured":false,"connected":false}' }))
  await page.route('**/rest/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let body = []
    if (path.endsWith('/chart_accounts')) body = CHART
    if (path.endsWith('/extra_revenues')) body = EXTRA_REVENUES
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/0' }, body:JSON.stringify(body) })
  })
})

test('receita de cirurgia lançada como outra receita aparece em Cirurgias, não em Outras', async ({ page }) => {
  await page.goto('/app/finance')
  await page.getByRole('button', { name:'Entradas', exact:true }).click()

  const panel = page.getByTestId('revenue-by-origin')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Pelo plano de contas, igual ao DRE.')).toBeVisible()

  // R$ 24.955 das duas cirurgias, contra R$ 3.000 do que não é cirurgia.
  await expect(panel.getByText('Cirurgias')).toBeVisible()
  await expect(panel.getByText('R$ 24.955,00')).toBeVisible()
  await expect(panel.getByText('Outras receitas operacionais')).toBeVisible()
  await expect(panel.getByText('R$ 3.000,00')).toBeVisible()

  // O total do painel é a soma das partes — a invariante que não pode quebrar.
  await expect(panel.getByText('R$ 27.955,00')).toBeVisible()
})

test('o painel cabe em pouco espaço: uma barra só, não uma barra por origem', async ({ page }) => {
  await page.goto('/app/finance')
  await page.getByRole('button', { name:'Entradas', exact:true }).click()

  const panel = page.getByTestId('revenue-by-origin')
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  // Antes eram ~40px por origem empilhados; com 2 origens o painel inteiro fica abaixo de 200px.
  expect(box.height).toBeLessThan(200)

  // Um segmento por origem, dentro da MESMA barra.
  await expect(panel.getByTestId('revenue-origin-segment-Cirurgias')).toBeVisible()
  await expect(panel.getByTestId('revenue-origin-segment-Outras receitas operacionais')).toBeVisible()
})

test('clicar numa origem abre os lançamentos daquela origem', async ({ page }) => {
  await page.goto('/app/finance')
  await page.getByRole('button', { name:'Entradas', exact:true }).click()
  await page.getByTestId('revenue-origin-segment-Cirurgias').click()

  await expect(page.getByRole('heading', { name:/Receita de cirurgias/i })).toBeVisible()
  // Escopo no modal: a tabela de Entradas continua atrás dele com todos os lançamentos.
  const modal = page.getByTestId('financial-drilldown').locator('xpath=..')
  await expect(modal.getByText('Valor do indicador')).toBeVisible()
  await expect(modal.getByText('KATIA Z MARTINS').first()).toBeVisible()
  // Só os lançamentos daquele grupo: a receita que não é cirurgia fica de fora.
  await expect(modal.getByText('CREDITO PIX - Sumary')).toHaveCount(0)
})
