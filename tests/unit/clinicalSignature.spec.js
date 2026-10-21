import { expect, test } from '@playwright/test'
import {
  assertSafeClinicalSignatureConnection,
  buildClinicalSignatureEnvelope,
  buildClinicalSignedFilePath,
  hashClinicalSignatureEnvelope,
  normalizeClinicalSignatureEvidence,
} from '../../api/_lib/clinicalSignature.js'
import {
  clinicalSignerReadiness,
  clinicalSignaturePresentation,
  hasCompleteClinicalSignatureEvidence,
  isValidCpf,
  latestClinicalSignatureByDocument,
} from '../../src/lib/clinicalSignature.js'
import { sanitizeProfilePayload } from '../../api/_lib/secureProfile.js'

const document = {
  id:'30000000-0000-4000-8000-000000000001',
  user_id:'10000000-0000-4000-8000-000000000001',
  patient_id:'40000000-0000-4000-8000-000000000001',
  created_by:'20000000-0000-4000-8000-000000000001',
  document_type:'exam_request',
  issue_date:'2026-10-21',
  document_data:{ exams:['Hemograma', 'Coagulograma'] },
  patient_name:'Ana',
  author_name:'Dra. Vitória',
  author_registration:'CRM-RS 123',
  author_council:'CRM',
  issuer_contact:'contato@clinica.test',
  issuer_address:'Av. Clínica, 100',
  created_at:'2026-10-21T12:00:00Z',
}

test('gera envelope e hash determinísticos sem depender da ordem das chaves', () => {
  const signer = { userId:document.created_by, name:'Dra. Vitória', registration:'CRM-RS 123', cpf:'529.982.247-25' }
  const first = buildClinicalSignatureEnvelope({ document, signer })
  const second = buildClinicalSignatureEnvelope({ document:{ ...document, document_data:{ exams:['Hemograma', 'Coagulograma'] } }, signer })
  expect(hashClinicalSignatureEnvelope(first)).toMatch(/^[0-9a-f]{64}$/)
  expect(hashClinicalSignatureEnvelope(first)).toBe(hashClinicalSignatureEnvelope(second))
  expect(first.signer.cpf).toBe('52998224725')
  expect(first.document.created_by).toBe(document.created_by)
})

test('bloqueia o envio ao provedor quando autor, identidade profissional ou CPF divergem', () => {
  const signer = { userId:document.created_by, name:'Dra. Vitória', registration:'CRM-RS 123', council:'CRM', cpf:'529.982.247-25' }
  expect(() => buildClinicalSignatureEnvelope({ document, signer:{ ...signer, userId:'20000000-0000-4000-8000-000000000002' } })).toThrow(/emitiu/)
  expect(() => buildClinicalSignatureEnvelope({ document, signer:{ ...signer, registration:'CRM-RS 999' } })).toThrow(/identidade/)
  expect(() => buildClinicalSignatureEnvelope({ document, signer:{ ...signer, cpf:'123.456.789-00' } })).toThrow(/CPF/)
})

test('rejeita certificado e senha dentro da configuração persistível', () => {
  const credentialId = '50000000-0000-4000-8000-000000000001'
  expect(() => assertSafeClinicalSignatureConnection({ provider:'provedor', pfxBase64:'base64' }, { id:credentialId })).toThrow(/Campo não permitido/)
  expect(() => assertSafeClinicalSignatureConnection({ provider:'provedor', clientSecret:'não-persistir' }, { id:credentialId })).toThrow(/Campo não permitido/)
  expect(() => assertSafeClinicalSignatureConnection({ provider:'provedor', credentialReference:`vault://${credentialId}` })).toThrow(/Campo não permitido/)
  expect(() => assertSafeClinicalSignatureConnection({ provider:'provedor', credentialId })).toThrow(/Campo não permitido/)
  expect(() => assertSafeClinicalSignatureConnection({ provider:'provedor' }, { id:'MinhaSenha123' })).toThrow(/UUID interno/)
  expect(assertSafeClinicalSignatureConnection({ provider:'Provedor' }, { id:credentialId, store:'vault' })).toEqual({
    provider:'provedor',
    credentialReference:`vault://${credentialId}`,
    signingMode:'remote_icp_brasil',
  })
})

