// src/lib/brbStatementLayout.js
// Leitor do extrato do BRB em texto (o PDF do internet banking, copiado ou
// extraido como texto). Produz a mesma forma de linha que o resto da
// conciliacao ja consome, definida em src/lib/statementParser.js.
//
// Ver docs/superpowers/specs/2026-10-30-conciliacao-bancaria-brb-design.md.
//
// O formato e hostil em quatro pontos, e cada um deles esta tratado aqui:
//  1. `DOC` vem `000000` em praticamente toda linha PIX, entao NAO existe
//     identificador unico: a deduplicacao usa chave derivada + indice de
//     ocorrencia dentro do dia;
//  2. a data da linha e so `DD/MM`; o ano vem do cabecalho da secao e precisa
//     ser propagado, senao a virada de ano gera lancamento com data errada;
//  3. o nome da contraparte vem truncado em ~20 caracteres;
//  4. nao ha saldo, entao nao existe soma de controle -- a conferencia e por
//     contagem e total por secao, mostrados para o humano confirmar.

const MONTHS = {
  JANEIRO:1, FEVEREIRO:2, MARCO:3, 'MARÇO':3, ABRIL:4, MAIO:5, JUNHO:6,
  JULHO:7, AGOSTO:8, SETEMBRO:9, OUTUBRO:10, NOVEMBRO:11, DEZEMBRO:12,
}

// `OUTUBRO/2026`
const SECTION_PERIOD = /^([A-ZÇ]+)\s*\/\s*(\d{4})$/i
// `01/10` no comeco da linha
const DAY = /^(\d{2})\/(\d{2})\b/
// `R$ +1.234,00` / `R$ −1.234,00` (o PDF usa o sinal U+2212, nao o hifen)
const AMOUNT = /R\$\s*([+−-])?\s*([\d.]+,\d{2})/
// `CREDITO PIX – DOC: 000000`
const HISTORY = /^(.*?)\s*[–-]\s*DOC:\s*(\d+)\s*$/
// Linhas que nunca sao movimento nem contraparte.
const IGNORED_LINE = /^(Dia|Hist[óo]rico|Valor|Extrato|P[áa]gina\b|Total\b|Saldo\b|Ag[êe]ncia\b|Conta\b)/i

// Um extrato do BRB tem estes marcadores; sem eles nao tentamos interpretar.
export function looksLikeBrbStatement(content) {
  const text = String(content || '')
  return /\bENTRADAS\b/i.test(text)
    && /\bSA[IÍ]DAS\b/i.test(text)
    && /DOC:\s*\d/.test(text)
    && SECTION_PERIOD.test(
      text.split(/\r?\n/).map(line => line.trim()).find(line => SECTION_PERIOD.test(line)) || '',
    )
}

export function parseBrbAmount(raw) {
  const match = AMOUNT.exec(String(raw || ''))
  if (!match) return null
  const value = Number(match[2].replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(value)) return null
  // O sinal da linha e redundante com a secao, mas quando vem usamos ele.
  const negative = match[1] === '-' || match[1] === '−'
  return negative ? -value : value
}

