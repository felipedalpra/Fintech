import { test, expect } from '@playwright/test'
import crypto from 'node:crypto'
import { validateClinicalUpload } from '../../api/_lib/clinicalUploadValidation.js'

test('aceita PDF quando bytes, extensão, tamanho e hash coincidem', () => {
  const buffer = Buffer.from('%PDF-1.7\nconteudo clínico')
  const result = validateClinicalUpload({
    buffer,
    fileName:'exame.PDF',
    expectedMimeType:'application/pdf',
    expectedFileSize:buffer.length,
    clientSha256:crypto.createHash('sha256').update(buffer).digest('hex'),
  })
  expect(result.valid).toBe(true)
  expect(result.observedMime).toBe('application/pdf')
})

test('rejeita arquivo com MIME real incompatível com extensão e hash esperado', () => {
  const buffer = Buffer.from('%PDF-1.7\nconteudo clínico')
  const result = validateClinicalUpload({
    buffer,
    fileName:'exame.jpg',
    expectedMimeType:'image/jpeg',
    expectedFileSize:buffer.length,
    clientSha256:'0'.repeat(64),
  })
  expect(result.valid).toBe(false)
  expect(result.observedMime).toBe('application/pdf')
})
