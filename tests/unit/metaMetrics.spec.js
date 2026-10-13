import { expect, test } from '@playwright/test'
import { aggregateInsights, deriveMetrics } from '../../src/lib/metaMetrics.js'

test('aggregateInsights: soma métricas aditivas por ref_id no período', () => {
  const rows = [
    { level: 'campaign', ref_id: 'C1', campaign_id: 'C1', date: '2026-10-01', spend: 100, impressions: 1000, clicks: 20, leads: 2 },
    { level: 'campaign', ref_id: 'C1', campaign_id: 'C1', date: '2026-10-02', spend: 50, impressions: 500, clicks: 10, leads: 1 },
    { level: 'campaign', ref_id: 'C2', campaign_id: 'C2', date: '2026-10-01', spend: 80, impressions: 800, clicks: 8, leads: 0 },
  ]
  const agg = aggregateInsights(rows)
  expect(agg).toEqual([
    { ref_id: 'C1', campaign_id: 'C1', spend: 150, impressions: 1500, clicks: 30, leads: 3 },
    { ref_id: 'C2', campaign_id: 'C2', spend: 80, impressions: 800, clicks: 8, leads: 0 },
  ])
})

test('aggregateInsights: entrada vazia → []', () => {
  expect(aggregateInsights([])).toEqual([])
  expect(aggregateInsights(null)).toEqual([])
})

test('deriveMetrics: ratios a partir das somas (aditivos); denominador 0 → 0', () => {
  const m = deriveMetrics({ spend: 150, impressions: 1500, clicks: 30, leads: 3 })
  expect(m.ctr).toBeCloseTo(2, 5)        // 30/1500*100
  expect(m.cpc).toBeCloseTo(5, 5)        // 150/30
  expect(m.cpm).toBeCloseTo(100, 5)      // 150/1500*1000
  expect(m.cpl).toBeCloseTo(50, 5)       // 150/3
  expect(deriveMetrics({ spend: 10, impressions: 0, clicks: 0, leads: 0 }))
    .toMatchObject({ ctr: 0, cpc: 0, cpm: 0, cpl: 0 })
})
