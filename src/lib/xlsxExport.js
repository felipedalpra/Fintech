import XLSXStyle from 'xlsx-js-style'

// ─── Style helpers ────────────────────────────────────────────────────────────

const FONT_BASE = { name: 'Calibri', sz: 11 }

const S = {
  title: {
    font: { ...FONT_BASE, bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1A1A2E' } },
    alignment: { vertical: 'center', wrapText: false },
  },
  subtitle: {
    font: { ...FONT_BASE, italic: true, color: { rgb: '555577' } },
    alignment: { vertical: 'center' },
  },
  sectionHeader: {
    font: { ...FONT_BASE, bold: true, sz: 11, color: { rgb: '1A1A2E' } },
    fill: { fgColor: { rgb: 'E8EAFF' } },
    alignment: { indent: 0 },
  },
  subtotal: {
    font: { ...FONT_BASE, bold: true, sz: 11 },
    fill: { fgColor: { rgb: 'F0F0F8' } },
    border: { top: { style: 'thin', color: { rgb: 'CCCCDD' } } },
    numFmt: 'R$ #,##0.00',
  },
  total: {
    font: { ...FONT_BASE, bold: true, sz: 12 },
    fill: { fgColor: { rgb: 'D0D0FF' } },
    border: { top: { style: 'medium', color: { rgb: '5555AA' } }, bottom: { style: 'double', color: { rgb: '5555AA' } } },
    numFmt: 'R$ #,##0.00',
  },
  totalLabel: {
    font: { ...FONT_BASE, bold: true, sz: 12 },
    fill: { fgColor: { rgb: 'D0D0FF' } },
    border: { top: { style: 'medium', color: { rgb: '5555AA' } }, bottom: { style: 'double', color: { rgb: '5555AA' } } },
  },
  row: {
    font: { ...FONT_BASE },
    numFmt: 'R$ #,##0.00',
  },
  rowLabel: {
    font: { ...FONT_BASE },
    alignment: { indent: 1 },
  },
  colHeader: {
    font: { ...FONT_BASE, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '3344AA' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  },
  positive: {
    font: { ...FONT_BASE, color: { rgb: '1A7A3A' } },
    numFmt: 'R$ #,##0.00',
  },
  negative: {
    font: { ...FONT_BASE, color: { rgb: 'AA2222' } },
    numFmt: 'R$ #,##0.00',
  },
  pct: {
    font: { ...FONT_BASE, italic: true, color: { rgb: '555566' } },
    numFmt: '0.0%',
    alignment: { horizontal: 'right' },
  },
}

function cell(v, s, extraNumFmt) {
  const type = typeof v === 'number' ? 'n' : 's'
  const c = { v, t: type, s }
  if (extraNumFmt) c.z = extraNumFmt
  return c
}

function n(v) { return typeof v === 'number' ? v : Number(v || 0) }

function download(wb, filename) {
  XLSXStyle.writeFile(wb, filename)
}

// ─── DRE ─────────────────────────────────────────────────────────────────────

export function exportDRE(m, periodLabel) {
  const wb = XLSXStyle.utils.book_new()
  const rows = []

  const addRow = (label, value, labelStyle, valueStyle) => {
    rows.push([cell(label, labelStyle), cell('', {}), value !== undefined ? cell(n(value), valueStyle) : cell('', {})])
  }

  // Title
  rows.push([cell(`DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO — DRE`, S.title), cell('', S.title), cell('', S.title)])
  rows.push([cell(`Período: ${periodLabel}`, S.subtitle), cell('', S.subtitle), cell('', S.subtitle)])
  rows.push([cell('', {}), cell('', {}), cell('', {})])
  rows.push([cell('Descrição', S.colHeader), cell('', S.colHeader), cell('Valor (R$)', S.colHeader)])

  // 1. Receitas
  rows.push([cell('1. RECEITAS BRUTAS', S.sectionHeader), cell('', S.sectionHeader), cell('', S.sectionHeader)])
  addRow('   Receita de Cirurgias',            m.surgeryRevenue,           S.rowLabel, m.surgeryRevenue >= 0 ? S.positive : S.negative)
  addRow('   Receita de Consultas',             m.consultationRevenue,      S.rowLabel, m.consultationRevenue >= 0 ? S.positive : S.negative)
  addRow('   Receita de Produtos',              m.productSalesRevenue,      S.rowLabel, m.productSalesRevenue >= 0 ? S.positive : S.negative)
  addRow('   Outras Receitas',                  m.extraRevenueTotal,        S.rowLabel, m.extraRevenueTotal >= 0 ? S.positive : S.negative)
  addRow('= RECEITA BRUTA TOTAL',              m.grossRevenue,              S.totalLabel, S.subtotal)
  rows.push([cell('', {}), cell('', {}), cell('', {})])

  // 2. Custos
  rows.push([cell('2. CUSTOS E DESPESAS', S.sectionHeader), cell('', S.sectionHeader), cell('', S.sectionHeader)])
  addRow('   (-) Custos de Cirurgias',          m.surgeryCostTotal,         S.rowLabel, S.negative)
  addRow('   (-) Custos de Consultas',          m.consultationCostTotal,    S.rowLabel, S.negative)
  addRow('   (-) Custo dos Produtos Vendidos',  m.productPurchaseTotal,     S.rowLabel, S.negative)
  addRow('   (-) Despesas Operacionais',        m.operationalExpenses,      S.rowLabel, S.negative)
  addRow('= LUCRO OPERACIONAL',                m.operatingProfit,           S.totalLabel, m.operatingProfit >= 0 ? S.subtotal : { ...S.subtotal, font: { ...FONT_BASE, bold: true, color: { rgb: 'AA2222' } } })
  rows.push([cell('', {}), cell('', {}), cell('', {})])

  // 3. Impostos
  rows.push([cell('3. TRIBUTAÇÃO', S.sectionHeader), cell('', S.sectionHeader), cell('', S.sectionHeader)])
  addRow('   (-) Impostos e Tributos',          m.taxExpenses,              S.rowLabel, S.negative)
  rows.push([cell('', {}), cell('', {}), cell('', {})])

  // Resultado
  addRow('= LUCRO LÍQUIDO DO PERÍODO',         m.netProfit,                S.totalLabel, m.netProfit >= 0 ? S.total : { ...S.total, font: { ...FONT_BASE, bold: true, sz: 12, color: { rgb: 'AA2222' } } })

  const marginVal = m.grossRevenue > 0 ? m.netProfit / m.grossRevenue : 0
  rows.push([cell('   Margem Líquida', S.rowLabel), cell('', {}), cell(marginVal, S.pct)])
  rows.push([cell('', {}), cell('', {}), cell('', {})])

  // Total despesas
  const totalExp = m.surgeryCostTotal + m.consultationCostTotal + m.productPurchaseTotal + m.operationalExpenses + m.taxExpenses
  addRow('   Total de Despesas (referência)',   totalExp,                   S.rowLabel, S.negative)

  const ws = XLSXStyle.utils.aoa_to_sheet(rows.map(r => r.map(c => c.v)))
  // Rewrite cells with style
  rows.forEach((row, r) => {
    row.forEach((c, col) => {
      const ref = XLSXStyle.utils.encode_cell({ r, c: col })
      ws[ref] = c
    })
  })

  ws['!cols'] = [{ wch: 42 }, { wch: 2 }, { wch: 20 }]
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
  ]
  ws['!rows'] = [{ hpt: 28 }, { hpt: 18 }]

  XLSXStyle.utils.book_append_sheet(wb, ws, 'DRE')
  download(wb, `DRE_${periodLabel}.xlsx`)
}

// ─── Fluxo de Caixa ───────────────────────────────────────────────────────────

export function exportFluxoCaixa(m, periodLabel) {
  const wb = XLSXStyle.utils.book_new()
  const rows = []

  rows.push([cell('FLUXO DE CAIXA', S.title), cell('', S.title), cell('', S.title), cell('', S.title), cell('', S.title)])
  rows.push([cell(`Período: ${periodLabel}`, S.subtitle), cell('', S.subtitle), cell('', S.subtitle), cell('', S.subtitle), cell('', S.subtitle)])
  rows.push([cell('', {}), cell('', {}), cell('', {}), cell('', {}), cell('', {})])
  rows.push([
    cell('Data', S.colHeader),
    cell('Histórico', S.colHeader),
    cell('Entradas (R$)', S.colHeader),
    cell('Saídas (R$)', S.colHeader),
    cell('Saldo Acumulado (R$)', S.colHeader),
  ])

  const entries = [
    ...m.entriesFinancial.map(i => ({ date: i.date || '', desc: i.description || '', entrada: n(i.value), saida: 0 })),
    ...m.exitsFinancial.map(i => ({ date: i.date || '', desc: i.description || '', entrada: 0, saida: n(i.value) })),
  ].sort((a, b) => (a.date || '').localeCompare(b.date || ''))

  let saldo = 0
  let totEntradas = 0
  let totSaidas = 0

  for (const item of entries) {
    saldo += item.entrada - item.saida
    totEntradas += item.entrada
    totSaidas += item.saida
    rows.push([
      cell(item.date, S.rowLabel),
      cell(item.desc, S.rowLabel),
      item.entrada > 0 ? cell(item.entrada, S.positive) : cell('', {}),
      item.saida > 0 ? cell(item.saida, S.negative) : cell('', {}),
      cell(saldo, saldo >= 0 ? S.positive : S.negative),
    ])
  }

  rows.push([cell('', {}), cell('', {}), cell('', {}), cell('', {}), cell('', {})])
  rows.push([
    cell('TOTAIS', S.totalLabel),
    cell('', S.totalLabel),
    cell(totEntradas, S.total),
    cell(totSaidas, { ...S.total, font: { ...FONT_BASE, bold: true, sz: 12, color: { rgb: 'AA2222' } } }),
    cell(saldo, saldo >= 0 ? S.total : { ...S.total, font: { ...FONT_BASE, bold: true, sz: 12, color: { rgb: 'AA2222' } } }),
  ])

  const ws = XLSXStyle.utils.aoa_to_sheet(rows.map(r => r.map(c => c.v)))
  rows.forEach((row, r) => {
    row.forEach((c, col) => {
      const ref = XLSXStyle.utils.encode_cell({ r, c: col })
      ws[ref] = c
    })
  })

  ws['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 22 }]
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
  ]
  ws['!rows'] = [{ hpt: 28 }, { hpt: 18 }]

  XLSXStyle.utils.book_append_sheet(wb, ws, 'Fluxo de Caixa')
  download(wb, `FluxoCaixa_${periodLabel}.xlsx`)
}

// ─── Balanço Patrimonial ──────────────────────────────────────────────────────

export function exportBalanco(data, balanceDate) {
  const wb = XLSXStyle.utils.book_new()
  const rows = []
  const assets = data.assets || []
  const liabilities = data.liabilities || []

  const ASSET_LABELS = { banco: 'Banco / Caixa', investimento: 'Investimento', imovel: 'Imóvel', equipamento: 'Equipamento', outros: 'Outros' }
  const LIAB_LABELS = { emprestimo: 'Empréstimo', financiamento: 'Financiamento', impostos: 'Impostos a Pagar', fornecedor: 'Fornecedor', outros: 'Outros' }

  const totalAssets = assets.reduce((s, i) => s + n(i.value), 0)
  const totalLiab = liabilities.reduce((s, i) => s + n(i.value), 0)
  const equity = totalAssets - totalLiab

  const dateLabel = balanceDate || new Date().toISOString().split('T')[0]

  rows.push([cell('BALANÇO PATRIMONIAL', S.title), cell('', S.title), cell('', S.title)])
  rows.push([cell(`Data-base: ${dateLabel}`, S.subtitle), cell('', S.subtitle), cell('', S.subtitle)])
  rows.push([cell('', {}), cell('', {}), cell('', {})])

  // ATIVO
  rows.push([cell('ATIVO', S.sectionHeader), cell('', S.sectionHeader), cell('Valor (R$)', S.colHeader)])
  for (const item of assets) {
    rows.push([cell(item.name || '—', S.rowLabel), cell(ASSET_LABELS[item.category] || item.category || '', { font: { ...FONT_BASE, italic: true, color: { rgb: '777799' } } }), cell(n(item.value), S.positive)])
  }
  rows.push([cell('TOTAL DO ATIVO', S.totalLabel), cell('', S.totalLabel), cell(totalAssets, S.total)])
  rows.push([cell('', {}), cell('', {}), cell('', {})])

  // PASSIVO
  rows.push([cell('PASSIVO', S.sectionHeader), cell('', S.sectionHeader), cell('Valor (R$)', S.colHeader)])
  for (const item of liabilities) {
    rows.push([cell(item.name || '—', S.rowLabel), cell(LIAB_LABELS[item.category] || item.category || '', { font: { ...FONT_BASE, italic: true, color: { rgb: '777799' } } }), cell(n(item.value), S.negative)])
  }
  rows.push([cell('TOTAL DO PASSIVO', S.totalLabel), cell('', S.totalLabel), cell(totalLiab, { ...S.total, font: { ...FONT_BASE, bold: true, sz: 12, color: { rgb: 'AA2222' } } })])
  rows.push([cell('', {}), cell('', {}), cell('', {})])

  // Patrimônio Líquido
  rows.push([cell('= PATRIMÔNIO LÍQUIDO', S.totalLabel), cell('', S.totalLabel), cell(equity, equity >= 0 ? S.total : { ...S.total, font: { ...FONT_BASE, bold: true, sz: 12, color: { rgb: 'AA2222' } } })])

  const ws = XLSXStyle.utils.aoa_to_sheet(rows.map(r => r.map(c => c.v)))
  rows.forEach((row, r) => {
    row.forEach((c, col) => {
      const ref = XLSXStyle.utils.encode_cell({ r, c: col })
      ws[ref] = c
    })
  })

  ws['!cols'] = [{ wch: 36 }, { wch: 20 }, { wch: 20 }]
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
  ]
  ws['!rows'] = [{ hpt: 28 }, { hpt: 18 }]

  XLSXStyle.utils.book_append_sheet(wb, ws, 'Balanço Patrimonial')
  download(wb, `Balanco_${dateLabel}.xlsx`)
}