test('só aceita assinatura concluída com evidências verificáveis', () => {
  const scope = {
    ownerId:'10000000-0000-4000-8000-000000000001',
    documentId:'30000000-0000-4000-8000-000000000001',
    signatureId:'60000000-0000-4000-8000-000000000001',
  }
  expect(() => normalizeClinicalSignatureEvidence({ status:'signed' }, scope)).toThrow(/incompletas/)
  expect(normalizeClinicalSignatureEvidence({
    status:'signed',
    signedFilePath:'caminho/enviado-pelo-provedor.pdf',
    signedFileSha256:'a'.repeat(64),
    signatureStandard:'PAdES-B-T',
    certificateSubject:'CN=Dra. Vitória',
    certificateSerial:'serial-1',
    certificateIssuer:'AC ICP-Brasil',
    certificateValidFrom:'2026-01-01T00:00:00Z',
    certificateValidUntil:'2027-01-01T00:00:00Z',
    signedAt:'2026-10-21T15:00:00Z',
  }, scope)).toMatchObject({
    status:'signed',
    signature_standard:'PAdES-B-T',
    signed_file_path:buildClinicalSignedFilePath(scope),
  })
  expect(() => normalizeClinicalSignatureEvidence({
    status:'signed',
    signedFileSha256:'a'.repeat(64),
    signatureStandard:'PAdES',
    certificateSubject:'CN=Dra. Vitória',
    certificateSerial:'serial-1',
    certificateIssuer:'AC ICP-Brasil',
    certificateValidFrom:'2026-01-01T00:00:00Z',
    certificateValidUntil:'2027-01-01T00:00:00Z',
    signedAt:'2026-10-21T15:00:00Z',
  }, scope)).toThrow(/incompletas/)
})

test('deriva status e prontidão sem declarar assinatura inexistente', () => {
  expect(isValidCpf('529.982.247-25')).toBe(true)
  expect(isValidCpf('111.111.111-11')).toBe(false)
  expect(clinicalSignerReadiness({ doctor:{ fullName:'Dra. Vitória', registrationId:'CRM-RS 123', cpf:'529.982.247-25' } }).ready).toBe(true)
  expect(clinicalSignerReadiness({ doctor:{ fullName:'Dra. Vitória' } }).missing).toEqual(['CRM', 'CPF válido'])
  expect(clinicalSignaturePresentation(null).label).toBe('Assinatura digital não configurada')
  expect(clinicalSignaturePresentation({ status:'signed' }).label).toBe('Evidência digital inconsistente')

  const signed = {
    document_id:'document-1',
    status:'signed',
    created_at:'2026-10-21T11:00:00Z',
    signed_file_path:'clinical/document-1.pdf',
    signed_file_sha256:'a'.repeat(64),
    signature_standard:'PAdES-B-T',
    certificate_subject:'CN=Dra. Vitória',
    certificate_serial:'serial-1',
    certificate_issuer:'AC ICP-Brasil',
    certificate_valid_from:'2026-01-01T00:00:00Z',
    certificate_valid_until:'2027-01-01T00:00:00Z',
    signed_at:'2026-10-21T15:00:00Z',
  }
  expect(hasCompleteClinicalSignatureEvidence(signed)).toBe(true)
  const latest = latestClinicalSignatureByDocument([
    signed,
    { document_id:'document-1', status:'failed', created_at:'2026-10-21T12:00:00Z' },
  ])
  expect(latest['document-1'].status).toBe('signed')
  expect(clinicalSignaturePresentation(latest['document-1']).label).toBe('Assinado digitalmente')
})

test('perfil seguro preserva CPF e RQE, mas descarta material de certificado', () => {
  const sanitized = sanitizeProfilePayload({
    doctor:{
      fullName:' Dra. Vitória ',
      registrationId:' CRM-RS 123 ',
      cpf:' 123.456.789-00 ',
      rqe:' 4567 ',
      certificateBase64:'não-deve-sair',
      password:'não-deve-sair',
    },
  })
  expect(sanitized.doctor).toMatchObject({
    fullName:'Dra. Vitória',
    registrationId:'CRM-RS 123',
    cpf:'123.456.789-00',
    rqe:'4567',
  })
  expect(sanitized.doctor).not.toHaveProperty('certificateBase64')
  expect(sanitized.doctor).not.toHaveProperty('password')
})

