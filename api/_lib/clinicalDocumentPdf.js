// api/_lib/clinicalDocumentPdf.js
// Renderizacao deterministica, no servidor, do PDF do documento clinico que
// sera enviado para assinatura.
//
// Por que no servidor e nao reaproveitando o HTML de impressao do navegador:
//  - o conteudo assinado nao pode depender de fonte, zoom ou motor do cliente;
//  - o SHA-256 do artefato precisa ser reproduzivel para auditoria.
//
// Por que pdf-lib e nao Chromium/headless: a Vercel nao comporta um navegador
// nesta funcao, e pdf-lib gera bytes estaveis quando datas, produtor e fluxo de
// objetos sao fixados (ver fixDeterministicMetadata).

import crypto from 'crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// Instante fixo: qualquer data "agora" dentro dos metadados quebraria a
// reprodutibilidade do hash do artefato.
const DETERMINISTIC_EPOCH = new Date(Date.UTC(2000, 0, 1, 0, 0, 0))
const PRODUCER = 'SurgiMetrics Clinical Renderer'

const A4 = Object.freeze({ width:595.28, height:841.89 })
const MARGIN = 51 // ~18mm
const TITLE_SIZE = 16
const BODY_SIZE = 10.5
const SMALL_SIZE = 8.5
const LINE_GAP = 4

const INK = rgb(0.094, 0.125, 0.169)
const MUTED = rgb(0.333, 0.376, 0.431)
const RULE = rgb(0.114, 0.478, 0.467)

// Substituicoes deterministas para o que a WinAnsiEncoding das fontes padrao
// nao representa. Sem isso o render falharia em um caractere colado pelo
// usuario, exatamente no momento de assinar.
const CHARACTER_FALLBACKS = Object.freeze({
  '‘':"'", '’':"'", '‚':"'", '‛':"'",
  '“':'"', '”':'"', '„':'"',
  '‐':'-', '‑':'-', '‒':'-', '–':'-', '—':'-', '―':'-',
  '…':'...', ' ':' ', '​':'', ' ':' ', ' ':' ',
  '•':'-', '·':'-', '−':'-', '­':'',
  '⁄':'/', '₿':'', '﻿':'',
})

// WinAnsi cobre Latin-1 + um bloco de pontuacao. Fora disso, descartamos de
// forma deterministica em vez de deixar o pdf-lib lancar.
function encodableForWinAnsi(char) {
  const code = char.codePointAt(0)
  if (code === 0x0a) return true
  if (code >= 0x20 && code <= 0x7e) return true
  if (code >= 0xa0 && code <= 0xff) return true
  return ['€', '‚', 'ƒ', '…', '†', '‡', 'ˆ', '‰',
    'Š', '‹', 'Œ', 'Ž', '‘', '’', '“', '”',
    '•', '–', '—', '˜', '™', 'š', '›', 'œ',
    'ž', 'Ÿ'].includes(char)
}

export function sanitizePdfText(value) {
  const raw = String(value ?? '')
  let output = ''
  for (const char of raw) {
    if (Object.hasOwn(CHARACTER_FALLBACKS, char)) {
      output += CHARACTER_FALLBACKS[char]
      continue
    }
    output += encodableForWinAnsi(char) ? char : ''
  }
  // Normaliza quebras e espacos para que o mesmo conteudo logico gere os
  // mesmos bytes, independente de como foi digitado.
  return output.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
}

export function wrapText(text, { font, size, maxWidth }) {
  const lines = []
  for (const paragraph of sanitizePdfText(text).split('\n')) {
    if (!paragraph) { lines.push(''); continue }
    let current = ''
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
        // Palavra sozinha maior que a linha: quebra por caractere para nao
        // transbordar a margem do documento clinico.
        if (!current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          let chunk = ''
          for (const char of candidate) {
            if (font.widthOfTextAtSize(chunk + char, size) > maxWidth && chunk) {
              lines.push(chunk)
              chunk = char
            } else {
              chunk += char
            }
          }
          current = chunk
          continue
        }
        current = candidate
      } else {
        lines.push(current)
        current = word
      }
    }
    if (current) lines.push(current)
  }
  return lines
}

