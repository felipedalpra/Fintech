import { expect, test } from '@playwright/test'
import {
  renderClinicalDocumentPdf,
  sanitizePdfText,
  sha256Hex,
  wrapText,
} from '../../api/_lib/clinicalDocumentPdf.js'
import {
  buildClinicalSignedFilePath,
  CLINICAL_SIGNATURE_RENDERING_VERSION,
} from '../../api/_lib/clinicalSignature.js'
import zlib from 'node:zlib'

// Os fluxos de conteudo do PDF sao comprimidos e o texto e mostrado como
// string hexadecimal em `<HEX> Tj`. Para conferir o que foi REALMENTE
// desenhado, descomprimimos cada stream e decodificamos esses operadores.
function renderedText(buffer) {
  const raw = buffer.toString('latin1')
  const streams = []
  const pattern = /stream\r?\n/g
  let match
  while ((match = pattern.exec(raw)) !== null) {
    const start = match.index + match[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) break
    try {
      streams.push(zlib.inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1'))
    } catch { /* stream nao comprimido ou nao textual */ }
  }
  return streams
    .join('\n')
    .replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_, hex) => Buffer.from(hex, 'hex').toString('latin1'))
    .replace(/[^\S\n]+/g, ' ')
}

const OWNER = '10000000-0000-4000-8000-000000000001'
const DOCUMENT = '30000000-0000-4000-8000-000000000001'
const ATTEMPT = '60000000-0000-4000-8000-000000000001'

const examRequest = {
  id:DOCUMENT,
  user_id:OWNER,
  patient_id:'40000000-0000-4000-8000-000000000001',
  created_by:'20000000-0000-4000-8000-000000000001',
  document_type:'exam_request',
  issue_date:'2026-10-28',
  patient_name:'Ana Paciente',
  patient_cpf:'529.982.247-25',
  patient_address:'Rua X, 10 - Porto Alegre / RS',
  author_name:'Dra. Vitória Ribeiro',
  author_registration:'CRM-RS 12345',
  author_council:'CRM',
  clinic_name:'Clínica Exemplo',
  issuer_address:'Av. Clínica, 100',
  issuer_contact:'contato@clinica.test',
  document_data:{
    exams:['Hemograma completo', 'Coagulograma'],
    clinical_indication:'Pré-operatório',
    instructions:'Jejum de 8 horas',
  },
}

const prescription = {
  ...examRequest,
  document_type:'simple_prescription',
  document_data:{
    items:[{ medication:'Dipirona', presentation:'500mg', quantity:'1 caixa', directions:'1 comprimido a cada 8 horas por 3 dias' }],
    simple_prescription_confirmed:true,
  },
}

