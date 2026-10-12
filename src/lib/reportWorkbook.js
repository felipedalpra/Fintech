import XLSXStyle from 'xlsx-js-style'

const COLORS = {
  navy:'111827',
  blue:'2563EB',
  cyan:'0891B2',
  paleBlue:'DBEAFE',
  paleGray:'F3F4F6',
  gray:'6B7280',
  red:'B91C1C',
  paleRed:'FEE2E2',
  white:'FFFFFF',
  green:'047857',
}

const FONT = { name:'Calibri', sz:11 }

const STYLES = {
  title:{ font:{ ...FONT, bold:true, sz:16, color:{ rgb:COLORS.white } }, fill:{ fgColor:{ rgb:COLORS.navy } }, alignment:{ vertical:'center' } },
  subtitle:{ font:{ ...FONT, italic:true, color:{ rgb:COLORS.gray } } },
  header:{ font:{ ...FONT, bold:true, color:{ rgb:COLORS.white } }, fill:{ fgColor:{ rgb:COLORS.blue } }, alignment:{ horizontal:'center', vertical:'center', wrapText:true }, border:{ bottom:{ style:'thin', color:{ rgb:'1D4ED8' } } } },
  label:{ font:{ ...FONT, bold:true }, fill:{ fgColor:{ rgb:COLORS.paleGray } } },
  text:{ font:{ ...FONT }, alignment:{ vertical:'top', wrapText:true } },
  number:{ font:{ ...FONT }, numFmt:'#,##0.00' },
  integer:{ font:{ ...FONT }, numFmt:'#,##0' },
  currency:{ font:{ ...FONT }, numFmt:'R$ #,##0.00;[Red]-R$ #,##0.00' },
  percent:{ font:{ ...FONT }, numFmt:'0.00%' },
  date:{ font:{ ...FONT }, alignment:{ horizontal:'center' } },
  warning:{ font:{ ...FONT, color:{ rgb:COLORS.red } }, fill:{ fgColor:{ rgb:COLORS.paleRed } }, alignment:{ wrapText:true, vertical:'top' } },
  success:{ font:{ ...FONT, color:{ rgb:COLORS.green } } },
}

export function exportReportWorkbook(report) {
  const workbook = createReportWorkbook(report)
  const period = report.period?.end || new Date().toISOString().slice(0, 10)
  XLSXStyle.writeFile(workbook, `${safeFilename(report.title)}_${period}.xlsx`)
}

export function exportCompleteWorkbook(reports, range = {}) {
  const workbook = createCompleteWorkbook(reports, range)
  const period = range.end || new Date().toISOString().slice(0, 10)
  XLSXStyle.writeFile(workbook, `SurgiMetrics_Relatorios_${period}.xlsx`)
}

export function createReportWorkbook(report) {
  const workbook = XLSXStyle.utils.book_new()
  XLSXStyle.utils.book_append_sheet(workbook, buildSummarySheet(report), 'Resumo')
  XLSXStyle.utils.book_append_sheet(workbook, buildDataSheet(report), safeSheetName(report.title))
  XLSXStyle.utils.book_append_sheet(workbook, buildAuditSheet(report), 'Auditoria')
  return workbook
}

export function createCompleteWorkbook(reports, range = {}) {
  const workbook = XLSXStyle.utils.book_new()
  XLSXStyle.utils.book_append_sheet(workbook, buildIndexSheet(reports, range), 'Índice')

  const usedNames = new Set(['Índice', 'Auditoria'])
  reports.forEach(report => {
    const name = uniqueSheetName(report.title, usedNames)
    usedNames.add(name)
    XLSXStyle.utils.book_append_sheet(workbook, buildDataSheet(report), name)
  })

  XLSXStyle.utils.book_append_sheet(workbook, buildCombinedAuditSheet(reports), 'Auditoria')
  return workbook
}

