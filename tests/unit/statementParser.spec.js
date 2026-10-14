import { expect, test } from '@playwright/test'
import { decodeStatementBuffer, parseCsvStatement, parseOfxStatement, parseStatementAmount, sha256Hex } from '../../src/lib/statementParser.js'

test('parseia OFX SGML e XML preservando a data bancária declarada', () => {
  const ofx = `OFXHEADER:100\n<OFX><BANKTRANLIST>
    <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261013120000[-3:BRT]<TRNAMT>500.00<FITID>abc-1<MEMO>PIX MARIA</STMTTRN>
    <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261014110000.000[-3:BRT]<TRNAMT>-18.90<FITID>abc-2<NAME>TARIFA</STMTTRN>
  </BANKTRANLIST></OFX>`
  const result = parseOfxStatement(ofx)
  expect(result.errors).toEqual([])
  expect(result.lines).toHaveLength(2)
  expect(result.lines[0]).toMatchObject({ externalId:'abc-1', postedDate:'2026-10-13', amount:500, description:'PIX MARIA' })
  expect(result.lines[1]).toMatchObject({ externalId:'abc-2', postedDate:'2026-10-14', amount:-18.9, description:'TARIFA' })
})

test('parseia CSV com aspas, ponto e vírgula e quebra de linha dentro da descrição', () => {
  const csv = 'Data;Descrição;Valor\r\n13/10/2026;"PIX; Maria";"500,00"\r\n14/10/2026;"Tarifa\nbancária";"-18,90"'
  const result = parseCsvStatement(csv)
  expect(result.requiresMapping).toBe(false)
  expect(result.errors).toEqual([])
  expect(result.lines).toHaveLength(2)
  expect(result.lines[0]).toMatchObject({ postedDate:'2026-10-13', amount:500, description:'PIX; Maria' })
  expect(result.lines[1]).toMatchObject({ postedDate:'2026-10-14', amount:-18.9, description:'Tarifa\nbancária' })
})

test('aceita colunas separadas de crédito e débito', () => {
  const csv = 'data,descricao,credito,debito\n2026-10-13,Recebimento,"1.234,56",\n2026-10-14,Pagamento,,"89,10"'
  const result = parseCsvStatement(csv)
  expect(result.errors).toEqual([])
  expect(result.lines.map(line => line.amount)).toEqual([1234.56, -89.1])
})

test('pede mapeamento quando cabeçalho é ambíguo e não descarta linhas inválidas silenciosamente', () => {
  const ambiguous = parseCsvStatement('quando;texto;quantia\n13/10/2026;x;10')
  expect(ambiguous.requiresMapping).toBe(true)
  const mapped = parseCsvStatement('quando;texto;quantia\n31/02/2026;x;10\n13/10/2026;y;0', { mapping:{ date:0, description:1, amount:2 } })
  expect(mapped.lines).toEqual([])
  expect(mapped.errors).toHaveLength(2)
})

test('bloqueia CSV inteiro quando aspas abertas podem engolir outra movimentação', () => {
  const csv = 'Data;Descrição;Valor\n13/10/2026;"PIX Maria;500,00\n14/10/2026;Tarifa;-18,90'
  const result = parseCsvStatement(csv)
  expect(result.lines).toEqual([])
  expect(result.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason:expect.stringContaining('aspas sem fechamento') }),
  ]))
})

test('bloqueia CSV inteiro quando uma linha tem largura diferente do cabeçalho', () => {
  const csv = 'Data;Descrição;Valor\n13/10/2026;PIX Maria;500,00;coluna inesperada\n14/10/2026;Tarifa;-18,90'
  const result = parseCsvStatement(csv)
  expect(result.lines).toEqual([])
  expect(result.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ line:2, reason:expect.stringContaining('Quantidade de colunas') }),
  ]))
})

test('interpreta formatos monetários brasileiros e parênteses', () => {
  expect(parseStatementAmount('R$ 1.234,56')).toBe(1234.56)
  expect(parseStatementAmount('(89,10)')).toBe(-89.1)
  expect(parseStatementAmount('1,234.56')).toBe(1234.56)
})

test('faz fallback Windows-1252 e hash determinístico', async () => {
  expect(decodeStatementBuffer(Uint8Array.from([67, 97, 102, 233]))).toBe('Café')
  expect(await sha256Hex('extrato')).toBe(await sha256Hex('extrato'))
  expect(await sha256Hex('extrato')).not.toBe(await sha256Hex('outro'))
})