test('o PDF e deterministico: o mesmo documento gera os mesmos bytes e o mesmo hash', async () => {
  const first = await renderClinicalDocumentPdf(examRequest)
  await new Promise(resolve => setTimeout(resolve, 40))
  const second = await renderClinicalDocumentPdf(examRequest)
  expect(first.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(first.sha256).toBe(second.sha256)
  expect(first.buffer.equals(second.buffer)).toBe(true)
  expect(first.sha256).toBe(sha256Hex(first.buffer))
})

test('o artefato e um PDF valido e sem data de geracao variavel', async () => {
  const { buffer } = await renderClinicalDocumentPdf(examRequest)
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  const text = buffer.toString('latin1')
  // Qualquer data "agora" nos metadados quebraria o hash reproduzivel.
  expect(text).toContain('D:20000101')
  expect(text).not.toContain(String(new Date().getFullYear() + 1))
})

test('conteudo diferente produz hash diferente, inclusive por mudanca minima', async () => {
  const base = await renderClinicalDocumentPdf(examRequest)
  const other = await renderClinicalDocumentPdf(prescription)
  const tweaked = await renderClinicalDocumentPdf({
    ...examRequest,
    document_data:{ ...examRequest.document_data, exams:['Hemograma completo', 'Coagulograma', 'Glicemia'] },
  })
  expect(new Set([base.sha256, other.sha256, tweaked.sha256]).size).toBe(3)
})

test('cada tipo clinico suportado renderiza seu proprio titulo e corpo', async () => {
  const exam = renderedText((await renderClinicalDocumentPdf(examRequest)).buffer)
  const recipe = renderedText((await renderClinicalDocumentPdf(prescription)).buffer)
  expect(exam).toContain('PEDIDO DE EXAMES')
  expect(recipe).toContain('RECEITUARIO SIMPLES')
  // A receita simples declara, no proprio artefato, o limite de escopo.
  expect(recipe).toContain('nao contem medicamento controlado')
  // O conteudo clinico de fato chega ao artefato assinado.
  expect(exam).toContain('Hemograma completo')
  expect(recipe).toContain('Dipirona')
  expect(exam).toContain('Ana Paciente')
})

test('tipo de documento nao suportado e recusado antes de qualquer render', async () => {
  await expect(renderClinicalDocumentPdf({ ...examRequest, document_type:'atestado' })).rejects.toThrow(/nao suportado/)
  await expect(renderClinicalDocumentPdf({ id:'', document_type:'exam_request' })).rejects.toThrow(/invalido/)
})

test('texto fora da codificacao da fonte e normalizado sem derrubar a assinatura', async () => {
  // Aspas tipograficas, travessao, emoji e espaco invisivel colados pelo usuario
  // nao podem fazer a geracao do PDF falhar no momento de assinar.
  const noisy = {
    ...examRequest,
    document_data:{
      exams:['Hemograma — “completo”​', 'Coagulograma \u{1F600}'],
      clinical_indication:'Pré­operatório',
      instructions:'Jejum de 8h',
    },
  }
  const rendered = await renderClinicalDocumentPdf(noisy)
  expect(rendered.sha256).toMatch(/^[0-9a-f]{64}$/)
  const again = await renderClinicalDocumentPdf(noisy)
  expect(rendered.sha256).toBe(again.sha256)
})

test('sanitizacao e estavel e remove apenas o que a fonte nao representa', () => {
  expect(sanitizePdfText('“aspas” — traço')).toBe('"aspas" - traço')
  expect(sanitizePdfText('a​b')).toBe('ab')
  expect(sanitizePdfText('x \u{1F600} y')).toBe('x y')
  expect(sanitizePdfText('  espaços   múltiplos  ')).toBe('espaços múltiplos')
  expect(sanitizePdfText('linha1\r\nlinha2')).toBe('linha1\nlinha2')
  // Acentos do português permanecem intactos.
  expect(sanitizePdfText('ação coração José')).toBe('ação coração José')
})

test('quebra de linha respeita a largura e nao transborda com palavra gigante', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const lines = wrapText('palavra '.repeat(40), { font, size:10.5, maxWidth:200 })
  expect(lines.length).toBeGreaterThan(1)
  for (const line of lines) expect(font.widthOfTextAtSize(line, 10.5)).toBeLessThanOrEqual(200)

  const huge = wrapText('A'.repeat(300), { font, size:10.5, maxWidth:200 })
  expect(huge.length).toBeGreaterThan(1)
  for (const line of huge) expect(font.widthOfTextAtSize(line, 10.5)).toBeLessThanOrEqual(200)
})

test('documento longo pagina sem perder conteudo nem determinismo', async () => {
  const long = {
    ...examRequest,
    document_data:{
      exams:Array.from({ length:30 }, (_, index) => `Exame numero ${index + 1} com descricao longa o bastante para ocupar a linha inteira do pedido`),
      clinical_indication:'Indicação '.repeat(60),
      instructions:'Orientação '.repeat(60),
    },
  }
  const first = await renderClinicalDocumentPdf(long)
  const second = await renderClinicalDocumentPdf(long)
  expect(first.sha256).toBe(second.sha256)
  expect(first.buffer.length).toBeGreaterThan(4000)
})

test('o caminho de armazenamento e gerado pelo servidor no escopo da clinica', () => {
  expect(buildClinicalSignedFilePath({ ownerId:OWNER, documentId:DOCUMENT, signatureId:ATTEMPT }))
    .toBe(`clinical-signatures/${OWNER}/${DOCUMENT}/${ATTEMPT}.pdf`)

  // Nenhum caminho arbitrario do provedor pode entrar no namespace.
  for (const scope of [
    { ownerId:'../outro', documentId:DOCUMENT, signatureId:ATTEMPT },
    { ownerId:OWNER, documentId:'..', signatureId:ATTEMPT },
    { ownerId:OWNER, documentId:DOCUMENT, signatureId:'/etc/passwd' },
    { ownerId:OWNER, documentId:DOCUMENT, signatureId:'' },
  ]) {
    expect(() => buildClinicalSignedFilePath(scope)).toThrow(/Escopo inv/)
  }
})

test('a versao de renderizacao foi evoluida explicitamente junto com o render no servidor', () => {
  // v1 descrevia a etapa sem PDF gerado no servidor; o artefato assinado agora
  // tem bytes definidos por este renderizador.
  expect(CLINICAL_SIGNATURE_RENDERING_VERSION).toBe('clinical-pdf-v2')
})
