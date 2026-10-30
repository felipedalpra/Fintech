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

test('nenhuma linha vira external_id, porque o DOC não é único entre tipos', () => {
  // O índice único de external_id derrubaria a importação INTEIRA numa colisão,
  // inclusive ao reimportar um período sobreposto. O número fica em
  // source_metadata para conferência, e a dedupe usa a chave derivada.
  const { lines } = parseBrbStatementText(EXTRATO)
  expect(lines.every(line => line.externalId === null)).toBe(true)

  const ted = lines.find(line => line.sourceMetadata.kind.includes('TED'))
  expect(ted.sourceMetadata.docNumber).toBe('821925')
  const pix = lines.find(line => line.sourceMetadata.kind.includes('CREDITO PIX'))
  expect(pix.sourceMetadata.docNumber).toBe('000000')
})

test('movimento fora de ENTRADAS/SAÍDAS é recusado, nunca vira entrada por omissão', () => {
  const semSecao = `OUTUBRO/2026
Dia Histórico Valor
01/10 DEBITO PIX – DOC: 000000
R$ −500,00`
  const { lines, errors } = parseBrbStatementText(semSecao)
  expect(lines).toHaveLength(0)
  expect(errors[0].reason).toContain('não é possível saber se é entrada ou saída')
})

test('sinal impresso que contradiz a seção vira erro, não escolha silenciosa', () => {
  const contraditorio = `ENTRADAS
OUTUBRO/2026
Dia Histórico Valor
01/10 CREDITO PIX – DOC: 000000
R$ −500,00`
  const { lines, errors } = parseBrbStatementText(contraditorio)
  expect(lines).toHaveLength(0)
  expect(errors[0].reason).toContain('contradiz a seção')
})

test('mês da linha diferente do mês da seção é recusado', () => {
  // Somar o ano da seção a outro mês geraria data com meses de erro, e a data
  // de caixa alimenta fluxo e DRE.
  const inconsistente = `ENTRADAS
JANEIRO/2027
Dia Histórico Valor
31/12 CREDITO PIX – DOC: 000000
R$ +100,00`
  const { lines, errors } = parseBrbStatementText(inconsistente)
  expect(lines).toHaveLength(0)
  expect(errors[0].reason).toContain('diferente do mês da seção')
})

test('rodapé e totais não viram contraparte, porque ela entra na chave de dedupe', () => {
  const comRodape = `ENTRADAS
OUTUBRO/2026
Dia Histórico Valor
01/10 CREDITO PIX – DOC: 000000
Página 2 de 7
R$ +100,00
02/10 CREDITO PIX – DOC: 000000
Total do mês
R$ +200,00`
  const { lines } = parseBrbStatementText(comRodape)
  expect(lines).toHaveLength(2)
  expect(lines.every(line => line.sourceMetadata.counterpartyName === null)).toBe(true)
})

