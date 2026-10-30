const DATE_HEADERS = ['data', 'date', 'dtposted', 'data lancamento', 'data do lancamento']
const DESCRIPTION_HEADERS = ['descricao', 'descrição', 'historico', 'histórico', 'memo', 'detalhes', 'lancamento', 'lançamento']
const AMOUNT_HEADERS = ['valor', 'amount', 'value', 'valor lancamento', 'valor do lancamento']
const CREDIT_HEADERS = ['credito', 'crédito', 'credit', 'entrada', 'receita']
const DEBIT_HEADERS = ['debito', 'débito', 'debit', 'saida', 'saída', 'despesa']
const ID_HEADERS = ['fitid', 'id', 'transaction id', 'id transacao', 'id transação', 'identificador', 'documento']
const CATEGORY_HEADERS = ['categoria', 'plano de contas', 'conta contabil', 'conta contábil']
const COST_CENTER_HEADERS = ['centro de custo', 'centro custo']
const REFERENCE_HEADERS = ['paciente contrato', 'paciente', 'contrato', 'referencia', 'referência']
const OBSERVATION_HEADERS = ['observacao servico', 'observação serviço', 'observacao', 'observação', 'servico', 'serviço']
const CASH_PAYMENT_HEADERS = ['pagamento a vista', 'pagamento à vista', 'a vista', 'à vista']
const INSTALLMENT_HEADERS = ['parcelado se parcelado qual parcela', 'parcelado', 'parcela']

import { looksLikeBrbStatement, parseBrbStatementText } from './brbStatementLayout.js'

function stripBom(value) {
  return String(value || '').replace(/^\uFEFF/, '')
}

export function normalizeStatementDescription(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(pix|ted|doc|transferencia|transferência)\b/g, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function normalizeHeader(value) {
  return normalizeStatementDescription(value)
}

function findHeader(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader)
  return headers.findIndex(header => {
    const normalized = normalizeHeader(header)
    return normalizedAliases.some(alias => normalized === alias || (alias.length > 2 && normalized.includes(alias)))
  })
}

function parseIsoOrBrDate(value) {
  const raw = String(value || '').trim()
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (match) return validDate(match[1], match[2], match[3])
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/)
  if (!match) return null
  const year = match[3].length === 2 ? `20${match[3]}` : match[3]
  return validDate(year, match[2], match[1])
}

function validDate(year, month, day) {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  const candidate = new Date(Date.UTC(y, m - 1, d))
  if (candidate.getUTCFullYear() !== y || candidate.getUTCMonth() !== m - 1 || candidate.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function parseStatementAmount(value) {
  let raw = String(value ?? '').trim()
  if (!raw) return null
  const negativeByParentheses = /^\(.*\)$/.test(raw)
  raw = raw.replace(/[()\sR$]/g, '')
  const comma = raw.lastIndexOf(',')
  const dot = raw.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    raw = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')
  } else if (comma >= 0) {
    raw = raw.replace(/\./g, '').replace(',', '.')
  } else if ((raw.match(/\./g) || []).length > 1) {
    const last = raw.lastIndexOf('.')
    raw = `${raw.slice(0, last).replace(/\./g, '')}${raw.slice(last)}`
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return null
  return negativeByParentheses ? -Math.abs(parsed) : parsed
}

function parseCsvRows(content, delimiter) {
  const rows = []
  const rowLines = []
  const errors = []
  let row = []
  let field = ''
  let quoted = false
  let quoteClosed = false
  let physicalLine = 1
  let rowStartLine = 1

  function finishRow() {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
    rowLines.push(rowStartLine)
    row = []
    field = ''
    quoteClosed = false
    rowStartLine = physicalLine + 1
  }

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
        quoteClosed = true
      } else {
        field += char
        if (char === '\n') physicalLine += 1
      }
      continue
    }
    if (quoteClosed) {
      if (char === delimiter) {
        row.push(field)
        field = ''
        quoteClosed = false
      } else if (char === '\n') {
        finishRow()
        physicalLine += 1
      } else if (char !== '\r' && !/\s/.test(char)) {
        errors.push({ line:physicalLine, reason:'Há conteúdo inesperado depois do fechamento de aspas.' })
        field += char
        quoteClosed = false
      }
    } else if (char === '"') {
      if (field.length > 0) {
        errors.push({ line:physicalLine, reason:'Há aspas em posição inválida no CSV.' })
        field += char
      } else {
        quoted = true
      }
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      finishRow()
      physicalLine += 1
    } else {
      field += char
    }
  }
  if (quoted) errors.push({ line:rowStartLine, reason:'Há aspas sem fechamento; o arquivo pode ter unido movimentações diferentes.' })
  row.push(field.replace(/\r$/, ''))
  if (row.some(cell => cell.trim())) {
    rows.push(row)
    rowLines.push(rowStartLine)
  }
  return { rows, rowLines, errors }
}

