import { expect, test } from '@playwright/test'
import { extractCreative } from '../../api/_lib/metaInsights.js'
import { buildCreativeCards, filterCreatives, sortCreatives, adsManagerLink, metaPostLink } from '../../src/lib/metaCreatives.js'

// ---- extração do criativo (backend) ----

test('o texto principal vem do object_story_spec, que é onde a Meta realmente o coloca', () => {
  const c = extractCreative({ creative: { id: 'CR1', thumbnail_url: 't.jpg',
    object_story_spec: { link_data: { message: 'Avalie sua rinoplastia', name: 'Agende', picture: 'p.jpg' } } } })
  expect(c.body_text).toBe('Avalie sua rinoplastia')
  expect(c.title_text).toBe('Agende')
  expect(c.image_url).toBe('p.jpg')
  expect(c.creative_id).toBe('CR1')
})

test('criativo de vídeo usa video_data, não link_data', () => {
  const c = extractCreative({ creative: { id: 'CR2',
    object_story_spec: { video_data: { message: 'Veja o antes e depois', title: 'Resultados' } } } })
  expect(c.body_text).toBe('Veja o antes e depois')
  expect(c.title_text).toBe('Resultados')
})

test('criativo dinâmico (asset_feed_spec) entrega o primeiro texto', () => {
  const c = extractCreative({ creative: { id: 'CR3',
    asset_feed_spec: { bodies: [{ text: 'Texto A' }, { text: 'Texto B' }], titles: [{ text: 'Título A' }] } } })
  expect(c.body_text).toBe('Texto A')
  expect(c.title_text).toBe('Título A')
})

test('texto ausente é null, nunca string vazia nem placeholder', () => {
  // null = a Meta não devolveu. A tela precisa saber a diferença para avisar em vez de inventar.
  const c = extractCreative({ creative: { id: 'CR4', thumbnail_url: 't.jpg' } })
  expect(c.body_text).toBeNull()
  expect(c.title_text).toBeNull()
  expect(c.image_url).toBeNull()
  expect(c.object_story_id).toBeNull()
})

test('anúncio sem creative nenhum não quebra a extração', () => {
  expect(extractCreative({})).toEqual({ creative_id: null, thumbnail_url: null, image_url: null,
    body_text: null, title_text: null, object_story_id: null })
  expect(extractCreative(null).creative_id).toBeNull()
})

test('texto só de espaços conta como ausente', () => {
  const c = extractCreative({ creative: { id: 'CR5', object_story_spec: { link_data: { message: '   ' } } } })
  expect(c.body_text).toBeNull()
})

// ---- cards (frontend) ----

const ads = [
  { ad_id: 'A1', name: 'Rino vídeo', status: 'ACTIVE', campaign_id: 'C1', adset_id: 'S1', thumbnail_url: 't1.jpg' },
  { ad_id: 'A2', name: 'Mama carrossel', status: 'PAUSED', campaign_id: 'C2', adset_id: 'S2', thumbnail_url: null },
]
const insights = [
  { ref_id: 'A1', spend: 300, impressions: 10000, clicks: 200, leads: 10, actions: null },
  { ref_id: 'A1', spend: 100, impressions: 2000, clicks: 50, leads: 2, actions: null },
  { ref_id: 'A2', spend: 50, impressions: 5000, clicks: 25, leads: 0, actions: null },
]

test('o card soma o período inteiro e deriva CTR/CPC dos totais', () => {
  const cards = buildCreativeCards(ads, insights, { C1: 'Campanha Rino', C2: 'Campanha Mama' }, { S1: 'Conjunto 1' })
  const a1 = cards.find(c => c.ad_id === 'A1')
  expect(a1.spend).toBe(400)
  expect(a1.impressions).toBe(12000)
  expect(a1.clicks).toBe(250)
  expect(a1.leads).toBe(12)
  expect(a1.ctr).toBeCloseTo(2.083, 3)   // 250/12000*100
  expect(a1.cpc).toBeCloseTo(1.6, 3)     // 400/250
  expect(a1.campaignName).toBe('Campanha Rino')
  expect(a1.adsetName).toBe('Conjunto 1')
})

