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

async function mock(page, { lastRun = null, onSync } = {}) {
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/**', route => {
    if (new URL(route.request().url()).search.includes('meta-sync-range')) onSync?.()
    return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' })
  })
  await page.route('**/rest/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let body = []
    if (path.endsWith('/meta_insights')) body = INSIGHTS
    if (path.endsWith('/meta_campaigns')) body = [{ campaign_id:'C1', name:'Rinoplastia — Tráfego', status:'ACTIVE' }]
    if (path.endsWith('/meta_connections')) body = { status:'conectado', ad_account_id:'act_1', updated_at:new Date().toISOString() }
    if (path.endsWith('/meta_sync_runs')) body = lastRun
    if (path.endsWith('/meta_adsets')) body = [{ adset_id:'AS1', name:'Conjunto A', status:'ACTIVE' }]
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

test('clicar numa campanha abre os conjuntos só dela, e dá para voltar', async ({ page }) => {
  await mock(page)
  await page.goto('/app/ads')
  await page.locator('table tbody tr').first().click()

  const crumb = page.getByTestId('drill-crumb')
  await expect(crumb).toBeVisible()
  await expect(crumb.getByText('Rinoplastia — Tráfego')).toBeVisible()

  await page.getByTestId('drill-clear').click()
  await expect(page.getByTestId('drill-crumb')).toHaveCount(0)
})

test('existe atualização manual e ela consulta o Meta', async ({ page }) => {
  let chamou = false
  await mock(page, { onSync: () => { chamou = true } })
  await page.goto('/app/ads')
  await page.getByTestId('refresh-now').click()
  await expect.poll(() => chamou, { timeout:5000 }).toBe(true)
})

test('limite de taxa da Meta é explicado, não mostrado como dado em branco', async ({ page }) => {
  // Dado velho sem explicação é pior que dado velho com o motivo ao lado.
  await mock(page, { lastRun:{ started_at:new Date().toISOString(), finished_at:new Date().toISOString(),
    ok:false, counts:{}, error_code:'rate_limit', error_text:'(#17) User request limit reached', trigger:'cron' } })
  await page.goto('/app/ads')
  const bar = page.getByTestId('sync-status')
  await expect(bar.getByText('A Meta limitou as consultas', { exact:false })).toBeVisible()
  // E não pode se dizer "Sincronizado" na mesma linha em que avisa que a sincronização falhou.
  await expect(bar.getByText('Sincronizado com o Meta', { exact:false })).toHaveCount(0)
  await expect(bar.getByText('Dados de', { exact:false })).toBeVisible()
})

test('falha de autenticação manda reconectar, em vez de culpar a Meta', async ({ page }) => {
  await mock(page, { lastRun:{ started_at:new Date().toISOString(), finished_at:new Date().toISOString(),
    ok:false, counts:{}, error_code:'auth', error_text:'invalid token', trigger:'cron' } })
  await page.goto('/app/ads')
  await expect(page.getByTestId('sync-status').getByText('Reconecte em Configurações', { exact:false })).toBeVisible()
})

// Regressão: com período longo (muitos dias — ex. um ano via "Personalizado"), a largura
// somada das barras não pode ultrapassar a largura do cartão e invadir o cartão vizinho na
// fileira de 4 gráficos diários. "Trimestre" sempre mostra ~90 dias fixos (não serve pra testar
// isso); o jeito de ter mais barras na tela é abrir um intervalo bem maior em "Personalizado".
test('gráficos diários não vazam para o cartão vizinho com período longo', async ({ page }) => {
  const insightsLongos = []
  for (let i = 0; i < 365; i += 1) {
    insightsLongos.push({ level:'campaign', ref_id:'C1', campaign_id:'C1', date:dia(i), spend:100, impressions:2000, clicks:60,
      leads:i % 7 === 0 ? 2 : 0, actions:[{ action_type:'lead', value:String(i % 7 === 0 ? 2 : 0) }], updated_at:new Date().toISOString() })
  }
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/**', route => route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' }))
  await page.route('**/rest/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let body = []
    if (path.endsWith('/meta_insights')) body = insightsLongos
    if (path.endsWith('/meta_campaigns')) body = [{ campaign_id:'C1', name:'Rinoplastia — Tráfego', status:'ACTIVE' }]
    if (path.endsWith('/meta_connections')) body = { status:'conectado', ad_account_id:'act_1', updated_at:new Date().toISOString() }
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/1' }, body:JSON.stringify(body) })
  })
  // Largura generosa o bastante para a grade virar 4 colunas lado a lado, o caso que vazava.
  await page.setViewportSize({ width:1900, height:1100 })
  await page.goto('/app/ads')
  await page.getByText('Personalizado', { exact:true }).click()
  await page.locator('input[type="date"]').first().fill(dia(364))
  await page.locator('input[type="date"]').nth(1).fill(dia(0))
  await expect(page.getByTestId('chart-cpl')).toBeVisible()

  for (const id of ['chart-spend', 'chart-leads', 'chart-clicks', 'chart-cpl']) {
    const card = page.getByTestId(id)
    const track = card.locator('[role="img"][aria-label*="dias"]')
    const cardBox = await card.boundingBox()
    // O container flex não cresce para acomodar filhos que não cabem — eles vazam visualmente
    // pra fora dele e o boundingBox do próprio container não reflete isso. Por isso medimos a
    // ÚLTIMA barra renderizada (o ponto mais à direita de verdade), não o container.
    const lastBar = track.locator('> div').last()
    const lastBarBox = await lastBar.boundingBox()
    expect(lastBarBox.x + lastBarBox.width, `${id}: a última barra vaza pra fora do cartão`).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
  }
})