function detectDelimiter(content) {
  const sample = content.slice(0, 20_000)
  const delimiters = [';', ',', '\t']
  const ranked = delimiters.map(delimiter => {
    const rows = parseCsvRows(sample, delimiter).rows.slice(0, 10)
    const widths = rows.filter(row => row.some(cell => cell.trim())).map(row => row.length)
    const commonWidth = widths.reduce((best, width) => widths.filter(item => item === width).length > widths.filter(item => item === best).length ? width : best, widths[0] || 0)
    return { delimiter, headerWidth:widths[0] || 0, commonWidth, consistent:widths.filter(width => width === commonWidth).length }
  }).sort((a, b) => Number(b.headerWidth > 1) - Number(a.headerWidth > 1)
    || Number(b.commonWidth > 1) - Number(a.commonWidth > 1)
    || b.consistent - a.consistent
    || b.commonWidth - a.commonWidth)
  return ranked[0]?.headerWidth > 1 ? ranked[0].delimiter : null
}

function autoMapping(headers) {
  const credit = findHeader(headers, CREDIT_HEADERS)
  const debit = findHeader(headers, DEBIT_HEADERS)
  const mapping = {
    date:findHeader(headers, DATE_HEADERS),
    description:findHeader(headers, DESCRIPTION_HEADERS),
    // Quando crédito e débito existem em colunas separadas, eles têm precedência. Isso evita
    // interpretar “Valor crédito” como um valor assinado e perder silenciosamente os débitos.
    amount:credit >= 0 && debit >= 0 ? -1 : findHeader(headers, AMOUNT_HEADERS),
    credit,
    debit,
    externalId:findHeader(headers, ID_HEADERS),
    category:findHeader(headers, CATEGORY_HEADERS),
    costCenter:findHeader(headers, COST_CENTER_HEADERS),
    reference:findHeader(headers, REFERENCE_HEADERS),
    observation:findHeader(headers, OBSERVATION_HEADERS),
    cashPayment:findHeader(headers, CASH_PAYMENT_HEADERS),
    installmentInfo:findHeader(headers, INSTALLMENT_HEADERS),
  }
  // O modelo mensal usado pela clínica deixa sem título a coluna de paciente/contrato,
  // posicionada entre Centro de custo e Observação/serviço. Preserva esse dado sem depender
  // de nome de pessoa ou conteúdo da linha.
  if (mapping.reference < 0 && mapping.costCenter >= 0 && mapping.observation === mapping.costCenter + 2
    && !String(headers[mapping.costCenter + 1] || '').trim()) {
    mapping.reference = mapping.costCenter + 1
  }
  const hasAmount = mapping.amount >= 0 || (mapping.credit >= 0 && mapping.debit >= 0)
  return { mapping, complete:mapping.date >= 0 && hasAmount }
}

function normalizeMapping(mapping = {}) {
  const result = {}
  for (const key of ['date', 'description', 'amount', 'credit', 'debit', 'externalId', 'category', 'costCenter', 'reference', 'observation', 'cashPayment', 'installmentInfo']) {
    const value = Number(mapping[key])
    result[key] = Number.isInteger(value) && value >= 0 ? value : -1
  }
  return result
}

