const DATE_HEADERS = ['data', 'date', 'dtposted', 'data lancamento', 'data do lancamento']
const DESCRIPTION_HEADERS = ['descricao', 'descrição', 'historico', 'histórico', 'memo', 'detalhes', 'lancamento', 'lançamento']
const AMOUNT_HEADERS = ['valor', 'amount', 'value', 'valor lancamento', 'valor do lancamento']
const CREDIT_HEADERS = ['credito', 'crédito', 'credit', 'entrada']
const DEBIT_HEADERS = ['debito', 'débito', 'debit', 'saida', 'saída']
const ID_HEADERS = ['fitid', 'id', 'identificador', 'documento']

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
    return normalizedAliases.some(alias => normalized === alias || normalized.includes(alias))
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
  const mapping = {
    date:findHeader(headers, DATE_HEADERS),
    description:findHeader(headers, DESCRIPTION_HEADERS),
    amount:findHeader(headers, AMOUNT_HEADERS),
    credit:findHeader(headers, CREDIT_HEADERS),
    debit:findHeader(headers, DEBIT_HEADERS),
    externalId:findHeader(headers, ID_HEADERS),
  }
  const hasAmount = mapping.amount >= 0 || (mapping.credit >= 0 && mapping.debit >= 0)
  return { mapping, complete:mapping.date >= 0 && hasAmount }
}

function normalizeMapping(mapping = {}) {
  const result = {}
  for (const key of ['date', 'description', 'amount', 'credit', 'debit', 'externalId']) {
    const value = Number(mapping[key])
    result[key] = Number.isInteger(value) && value >= 0 ? value : -1
  }
  return result
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

export function parseOfxStatement(content) {
  const text = stripBom(content)
  const starts = [...text.matchAll(/<STMTTRN>/gi)]
  if (!starts.length) return { format:'ofx', lines:[], errors:[{ line:1, reason:'Nenhuma transação OFX foi encontrada.' }], requiresMapping:false, mapping:null }
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
    const description = extractOfxTag(block, 'MEMO') || extractOfxTag(block, 'NAME') || extractOfxTag(block, 'CHECKNUM') || ''
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
      sourceMetadata:{ transactionType:extractOfxTag(block, 'TRNTYPE') || null },
    })
  })
  return { format:'ofx', lines, errors, requiresMapping:false, mapping:null }
}

export function parseStatementText(content, options = {}) {
  const fileName = String(options.fileName || '').toLowerCase()
  const looksOfx = fileName.endsWith('.ofx') || /OFXHEADER\s*:|<OFX[>\s]/i.test(content)
  return looksOfx ? parseOfxStatement(content) : parseCsvStatement(content, options)
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

export async function parseStatementFile(file, options = {}) {
  const buffer = await file.arrayBuffer()
  const text = decodeStatementBuffer(buffer)
  const parsed = parseStatementText(text, { ...options, fileName:file.name })
  return { ...parsed, fileName:file.name, fileHash:await sha256Hex(buffer), fileSize:file.size }
}
