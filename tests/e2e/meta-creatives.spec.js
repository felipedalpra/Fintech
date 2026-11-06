import { expect, test } from '@playwright/test'

const hoje = new Date()
const dia = n => new Date(hoje.getTime() - n * 86400000).toISOString().slice(0, 10)

const ADS = [
  { ad_id:'A1', adset_id:'AS1', campaign_id:'C1', name:'Rino — vídeo antes e depois', status:'ACTIVE',
    thumbnail_url:'https://exemplo.test/t1.jpg', image_url:null,
    body_text:'Agende sua avaliação de rinoplastia', title_text:'Consulta', object_story_id:'111_222' },
  { ad_id:'A2', adset_id:'AS1', campaign_id:'C2', name:'Mama — carrossel', status:'PAUSED',
    thumbnail_url:null, image_url:null, body_text:null, title_text:null, object_story_id:null },
  { ad_id:'A3', adset_id:'AS1', campaign_id:'C1', name:'Rino — imagem estática', status:'ACTIVE',
    thumbnail_url:'https://exemplo.test/t3.jpg', image_url:null, body_text:'Texto do estático', title_text:null, object_story_id:null },
]

// A3 de propósito SEM insight: é o caso em que a tela não pode inventar zero.
const INSIGHTS = [
  { ref_id:'A1', level:'ad', campaign_id:'C1', date:dia(1), spend:400, impressions:12000, clicks:250, leads:12, updated_at:new Date().toISOString() },
  { ref_id:'A2', level:'ad', campaign_id:'C2', date:dia(1), spend:50,  impressions:5000,  clicks:25,  leads:0,  updated_at:new Date().toISOString() },
]

async function mock(page, { ads = ADS, insights = INSIGHTS, adsError = false } = {}) {
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/**', route => route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' }))
  await page.route('**/rest/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (adsError && path.endsWith('/meta_ads')) {
      return route.fulfill({ status:500, contentType:'application/json', body:JSON.stringify({ message:'falha no banco' }) })
    }
    let body = []
    if (path.endsWith('/meta_ads')) body = ads
    if (path.endsWith('/meta_insights')) body = insights
    if (path.endsWith('/meta_campaigns')) body = [{ campaign_id:'C1', name:'Campanha Rino' }, { campaign_id:'C2', name:'Campanha Mama' }]
    if (path.endsWith('/meta_adsets')) body = [{ adset_id:'AS1', name:'Conjunto A' }]
    if (path.endsWith('/meta_connections')) body = { status:'conectado', ad_account_id:'act_777', updated_at:new Date().toISOString() }
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/1' }, body:JSON.stringify(body) })
  })
}

async function abrirCriativos(page) {
  await page.goto('/app/ads')
  await page.getByTestId('subtab-criativos').click()
  await expect(page.getByTestId('creatives-grid')).toBeVisible()
}

test('a aba lista um card por anúncio, com campanha, situação e métricas', async ({ page }) => {
  await mock(page)
  await abrirCriativos(page)
  await expect(page.getByTestId('creative-card')).toHaveCount(3)

  const a1 = page.getByTestId('creative-card').filter({ hasText:'Rino — vídeo' })
  await expect(a1.getByText('Campanha Rino')).toBeVisible()
  await expect(a1.getByText('Ativo', { exact:true })).toBeVisible()
  await expect(a1.getByText('R$ 400,00')).toBeVisible()   // soma do período
  await expect(a1.getByText('2,08%')).toBeVisible()        // CTR = 250/12000
  await expect(a1.getByText('R$ 1,60')).toBeVisible()      // CPC = 400/250
})

test('anúncio sem entrega no período avisa, em vez de mostrar zero', async ({ page }) => {
  // Zero diria "não gastou nada". O certo é dizer que a Meta não registrou entrega.
  await mock(page)
  await abrirCriativos(page)
  const a3 = page.getByTestId('creative-card').filter({ hasText:'imagem estática' })
  await expect(a3.getByTestId('creative-no-data')).toBeVisible()
  await expect(a3.getByText('R$ 0,00')).toHaveCount(0)
  await expect(a3.getByText('0,00%')).toHaveCount(0)
})

test('criativo sem imagem mostra o motivo, não um quadro vazio', async ({ page }) => {
  await mock(page)
  await abrirCriativos(page)
  const a2 = page.getByTestId('creative-card').filter({ hasText:'Mama — carrossel' })
  await expect(a2.getByText('não forneceu imagem', { exact:false })).toBeVisible()
})