function mappedText(row, mapping, key) {
  return mapping[key] >= 0 ? String(row[mapping[key]] ?? '').trim() : ''
}

function spreadsheetDate(value, XLSX) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return validDate(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    return parsed ? validDate(parsed.y, parsed.m, parsed.d) : null
  }
  return parseIsoOrBrDate(value)
}

function spreadsheetHeader(rows) {
  const candidates = rows.slice(0, 20).map((row, index) => {
    const headers = row.map(cell => String(cell ?? '').trim())
    const detected = autoMapping(headers)
    const metadataFields = ['category', 'costCenter', 'reference', 'observation'].filter(key => detected.mapping[key] >= 0).length
    return { index, headers, ...detected, score:Number(detected.complete) * 100 + metadataFields * 10 + headers.filter(Boolean).length }
  })
  return candidates.sort((a, b) => b.score - a.score || a.index - b.index)[0] || { index:0, headers:[], mapping:{}, complete:false }
}

export async function parseXlsxStatement(buffer, options = {}) {
  const imported = await import('xlsx')
  const XLSX = imported.default || imported
  const workbook = XLSX.read(buffer, { type:'array', cellDates:false })
  const sheetNames = [...workbook.SheetNames]
  const sheetName = options.sheetName && workbook.Sheets[options.sheetName] ? options.sheetName : workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return { format:'xlsx', sheetNames, headers:[], lines:[], errors:[{ line:1, reason:'A planilha não possui uma aba legível.' }], requiresMapping:false, mapping:null }
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1')
  const rows = XLSX.utils.sheet_to_json(sheet, { header:1, raw:true, defval:'', blankrows:true })
  const detected = spreadsheetHeader(rows)
  const headerIndex = Number.isInteger(options.headerRow) ? options.headerRow : detected.index
  const headers = (rows[headerIndex] || []).map(cell => String(cell ?? '').trim())
  const mapping = options.mapping ? normalizeMapping(options.mapping) : autoMapping(headers).mapping
  const hasAmount = mapping.amount >= 0 || (mapping.credit >= 0 && mapping.debit >= 0)
  if (mapping.date < 0 || !hasAmount) {
    return { format:'xlsx', sheetNames, sheetName, headerRow:headerIndex, headers, lines:[], errors:[], requiresMapping:true, mapping }
  }

  const lines = []
  const errors = []
  const seenIds = new Set()
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const rowIndex = headerIndex + 1 + offset
    const displayLine = range.s.r + rowIndex + 1
    const rawDate = row[mapping.date]
    const description = mappedText(row, mapping, 'description')
    const category = mappedText(row, mapping, 'category')
    const costCenter = mappedText(row, mapping, 'costCenter')
    const reference = mappedText(row, mapping, 'reference')
    const observation = mappedText(row, mapping, 'observation')
    const cashPayment = mappedText(row, mapping, 'cashPayment')
    const installmentInfo = mappedText(row, mapping, 'installmentInfo')
    const hasSupportingData = Boolean(description || category || costCenter || reference || observation || cashPayment || installmentInfo)
    const amount = csvLineAmount(row, mapping)
    const rowHasAnyValue = row.some(cell => String(cell ?? '').trim())
    if (!rowHasAnyValue) return
    // Totais/rodapés do Excel normalmente têm apenas fórmula/valor e nenhuma identificação.
    if (!rawDate && !hasSupportingData) return
    if (!rawDate && /^(total|saldo)$/i.test(description) && !category && !costCenter && !reference && !observation) return
    const postedDate = spreadsheetDate(rawDate, XLSX)
    const externalId = mappedText(row, mapping, 'externalId') || null
    if (!postedDate) errors.push({ line:displayLine, reason:'Data inválida ou ausente.' })
    if (amount == null || amount === 0) errors.push({ line:displayLine, reason:'Receita/despesa inválida, ausente ou igual a zero.' })
    if (externalId && seenIds.has(externalId)) errors.push({ line:displayLine, reason:`Identificador duplicado no arquivo: ${externalId}.` })
    if (!postedDate || amount == null || amount === 0 || (externalId && seenIds.has(externalId))) return
    if (externalId) seenIds.add(externalId)
    lines.push({
      sourceLineKey:lineKey({ externalId, lineIndex:displayLine, postedDate, amount, description }),
      externalId,
      postedDate,
      amount:Math.round(amount * 100) / 100,
      description,
      normalizedDescription:normalizeStatementDescription([description, reference, observation].filter(Boolean).join(' ')),
      lineIndex:displayLine,
      sourceMetadata:{ sheetName, excelRow:displayLine, category, costCenter, reference, observation, cashPayment, installmentInfo },
    })
  })
  const totals = statementTotals(lines)
  return { format:'xlsx', sheetNames, sheetName, headerRow:headerIndex, headers, lines, errors, requiresMapping:false, mapping, totals }
}

