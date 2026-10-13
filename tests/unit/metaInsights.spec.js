import { expect, test } from '@playwright/test'
import { parseInsightsResponse, deriveMetrics } from '../../api/_lib/metaInsights.js'

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
          { action_type: 'post_engagement', value: '900' }, // ignora
        ],
      },
    ],
  }
  const rows = parseInsightsResponse(body, 'campaign')
  expect(rows).toEqual([
    { level: 'campaign', ref_id: 'C1', campaign_id: 'C1', date: '2026-10-01',
      spend: 3120.5, impressions: 128900, reach: 42300, clicks: 2140, leads: 58 },
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