test('anúncio sem nenhum insight no período aparece com métrica indisponível, não com zero', () => {
  // Zerar seria afirmar "não gastou nada"; o certo é "a Meta não trouxe número para este período".
  const cards = buildCreativeCards([{ ad_id: 'A9', name: 'Novo', status: 'ACTIVE' }], [], {}, {})
  expect(cards[0].hasData).toBe(false)
  expect(cards[0].spend).toBeNull()
  expect(cards[0].ctr).toBeNull()
})

test('CTR e CPC sem denominador são indefinidos, não zero', () => {
  const cards = buildCreativeCards([{ ad_id: 'A1', name: 'x' }],
    [{ ref_id: 'A1', spend: 10, impressions: 0, clicks: 0, leads: 0 }], {}, {})
  expect(cards[0].hasData).toBe(true)
  expect(cards[0].ctr).toBeNull()
  expect(cards[0].cpc).toBeNull()
  expect(cards[0].spend).toBe(10)
})

// ---- filtros e ordenação ----

const cards = [
  { ad_id: 'A1', name: 'Rino vídeo', campaignName: 'Campanha Rino', campaign_id: 'C1', status: 'ACTIVE', spend: 400, ctr: 2.08, cpc: 1.6 },
  { ad_id: 'A2', name: 'Mama carrossel', campaignName: 'Campanha Mama', campaign_id: 'C2', status: 'PAUSED', spend: 50, ctr: 0.5, cpc: 2 },
  { ad_id: 'A3', name: 'Rino imagem', campaignName: 'Campanha Rino', campaign_id: 'C1', status: 'ACTIVE', spend: null, ctr: null, cpc: null },
]

test('a busca ignora acento e caixa, e também acha pelo nome da campanha', () => {
  expect(filterCreatives(cards, { q: 'VIDEO' }).map(c => c.ad_id)).toEqual(['A1'])
  expect(filterCreatives(cards, { q: 'campanha rino' }).map(c => c.ad_id)).toEqual(['A1', 'A3'])
})

test('filtro por campanha e por status', () => {
  expect(filterCreatives(cards, { campaignId: 'C2' }).map(c => c.ad_id)).toEqual(['A2'])
  expect(filterCreatives(cards, { status: 'PAUSED' }).map(c => c.ad_id)).toEqual(['A2'])
  expect(filterCreatives(cards, { campaignId: 'C1', status: 'ACTIVE' }).map(c => c.ad_id)).toEqual(['A1', 'A3'])
  expect(filterCreatives(cards, { campaignId: 'C1', status: 'PAUSED' })).toEqual([])
})

test('ordenação manda o indisponível para o fim, nas duas direções', () => {
  // Sem número não é "o pior": é desconhecido. Em asc, null no topo fingiria CPC zero.
  expect(sortCreatives(cards, 'spend', 'desc').map(c => c.ad_id)).toEqual(['A1', 'A2', 'A3'])
  expect(sortCreatives(cards, 'spend', 'asc').map(c => c.ad_id)).toEqual(['A2', 'A1', 'A3'])
  expect(sortCreatives(cards, 'cpc', 'asc').map(c => c.ad_id)).toEqual(['A1', 'A2', 'A3'])
  expect(sortCreatives(cards, 'ctr', 'desc').map(c => c.ad_id)).toEqual(['A1', 'A2', 'A3'])
})

test('ordenar não altera o array recebido', () => {
  const orig = cards.map(c => c.ad_id)
  sortCreatives(cards, 'spend', 'asc')
  expect(cards.map(c => c.ad_id)).toEqual(orig)
})

// ---- links ----

test('o link do Gerenciador é montado com a conta e o anúncio, sem depender de campo novo da API', () => {
  const url = adsManagerLink('act_123', 'A1')
  expect(url).toContain('act=act_123')
  expect(url).toContain('selected_ad_ids=A1')
  expect(adsManagerLink(null, 'A1')).toBeNull()
  expect(adsManagerLink('act_123', null)).toBeNull()
})

test('o link do post público só existe quando a Meta deu o id da publicação', () => {
  expect(metaPostLink('123_456')).toBe('https://www.facebook.com/123_456')
  expect(metaPostLink(null)).toBeNull()
})