function csvLineAmount(row, mapping) {
  if (mapping.amount >= 0) return parseStatementAmount(row[mapping.amount])
  const credit = mapping.credit >= 0 ? parseStatementAmount(row[mapping.credit]) : null
  const debit = mapping.debit >= 0 ? parseStatementAmount(row[mapping.debit]) : null
  if (credit != null && credit !== 0 && debit != null && debit !== 0) return null
  if (credit != null && credit !== 0) return Math.abs(credit)
  if (debit != null && debit !== 0) return -Math.abs(debit)
  return null
}

function lineKey({ externalId, lineIndex, postedDate, amount, description }) {
  return externalId || `${lineIndex}:${postedDate}:${Number(amount).toFixed(2)}:${normalizeStatementDescription(description)}`
}

export function statementTotals(lines = []) {
  const totals = lines.reduce((acc, line) => {
    if (Number(line.amount) > 0) acc.receipts += Number(line.amount)
    else acc.expenses += Math.abs(Number(line.amount))
    return acc
  }, { receipts:0, expenses:0 })
  totals.receipts = Math.round(totals.receipts * 100) / 100
  totals.expenses = Math.round(totals.expenses * 100) / 100
  totals.net = Math.round((totals.receipts - totals.expenses) * 100) / 100
  return totals
}

export function updateStatementLine(line, changes = {}) {
  const postedDate = parseIsoOrBrDate(changes.postedDate ?? line.postedDate)
  if (!postedDate) throw new Error('Informe uma data válida.')
  const amount = parseStatementAmount(changes.amount ?? line.amount)
  if (amount == null || amount === 0) throw new Error('Informe um valor diferente de zero.')
  const description = String(changes.description ?? line.description ?? '').trim()
  const currentMetadata = line.sourceMetadata || line.source_metadata || {}
  const sourceMetadata = {
    ...currentMetadata,
    category:String(changes.category ?? currentMetadata.category ?? '').trim(),
    costCenter:String(changes.costCenter ?? currentMetadata.costCenter ?? '').trim(),
    reference:String(changes.reference ?? currentMetadata.reference ?? '').trim(),
    observation:String(changes.observation ?? currentMetadata.observation ?? '').trim(),
  }
  const roundedAmount = Math.round(amount * 100) / 100
  return {
    ...line,
    postedDate,
    amount:roundedAmount,
    description,
    normalizedDescription:normalizeStatementDescription([description, sourceMetadata.reference, sourceMetadata.observation].filter(Boolean).join(' ')),
    sourceLineKey:lineKey({ externalId:line.externalId, lineIndex:line.lineIndex, postedDate, amount:roundedAmount, description }),
    sourceMetadata,
  }
}

export function statementMovementFingerprint(line) {
  const amount = Number(line?.amount || 0)
  const description = line?.normalizedDescription || line?.normalized_description || line?.description || ''
  return [
    line?.postedDate || line?.posted_date || '',
    amount > 0 ? 'receivable' : 'payable',
    Math.abs(amount).toFixed(2),
    normalizeStatementDescription(description),
  ].join('|')
}