// Remove o codigo de canal (`— 0136`) e o ruido que sobra na linha da
// contraparte. O nome continua truncado pelo banco; isso e aceito.
export function cleanCounterparty(raw) {
  const cleaned = String(raw || '')
    .replace(/[—–-]\s*\d{3,4}\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Linha que e SO o codigo de canal nao tem contraparte nenhuma: devolver
  // "0136" como nome faria o casamento por nome bater em qualquer coisa.
  return /^\d{3,4}$/.test(cleaned) ? '' : cleaned
}

// Algumas linhas trazem digitos de documento colados ao nome
// (`51 412 552 FULANO DE TAL`). Sao os PRIMEIROS digitos do CPF/CNPJ, nao os
// ultimos -- por isso nao alimentam `counterparty_document_suffix`, que
// significaria outra coisa. Ficam separados para ajudar a conferencia humana.
export function splitCounterparty(raw) {
  const cleaned = cleanCounterparty(raw)
  const match = /^((?:\d{2,3}[\s.]){2,3}\d{2,3})\s+(.+)$/.exec(cleaned)
  if (!match) return { name:cleaned, documentPrefix:null }
  return { name:match[2].trim(), documentPrefix:match[1].replace(/\D/g, '') }
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Le o texto inteiro e devolve as linhas normalizadas.
// `options.lineIndexOffset` existe para quem concatena varios extratos.
export function parseBrbStatementText(content, options = {}) {
  const rawLines = String(content || '').split(/\r?\n/).map(line => line.trim())
  const lines = []
  const errors = []
  const sections = []

  let period = null        // { year, month }
  let direction = null     // 'in' | 'out'
  let pending = null       // linha em construcao
  const occurrences = new Map()

  function flush(physicalLine) {
    if (!pending) return
    const { day, month, year, amount, kind, doc, counterparty, lineIndex } = pending
    pending = null

    const postedDate = isoDate(year, month, day)
    if (!postedDate) {
      errors.push({ line:physicalLine, reason:`Data inválida no extrato: ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}.` })
      return
    }
    if (amount == null || amount === 0) {
      errors.push({ line:physicalLine, reason:'Valor ausente ou igual a zero.' })
      return
    }

    // A SEÇÃO manda no sinal. Sem seção reconhecida nao ha como saber se e
    // entrada ou saida, e assumir entrada transformaria um debito em credito
    // silenciosamente -- erro que so apareceria no fluxo de caixa.
    if (direction !== 'in' && direction !== 'out') {
      errors.push({ line:physicalLine, reason:'Movimento fora de ENTRADAS/SAÍDAS: não é possível saber se é entrada ou saída.' })
      return
    }
    const signed = direction === 'out' ? -Math.abs(amount) : Math.abs(amount)

    // O sinal impresso na linha e redundante com a secao. Quando os dois se
    // contradizem, alguma leitura esta errada: avisamos em vez de escolher.
    if (amount < 0 !== (direction === 'out')) {
      errors.push({
        line:physicalLine,
        reason:`Sinal do valor contradiz a seção ${direction === 'out' ? 'SAÍDAS' : 'ENTRADAS'}: confira esta linha no extrato.`,
      })
      return
    }

    // O codigo de canal (`— 0136`) nao diz nada para quem concilia e atrapalha
    // o casamento por nome, entao sai tambem da descricao.
    const { name:counterpartyName, documentPrefix } = splitCounterparty(counterparty)
    const description = [kind, counterpartyName].filter(Boolean).join(' — ')

    // Sem identificador único no extrato, duas transferências idênticas no
    // mesmo dia só se distinguem pela ordem em que aparecem. O índice de
    // ocorrência preserva as duas em vez de colapsar uma.
    const base = `${postedDate}|${signed.toFixed(2)}|${kind}|${counterpartyName.toUpperCase()}`
    const seen = (occurrences.get(base) || 0) + 1
    occurrences.set(base, seen)

    lines.push({
      sourceLineKey:`brb:${base}#${seen}`,
      // Nenhum external_id para o BRB. O `DOC` nao e unico entre tipos de
      // operacao, e o indice unico de external_id derrubaria a importacao
      // INTEIRA numa colisao -- inclusive ao reimportar um periodo sobreposto.
      // O numero fica em source_metadata para conferencia humana, e a
      // deduplicacao usa a chave derivada e o fingerprint.
      externalId:null,
      postedDate,
      amount:Math.round(signed * 100) / 100,
      description,
      normalizedDescription:description.toLocaleUpperCase('pt-BR').replace(/\s+/g, ' ').trim(),
      lineIndex,
      sourceMetadata:{
        bank:'BRB',
        section:direction === 'out' ? 'SAÍDAS' : 'ENTRADAS',
        kind,
        // `counterpartyName` e a chave que o store grava em counterparty_name.
        counterpartyName:counterpartyName || null,
        counterpartyDocumentPrefix:documentPrefix,
        docNumber:doc || null,
        occurrence:seen,
      },
    })
  }

  rawLines.forEach((line, index) => {
    const physicalLine = index + 1 + Number(options.lineIndexOffset || 0)
    if (!line) return

    const periodMatch = SECTION_PERIOD.exec(line)
    if (periodMatch) {
      const month = MONTHS[periodMatch[1].toLocaleUpperCase('pt-BR')]
      if (month) {
        flush(physicalLine)
        period = { year:Number(periodMatch[2]), month }
        sections.push({ year:period.year, month, direction })
      }
      return
    }

    // `\b` e nao `$`: a remontagem por posicao pode colar outro texto na
    // mesma linha do marcador (ex.: "SAÍDAS  Total").
    if (/^ENTRADAS\b/i.test(line)) { flush(physicalLine); direction = 'in'; return }
    if (/^SA[IÍ]DAS\b/i.test(line)) { flush(physicalLine); direction = 'out'; return }
    // Cabecalho, rodape e totais nao sao movimento. Isso importa mais do que
    // parece: a contraparte entra na chave de deduplicacao, entao deixar um
    // "Pagina 2 de 7" virar contraparte faria a MESMA transacao gerar chaves
    // diferentes em extratos paginados de formas diferentes.
    if (IGNORED_LINE.test(line)) return

    const dayMatch = DAY.exec(line)
    if (dayMatch) {
      flush(physicalLine)
      if (!period) {
        errors.push({ line:physicalLine, reason:'Movimento antes do cabeçalho de mês: não é possível saber o ano.' })
        return
      }
      if (Number(dayMatch[2]) !== period.month) {
        // Somar o ano da secao a um mes diferente produziria data com meses de
        // erro -- e a data de caixa alimenta fluxo e DRE.
        errors.push({
          line:physicalLine,
          reason:`Mês da linha (${dayMatch[2]}) diferente do mês da seção (${String(period.month).padStart(2, '0')}).`,
        })
        return
      }
      const rest = line.slice(dayMatch[0].length).trim()
      const amount = parseBrbAmount(rest)
      pending = {
        day:Number(dayMatch[1]),
        month:Number(dayMatch[2]),
        // O mês da linha manda; o ano vem da seção.
        year:period.year,
        amount,
        kind:'',
        doc:'',
        counterparty:'',
        lineIndex:physicalLine,
      }
      // O restante da linha pode já trazer o histórico.
      const withoutAmount = rest.replace(AMOUNT, '').trim()
      if (withoutAmount) applyHistory(pending, withoutAmount)
      return
    }

    // Linha de continuação: tipo da operação, ou contraparte.
    if (pending) {
      if (pending.amount == null) {
        const amount = parseBrbAmount(line)
        if (amount != null) {
          pending.amount = amount
          const rest = line.replace(AMOUNT, '').trim()
          if (rest) applyHistory(pending, rest)
          return
        }
      }
      applyHistory(pending, line)
    }
  })
  flush(rawLines.length + Number(options.lineIndexOffset || 0))

  return { lines, errors, sections }
}

// Uma linha de continuacao so vale como contraparte se parecer nome: letras.
// Um fragmento solto de valor ou um numero perdido nao viram nome.
function looksLikeName(text) {
  return /[A-Za-zÀ-ÿ]{3}/.test(text) && !/R\$/.test(text)
}

function applyHistory(target, text) {
  const historyMatch = HISTORY.exec(text)
  if (historyMatch) {
    // `CREDITO PIX – DOC: 000000`
    if (!target.kind) target.kind = historyMatch[1].trim()
    if (!target.doc) target.doc = historyMatch[2]
    return
  }
  // Sem `DOC:`, é a linha da contraparte — ou o tipo, se ainda não veio.
  const value = text.trim()
  if (!looksLikeName(value) && !/^\d{3,4}$/.test(value)) return
  if (!target.kind) target.kind = value
  else if (!target.counterparty) target.counterparty = value
}
