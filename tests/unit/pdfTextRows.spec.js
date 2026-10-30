import { expect, test } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { groupTextItemsIntoRows, extractPdfTextRows } from '../../src/lib/pdfTextRows.js'
import { parseStatementText } from '../../src/lib/statementParser.js'

// ---------------------------------------------------------------------------
// Agrupamento por posicao (puro)
// ---------------------------------------------------------------------------

test('fragmentos na mesma altura viram uma linha, ordenados pela posição horizontal', () => {
  // Chegam fora de ordem de proposito: e assim que o PDF do BRB entrega.
  const rows = groupTextItemsIntoRows([
    { text:'R$ +1.234,00', x:420, y:700, height:10 },
    { text:'01/10', x:40, y:700, height:10 },
    { text:'CREDITO PIX – DOC: 000000', x:120, y:700, height:10 },
  ])
  expect(rows).toEqual(['01/10 CREDITO PIX – DOC: 000000 R$ +1.234,00'])
})

test('linhas diferentes não se misturam, e a ordem é de cima para baixo', () => {
  const rows = groupTextItemsIntoRows([
    { text:'segunda', x:40, y:680, height:10 },
    { text:'primeira', x:40, y:700, height:10 },
    { text:'terceira', x:40, y:660, height:10 },
  ])
  expect(rows).toEqual(['primeira', 'segunda', 'terceira'])
})

test('pequena variação de altura na mesma linha não quebra a linha em duas', () => {
  // Fragmentos de uma mesma linha raramente têm Y idêntico no PDF.
  const rows = groupTextItemsIntoRows([
    { text:'01/10', x:40, y:700.0, height:10 },
    { text:'CREDITO PIX', x:120, y:700.4, height:10 },
    { text:'R$ +9,00', x:420, y:699.6, height:10 },
  ])
  expect(rows).toHaveLength(1)
})

test('a tolerância acompanha o tamanho do texto, em vez de ser um número fixo', () => {
  // Texto grande (cabeçalho) tolera mais distância que texto pequeno.
  const pequeno = groupTextItemsIntoRows([
    { text:'a', x:0, y:100, height:6 },
    { text:'b', x:10, y:95, height:6 },
  ])
  expect(pequeno).toHaveLength(2)

  const grande = groupTextItemsIntoRows([
    { text:'a', x:0, y:100, height:24 },
    { text:'b', x:10, y:95, height:24 },
  ])
  expect(grande).toHaveLength(1)
})

test('fragmentos vazios e lista vazia não viram linha', () => {
  expect(groupTextItemsIntoRows([])).toEqual([])
  expect(groupTextItemsIntoRows([{ text:'   ', x:0, y:0, height:10 }])).toEqual([])
  expect(groupTextItemsIntoRows(null)).toEqual([])
})

// ---------------------------------------------------------------------------
// PDF de verdade, com as colunas desencontradas como no extrato do BRB
// ---------------------------------------------------------------------------

// Escreve as COLUNAS em ordem trocada de proposito: primeiro toda a coluna do
// historico, depois a do dia e a do valor. E assim que o extrato do BRB guarda
// o texto, e e por isso que copiar e colar embaralha os campos.
async function buildBrbLikePdf() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595.28, 841.89])
  const draw = (text, x, y, size = 9) => page.drawText(text, { x, y, size, font })

  draw('Extrato', 40, 800, 14)
  draw('ENTRADAS', 40, 780, 12)
  draw('OUTUBRO/2026', 40, 765)
  draw('Dia', 40, 750)
  draw('Historico', 120, 750)
  draw('Valor', 440, 750)

  // Coluna do historico primeiro.
  draw('CREDITO PIX - DOC: 000000', 120, 730)
  draw('FULANO DE TAL AAAA - 0136', 120, 718)
  draw('CREDITO DE TED PAG C.CORRENTE - DOC: 821925', 120, 700)
  draw('BELTRANO DA SILVA', 120, 688)

  // Só depois a coluna do dia e a do valor.
  draw('01/10', 40, 730)
  draw('R$ +1.234,00', 440, 730)
  draw('07/10', 40, 700)
  draw('R$ +500,00', 440, 700)

  draw('SAIDAS', 40, 650, 12)
  draw('OUTUBRO/2026', 40, 635)
  draw('Dia', 40, 620)
  draw('Historico', 120, 620)
  draw('Valor', 440, 620)
  draw('TARIFA ENVIO VALORES PIX - DOC: 000000', 120, 600)
  draw('02/10', 40, 600)
  draw('R$ -9,00', 440, 600)

  return Buffer.from(await doc.save())
}

test('a ordem interna do PDF é embaralhada — é por isso que copiar e colar falha', async () => {
  const pdf = await buildBrbLikePdf()
  const rows = await extractPdfTextRows(pdf)
  // Remontado pela posição, o dia volta a ficar junto do seu histórico e valor.
  expect(rows).toContain('01/10 CREDITO PIX - DOC: 000000 R$ +1.234,00')
  expect(rows).toContain('07/10 CREDITO DE TED PAG C.CORRENTE - DOC: 821925 R$ +500,00')
  expect(rows).toContain('02/10 TARIFA ENVIO VALORES PIX - DOC: 000000 R$ -9,00')
  // A contraparte fica na própria linha, como continuação.
  expect(rows).toContain('FULANO DE TAL AAAA - 0136')
})

test('o PDF remontado atravessa o parser e vira lançamentos corretos', async () => {
  const pdf = await buildBrbLikePdf()
  const rows = await extractPdfTextRows(pdf)
  const parsed = parseStatementText(rows.join('\n'), { fileName:'extrato.pdf' })

  expect(parsed.format).toBe('brb')
  expect(parsed.lines).toHaveLength(3)

  const [primeira, segunda, saida] = parsed.lines
  expect(primeira.postedDate).toBe('2026-10-01')
  expect(primeira.amount).toBe(1234)
  expect(primeira.sourceMetadata.counterpartyName).toBe('FULANO DE TAL AAAA')

  expect(segunda.postedDate).toBe('2026-10-07')
  expect(segunda.sourceMetadata.docNumber).toBe('821925')
  expect(segunda.externalId).toBeNull()
  expect(segunda.sourceMetadata.counterpartyName).toBe('BELTRANO DA SILVA')

  // A seção decidiu o sinal.
  expect(saida.amount).toBe(-9)
  expect(saida.sourceMetadata.section).toBe('SAÍDAS')

  expect(parsed.totals.receipts).toBe(1734)
  expect(parsed.totals.expenses).toBe(9)
})