export function parseCsvStatement(content, options = {}) {
  const text = stripBom(content)
  const delimiter = options.delimiter || detectDelimiter(text)
  if (!delimiter) return { format:'csv', headers:[], lines:[], errors:[{ line:1, reason:'Não foi possível identificar o separador do CSV.' }], requiresMapping:true, mapping:null }
  const parsedRows = parseCsvRows(text, delimiter)
  const nonEmptyRows = parsedRows.rows
    .map((row, index) => ({ row, line:parsedRows.rowLines[index] }))
    .filter(item => item.row.some(cell => cell.trim()))
  const rows = nonEmptyRows.map(item => item.row)
  if (rows.length < 2) return { format:'csv', headers:rows[0] || [], lines:[], errors:[{ line:1, reason:'O CSV não possui linhas de movimentação.' }], requiresMapping:false, mapping:null, delimiter }
  const headers = rows[0].map(cell => stripBom(cell).trim())
  const structuralErrors = [...parsedRows.errors]
  nonEmptyRows.slice(1).forEach(item => {
    if (item.row.length !== headers.length) {
      structuralErrors.push({ line:item.line, reason:`Quantidade de colunas diferente do cabeçalho (${item.row.length} em vez de ${headers.length}).` })
    }
  })
  if (structuralErrors.length) {
    return { format:'csv', headers, lines:[], errors:structuralErrors, requiresMapping:false, mapping:null, delimiter }
  }
  const detected = autoMapping(headers)
  const mapping = options.mapping ? normalizeMapping(options.mapping) : detected.mapping
  const hasAmount = mapping.amount >= 0 || (mapping.credit >= 0 && mapping.debit >= 0)
  if (mapping.date < 0 || !hasAmount) {
    return { format:'csv', headers, lines:[], errors:[], requiresMapping:true, mapping, delimiter }
  }

  const lines = []
  const errors = []
  const seenIds = new Set()
  rows.slice(1).forEach((row, rowIndex) => {
    const displayLine = nonEmptyRows[rowIndex + 1].line
    const postedDate = parseIsoOrBrDate(row[mapping.date])
    const amount = csvLineAmount(row, mapping)
    const description = mapping.description >= 0 ? String(row[mapping.description] || '').trim() : ''
    const externalId = mapping.externalId >= 0 ? String(row[mapping.externalId] || '').trim() || null : null
    if (!postedDate) errors.push({ line:displayLine, reason:'Data inválida ou ausente.' })
    if (amount == null || amount === 0) errors.push({ line:displayLine, reason:'Valor inválido, ausente ou igual a zero.' })
    if (externalId && seenIds.has(externalId)) errors.push({ line:displayLine, reason:`Identificador duplicado no arquivo: ${externalId}.` })
    if (!postedDate || amount == null || amount === 0 || (externalId && seenIds.has(externalId))) return
    if (externalId) seenIds.add(externalId)
    const normalizedDescription = normalizeStatementDescription(description)
    lines.push({
      sourceLineKey:lineKey({ externalId, lineIndex:displayLine, postedDate, amount, description }),
      externalId,
      postedDate,
      amount:Math.round(amount * 100) / 100,
      description,
      normalizedDescription,
      lineIndex:displayLine,
      sourceMetadata:{ delimiter },
    })
  })
  return { format:'csv', headers, lines, errors, requiresMapping:false, mapping, delimiter }
}

function extractOfxTag(block, tag) {
  const match = String(block).match(new RegExp(`<${tag}[^>]*>\\s*([^<\\r\\n]+)`, 'i'))
  return match ? match[1].trim() : ''
}

function ofxDate(value) {
  const raw = String(value || '').trim()
  if (!/^\d{8}/.test(raw)) return null
  return validDate(raw.slice(0, 4), raw.slice(4, 6), raw.slice(6, 8))
}

function maskAccountNumber(value) {
  const normalized = String(value || '').replace(/\s+/g, '').trim()
  if (!normalized) return null
  const suffix = normalized.replace(/[^a-z0-9]/gi, '').slice(-4)
  return suffix ? `••••${suffix}` : null
}

