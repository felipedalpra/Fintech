import { expect, test } from '@playwright/test'
import { buildDataQualitySummary } from '../../src/components/DataQualityCenter.jsx'

test('centro de qualidade deriva pendências sem mutar dados', () => {
  const data = {
    extraRevenues:[
      { id:'a', description:'Receita avulsa', value:100, date:'2026-10-15', status:'recebido' },
      { id:'b', description:'Receita avulsa', value:100, date:'2026-10-15', status:'recebido' },
    ],
    expenses:[], surgeries:[], consultations:[], productSales:[], productPurchases:[],
  }
  const before = JSON.stringify(data)
  const result = buildDataQualitySummary(data)
  expect(result.uncategorized).toHaveLength(2)
  expect(result.duplicates).toHaveLength(1)
  expect(JSON.stringify(data)).toBe(before)
})
