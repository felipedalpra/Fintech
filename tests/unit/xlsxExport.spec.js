import { expect, test } from '@playwright/test'
import { createDreWorkbook } from '../../src/lib/xlsxExport.js'

test('template Excel da DRE mostra sinais, análise vertical e separadores visuais', () => {
  const workbook = createDreWorkbook({
    surgeryRevenue:1000,
    consultationRevenue:0,
    productSalesRevenue:0,
    extraRevenueTotal:0,
    grossRevenue:1000,
    revenueDeductions:50,
    netRevenue:950,
    surgeryCostTotal:200,
    consultationCostTotal:0,
    productPurchaseTotal:0,
    additionalDirectCosts:0,
    operationalExpenses:100,
    operatingProfit:650,
    financialRevenue:10,
    financialExpenses:20,
    profitBeforeTax:640,
    taxExpenses:40,
    netProfit:600,
  }, 'Outubro_2026')
  const sheet = workbook.Sheets.DRE

  expect(sheet.B4.v).toBe('Valor (R$)')
  expect(sheet.C4.v).toBe('Análise vertical')
  expect(sheet.B6.v).toBe(1000)
  expect(sheet.B6.s.fill.fgColor.rgb).toBe('E8F5EC')
  expect(sheet.B11.v).toBe(-50)
  expect(sheet.C11.v).toBe(-0.05)
  expect(sheet.B11.s.fill.fgColor.rgb).toBe('FCE8E8')
  expect(sheet.A11.s.border.bottom.style).toBe('hair')
})