function extractEndToEndId(value) {
  const match = String(value || '').match(/\bE\d{8}[A-Z0-9]{23}\b/i)
  return match ? match[0].toUpperCase() : null
}

function ofxStatementMetadata(text) {
  const accountId = extractOfxTag(text, 'ACCTID')
  const institutionCode = extractOfxTag(text, 'BANKID') || extractOfxTag(text, 'FID') || null
  const agencyCode = extractOfxTag(text, 'BRANCHID') || null
  const accountType = extractOfxTag(text, 'ACCTTYPE') || null
  const currency = (extractOfxTag(text, 'CURDEF') || 'BRL').toUpperCase()
  const periodStart = ofxDate(extractOfxTag(text, 'DTSTART'))
  const periodEnd = ofxDate(extractOfxTag(text, 'DTEND'))
  const ledgerBlock = text.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i)?.[1] || ''
  const closingBalance = parseStatementAmount(extractOfxTag(ledgerBlock, 'BALAMT'))
  const balanceDate = ofxDate(extractOfxTag(ledgerBlock, 'DTASOF'))
  const availableBlock = text.match(/<AVAILBAL>([\s\S]*?)(?:<\/AVAILBAL>|<LEDGERBAL>|<BANKTRANLIST>|<\/STMTRS>)/i)?.[1] || ''
  const availableBalance = parseStatementAmount(extractOfxTag(availableBlock, 'BALAMT'))
  const suffix = accountId.replace(/[^a-z0-9]/gi, '').slice(-4) || null
  return {
    institutionCode,
    institutionName:extractOfxTag(text, 'ORG') || null,
    agencyCode,
    accountNumberMasked:maskAccountNumber(accountId),
    accountNumberSuffix:suffix,
    accountType,
    currency,
    periodStart,
    periodEnd,
    closingBalance,
    availableBalance,
    balanceDate,
    accountFingerprint:institutionCode && suffix
      ? `${String(institutionCode).toLowerCase()}:${String(agencyCode || '').toLowerCase()}:${suffix.toLowerCase()}:${String(accountType || '').toLowerCase()}`
      : null,
  }
}

export function parseOfxStatement(content) {
  const text = stripBom(content)
  const statementMetadata = ofxStatementMetadata(text)
  const starts = [...text.matchAll(/<STMTTRN>/gi)]
  if (!starts.length) return { format:'ofx', lines:[], errors:[{ line:1, reason:'Nenhuma transação OFX foi encontrada.' }], requiresMapping:false, mapping:null, statementMetadata }
  const lines = []
  const errors = []
  const seenIds = new Set()
  starts.forEach((start, index) => {
    const from = start.index + start[0].length
    const next = starts[index + 1]?.index ?? text.length
    const block = text.slice(from, next).split(/<\/STMTTRN>/i)[0]
    const displayLine = index + 1
    const postedDate = ofxDate(extractOfxTag(block, 'DTPOSTED'))
    const amount = parseStatementAmount(extractOfxTag(block, 'TRNAMT'))
    const externalId = extractOfxTag(block, 'FITID') || null
    const memo = extractOfxTag(block, 'MEMO')
    const name = extractOfxTag(block, 'NAME')
    const checkNumber = extractOfxTag(block, 'CHECKNUM') || null
    const referenceNumber = extractOfxTag(block, 'REFNUM') || null
    const description = memo || name || checkNumber || ''
    if (!postedDate) errors.push({ line:displayLine, reason:'DTPOSTED inválido ou ausente.' })
    if (amount == null || amount === 0) errors.push({ line:displayLine, reason:'TRNAMT inválido, ausente ou igual a zero.' })
    if (externalId && seenIds.has(externalId)) errors.push({ line:displayLine, reason:`FITID duplicado no arquivo: ${externalId}.` })
    if (!postedDate || amount == null || amount === 0 || (externalId && seenIds.has(externalId))) return
    if (externalId) seenIds.add(externalId)
    const normalizedDescription = normalizeStatementDescription(description)
    lines.push({
      sourceLineKey:lineKey({ externalId, lineIndex:displayLine, postedDate, amount, description }),
      externalId,
      postedDate,
      amount:Math.round(amount * 100) / 100,
      description,
      normalizedDescription,
      lineIndex:displayLine,
      sourceMetadata:{
        transactionType:extractOfxTag(block, 'TRNTYPE') || null,
        transactionStatus:'booked',
        checkNumber,
        referenceNumber,
        txid:extractOfxTag(block, 'TXID') || null,
        endToEndId:extractEndToEndId(`${memo} ${name} ${referenceNumber || ''}`),
        counterpartyName:name || null,
      },
    })
  })
  return { format:'ofx', lines, errors, requiresMapping:false, mapping:null, statementMetadata }
}