test('marcador de seção colado a outro texto ainda é reconhecido', () => {
  // A remontagem por posição pode juntar "SAÍDAS" com um total na mesma linha.
  const colado = `SAÍDAS   Total do período
OUTUBRO/2026
Dia Histórico Valor
02/10 DEBITO PIX – DOC: 000000
R$ −9,00`
  const { lines } = parseBrbStatementText(colado)
  expect(lines).toHaveLength(1)
  expect(lines[0].amount).toBe(-9)
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

// ---------------------------------------------------------------------------
// Layout REAL do PDF: o tipo vem numa linha ACIMA do dia
// ---------------------------------------------------------------------------
// O extrato que a clinica usa nao coloca o tipo na mesma linha do dia: o
// historico fica numa linha propria, ANTES da linha do dia/valor, e a
// contraparte vem DEPOIS. Ler esse arquivo de verdade foi o que revelou que a
// primeira versao do parser jogava o tipo fora e gravava a contraparte no lugar
// dele -- corrompendo a descricao E a chave de dedupe de todo o extrato.
const EXTRATO_TIPO_ACIMA = `Extrato
CLINICA EXEMPLO LTDA
Agência: 100 — Conta Corrente: 100.071.191-6
29/10/2026 14:22
ENTRADAS
OUTUBRO/2026
Dia Histórico Valor
CREDITO PIX – DOC: 000000
01/10 R$ +1.234,00
0136
CREDITO PIX – DOC: 000000
01/10 R$ +2.345,00
FULANO DE TAL AAAA — 0136
CREDITO DE TED PAG C.CORRENTE – DOC: 821925
07/10 R$ +500,00
BELTRANO DA SILVA
SAÍDAS
OUTUBRO/2026
Dia Histórico Valor
TARIFA ENVIO VALORES PIX – DOC: 000000
02/10 R$ −9,00`

test('tipo numa linha acima do dia é preservado — é assim no PDF real', () => {
  const { lines, errors } = parseBrbStatementText(EXTRATO_TIPO_ACIMA)
  expect(errors).toEqual([])
  expect(lines).toHaveLength(4)

  // O tipo NAO pode ser perdido nem substituido pela contraparte.
  expect(lines.map(line => line.sourceMetadata.kind)).toEqual([
    'CREDITO PIX',
    'CREDITO PIX',
    'CREDITO DE TED PAG C.CORRENTE',
    'TARIFA ENVIO VALORES PIX',
  ])
  // E a contraparte, que vem DEPOIS do dia, continua sendo contraparte.
  expect(lines[0].sourceMetadata.counterpartyName).toBeNull()
  expect(lines[1].sourceMetadata.counterpartyName).toBe('FULANO DE TAL AAAA')
  expect(lines[2].sourceMetadata.counterpartyName).toBe('BELTRANO DA SILVA')
  expect(lines[2].sourceMetadata.docNumber).toBe('821925')
})

test('o carimbo de geração do extrato não vira lançamento', () => {
  // "29/10/2026 14:22" comeca igual a uma linha de dia ("29/10"). Se for lido
  // como movimento, entra um lancamento inventado em todo extrato importado.
  const { lines, errors } = parseBrbStatementText(EXTRATO_TIPO_ACIMA)
  expect(errors).toEqual([])
  expect(lines.some(line => line.postedDate.endsWith('-10-29'))).toBe(false)
})

test('o tipo pendente não atravessa a troca de seção', () => {
  // Este teste nasceu VAZIO: a versão anterior punha um `DEBITO PIX – DOC:`
  // depois da troca de seção, que sobrescrevia o cabeçalho pendente de
  // qualquer forma -- então ele passava mesmo sem o reset que dizia testar.
  // Agora o movimento das SAÍDAS vem SEM cabeçalho: ele não pode herdar o
  // `CREDITO PIX` órfão das ENTRADAS, que é de outra seção.
  const { lines, errors } = parseBrbStatementText(`ENTRADAS
OUTUBRO/2026
CREDITO PIX – DOC: 000000
SAÍDAS
OUTUBRO/2026
02/10 R$ −9,00`)
  expect(lines).toHaveLength(0)
  expect(errors.map(error => error.reason)).toEqual([
    expect.stringContaining('sem movimento correspondente'),
    expect.stringContaining('Movimento sem tipo de operação'),
  ])
})

test('movimento sem histórico é recusado, nunca gravado sem tipo', () => {
  // O tipo entra na chave de deduplicação. Um movimento sem tipo gravado em
  // silêncio corrompe a chave: reimportar o período duplicaria lançamentos.
  const { lines, errors } = parseBrbStatementText(`ENTRADAS
OUTUBRO/2026
01/10 R$ +10,00
FULANO DE TAL — 0136`)
  expect(lines).toHaveLength(0)
  expect(errors[0].reason).toContain('Movimento sem tipo de operação')
})

test('texto livre nunca é promovido a tipo, mesmo sem histórico na frente', () => {
  // Era o bug original: a contraparte tomava o lugar do tipo. Aqui o primeiro
  // movimento é recusado, e o SEGUNDO (com cabeçalho) sai correto -- provando
  // que a falha de um não contamina o outro.
  const { lines, errors } = parseBrbStatementText(`ENTRADAS
OUTUBRO/2026
01/10 R$ +10,00
FULANO DE TAL — 0136
CREDITO PIX – DOC: 000000
02/10 R$ +5,00
BELTRANO — 0136`)
  expect(errors).toHaveLength(1)
  expect(lines).toHaveLength(1)
  expect(lines[0].sourceMetadata.kind).toBe('CREDITO PIX')
  expect(lines[0].sourceMetadata.counterpartyName).toBe('BELTRANO')
})

test('contraparte que começa com palavra de rótulo não é descartada', () => {
  // `Conta\b`, `Dia`, `Total\b` casavam por PREFIXO e engoliam contrapartes
  // reais. A contraparte entra na chave de dedupe, então perdê-la faz duas
  // transferências de mesmo valor e dia para fornecedores diferentes
  // compartilharem a mesma base de chave.
  const nomes = ['CONTA AZUL SA', 'DIAGNOSTICOS DO BRASIL', 'TOTAL SAUDE LTDA', 'VALORIZE SERVICOS', 'SALDAO DA CONSTRUCAO']
  for (const nome of nomes) {
    const { lines, errors } = parseBrbStatementText(`SAÍDAS
OUTUBRO/2026
DEBITO PIX – DOC: 000000
01/10 R$ −10,00
${nome} — 0136`)
    expect(errors, nome).toEqual([])
    expect(lines[0].sourceMetadata.counterpartyName, nome).toBe(nome)
  }
})

test('rótulo de rodapé continua sendo descartado, agora pela forma exata', () => {
  const rotulos = ['Extrato', 'Dia Histórico Valor', 'Total do mês', 'Total', 'Saldo anterior',
    'Conta Corrente: 100.000.000-0', 'Agência: 100 — Conta Corrente: 100.000.000-0',
    'Página 2 de 7', '29/10/2026 14:22']
  for (const rotulo of rotulos) {
    const { lines, errors } = parseBrbStatementText(`SAÍDAS
OUTUBRO/2026
DEBITO PIX – DOC: 000000
01/10 R$ −10,00
${rotulo}`)
    expect(errors, rotulo).toEqual([])
    expect(lines, rotulo).toHaveLength(1)
    expect(lines[0].sourceMetadata.counterpartyName, rotulo).toBeNull()
  }
})

test('dois históricos seguidos não fazem o primeiro desaparecer', () => {
  const { lines, errors } = parseBrbStatementText(`ENTRADAS
OUTUBRO/2026
CREDITO PIX – DOC: 111
CREDITO DE TED PAG C.CORRENTE – DOC: 222
01/10 R$ +10,00`)
  expect(lines).toHaveLength(1)
  expect(lines[0].sourceMetadata.kind).toBe('CREDITO DE TED PAG C.CORRENTE')
  expect(errors[0].reason).toContain('CREDITO PIX')
  expect(errors[0].reason).toContain('sem movimento correspondente')
})

test('histórico órfão no fim do arquivo é avisado, não engolido', () => {
  // Um histórico sem movimento significa que a leitura perdeu uma linha: o
  // extrato ficaria com um lançamento de menos sem ninguém notar.
  const { lines, errors } = parseBrbStatementText(`ENTRADAS
OUTUBRO/2026
CREDITO PIX – DOC: 111
01/10 R$ +10,00
DEBITO PIX – DOC: 222`)
  expect(lines).toHaveLength(1)
  expect(errors[0].reason).toContain('sem movimento correspondente')
})

test('segunda linha de texto no mesmo movimento vira erro, não escolha', () => {
  // Se duas linhas disputam o papel de contraparte, a chave de dedupe passaria
  // a depender de onde a página quebrou. Avisar é melhor que escolher.
  const { errors } = parseBrbStatementText(`SAÍDAS
OUTUBRO/2026
DEBITO PIX – DOC: 000000
01/10 R$ −10,00
FULANO DE TAL — 0136
BELTRANO DA SILVA`)
  expect(errors[0].reason).toContain('Linha inesperada dentro de um movimento')
})

test('a mesma transação gera a mesma chave com paginação diferente', () => {
  // Fidedignidade cross-importação: reimportar o mesmo período com o extrato
  // paginado de outra forma não pode mudar a chave de deduplicação, senão a
  // reimportação duplica tudo.
  const movimento = `DEBITO PIX – DOC: 000000
01/10 R$ −10,00
FULANO DE TAL — 0136`
  const semQuebra = parseBrbStatementText(`SAÍDAS\nOUTUBRO/2026\n${movimento}`)
  const comQuebra = parseBrbStatementText(
    `SAÍDAS\nOUTUBRO/2026\nPágina 1 de 2\n${movimento}\nPágina 2 de 2\nDia Histórico Valor`,
  )
  expect(semQuebra.errors).toEqual([])
  expect(comQuebra.errors).toEqual([])
  expect(comQuebra.lines[0].sourceLineKey).toBe(semQuebra.lines[0].sourceLineKey)
})
