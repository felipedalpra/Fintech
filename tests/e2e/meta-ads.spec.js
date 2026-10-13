import { expect, test } from '@playwright/test'

// Insights diários (nível campanha): C1 em 2 dias, C2 em 1 dia.
// Agregado esperado: C1 gasto 150 / impr 1500 / cliques 30 / leads 3 → CTR 2,00% CPC R$5 CPL R$50.
//                    C2 gasto 80  / impr 800  / cliques 8  / leads 0 → CPL R$0 (sem leads).
// Totais: gasto 230 / impr 2300 / cliques 38 / CTR 1,65% / leads 3 / CPL médio R$76,67.
const CAMPAIGN_INSIGHTS = [
  { level: 'campaign', ref_id: 'C1', campaign_id: 'C1', date: '2026-10-01', spend: 100, impressions: 1000, clicks: 20, leads: 2, updated_at: '2026-10-12T09:00:00Z' },
  { level: 'campaign', ref_id: 'C1', campaign_id: 'C1', date: '2026-10-02', spend: 50, impressions: 500, clicks: 10, leads: 1, updated_at: '2026-10-12T09:00:00Z' },
  { level: 'campaign', ref_id: 'C2', campaign_id: 'C2', date: '2026-10-01', spend: 80, impressions: 800, clicks: 8, leads: 0, updated_at: '2026-10-12T09:00:00Z' },
]
const ADSET_INSIGHTS = [
  { level: 'adset', ref_id: 'AS1', campaign_id: 'C1', date: '2026-10-01', spend: 150, impressions: 1500, clicks: 30, leads: 3, updated_at: '2026-10-12T09:00:00Z' },
]
const CAMPAIGNS = [
  { campaign_id: 'C1', name: 'Rinoplastia — Interesse SP', status: 'ACTIVE' },
  { campaign_id: 'C2', name: 'Mamoplastia — Lookalike', status: 'PAUSED' },
]
const ADSETS = [{ adset_id: 'AS1', name: 'Conjunto Reels 25-44', status: 'ACTIVE' }]
// Alcance/frequência (deduplicados por período) — conta + campanhas + conjunto.
const REACH = [
  { level: 'account', ref_id: 'account', reach: 101200, frequency: 3.18 },
  { level: 'campaign', ref_id: 'C1', reach: 42300, frequency: 3.05 },
  { level: 'campaign', ref_id: 'C2', reach: 31800, frequency: 3.03 },
  { level: 'adset', ref_id: 'AS1', reach: 9400, frequency: 4.70 },
]

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
  await page.route('**/rest/v1/meta_insights*', route => {
    if (route.request().method() !== 'GET') return route.continue()
    const url = route.request().url()
    if (url.includes('level=eq.adset')) return route.fulfill(json(ADSET_INSIGHTS))
    if (url.includes('level=eq.ad')) return route.fulfill(json([]))
    return route.fulfill(json(CAMPAIGN_INSIGHTS))
  })
  await page.route('**/rest/v1/meta_campaigns*', route =>
    route.request().method() === 'GET' ? route.fulfill(json(CAMPAIGNS)) : route.continue())
  await page.route('**/rest/v1/meta_adsets*', route =>
    route.request().method() === 'GET' ? route.fulfill(json(ADSETS)) : route.continue())
  // '?' delimita a tabela: evita casar meta_adsets com o glob de meta_ads.
  await page.route('**/rest/v1/meta_ads?*', route =>
    route.request().method() === 'GET' ? route.fulfill(json([])) : route.continue())
  await page.route('**/rest/v1/meta_analyses*', route =>
    route.request().method() === 'GET' ? route.fulfill(json([])) : route.continue())
  await page.route('**/rest/v1/meta_reach*', route =>
    route.request().method() === 'GET' ? route.fulfill(json(REACH)) : route.continue())
})

test('Anúncios está na sub-nav da área Pacientes', async ({ page }) => {
  await page.goto('/app/funnel')
  await expect(page.getByTestId('sub-nav').getByText('Anúncios')).toBeVisible()
})

test('Desempenho agrega por campanha e calcula KPIs e métricas derivadas', async ({ page }) => {
  await page.goto('/app/ads')
  await expect(page).toHaveURL(/\/app\/ads$/)
  await expect(page.getByRole('heading', { name: 'Anúncios — Meta Ads' })).toBeVisible()

  // Sub-abas, seletor de nível e períodos.
  await expect(page.getByText('📊 Desempenho')).toBeVisible()
  await expect(page.getByText('💡 Análises')).toBeVisible()
  for (const lvl of ['Campanhas', 'Conjuntos', 'Anúncios']) {
    await expect(page.getByRole('main').getByRole('button', { name: lvl, exact: true })).toBeVisible()
  }

  // Campanhas agregadas e selo do melhor CPL (C1 tem CPL R$50; C2 sem leads fica fora).
  await expect(page.getByText('Rinoplastia — Interesse SP')).toBeVisible()
  await expect(page.getByText('Mamoplastia — Lookalike')).toBeVisible()
  await expect(page.getByText('★ melhor CPL')).toBeVisible()

  // KPIs totais (gasto 230, CPL médio 76,67) e número agregado de uma campanha (gasto 150).
  await expect(page.getByText('R$ 230,00').first()).toBeVisible()
  await expect(page.getByText('R$ 76,67')).toBeVisible()
  await expect(page.getByText('R$ 150,00').first()).toBeVisible()

  // Alcance/frequência (deduplicados por período): KPI da conta e por campanha.
  await expect(page.getByText('101.200').first()).toBeVisible() // KPI alcance da conta
  await expect(page.getByText('42.300')).toBeVisible()          // alcance da C1
  await expect(page.getByText('3,05')).toBeVisible()            // frequência da C1
})

test('trocar o nível para Conjuntos recarrega os dados do nível', async ({ page }) => {
  await page.goto('/app/ads')
  await page.getByRole('main').getByRole('button', { name: 'Conjuntos', exact: true }).click()
  await expect(page.getByText('Conjunto Reels 25-44')).toBeVisible()
})

test('aba Análises mostra estado vazio com botão Reanalisar quando não há cache', async ({ page }) => {
  await page.goto('/app/ads')
  await page.getByText('💡 Análises').click()
  await expect(page.getByRole('button', { name: 'Reanalisar' })).toBeVisible()
  await expect(page.getByText(/Nenhuma análise ainda/)).toBeVisible()
})
