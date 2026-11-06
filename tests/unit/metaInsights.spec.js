import { expect, test } from '@playwright/test'
import { parseInsightsResponse, deriveMetrics, parseReachResponse } from '../../api/_lib/metaInsights.js'

test('parseInsightsResponse: nível campaign normaliza strings e extrai leads das actions', () => {
  const body = {
    data: [
      {
        campaign_id: 'C1',
        campaign_name: 'Rinoplastia',
        date_start: '2026-10-01',
        date_stop: '2026-10-01',
        spend: '3120.50',
        impressions: '128900',
        reach: '42300',
        clicks: '2140',
        actions: [
          { action_type: 'lead', value: '58' },
          // Não entra em `leads`, mas agora é GUARDADO: é a fonte do engajamento na tela.
          { action_type: 'post_engagement', value: '900' },
        ],
      },
    ],
  }
  const rows = parseInsightsResponse(body, 'campaign')
  expect(rows).toEqual([
    { level: 'campaign', ref_id: 'C1', campaign_id: 'C1', date: '2026-10-01',
      spend: 3120.5, impressions: 128900, reach: 42300, clicks: 2140, leads: 58,
      actions: [
        { action_type: 'lead', value: '58' },
        { action_type: 'post_engagement', value: '900' },
      ],
      cost_per_action: null },
  ])
})

test('parseInsightsResponse: nível adset/ad usa o id do próprio nível como ref_id e mantém campaign_id', () => {
  const adset = parseInsightsResponse({ data: [{
    adset_id: 'AS1', campaign_id: 'C1', date_start: '2026-10-02', date_stop: '2026-10-02',
    spend: '100', impressions: '1000', reach: '800', clicks: '20', actions: [],
  }] }, 'adset')
  expect(adset[0]).toMatchObject({ level: 'adset', ref_id: 'AS1', campaign_id: 'C1', leads: 0 })

  const ad = parseInsightsResponse({ data: [{
    ad_id: 'AD1', adset_id: 'AS1', campaign_id: 'C1', date_start: '2026-10-02', date_stop: '2026-10-02',
    spend: '50', impressions: '500', reach: '400', clicks: '10',
  }] }, 'ad')
  expect(ad[0]).toMatchObject({ level: 'ad', ref_id: 'AD1', campaign_id: 'C1', leads: 0 })
})

test('parseInsightsResponse: corpo vazio ou sem data retorna []', () => {
  expect(parseInsightsResponse({}, 'campaign')).toEqual([])
  expect(parseInsightsResponse({ data: [] }, 'campaign')).toEqual([])
  expect(parseInsightsResponse(null, 'campaign')).toEqual([])
})

test('parseInsightsResponse: NÃO soma tipos de lead — prefere "lead" (evita dupla contagem)', () => {
  const rows = parseInsightsResponse({ data: [{
    campaign_id: 'C1', date_start: '2026-10-01', date_stop: '2026-10-01',
    spend: '10', impressions: '100', reach: '90', clicks: '5',
    actions: [
      { action_type: 'lead', value: '3' },
      { action_type: 'onsite_conversion.lead_grouped', value: '3' }, // mesmo evento, outro recorte
    ],
  }] }, 'campaign')
  expect(rows[0].leads).toBe(3) // pega 'lead', não 3+3=6
})

test('parseInsightsResponse: usa o tipo agrupado quando "lead" não existe', () => {
  const rows = parseInsightsResponse({ data: [{
    campaign_id: 'C1', date_start: '2026-10-01', date_stop: '2026-10-01',
    spend: '10', impressions: '100', reach: '90', clicks: '5',
    actions: [{ action_type: 'onsite_conversion.lead_grouped', value: '4' }],
  }] }, 'campaign')
  expect(rows[0].leads).toBe(4)
})

test('parseReachResponse: nível campaign normaliza reach/frequency por entidade', () => {
  const rows = parseReachResponse({ data: [
    { campaign_id: 'C1', reach: '42300', frequency: '3.05' },
    { campaign_id: 'C2', reach: '31800', frequency: '3.03' },
  ] }, 'campaign')
  expect(rows).toEqual([
    { level: 'campaign', ref_id: 'C1', reach: 42300, frequency: 3.05 },
    { level: 'campaign', ref_id: 'C2', reach: 31800, frequency: 3.03 },
  ])
})

test('parseReachResponse: nível account (sem id) usa ref_id "account"', () => {
  const rows = parseReachResponse({ data: [{ reach: '101200', frequency: '3.18' }] }, 'account')
  expect(rows).toEqual([{ level: 'account', ref_id: 'account', reach: 101200, frequency: 3.18 }])
  expect(parseReachResponse({}, 'account')).toEqual([])
})

test('deriveMetrics: calcula ctr, cpc, cpm, frequência e cpl', () => {
  const m = deriveMetrics({ spend: 3120, impressions: 128900, reach: 42300, clicks: 2140, leads: 58 })
  expect(m.ctr).toBeCloseTo(1.66, 2)      // 2140/128900*100
  expect(m.cpc).toBeCloseTo(1.458, 3)     // 3120/2140
  expect(m.cpm).toBeCloseTo(24.205, 3)    // 3120/128900*1000
  expect(m.frequency).toBeCloseTo(3.047, 3) // 128900/42300
  expect(m.cpl).toBeCloseTo(53.793, 3)    // 3120/58
})

test('deriveMetrics: denominador zero vira 0 (sem NaN/Infinity)', () => {
  const m = deriveMetrics({ spend: 100, impressions: 0, reach: 0, clicks: 0, leads: 0 })
  expect(m).toEqual({ ctr: 0, cpc: 0, cpm: 0, frequency: 0, cpl: 0 })
})

test('o array actions é guardado inteiro, não só o lead', () => {
  // Era aqui que engajamento, conversões por tipo e custo por resultado se perdiam: o parser
  // extraía o lead e descartava o resto, obrigando nova chamada à Meta para recuperá-los.
  const body = { data: [{
    campaign_id: '1', date_start: '2026-11-01', spend: '100', impressions: '1000', clicks: '50',
    actions: [{ action_type: 'lead', value: '5' }, { action_type: 'post_engagement', value: '80' }],
    cost_per_action_type: [{ action_type: 'lead', value: '20' }],
  }] }
  const [row] = parseInsightsResponse(body, 'campaign')
  expect(row.leads).toBe(5)
  expect(row.actions).toHaveLength(2)
  expect(row.actions[1].action_type).toBe('post_engagement')
  expect(row.cost_per_action[0].value).toBe('20')
})

test('insight sem actions guarda null, não array vazio nem zero', () => {
  // null = a Meta não informou. Array vazio diria "informou que não houve", que é outra coisa.
  const body = { data: [{ campaign_id: '1', date_start: '2026-11-01', spend: '10' }] }
  const [row] = parseInsightsResponse(body, 'campaign')
  expect(row.actions).toBeNull()
  expect(row.cost_per_action).toBeNull()
  expect(row.leads).toBe(0)
})