test('busca, filtro por campanha e por situação recortam a lista', async ({ page }) => {
  await mock(page)
  await abrirCriativos(page)

  await page.getByTestId('creatives-search').fill('carrossel')
  await expect(page.getByTestId('creative-card')).toHaveCount(1)

  // A busca também acha pelo nome da campanha, que é como a clínica pensa.
  await page.getByTestId('creatives-search').fill('campanha rino')
  await expect(page.getByTestId('creative-card')).toHaveCount(2)

  await page.getByTestId('creatives-search').fill('')
  await page.getByTestId('creatives-campaign').selectOption('C2')
  await expect(page.getByTestId('creative-card')).toHaveCount(1)

  await page.getByTestId('creatives-campaign').selectOption('')
  await page.getByTestId('creatives-status').selectOption('PAUSED')
  await expect(page.getByTestId('creative-card')).toHaveCount(1)
  await expect(page.getByTestId('creative-card').first()).toContainText('Mama')
})

test('ordenação por investimento e CPC mantém o indisponível no fim', async ({ page }) => {
  await mock(page)
  await abrirCriativos(page)
  const nomes = async () => page.getByTestId('creative-name').allTextContents()

  // Padrão: investimento decrescente.
  expect((await nomes())[0]).toContain('Rino — vídeo')

  await page.getByTestId('creatives-sort-spend').click() // vira crescente
  const asc = await nomes()
  expect(asc[0]).toContain('Mama')
  // Sem número não é "o mais barato": vai para o fim nas duas direções.
  expect(asc[2]).toContain('imagem estática')

  await page.getByTestId('creatives-sort-cpc').click()
  const porCpc = await nomes()
  expect(porCpc[2]).toContain('imagem estática')
})

test('filtro sem resultado explica o que fazer, e não parece perda de dado', async ({ page }) => {
  await mock(page)
  await abrirCriativos(page)
  await page.getByTestId('creatives-search').fill('zzzz')
  await expect(page.getByTestId('creatives-empty')).toContainText('Limpe a busca')
})

test('sem nenhum anúncio sincronizado a tela diz isso, sem erro', async ({ page }) => {
  await mock(page, { ads: [], insights: [] })
  await page.goto('/app/ads')
  await page.getByTestId('subtab-criativos').click()
  await expect(page.getByTestId('creatives-empty')).toContainText('Nenhum anúncio sincronizado')
})

test('falha ao carregar aparece como erro, não como lista vazia', async ({ page }) => {
  // Lista vazia por erro é a mentira mais perigosa: parece "você não tem anúncios".
  await mock(page, { adsError: true })
  await page.goto('/app/ads')
  await page.getByTestId('subtab-criativos').click()
  await expect(page.getByText('Não foi possível carregar os criativos', { exact:false })).toBeVisible()
  await expect(page.getByTestId('creatives-empty')).toHaveCount(0)
})

test('o card abre o painel com texto, conjunto, métricas e link para a Meta', async ({ page }) => {
  await mock(page)
  await abrirCriativos(page)
  await page.getByTestId('creative-card').filter({ hasText:'Rino — vídeo' }).click()

  const d = page.getByTestId('creative-drawer')
  await expect(d).toBeVisible()
  await expect(d.getByText('Agende sua avaliação de rinoplastia')).toBeVisible()
  await expect(d.getByText('Conjunto A', { exact:false })).toBeVisible()
  await expect(d.getByText('12.000')).toBeVisible()

  const link = d.getByTestId('creative-manager-link')
  await expect(link).toHaveAttribute('href', /act=act_777/)
  await expect(link).toHaveAttribute('href', /selected_ad_ids=A1/)

  await d.getByTestId('creative-drawer-close').click()
  await expect(page.getByTestId('creative-drawer')).toHaveCount(0)
})

test('anúncio sem texto no painel explica a ausência, em vez de ficar em branco', async ({ page }) => {
  await mock(page)
  await abrirCriativos(page)
  await page.getByTestId('creative-card').filter({ hasText:'Mama — carrossel' }).click()
  await expect(page.getByTestId('creative-drawer').getByText('não devolveu o texto', { exact:false })).toBeVisible()
})

test('a aba Desempenho continua intacta ao lado da nova aba', async ({ page }) => {
  // A fase 1 não pode ser afetada por esta entrega.
  await mock(page)
  await abrirCriativos(page)
  await page.getByTestId('subtab-desempenho').click()
  await expect(page.getByTestId('sync-status')).toBeVisible()
  await expect(page.locator('table')).toBeVisible()
})

test('miniatura que expirou no Meta explica a falha, em vez de deixar um quadro vazio', async ({ page }) => {
  // A Meta assina e expira as URLs; sem isto o card ficava com um retângulo mudo.
  await mock(page)
  await page.route('https://exemplo.test/**', route => route.abort())
  await abrirCriativos(page)
  const a1 = page.getByTestId('creative-card').filter({ hasText:'Rino — vídeo' })
  await expect(a1.getByTestId('creative-no-image')).toContainText('expirou no Meta')
})
