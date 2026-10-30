import { expect, test } from '@playwright/test'
import {
  cleanCounterparty,
  splitCounterparty,
  looksLikeBrbStatement,
  parseBrbAmount,
  parseBrbStatementText,
} from '../../src/lib/brbStatementLayout.js'
import { parseStatementText, statementTotals } from '../../src/lib/statementParser.js'

// Layout real do extrato do BRB, com dados FICTICIOS. O extrato verdadeiro tem
// nome de paciente e valor real e nao entra no repositorio.
const EXTRATO = `Extrato
CLINICA EXEMPLO LTDA
29/10/2026 14:22

ENTRADAS
OUTUBRO/2026
Dia Histórico Valor
01/10 CREDITO PIX – DOC: 000000
FULANO DE TAL AAAA — 0136
R$ +1.234,00
01/10 CREDITO PIX – DOC: 000000
0136
R$ +200,00
02/10 CRED JUROS LIQUIDO CDB AUTOMAT – DOC: 000000
R$ +54,45
07/10 CREDITO DE TED PAG C.CORRENTE – DOC: 821925
BELTRANO DA SILVA
R$ +38.459,00

SAÍDAS
OUTUBRO/2026
Dia Histórico Valor
01/10 TARIFA ENVIO VALORES PIX – DOC: 000000
R$ −9,00
01/10 DEBITO PIX – DOC: 000000
SICRANO SOBRENOME — 0136
R$ −2.300,00
13/10 PAGAMENTO TRIBUTO FEDERAL – DOC: 649808
0123
R$ −2.929,69`

test('reconhece o extrato do BRB e nao confunde com CSV ou OFX', () => {
  expect(looksLikeBrbStatement(EXTRATO)).toBe(true)
  expect(looksLikeBrbStatement('data;valor;descricao\n01/10/2026;10,00;teste')).toBe(false)
  expect(looksLikeBrbStatement('OFXHEADER:100')).toBe(false)
  expect(looksLikeBrbStatement('')).toBe(false)
  // Texto com as palavras soltas, sem periodo nem DOC, nao e extrato.
  expect(looksLikeBrbStatement('ENTRADAS e SAÍDAS do mês')).toBe(false)
})

test('a seção define o sinal: ENTRADAS positivo, SAÍDAS negativo', () => {
  const { lines } = parseBrbStatementText(EXTRATO)
  const entradas = lines.filter(line => line.sourceMetadata.section === 'ENTRADAS')
  const saidas = lines.filter(line => line.sourceMetadata.section === 'SAÍDAS')
  expect(entradas).toHaveLength(4)
  expect(saidas).toHaveLength(3)
  expect(entradas.every(line => line.amount > 0)).toBe(true)
  expect(saidas.every(line => line.amount < 0)).toBe(true)
})

test('o ano vem do cabeçalho da seção, porque a linha só tem dia/mês', () => {
  const { lines } = parseBrbStatementText(EXTRATO)
  expect(lines[0].postedDate).toBe('2026-10-01')
  expect(lines.at(-1).postedDate).toBe('2026-10-13')
  // Todas as datas ficam no ano da seção, nunca no ano corrente.
  expect(lines.every(line => line.postedDate.startsWith('2026-10-'))).toBe(true)
})

test('extrato que cruza a virada do ano mantém cada mês no seu ano', () => {
  const doisMeses = `ENTRADAS
DEZEMBRO/2025
Dia Histórico Valor
31/12 CREDITO PIX – DOC: 000000
R$ +100,00
JANEIRO/2026
Dia Histórico Valor
02/01 CREDITO PIX – DOC: 000000
R$ +200,00
SAÍDAS
JANEIRO/2026
Dia Histórico Valor
03/01 DEBITO PIX – DOC: 000000
R$ −50,00`
  const { lines } = parseBrbStatementText(doisMeses)
  expect(lines.map(line => line.postedDate)).toEqual(['2025-12-31', '2026-01-02', '2026-01-03'])
})

test('movimento antes do cabeçalho de mês é recusado em vez de chutar o ano', () => {
  const semPeriodo = `ENTRADAS
Dia Histórico Valor
01/10 CREDITO PIX – DOC: 000000
R$ +100,00`
  const { lines, errors } = parseBrbStatementText(semPeriodo)
  expect(lines).toHaveLength(0)
  expect(errors[0].reason).toContain('não é possível saber o ano')
})

test('duas transferências idênticas no mesmo dia continuam sendo duas', () => {
  // Sem identificador único no extrato, elas só se distinguem pela ordem.
  const duplicadas = `ENTRADAS
OUTUBRO/2026
Dia Histórico Valor
01/10 CREDITO PIX – DOC: 000000
FULANO DE TAL AAAA — 0136
R$ +200,00
01/10 CREDITO PIX – DOC: 000000
FULANO DE TAL AAAA — 0136
R$ +200,00`
  const { lines } = parseBrbStatementText(duplicadas)
  expect(lines).toHaveLength(2)
  expect(lines[0].sourceLineKey).not.toBe(lines[1].sourceLineKey)
  expect(lines[0].sourceMetadata.occurrence).toBe(1)
  expect(lines[1].sourceMetadata.occurrence).toBe(2)
})