function buildSummarySheet(report) {
  const rows = [
    [`SURGIMETRICS — ${report.title}`],
    [report.description],
    [`Período: ${periodLabel(report.period)}`],
    [],
    ['Indicador', 'Valor'],
    ...(report.summary || []).map(([label, value, type]) => [label, typedCell(value, type || inferSummaryType(label, value))]),
    [],
    ['Metodologia'],
    [report.methodology || 'Não informada.'],
    [],
    ['Alertas de integridade'],
    ...((report.warnings || []).length ? report.warnings.map(item => [item]) : [['Nenhum alerta específico para este relatório.']]),
  ]
  const ws = XLSXStyle.utils.aoa_to_sheet(rows)
  styleMergedTitle(ws, 2)
  styleRow(ws, 1, STYLES.subtitle, 2)
  styleRow(ws, 2, STYLES.subtitle, 2)
  styleRow(ws, 4, STYLES.header, 2)
  for (let row = 5; row < 5 + (report.summary || []).length; row += 1) {
    setStyle(ws, row, 0, STYLES.label)
    const type = report.summary[row - 5]?.[2] || inferSummaryType(report.summary[row - 5]?.[0], report.summary[row - 5]?.[1])
    setStyle(ws, row, 1, STYLES[type] || STYLES.number)
  }
  const methodologyRow = 6 + (report.summary || []).length
  styleRow(ws, methodologyRow, STYLES.header, 2)
  setStyle(ws, methodologyRow + 1, 0, STYLES.text)
  merge(ws, methodologyRow + 1, 0, methodologyRow + 1, 1)
  const warningHeaderRow = methodologyRow + 3
  styleRow(ws, warningHeaderRow, STYLES.header, 2)
  for (let row = warningHeaderRow + 1; row < rows.length; row += 1) {
    setStyle(ws, row, 0, report.warnings?.length ? STYLES.warning : STYLES.success)
    merge(ws, row, 0, row, 1)
  }
  ws['!cols'] = [{ wch:34 }, { wch:24 }]
  ws['!rows'] = [{ hpt:30 }]
  return ws
}

function buildDataSheet(report) {
  const columns = report.columns || []
  const dataRows = report.rows || []
  const rows = [
    [report.title, ...Array(Math.max(0, columns.length - 1)).fill('')],
    [`Período: ${periodLabel(report.period)} · Gerado em ${formatTimestamp(report.generatedAt)}`, ...Array(Math.max(0, columns.length - 1)).fill('')],
    [],
    columns.map(column => column.label),
    ...dataRows.map(row => columns.map(column => normalizeCellValue(row[column.key], column.type))),
  ]
  const ws = XLSXStyle.utils.aoa_to_sheet(rows)
  const lastColumn = Math.max(0, columns.length - 1)
  styleMergedTitle(ws, columns.length)
  styleRow(ws, 1, STYLES.subtitle, columns.length)
  if (columns.length > 1) merge(ws, 1, 0, 1, lastColumn)
  styleRow(ws, 3, STYLES.header, columns.length)
  dataRows.forEach((_row, index) => {
    const rowIndex = index + 4
    columns.forEach((column, columnIndex) => setStyle(ws, rowIndex, columnIndex, STYLES[column.type] || STYLES.text))
  })
  ws['!cols'] = columns.map(column => ({ wch:column.width || 18 }))
  ws['!rows'] = [{ hpt:30 }, { hpt:20 }, undefined, { hpt:32 }]
  if (columns.length) ws['!autofilter'] = { ref:`A4:${XLSXStyle.utils.encode_col(lastColumn)}${Math.max(4, dataRows.length + 4)}` }
  return ws
}

function buildAuditSheet(report) {
  const rows = [
    ['AUDITORIA DO RELATÓRIO'],
    ['Relatório', report.title],
    ['Gerado em', formatTimestamp(report.generatedAt)],
    ['Período/data-base', periodLabel(report.period)],
    ['Quantidade de linhas', report.rows?.length || 0],
    [],
    ['Fonte', 'Registros carregados'],
    ...Object.entries(report.sourceCounts || {}),
    [],
    ['Metodologia', report.methodology || 'Não informada.'],
    [],
    ['Alertas', 'Detalhe'],
    ...((report.warnings || []).length ? report.warnings.map((warning, index) => [`${index + 1}`, warning]) : [['—', 'Nenhum alerta específico.']]),
  ]
  const ws = XLSXStyle.utils.aoa_to_sheet(rows)
  styleMergedTitle(ws, 2)
  ;[1,2,3,4].forEach(row => { setStyle(ws,row,0,STYLES.label); setStyle(ws,row,1,STYLES.text) })
  styleRow(ws, 6, STYLES.header, 2)
  const sourceEnd = 7 + Object.keys(report.sourceCounts || {}).length
  for (let row = 7; row < sourceEnd; row += 1) { setStyle(ws,row,0,STYLES.text); setStyle(ws,row,1,STYLES.integer) }
  setStyle(ws, sourceEnd + 1, 0, STYLES.label)
  setStyle(ws, sourceEnd + 1, 1, STYLES.text)
  styleRow(ws, sourceEnd + 3, STYLES.header, 2)
  for (let row = sourceEnd + 4; row < rows.length; row += 1) { setStyle(ws,row,0,STYLES.text); setStyle(ws,row,1,report.warnings?.length ? STYLES.warning : STYLES.success) }
  ws['!cols'] = [{ wch:28 }, { wch:78 }]
  return ws
}

