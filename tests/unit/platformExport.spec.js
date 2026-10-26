import { expect, test } from '@playwright/test'
import XLSXStyle from 'xlsx-js-style'
import {
  buildLocalSheets,
  createPlatformWorkbook,
  fetchAllRows,
  sanitizeObject,
} from '../../src/lib/platformExport.js'
import { filterRowsByPeriod, resolveExportPeriod } from '../../src/lib/exportPeriod.js'

test('períodos mensais, trimestrais, anuais e personalizados respeitam o calendário de São Paulo', () => {
  const now = '2026-10-26T12:00:00.000Z'

  expect(resolveExportPeriod({ preset:'month' }, now)).toMatchObject({ start:'2026-10-01', end:'2026-10-31', label:'Outubro de 2026' })
  expect(resolveExportPeriod({ preset:'quarter' }, now)).toMatchObject({ start:'2026-10-01', end:'2026-12-31', label:'4º trimestre de 2026' })
  expect(resolveExportPeriod({ preset:'year' }, now)).toMatchObject({ start:'2026-01-01', end:'2026-12-31', label:'Ano de 2026' })
  expect(resolveExportPeriod({ preset:'month', month:'2025-02' }, now)).toMatchObject({ start:'2025-02-01', end:'2025-02-28', label:'Fevereiro de 2025' })
  expect(resolveExportPeriod({ preset:'quarter', year:'2024', quarter:'2' }, now)).toMatchObject({ start:'2024-04-01', end:'2024-06-30', label:'2º trimestre de 2024' })
  expect(resolveExportPeriod({ preset:'year', year:'2023' }, now)).toMatchObject({ start:'2023-01-01', end:'2023-12-31', label:'Ano de 2023' })
  expect(resolveExportPeriod({ preset:'custom', start:'2026-02-10', end:'2026-03-20' }, now)).toMatchObject({ start:'2026-02-10', end:'2026-03-20', label:'10/02/2026 a 20/03/2026' })
})

test('filtro temporal usa a data operacional e mantém registros estruturais sem data', () => {
  const rows = filterRowsByPeriod([
    { id:'inside', date:'2026-10-15' },
    { id:'outside', date:'2026-09-30' },
    { id:'timestamp-inside', created_at:'2026-11-01T02:30:00.000Z' },
    { id:'structural' },
  ], { preset:'custom', start:'2026-10-01', end:'2026-10-31' }, ['date', 'created_at'])

  expect(rows.map(row => row.id)).toEqual(['inside', 'timestamp-inside', 'structural'])
})

test('período personalizado inválido bloqueia a exportação', () => {
  expect(() => resolveExportPeriod({ preset:'custom', start:'2026-10-31', end:'2026-10-01' })).toThrow('data inicial')
  expect(() => resolveExportPeriod({ preset:'custom', start:'', end:'2026-10-01' })).toThrow('datas inicial e final')
})

test('exportação por funcionalidade inclui todas as coleções oferecidas pela aba', () => {
  const sheets = buildLocalSheets({
    products:[{ id:'product-1', name:'Cinta' }],
    productSales:[{ id:'sale-1', productId:'product-1', totalValue:200 }],
    productPurchases:[{ id:'purchase-1', productId:'product-1', totalValue:100 }],
  }, 'products')

  expect(sheets.map(sheet => sheet.title)).toEqual(['Produtos', 'Vendas de produtos', 'Compras de produtos'])
  expect(sheets.map(sheet => sheet.rows.length)).toEqual([1, 1, 1])
})

test('exportação por funcionalidade filtra coleções datadas pelo período escolhido', () => {
  const sheets = buildLocalSheets({
    surgeries:[
      { id:'october', date:'2026-10-15' },
      { id:'november', date:'2026-11-01' },
    ],
  }, 'sales', { preset:'custom', start:'2026-10-01', end:'2026-10-31' })

  expect(sheets).toHaveLength(1)
  expect(sheets[0].rows.map(row => row.id)).toEqual(['october'])
})

test('sanitização preserva dados funcionais e remove credenciais inclusive em objetos aninhados', () => {
  const safe = sanitizeObject({
    id:'number-1',
    label:'Concierge',
    access_token:'segredo',
    api_token:'segredo-2',
    logoDataUrl:'data:image/png;base64,abc',
    settings:{ status:'ativo', client_secret:'segredo-3' },
  })

  expect(safe).toEqual({
    id:'number-1',
    label:'Concierge',
    logoDataUrl:'[arquivo binário não incluído na planilha]',
    settings:{ status:'ativo' },
  })
})

test('busca remota pagina além do limite padrão de mil registros', async () => {
  const allRows = Array.from({ length:1001 }, (_, index) => ({ id:`row-${String(index).padStart(4, '0')}` }))
  const requestedRanges = []
  const database = {
    from(table) {
      expect(table).toBe('patients')
      return {
        select() {
          return {
            order() {
              return {
                async range(start, end) {
                  requestedRanges.push([start, end])
                  return { data:allRows.slice(start, end + 1), error:null }
                },
              }
            },
          }
        },
      }
    },
  }

  const rows = await fetchAllRows(database, { table:'patients' })
  expect(rows).toHaveLength(1001)
  expect(requestedRanges).toEqual([[0, 999], [1000, 1999]])
})

test('workbook padronizado traz clínica, data, horário, filtros e estilos', () => {
  const workbook = createPlatformWorkbook({
    title:'Cirurgias',
    clinicName:'Clínica Aurora',
    generatedAt:'2026-10-26T15:30:45.000Z',
    period:{ preset:'month' },
    sheets:[{ title:'Cirurgias', rows:[{ id:'surgery-1', patient:'Ana', totalValue:12000, date:'2026-10-26' }] }],
    warnings:[],
  })

  expect(workbook.SheetNames).toEqual(['Visão Geral', 'Cirurgias'])
  expect(workbook.Sheets['Visão Geral'].A1.v).toContain('Clínica Aurora')
  expect(workbook.Sheets['Visão Geral'].A4.v).toBe('Período exportado: Outubro de 2026')
  expect(workbook.Sheets.Cirurgias.A1.v).toContain('Clínica Aurora')
  expect(workbook.Sheets.Cirurgias.A2.v).toContain('26/10/2026')
  expect(workbook.Sheets.Cirurgias.A2.v).toContain('Período: Outubro de 2026')
  expect(workbook.Sheets.Cirurgias['!autofilter'].ref).toBe('A4:D5')
  expect(workbook.Sheets.Cirurgias.A1.s.fill.fgColor.rgb).toBe('10233F')

  const bytes = XLSXStyle.write(workbook, { bookType:'xlsx', type:'buffer' })
  expect(bytes.length).toBeGreaterThan(5000)
})

test('aba sem registros preserva título legível e estado vazio estilizado', () => {
  const workbook = createPlatformWorkbook({
    title:'Exportação completa',
    clinicName:'Clínica Aurora — Unidade Jardins',
    generatedAt:'2026-10-26T15:30:45.000Z',
    sheets:[{ title:'Dados vazios', rows:[] }],
  })

  const sheet = workbook.Sheets['Dados vazios']
  expect(sheet['!ref']).toBe('A1:C4')
  expect(sheet['!merges']).toContainEqual({ s:{ r:0, c:0 }, e:{ r:0, c:2 } })
  expect(sheet['!merges']).toContainEqual({ s:{ r:3, c:0 }, e:{ r:3, c:2 } })
  expect(sheet.A4.v).toBe('Sem registros')
})
