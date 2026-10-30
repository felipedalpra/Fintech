import { expect, test } from '@playwright/test'
import {
  clinicalSignatureActionState,
  clinicalSignerReadiness,
  isClinicalSignatureEligible,
  latestAttemptByDocument,
} from '../../src/lib/clinicalSignature.js'
import { clinicalSignatureEvidenceComplete } from '../../api/_lib/clinicalSignature.js'

const AUTHOR = '20000000-0000-4000-8000-000000000001'
const OTHER = '20000000-0000-4000-8000-000000000002'
const DOCUMENT = '30000000-0000-4000-8000-000000000001'

const record = { id:DOCUMENT, document_type:'exam_request', created_by:AUTHOR }
const available = { available:true, environment:'homologation', requestedMode:'QUALIFIED' }
const unavailable = { available:false, reason:'desabilitada' }

function state(overrides = {}) {
  return clinicalSignatureActionState({ record, integration:available, viewerId:AUTHOR, ...overrides })
}

test('somente documento elegivel entra no fluxo digital', () => {
  expect(isClinicalSignatureEligible(record)).toBe(true)
  expect(isClinicalSignatureEligible({ ...record, document_type:'simple_prescription' })).toBe(true)
  // Documento legado sem autoria rastreavel segue apenas pela via manual.
  expect(isClinicalSignatureEligible({ ...record, created_by:null })).toBe(false)
  expect(isClinicalSignatureEligible({ ...record, document_type:'atestado' })).toBe(false)

  const legacy = state({ record:{ ...record, created_by:null } })
  expect(legacy.canRequest).toBe(false)
  expect(legacy.label).toContain('não disponível')
})

test('integracao desabilitada nao oferece acao nem promete assinatura qualificada', () => {
  const off = state({ integration:unavailable })
  expect(off.canRequest).toBe(false)
  expect(off.canReconcile).toBe(false)
  expect(off.label).toBe('Assinatura digital não configurada')
  expect(off.note).toContain('manualmente')
  expect(JSON.stringify(off)).not.toContain('qualificada')
})

test('somente o profissional autor pode solicitar a assinatura', () => {
  expect(state().canRequest).toBe(true)
  const notAuthor = state({ viewerId:OTHER })
  expect(notAuthor.canRequest).toBe(false)
  expect(notAuthor.note).toContain('emitiu o documento')
  // Sessao sem usuario identificado tambem nao oferece a acao.
  expect(state({ viewerId:'' }).canRequest).toBe(false)
})

test('tentativa pendente oferece atualizar status, nunca nova tentativa', () => {
  const pending = state({ attempt:{ id:'a1', documentId:DOCUMENT, status:'pending' } })
  expect(pending.canReconcile).toBe(true)
  expect(pending.canRequest).toBe(false)
  expect(pending.canRetry).toBe(false)
  expect(pending.canOpenSigned).toBe(false)
  expect(pending.tone).toBe('pending')
})

test('resultado desconhecido pede acao humana e nao reenvio automatico', () => {
  const unknown = state({ attempt:{ id:'a1', documentId:DOCUMENT, status:'pending', dispatchState:'unknown' } })
  expect(unknown.canAbandon).toBe(true)
  expect(unknown.canReconcile).toBe(true)
  expect(unknown.canRequest).toBe(false)
  expect(unknown.canRetry).toBe(false)
  expect(unknown.label).toContain('Resultado desconhecido')
  expect(unknown.note).toContain('duas vezes')
})

test('evidencia pendente de homologacao nao vira assinatura concluida', () => {
  const gap = state({
    attempt:{
      id:'a1', documentId:DOCUMENT, status:'pending',
      evidenceGapCode:'verify_service_unavailable',
      hasStoredArtifact:true,
    },
  })
  expect(gap.canOpenSigned).toBe(false)
  expect(gap.canOpenArtifact).toBe(true)
  expect(gap.label).toContain('evidência pendente')
  expect(gap.note).toContain('não respondeu')
  expect(gap.label).not.toContain('Assinado digitalmente')
})