function buildIndexSheet(reports, range) {
  const rows = [
    ['SURGIMETRICS — CENTRAL DE RELATÓRIOS'],
    [`Período: ${periodLabel(range)} · Gerado em ${formatTimestamp(reports[0]?.generatedAt)}`],
    [],
    ['Categoria', 'Relatório', 'Linhas exportadas', 'Alertas', 'Descrição'],
    ...reports.map(report => [report.categoryLabel, report.title, report.rows?.length || 0, report.warnings?.length || 0, report.description]),
  ]
  const ws = XLSXStyle.utils.aoa_to_sheet(rows)
  styleMergedTitle(ws, 5)
  styleRow(ws, 1, STYLES.subtitle, 5)
  merge(ws, 1, 0, 1, 4)
  styleRow(ws, 3, STYLES.header, 5)
  reports.forEach((_report,index) => {
    const row=index+4
    setStyle(ws,row,0,STYLES.text);setStyle(ws,row,1,STYLES.text);setStyle(ws,row,2,STYLES.integer);setStyle(ws,row,3,STYLES.integer);setStyle(ws,row,4,STYLES.text)
  })
  ws['!cols']=[{wch:22},{wch:34},{wch:18},{wch:12},{wch:58}]
  ws['!autofilter']={ref:`A4:E${Math.max(4,reports.length+4)}`}
  return ws
}

function buildCombinedAuditSheet(reports) {
  const rows = [
    ['AUDITORIA CONSOLIDADA'],
    ['Relatório', 'Categoria', 'Linhas', 'Tipo', 'Detalhe'],
  ]
  reports.forEach(report => {
    rows.push([report.title, report.categoryLabel, report.rows?.length || 0, 'Metodologia', report.methodology || 'Não informada.'])
    ;(report.warnings || []).forEach(warning => rows.push([report.title, report.categoryLabel, report.rows?.length || 0, 'Alerta', warning]))
  })
  const ws=XLSXStyle.utils.aoa_to_sheet(rows)
  styleMergedTitle(ws,5)
  styleRow(ws,1,STYLES.header,5)
  for(let row=2;row<rows.length;row+=1){for(let col=0;col<5;col+=1)setStyle(ws,row,col,rows[row][3]==='Alerta'&&col===4?STYLES.warning:(col===2?STYLES.integer:STYLES.text))}
  ws['!cols']=[{wch:34},{wch:22},{wch:12},{wch:16},{wch:82}]
  ws['!autofilter']={ref:`A2:E${Math.max(2,rows.length)}`}
  return ws
}

function styleMergedTitle(ws, width) {
  styleRow(ws, 0, STYLES.title, Math.max(1, width))
  if (width > 1) merge(ws, 0, 0, 0, width - 1)
}

function styleRow(ws, row, style, width) {
  for (let column = 0; column < width; column += 1) setStyle(ws, row, column, style)
}

function setStyle(ws, row, column, style) {
  const ref = XLSXStyle.utils.encode_cell({ r:row, c:column })
  if (!ws[ref]) ws[ref] = { t:'s', v:'' }
  ws[ref].s = style
}

function merge(ws, startRow, startColumn, endRow, endColumn) {
  ws['!merges'] = ws['!merges'] || []
  ws['!merges'].push({ s:{ r:startRow, c:startColumn }, e:{ r:endRow, c:endColumn } })
}

function typedCell(value, type) {
  return { v:value, t:typeof value === 'number' ? 'n' : 's', s:STYLES[type] || STYLES.text }
}

function normalizeCellValue(value, type) {
  if (type === 'boolean') return value ? 'Sim' : 'Não'
  if (['number','integer','currency','percent'].includes(type)) return Number(value || 0)
  return value ?? ''
}

function inferSummaryType(label, value) {
  if (typeof value !== 'number') return 'text'
  if (String(label).toLowerCase().includes('margem') || String(label).toLowerCase().includes('progresso')) return 'percent'
  if (/total|receita|saída|entrada|saldo|resultado|custo|valor|faturamento|estoque/i.test(String(label))) return 'currency'
  return Number.isInteger(value) ? 'integer' : 'number'
}

function periodLabel(period = {}) {
  if (period.label) return period.label
  if (period.start && period.end) return `${period.start} a ${period.end}`
  if (period.end) return `até ${period.end}`
  return 'Todos os registros disponíveis'
}

function formatTimestamp(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('pt-BR')
}

function safeSheetName(value) {
  return String(value || 'Relatório').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Relatório'
}

function uniqueSheetName(value, usedNames) {
  const base=safeSheetName(value)
  if(!usedNames.has(base))return base
  let index=2
  while(usedNames.has(safeSheetName(`${base.slice(0,27)} ${index}`)))index+=1
  return safeSheetName(`${base.slice(0,27)} ${index}`)
}

function safeFilename(value) {
  return String(value || 'Relatorio').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
}