export function parseStatementText(content, options = {}) {
  const fileName = String(options.fileName || '').toLowerCase()
  const looksOfx = fileName.endsWith('.ofx') || /OFXHEADER\s*:|<OFX[>\s]/i.test(content)
  if (looksOfx) return parseOfxStatement(content)
  // Extrato do BRB em texto (PDF do internet banking copiado como texto).
  // Nao e tabular, entao nao passa pelo leitor de CSV.
  if (looksLikeBrbStatement(content)) {
    const { lines, errors, sections } = parseBrbStatementText(content, options)
    return {
      format:'brb',
      bank:'BRB',
      lines,
      errors,
      sections,
      requiresMapping:false,
      mapping:null,
      totals:statementTotals(lines),
    }
  }
  return parseCsvStatement(content, options)
}

export function decodeStatementBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  try {
    return new TextDecoder('utf-8', { fatal:true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : (value instanceof Uint8Array ? value : new Uint8Array(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

// O PDF do extrato nao guarda o texto na ordem de leitura: a coluna do
// historico vem separada da coluna de dia/valor. Por isso ele e remontado pela
// POSICAO de cada fragmento antes de chegar ao parser -- copiar e colar o PDF
// embaralharia os campos.
async function parsePdfStatement(buffer, options = {}) {
  const { extractPdfTextRows } = await import('./pdfTextRows.js')
  let rows
  try {
    rows = await extractPdfTextRows(buffer)
  } catch {
    return {
      format:'pdf', lines:[], requiresMapping:false, mapping:null,
      totals:statementTotals([]),
      errors:[{ line:0, reason:'Não foi possível ler o PDF. Se ele for digitalizado (imagem), exporte o extrato em OFX, CSV ou texto.' }],
    }
  }
  const text = rows.join('\n')
  if (!rows.length) {
    return {
      format:'pdf', lines:[], requiresMapping:false, mapping:null,
      totals:statementTotals([]),
      errors:[{ line:0, reason:'O PDF não tem texto selecionável. Provavelmente é digitalizado; exporte o extrato em OFX, CSV ou texto.' }],
    }
  }
  const parsed = parseStatementText(text, { ...options, fileName:'extrato.txt' })
  if (parsed.format === 'brb') return { ...parsed, format:'brb', sourceFormat:'pdf' }
  return {
    format:'pdf', lines:[], requiresMapping:false, mapping:null,
    totals:statementTotals([]),
    errors:[{ line:0, reason:'Este PDF não tem o layout de extrato reconhecido. Exporte em OFX, CSV ou Excel.' }],
  }
}

export async function parseStatementFile(file, options = {}) {
  const buffer = await file.arrayBuffer()
  const lowerName = String(file.name || '').toLowerCase()
  let parsed
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    parsed = await parseXlsxStatement(buffer, options)
  } else if (lowerName.endsWith('.pdf')) {
    parsed = await parsePdfStatement(buffer, options)
  } else {
    parsed = parseStatementText(decodeStatementBuffer(buffer), { ...options, fileName:file.name })
  }
  return { ...parsed, fileName:file.name, fileHash:await sha256Hex(buffer), fileSize:file.size }
}