function displayDate(value) {
  const raw = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return ''
  const [year, month, day] = raw.split('-')
  return `${day}/${month}/${year}`
}

function professionalRegistrationLine(record) {
  const council = sanitizePdfText(record.author_council || 'CRM')
  const registration = sanitizePdfText(record.author_registration || '')
  if (!registration) return council
  return registration.toUpperCase().startsWith(council.toUpperCase()) ? registration : `${council} ${registration}`
}

function documentTitle(type) {
  return type === 'simple_prescription' ? 'RECEITUARIO SIMPLES' : 'PEDIDO DE EXAMES'
}

// Fixa tudo o que o pdf-lib preencheria com "agora".
function fixDeterministicMetadata(doc, record) {
  doc.setTitle(sanitizePdfText(`${documentTitle(record.document_type)} - ${record.patient_name || ''}`))
  doc.setAuthor(sanitizePdfText(record.author_name || ''))
  doc.setSubject('Documento clinico emitido pela SurgiMetrics')
  doc.setProducer(PRODUCER)
  doc.setCreator(PRODUCER)
  doc.setCreationDate(DETERMINISTIC_EPOCH)
  doc.setModificationDate(DETERMINISTIC_EPOCH)
}

class Layout {
  constructor(doc, fonts) {
    this.doc = doc
    this.fonts = fonts
    this.page = null
    this.y = 0
    this.addPage()
  }

  get maxWidth() {
    return A4.width - MARGIN * 2
  }

  addPage() {
    this.page = this.doc.addPage([A4.width, A4.height])
    this.y = A4.height - MARGIN
  }

  ensure(height) {
    if (this.y - height < MARGIN + 40) this.addPage()
  }

  text(value, { size = BODY_SIZE, bold = false, color = INK, indent = 0, gap = LINE_GAP } = {}) {
    const font = bold ? this.fonts.bold : this.fonts.regular
    const lines = wrapText(value, { font, size, maxWidth:this.maxWidth - indent })
    for (const line of lines) {
      this.ensure(size + gap)
      this.y -= size
      if (line) {
        this.page.drawText(line, { x:MARGIN + indent, y:this.y, size, font, color })
      }
      this.y -= gap
    }
  }

  space(height) {
    this.ensure(height)
    this.y -= height
  }

  rule(color = RULE, thickness = 1.2) {
    this.ensure(thickness + 6)
    this.y -= 6
    this.page.drawRectangle({ x:MARGIN, y:this.y, width:this.maxWidth, height:thickness, color })
    this.y -= thickness
  }

  sectionTitle(value) {
    this.space(10)
    this.text(value.toUpperCase(), { size:SMALL_SIZE, bold:true, color:MUTED, gap:3 })
  }
}

function drawExamRequest(layout, data) {
  const indication = sanitizePdfText(data.clinical_indication || '')
  if (indication) {
    layout.sectionTitle('Indicacao clinica')
    layout.text(indication)
  }
  layout.sectionTitle('Exames solicitados')
  const exams = Array.isArray(data.exams) ? data.exams : []
  exams.forEach((exam, index) => {
    layout.text(`${index + 1}. ${sanitizePdfText(exam)}`, { indent:8 })
  })
  const instructions = sanitizePdfText(data.instructions || '')
  if (instructions) {
    layout.sectionTitle('Orientacoes ao paciente')
    layout.text(instructions)
  }
}

