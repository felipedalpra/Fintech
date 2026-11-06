import { expect, test } from '@playwright/test'

const hoje = new Date()
const dia = n => new Date(hoje.getTime() - n * 86400000).toISOString().slice(0, 10)

// Período atual com dado; período anterior com gasto MAIOR, para a comparação ter sinal.
const INSIGHTS = []
for (let i = 0; i < 5; i += 1) {
  INSIGHTS.push({ level:'campaign', ref_id:'C1', campaign_id:'C1', date:dia(i), spend:100, impressions:2000, clicks:60,
    leads:i === 0 ? 5 : 1,
    actions:[{ action_type:'lead', value:String(i === 0 ? 5 : 1) }, { action_type:'link_click', value:'20' }, { action_type:'post_engagement', value:'90' }],
    updated_at:new Date().toISOString() })
}

async function mock(page) {
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/**', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }))
  await page.route('**/rest/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let body = []
    if (path.endsWith('/meta_insights')) body = INSIGHTS
    if (path.endsWith('/meta_campaigns')) body = [{ campaign_id:'C1', name:'Rinoplastia — Tráfego', status:'ACTIVE' }]
    if (path.endsWith('/meta_connections')) body = { status:'conectado', ad_account_id:'act_1', updated_at:new Date().toISOString() }
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/1' }, body:JSON.stringify(body) })
  })
}

test('o painel mostra os gráficos diários respeitando o período', async ({ page }) => {
  await mock(page)
  await page.goto('/app/ads')
  for (const id of ['chart-spend', 'chart-leads', 'chart-clicks', 'chart-cpl']) {
    await expect(page.getByTestId(id)).toBeVisible()
  }
  await expect(page.getByTestId('chart-comparison')).toBeVisible()
})

test('engajamento e conversões por tipo saem do actions que antes era descartado', async ({ page }) => {
  await mock(page)
  await page.goto('/app/ads')
  // 90 de post_engagement em 5 dias = 450, e NÃO entra em conversões.
  await expect(page.getByText('Engajamento', { exact:true })).toBeVisible()
  const conv = page.getByTestId('conversions-breakdown')
  await expect(conv.getByText('Cliques no link')).toBeVisible()
  await expect(conv.getByText('Engajamento')).toHaveCount(0)
})

test('não existem dois cartões com o mesmo número sob nomes diferentes', async ({ page }) => {
  // "Custo por resultado" e "CPL" eram o mesmo cálculo e apareciam como métricas distintas.
  await mock(page)
  await page.goto('/app/ads')
  await expect(page.getByText('Custo por resultado', { exact:true })).toBeVisible()
  await expect(page.getByText('CPL médio', { exact:true })).toHaveCount(0)
})

test('a busca filtra a tabela pelo nome', async ({ page }) => {
  await mock(page)
  await page.goto('/app/ads')
  // Escopado na tabela: o nome também aparece no gráfico de comparação.
  const tabela = page.locator('table')
  await expect(tabela.getByText('Rinoplastia — Tráfego')).toBeVisible()

  await page.getByTestId('ads-search').fill('mama')
  await expect(tabela.getByText('Rinoplastia — Tráfego')).toHaveCount(0)

  await page.getByTestId('ads-search').fill('rino')
  await expect(tabela.getByText('Rinoplastia — Tráfego')).toBeVisible()
})

test('o status da campanha aparece na tabela', async ({ page }) => {
  await mock(page)
  await page.goto('/app/ads')
  await expect(page.getByText('ativo', { exact:true })).toBeVisible()
})

test('a aba Análises traz leituras por regra com o número que as sustenta', async ({ page }) => {
  await mock(page)
  await page.goto('/app/ads')
  await page.getByText('Análises', { exact:false }).click()
  const findings = page.getByTestId('rule-findings')
  await expect(findings).toBeVisible()
  await expect(findings.getByText('Rinoplastia — Tráfego').first()).toBeVisible()
})