test('a mesma linha lida de novo gera a mesma chave, para dedupe entre importações', () => {
  const primeira = parseBrbStatementText(EXTRATO).lines
  const segunda = parseBrbStatementText(EXTRATO).lines
  expect(primeira.map(line => line.sourceLineKey)).toEqual(segunda.map(line => line.sourceLineKey))
  // A chave não depende do número da linha física, que muda se o PDF for
  // copiado com um cabeçalho a mais.
  const comCabecalhoExtra = parseBrbStatementText(`Extrato do mês\n\n${EXTRATO}`).lines
  expect(comCabecalhoExtra.map(line => line.sourceLineKey)).toEqual(primeira.map(line => line.sourceLineKey))
})

test('DOC 000000 não vira identificador, mas DOC real vira', () => {
  const { lines } = parseBrbStatementText(EXTRATO)
  const pix = lines.find(line => line.sourceMetadata.kind.includes('CREDITO PIX'))
  const ted = lines.find(line => line.sourceMetadata.kind.includes('TED'))
  const tributo = lines.find(line => line.sourceMetadata.kind.includes('TRIBUTO'))
  expect(pix.externalId).toBeNull()
  expect(ted.externalId).toBe('brb:821925')
  expect(tributo.externalId).toBe('brb:649808')
})

test('tipo e contraparte são separados, e o código de canal sai do nome', () => {
  const { lines } = parseBrbStatementText(EXTRATO)
  const pix = lines[0]
  expect(pix.sourceMetadata.kind).toBe('CREDITO PIX')
  expect(pix.sourceMetadata.counterpartyName).toBe('FULANO DE TAL AAAA')
  expect(pix.description).toBe('CREDITO PIX — FULANO DE TAL AAAA')

  // Linha sem contraparte (só o código de canal) não inventa nome.
  const semNome = lines[1]
  expect(semNome.sourceMetadata.counterpartyName).toBeNull()

  expect(cleanCounterparty('FULANO DE TAL AAAA — 0136')).toBe('FULANO DE TAL AAAA')
  expect(cleanCounterparty('0136')).toBe('')
  expect(cleanCounterparty('')).toBe('')
})

test('dígitos de documento colados ao nome são separados, nunca tratados como sufixo', () => {
  // O extrato traz os PRIMEIROS dígitos do CPF/CNPJ, não os últimos.
  expect(splitCounterparty('51 412 552 AMANDA RO — 0136')).toEqual({
    name:'AMANDA RO', documentPrefix:'51412552',
  })
  expect(splitCounterparty('FULANO DE TAL — 0136')).toEqual({ name:'FULANO DE TAL', documentPrefix:null })
  expect(splitCounterparty('0136')).toEqual({ name:'', documentPrefix:null })
})

test('valores são lidos com o sinal U+2212 que o PDF usa, não só o hífen', () => {
  expect(parseBrbAmount('R$ +1.234,00')).toBe(1234)
  expect(parseBrbAmount('R$ −9,00')).toBe(-9)
  expect(parseBrbAmount('R$ -9,00')).toBe(-9)
  expect(parseBrbAmount('R$ +27.155,00')).toBe(27155)
  expect(parseBrbAmount('R$ +54,45')).toBe(54.45)
  expect(parseBrbAmount('sem valor')).toBeNull()
  expect(parseBrbAmount('')).toBeNull()
})

test('os totais batem com a soma de cada seção', () => {
  const { lines } = parseBrbStatementText(EXTRATO)
  const totals = statementTotals(lines)
  // 1234 + 200 + 54,45 + 38459
  expect(totals.receipts).toBe(39947.45)
  // 9 + 2300 + 2929,69
  expect(totals.expenses).toBe(5238.69)
  expect(totals.net).toBe(34708.76)
})

test('o extrato entra pelo caminho normal do parser, sem passar pelo leitor de CSV', () => {
  const parsed = parseStatementText(EXTRATO, { fileName:'extrato.txt' })
  expect(parsed.format).toBe('brb')
  expect(parsed.bank).toBe('BRB')
  expect(parsed.requiresMapping).toBe(false)
  expect(parsed.lines).toHaveLength(7)
  expect(parsed.totals.net).toBe(34708.76)
  // E um CSV de verdade continua indo para o leitor de CSV.
  expect(parseStatementText('data;valor\n01/10/2026;10,00', { fileName:'x.csv' }).format).not.toBe('brb')
})