function drawPrescription(layout, data) {
  layout.sectionTitle('Prescricao')
  const items = Array.isArray(data.items) ? data.items : []
  items.forEach((item, index) => {
    layout.space(6)
    const heading = [sanitizePdfText(item.medication), sanitizePdfText(item.presentation)].filter(Boolean).join(' - ')
    layout.text(`${index + 1}. ${heading}`, { bold:true })
    const quantity = sanitizePdfText(item.quantity)
    if (quantity) layout.text(`Quantidade: ${quantity}`, { indent:14, size:BODY_SIZE - 0.5, color:MUTED })
    layout.text(`Modo de usar: ${sanitizePdfText(item.directions)}`, { indent:14 })
  })
  layout.space(8)
  layout.text('Receituario simples: nao contem medicamento controlado nem sujeito a retencao.', {
    size:SMALL_SIZE,
    color:MUTED,
  })
}

// Gera o PDF do documento clinico a partir do snapshot imutavel.
// Nenhum dado vem do navegador: o chamador le `clinical_documents` no servidor.
export async function renderClinicalDocumentPdf(record) {
  if (!record?.id || !record?.document_type) throw new Error('Documento clinico invalido para renderizacao.')
  if (!['exam_request', 'simple_prescription'].includes(record.document_type)) {
    throw new Error('Tipo de documento clinico nao suportado para assinatura.')
  }

  const doc = await PDFDocument.create({ updateMetadata:false })
  fixDeterministicMetadata(doc, record)
  const fonts = {
    regular:await doc.embedFont(StandardFonts.Helvetica),
    bold:await doc.embedFont(StandardFonts.HelveticaBold),
  }
  const layout = new Layout(doc, fonts)
  const data = record.document_data || {}

  // Cabecalho (timbre textual; o logo e imagem do navegador e nao entra no
  // artefato assinado para manter os bytes reproduziveis).
  layout.text(sanitizePdfText(record.clinic_name || record.author_name || ''), { size:13.5, bold:true, gap:2 })
  const address = sanitizePdfText(record.issuer_address || '')
  if (address) layout.text(address, { size:SMALL_SIZE, color:MUTED, gap:2 })
  const contact = sanitizePdfText(record.issuer_contact || '')
  if (contact) layout.text(contact, { size:SMALL_SIZE, color:MUTED, gap:2 })
  layout.rule()

  layout.space(16)
  layout.text(documentTitle(record.document_type), { size:TITLE_SIZE, bold:true, gap:6 })

  layout.space(6)
  layout.text('PACIENTE', { size:SMALL_SIZE, bold:true, color:MUTED, gap:3 })
  layout.text(sanitizePdfText(record.patient_name || ''), { size:12, bold:true, gap:3 })
  const patientMeta = [
    record.patient_cpf ? `CPF ${sanitizePdfText(record.patient_cpf)}` : '',
    sanitizePdfText(record.patient_address || ''),
  ].filter(Boolean).join(' - ')
  if (patientMeta) layout.text(patientMeta, { size:SMALL_SIZE, color:MUTED })

  if (record.document_type === 'simple_prescription') {
    drawPrescription(layout, data)
  } else {
    drawExamRequest(layout, data)
  }

  // Area de identificacao profissional. Nao desenhamos linha de assinatura
  // manuscrita: este artefato segue para assinatura eletronica.
  layout.space(34)
  layout.text(sanitizePdfText(record.author_name || ''), { size:11.5, bold:true, gap:2 })
  layout.text(professionalRegistrationLine(record), { size:SMALL_SIZE, color:MUTED, gap:2 })

  layout.space(18)
  const issued = displayDate(record.issue_date)
  layout.text([
    issued ? `Emitido em ${issued}` : '',
    `Registro clinico ${sanitizePdfText(record.id)}`,
  ].filter(Boolean).join(' - '), { size:SMALL_SIZE, color:MUTED, gap:2 })

  const bytes = await doc.save({ useObjectStreams:false, addDefaultPage:false })
  const buffer = Buffer.from(bytes)
  return {
    buffer,
    sha256:crypto.createHash('sha256').update(buffer).digest('hex'),
  }
}

export function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