test('assinatura concluida com evidencia completa libera o PDF assinado', () => {
  const signed = state({ attempt:{ id:'a1', documentId:DOCUMENT, status:'signed', evidenceComplete:true } })
  expect(signed.canOpenSigned).toBe(true)
  expect(signed.canRequest).toBe(false)
  expect(signed.canRetry).toBe(false)
  expect(signed.label).toBe('Assinado digitalmente')
  expect(signed.tone).toBe('signed')
})

test('status signed sem evidencia completa e sinalizado como inconsistente', () => {
  const broken = state({ attempt:{ id:'a1', documentId:DOCUMENT, status:'signed', evidenceComplete:false } })
  expect(broken.canOpenSigned).toBe(false)
  expect(broken.label).toBe('Evidência digital inconsistente')
  expect(broken.tone).toBe('failed')
})

test('nova tentativa so apos falha ou cancelamento terminal', () => {
  for (const status of ['failed', 'cancelled']) {
    const terminal = state({ attempt:{ id:'a1', documentId:DOCUMENT, status, failureMessage:'motivo' } })
    expect(terminal.canRetry, status).toBe(true)
    expect(terminal.canReconcile, status).toBe(false)
    expect(terminal.note, status).toBe('motivo')
  }
  // Com a integracao fora do ar nao oferecemos retentativa que seria recusada.
  expect(state({ attempt:{ id:'a1', documentId:DOCUMENT, status:'failed' }, integration:unavailable }).canRetry).toBe(false)
  // Nao-autor nao reabre tentativa.
  expect(state({ attempt:{ id:'a1', documentId:DOCUMENT, status:'failed' }, viewerId:OTHER }).canRetry).toBe(false)
})

test('status indisponivel preserva a via manual e nao oferece nada', () => {
  const blind = state({ evidenceAvailable:false, attempt:{ id:'a1', documentId:DOCUMENT, status:'pending' } })
  expect(blind.label).toBe('Status digital indisponível')
  expect(Object.entries(blind).filter(([key]) => key.startsWith('can')).every(([, value]) => value === false)).toBe(true)
  expect(blind.note).toContain('manual')
})

test('assinatura valida nao e escondida por tentativa posterior com falha', () => {
  const byDocument = latestAttemptByDocument([
    { id:'novo', documentId:DOCUMENT, status:'failed', createdAt:'2026-10-28T12:00:00Z' },
    { id:'valido', documentId:DOCUMENT, status:'signed', evidenceComplete:true, createdAt:'2026-10-27T12:00:00Z' },
  ])
  expect(byDocument[DOCUMENT].id).toBe('valido')
})

test('sem assinatura valida, prevalece a tentativa mais recente', () => {
  const byDocument = latestAttemptByDocument([
    { id:'antigo', documentId:DOCUMENT, status:'failed', createdAt:'2026-10-26T12:00:00Z' },
    { id:'recente', documentId:DOCUMENT, status:'pending', createdAt:'2026-10-28T12:00:00Z' },
    { id:'sem-documento', status:'pending', createdAt:'2026-10-29T12:00:00Z' },
  ])
  expect(byDocument[DOCUMENT].id).toBe('recente')
  expect(Object.keys(byDocument)).toEqual([DOCUMENT])
})

// ---------------------------------------------------------------------------
// Evidencia completa: regra autoritativa do servidor
// ---------------------------------------------------------------------------

const completeEvidence = {
  status:'signed',
  signed_file_path:'clinical-signatures/a/b/c.pdf',
  signed_file_sha256:'a'.repeat(64),
  signature_standard:'PAdES-B-T',
  certificate_subject:'CN=Dra. Vitória',
  certificate_serial:'0A1B',
  certificate_issuer:'AC Exemplo ICP-Brasil',
  certificate_valid_from:'2026-01-01T00:00:00Z',
  certificate_valid_until:'2027-01-01T00:00:00Z',
  signed_at:'2026-10-28T12:00:00Z',
}

