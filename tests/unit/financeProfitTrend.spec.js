import { expect, test } from '@playwright/test'
import { buildFinanceProfitTrend, buildFinanceTrendBuckets, summarizeFinanceProfitTrend } from '../../src/lib/financeProfitTrend.js'

test('divide um ano em meses civis sem perder dias nas bordas', () => {
  const buckets = buildFinanceTrendBuckets({ start:'2026-01-01', end:'2026-12-31' })
  expect(buckets).toHaveLength(12)
  expect(buckets[0]).toMatchObject({ start:'2026-01-01', end:'2026-01-31', granularity:'month' })
  expect(buckets[11]).toMatchObject({ start:'2026-12-01', end:'2026-12-31', granularity:'month' })
})

test('períodos médios usam semanas contínuas e respeitam o fim selecionado', () => {
  const buckets = buildFinanceTrendBuckets({ start:'2026-01-15', end:'2026-04-15' })
  expect(buckets[0]).toMatchObject({ start:'2026-01-15', end:'2026-01-21', granularity:'week' })
  expect(buckets.at(-1).end).toBe('2026-04-15')
  expect(buckets.slice(1).every((bucket, index) => {
    const previous = new Date(`${buckets[index].end}T00:00:00`)
    const current = new Date(`${bucket.start}T00:00:00`)
    return current - previous === 24 * 60 * 60 * 1000
  })).toBe(true)
})

test('intervalo curto preserva a leitura diária', () => {
  const buckets = buildFinanceTrendBuckets({ start:'2026-11-01', end:'2026-11-07' })
  expect(buckets).toHaveLength(7)
  expect(buckets.every(bucket => bucket.granularity === 'day' && bucket.start === bucket.end)).toBe(true)
})

test('calcula receita líquida, lucro e margem pela mesma fonte canônica do financeiro', () => {
  const data = {
    chartAccounts:[], procedures:[], products:[], productSales:[], productPurchases:[], surgeries:[], consultations:[],
    expenses:[{ id:'expense', description:'Aluguel', value:200, competenceDate:'2026-01-10', dueDate:'2026-01-10', paymentDate:'2026-01-10', status:'pago' }],
    extraRevenues:[{ id:'revenue', description:'Receita', value:1000, date:'2026-01-05', competenceDate:'2026-01-05', dueDate:'2026-01-05', status:'recebido' }],
    assets:[], liabilities:[], goals:[], recurrences:[],
  }
  const points = buildFinanceProfitTrend(data, { start:'2026-01-01', end:'2026-01-31' })
  expect(points[0]).toMatchObject({ start:'2026-01-01', end:'2026-01-07', netRevenue:1000, netProfit:1000, margin:100 })
  expect(points[1]).toMatchObject({ start:'2026-01-08', end:'2026-01-14', netRevenue:0, netProfit:-200, margin:0 })
  expect(summarizeFinanceProfitTrend(points)).toMatchObject({ netRevenue:1000, netProfit:800, margin:80 })
})
