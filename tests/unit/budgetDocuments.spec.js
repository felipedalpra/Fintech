import { expect, test } from '@playwright/test'
import {
  BUDGET_DOCUMENT_MAX_BYTES,
  buildBudgetDocumentRpcArgs,
  buildBudgetDocumentWhatsAppMessage,
  sortBudgetDocumentsByVersion,
  validateBudgetDocumentFile,
} from '../../src/lib/budgetDocuments.js'

function fakeFile({ name = 'orcamento.pdf', type = 'application/pdf', size = 1024 } = {}) {
  return { name, type, size }
}

test('aceita somente PDF dentro do limite de 10 MB', () => {
  expect(validateBudgetDocumentFile(null)).toContain('Selecione')
  expect(validateBudgetDocumentFile(fakeFile({ type:'image/png' }))).toContain('Formato não aceito')
  expect(validateBudgetDocumentFile(fakeFile({ size:0 }))).toContain('vazio')
  expect(validateBudgetDocumentFile(fakeFile({ size:BUDGET_DOCUMENT_MAX_BYTES + 1 }))).toContain('10 MB')
  expect(validateBudgetDocumentFile(fakeFile())).toBe('')
})

test('monta os argumentos da RPC de reserva de upload', () => {
  const file = fakeFile({ name:'orcamento-rinoplastia.pdf', size:2048 })
  const args = buildBudgetDocumentRpcArgs({ patientId:'patient-1', opportunityId:'opp-1', file, sha256:'a'.repeat(64) })
  expect(args).toEqual({
    p_patient_id:'patient-1',
    p_opportunity_id:'opp-1',
    p_file_name:'orcamento-rinoplastia.pdf',
    p_file_size:2048,
    p_client_sha256:'a'.repeat(64),
  })
  expect(buildBudgetDocumentRpcArgs({ patientId:'patient-1', opportunityId:null, file, sha256:'a'.repeat(64) }).p_opportunity_id).toBeNull()
})

test('ordena por versão, mais recente primeiro', () => {
  const sorted = sortBudgetDocumentsByVersion([{ version:1 }, { version:3 }, { version:2 }])
  expect(sorted.map(item => item.version)).toEqual([3, 2, 1])
})

test('mensagem de WhatsApp nunca afirma envio, só prepara o link', () => {
  const message = buildBudgetDocumentWhatsAppMessage({ patientName:'Ana', version:2, signedUrl:'https://exemplo.com/orcamento.pdf' })
  expect(message).toContain('Ana')
  expect(message).toContain('versão 2')
  expect(message).toContain('https://exemplo.com/orcamento.pdf')
  expect(message.toLowerCase()).not.toContain('enviado')
})