test('evidencia completa exige artefato, hash, padrao PAdES, certificado e instante coerente', () => {
  expect(clinicalSignatureEvidenceComplete(completeEvidence)).toBe(true)

  const incompleteCases = {
    'sem artefato':{ signed_file_path:'' },
    'sem hash':{ signed_file_sha256:'' },
    'hash malformado':{ signed_file_sha256:'xyz' },
    'sem padrao':{ signature_standard:null },
    'padrao nao permitido':{ signature_standard:'PAdES-INVENTADO' },
    'sem titular':{ certificate_subject:'  ' },
    'sem serial':{ certificate_serial:'' },
    'sem emissor':{ certificate_issuer:'' },
    'sem validade inicial':{ certificate_valid_from:null },
    'validade invertida':{ certificate_valid_until:'2025-01-01T00:00:00Z' },
    'assinatura fora da validade':{ signed_at:'2028-10-28T12:00:00Z' },
    'sem instante':{ signed_at:null },
  }
  for (const [label, override] of Object.entries(incompleteCases)) {
    expect(clinicalSignatureEvidenceComplete({ ...completeEvidence, ...override }), label).toBe(false)
  }
})

test('nenhum estado diferente de signed e considerado evidencia completa', () => {
  for (const status of ['pending', 'failed', 'cancelled']) {
    expect(clinicalSignatureEvidenceComplete({ ...completeEvidence, status }), status).toBe(false)
  }
})

test('tentativa pendente permite reabrir a pagina de assinatura sem novo envelope', () => {
  const pendingAttempt = { id:'a1', documentId:DOCUMENT, status:'pending' }
  const pending = state({ attempt:pendingAttempt })
  expect(pending.canOpenSigningPage).toBe(true)
  expect(pending.canRequest).toBe(false)

  // Nao-autor nao reabre a pagina de outro profissional.
  expect(state({ attempt:pendingAttempt, viewerId:OTHER }).canOpenSigningPage).toBe(false)

  // Resultado desconhecido e evidencia pendente nao oferecem a pagina: nao ha
  // o que assinar nesses estados.
  expect(state({ attempt:{ ...pendingAttempt, dispatchState:'unknown' } }).canOpenSigningPage).toBe(false)
  expect(state({ attempt:{ ...pendingAttempt, evidenceGapCode:'verify_service_unavailable' } }).canOpenSigningPage).toBe(false)
  // Terminais tambem nao.
  for (const status of ['signed', 'failed', 'cancelled']) {
    expect(state({ attempt:{ ...pendingAttempt, status, evidenceComplete:status === 'signed' } }).canOpenSigningPage, status).toBe(false)
  }
})

test('a prontidao do signatario cobra a UF, como o servidor cobra', () => {
  // Sem UF o servidor recusa a assinatura (OID 2.16.76.1.4.2.2.2). Se a tela
  // dissesse "identidade completa", a médica só descobriria ao tentar assinar.
  const base = { doctor:{ fullName:'Dra. Vitória', cpf:'529.982.247-25' } }

  const semUf = clinicalSignerReadiness({ doctor:{ ...base.doctor, registrationId:'12345' } })
  expect(semUf.ready).toBe(false)
  expect(semUf.missing.join(' ')).toContain('UF')

  // UF no próprio CRM.
  expect(clinicalSignerReadiness({ doctor:{ ...base.doctor, registrationId:'CRM-RS 12345' } }).ready).toBe(true)
  expect(clinicalSignerReadiness({ doctor:{ ...base.doctor, registrationId:'CRM/SP 9988' } }).ready).toBe(true)

  // UF vinda do endereço da clínica, que é o fallback do servidor.
  expect(clinicalSignerReadiness({
    doctor:{ ...base.doctor, registrationId:'12345' }, clinic:{ state:'MG' },
  }).ready).toBe(true)

  // Sigla que não é UF brasileira não vale.
  expect(clinicalSignerReadiness({ doctor:{ ...base.doctor, registrationId:'CRM-XX 12345' } }).ready).toBe(false)

  // As outras exigências continuam valendo.
  expect(clinicalSignerReadiness({ doctor:{ registrationId:'CRM-RS 1', cpf:'529.982.247-25' } }).missing).toContain('nome completo')
  expect(clinicalSignerReadiness({ doctor:{ fullName:'X', registrationId:'CRM-RS 1', cpf:'111' } }).missing).toContain('CPF válido')
})
