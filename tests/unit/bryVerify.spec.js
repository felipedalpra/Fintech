import { expect, test } from '@playwright/test'
import {
  BryVerifyError,
  bryVerifyConfig,
  hasVerifiedTimestamp,
  normalizeVerificationEvidence,
  sanitizeVerifyDetail,
  selectSignerCertificate,
  VERIFY_GAPS,
  verifySignedPdf,
} from '../../api/_lib/bryVerify.js'

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZXJpZmljYSJ9.segredo-do-verificador'

function env(overrides = {}) {
  return {
    BRY_VERIFY_BASE_URL:'https://hom.bry.com.br',
    BRY_VERIFY_TOKEN:TOKEN,
    BRY_VERIFY_REQUEST_TIMEOUT_MS:'1500',
    ...overrides,
  }
}

const config = () => bryVerifyConfig(env())

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

test('a verificacao exige host oficial da BRy em HTTPS, sem fallback inventado', () => {
  expect(config().ready).toBe(true)
  expect(bryVerifyConfig(env({ BRY_VERIFY_BASE_URL:'https://bry.com.br' })).ready).toBe(true)

  for (const url of [
    '',
    'http://hom.bry.com.br',
    'https://bry.com.br.evil.test',
    'https://evil.test',
    'https://user:senha@hom.bry.com.br',
    'https://hom.bry.com.br:8443',
    'nao-e-url',
  ]) {
    const candidate = bryVerifyConfig(env({ BRY_VERIFY_BASE_URL:url }))
    expect(candidate.ready, url).toBe(false)
    expect(candidate.baseUrl, url).toBe('')
  }
})

test('sem token a verificacao fica indisponivel e o timeout tem limites', () => {
  expect(bryVerifyConfig(env({ BRY_VERIFY_TOKEN:'' })).ready).toBe(false)
  expect(config().timeoutMs).toBe(1500)
  expect(bryVerifyConfig(env({ BRY_VERIFY_REQUEST_TIMEOUT_MS:'1' })).timeoutMs).toBe(30_000)
  expect(bryVerifyConfig(env({ BRY_VERIFY_REQUEST_TIMEOUT_MS:'999999' })).timeoutMs).toBe(30_000)
  // Caminho padrao documentado, e um caminho relativo invalido e recusado.
  expect(config().path).toBe('/api/pdf-verification-service/v1/signatures/verify')
  expect(bryVerifyConfig(env({ BRY_VERIFY_PATH:'verify' })).ready).toBe(false)
})

// ---------------------------------------------------------------------------
// Normalizacao da evidencia
// ---------------------------------------------------------------------------

function signerCertificate(overrides = {}) {
  return {
    type:'FinalCertificate',
    certificateInfo:{
      cpf:'52998224725',
      certificateType:'A3',
      serial:'0A1B2C',
      subjectDN:{ cn:'VITORIA RIBEIRO:52998224725', formattedCn:'VITORIA RIBEIRO' },
      issuerDN:{ cn:'AC Exemplo ICP-Brasil', o:'ICP-Brasil' },
      validity:{ notBefore:'2026-01-01T00:00:00Z', notAfter:'2027-01-01T00:00:00Z' },
      ...overrides,
    },
  }
}

const timestampEntry = {
  statusType:'TIMESTAMP',
  certificateInfo:{
    serial:'TS01',
    subjectDN:{ cn:'AC do Tempo' },
    issuerDN:{ cn:'AC do Tempo' },
    validity:{ notBefore:'2020-01-01T00:00:00Z', notAfter:'2030-01-01T00:00:00Z' },
  },
}

const chainEntry = {
  type:'ChainCertificate',
  certificateInfo:{
    serial:'AC01',
    subjectDN:{ cn:'AC Raiz' },
    issuerDN:{ cn:'AC Raiz' },
    validity:{ notBefore:'2020-01-01T00:00:00Z', notAfter:'2030-01-01T00:00:00Z' },
  },
}

function payload({ entries = [timestampEntry, chainEntry, signerCertificate()], ...overrides } = {}) {
  return {
    generalStatus:'VALID',
    signatureFormat:'PADES',
    signatureStatus:{
      signingTime:'2026-10-28T12:00:00.000Z',
      chainStatus:{ certificateStatusList:entries },
    },
    ...overrides,
  }
}

test('evidencia completa vira certificado, validade e instante da assinatura', () => {
  const result = normalizeVerificationEvidence(payload(), { requestedProfile:'TIMESTAMP' })
  expect(result.ok).toBe(true)
  expect(result.evidence).toEqual({
    signatureStandard:'PAdES-B-T',
    certificateSubject:'VITORIA RIBEIRO',
    certificateSerial:'0A1B2C',
    certificateIssuer:'AC Exemplo ICP-Brasil',
    certificateValidFrom:'2026-01-01T00:00:00.000Z',
    certificateValidUntil:'2027-01-01T00:00:00.000Z',
    signedAt:'2026-10-28T12:00:00.000Z',
  })
})

test('o certificado do signatario e escolhido, nunca o da cadeia nem o do carimbo', () => {
  const info = selectSignerCertificate(payload().signatureStatus)
  expect(info.serial).toBe('0A1B2C')
  // Ordem invertida nao muda a escolha.
  const inverted = selectSignerCertificate(payload({ entries:[signerCertificate(), chainEntry, timestampEntry] }).signatureStatus)
  expect(inverted.serial).toBe('0A1B2C')
  // Sem marcacao de final, cai no ultimo da cadeia, e os campos obrigatorios
  // continuam sendo conferidos depois.
  const unmarked = selectSignerCertificate({
    chainStatus:{ certificateStatusList:[chainEntry, { certificateInfo:{ serial:'XYZ' } }] },
  })
  expect(unmarked.serial).toBe('XYZ')
  expect(selectSignerCertificate({ chainStatus:{ certificateStatusList:[timestampEntry] } })).toBeNull()
  expect(selectSignerCertificate(null)).toBeNull()
})

test('o padrao PAdES vem do carimbo verificado, nunca do modo solicitado', () => {
  // Carimbo reconhecido pela verificacao -> B-T.
  expect(normalizeVerificationEvidence(payload(), { requestedProfile:'TIMESTAMP' }).evidence.signatureStandard).toBe('PAdES-B-T')

  // Sem carimbo e sem carimbo pedido -> B-B, o menor nivel defensavel.
  const noTimestamp = payload({ entries:[chainEntry, signerCertificate()] })
  expect(normalizeVerificationEvidence(noTimestamp, { requestedProfile:'' }).evidence.signatureStandard).toBe('PAdES-B-B')

  // Nunca declaramos B-LT/B-LTA: esta resposta nao prova arquivamento.
  for (const profile of ['', 'TIMESTAMP', 'BASIC']) {
    const result = normalizeVerificationEvidence(payload(), { requestedProfile:profile })
    expect(['PAdES-B-B', 'PAdES-B-T']).toContain(result.evidence?.signatureStandard ?? 'PAdES-B-T')
  }
})

test('pedir carimbo e nao conseguir confirmar e divergencia, nao nivel menor', () => {
  const noTimestamp = payload({ entries:[chainEntry, signerCertificate()] })
  const result = normalizeVerificationEvidence(noTimestamp, { requestedProfile:'TIMESTAMP' })
  expect(result.ok).toBe(false)
  expect(result.gap).toBe(VERIFY_GAPS.TIMESTAMP_NOT_VERIFIED)
  // Em nenhum caso devolve evidencia utilizavel.
  expect(result.evidence).toBeUndefined()
})

test('carimbo e reconhecido tanto na cadeia quanto na referencia da verificacao', () => {
  expect(hasVerifiedTimestamp(payload().signatureStatus)).toBe(true)
  expect(hasVerifiedTimestamp({ verificationReferenceType:'SIGNATURE_TIMESTAMP' })).toBe(true)
  expect(hasVerifiedTimestamp({ verificationReference:{ verificationReferenceType:'TIMESTAMP' } })).toBe(true)
  expect(hasVerifiedTimestamp({ chainStatus:{ certificateStatusList:[chainEntry] } })).toBe(false)
  expect(hasVerifiedTimestamp(null)).toBe(false)
})

test('assinatura invalida ou formato diferente de PAdES nunca gera evidencia', () => {
  for (const generalStatus of ['INVALID', 'INVALID_WITH_INTEGRITY_ERROR', '', 'QUALQUER']) {
    const result = normalizeVerificationEvidence(payload({ generalStatus }))
    expect(result.ok, generalStatus).toBe(false)
    expect(result.gap, generalStatus).toBe(VERIFY_GAPS.SIGNATURE_INVALID)
  }
  // VALID_WITH_ALERT ainda e aceito, conforme o enum da BRy.
  expect(normalizeVerificationEvidence(payload({ generalStatus:'VALID_WITH_ALERT' }), { requestedProfile:'TIMESTAMP' }).ok).toBe(true)

  const notPades = normalizeVerificationEvidence(payload({ signatureFormat:'CMS' }))
  expect(notPades.gap).toBe(VERIFY_GAPS.NOT_PADES)
})

test('evidencia incompleta ou incoerente falha fechada', () => {
  const cases = {
    'sem titular':{ subjectDN:{} },
    'sem serial':{ serial:'' },
    'sem emissor':{ issuerDN:{} },
    'sem validade':{ validity:{} },
    'validade invertida':{ validity:{ notBefore:'2027-01-01T00:00:00Z', notAfter:'2026-01-01T00:00:00Z' } },
    'assinatura fora da validade':{ validity:{ notBefore:'2020-01-01T00:00:00Z', notAfter:'2021-01-01T00:00:00Z' } },
    'validade ilegivel':{ validity:{ notBefore:'ontem', notAfter:'amanha' } },
  }
  for (const [label, override] of Object.entries(cases)) {
    const result = normalizeVerificationEvidence(
      payload({ entries:[timestampEntry, signerCertificate(override)] }),
      { requestedProfile:'TIMESTAMP' },
    )
    expect(result.ok, label).toBe(false)
    expect(result.gap, label).toBe(VERIFY_GAPS.CERTIFICATE_INCOMPLETE)
  }

  // Sem instante da assinatura tambem nao ha evidencia.
  const noSigningTime = payload()
  delete noSigningTime.signatureStatus.signingTime
  expect(normalizeVerificationEvidence(noSigningTime).gap).toBe(VERIFY_GAPS.CERTIFICATE_INCOMPLETE)

  // Resposta vazia ou sem assinatura nenhuma.
  expect(normalizeVerificationEvidence({}).ok).toBe(false)
  expect(normalizeVerificationEvidence(payload({ signatureStatus:undefined })).gap).toBe(VERIFY_GAPS.CERTIFICATE_INCOMPLETE)
})

test('signatureStatus em lista tambem e aceito', () => {
  const asList = payload()
  const result = normalizeVerificationEvidence(
    { ...asList, signatureStatus:[asList.signatureStatus] },
    { requestedProfile:'TIMESTAMP' },
  )
  expect(result.ok).toBe(true)
  expect(result.evidence.certificateSerial).toBe('0A1B2C')
})

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

test('o PDF vai como multipart e o token somente no header', async () => {
  let captured = null
  await verifySignedPdf(config(), Buffer.from('%PDF-1.7 assinado'), {
    fileName:'documento.pdf',
    fetchImpl:async (url, init) => {
      captured = { url, init }
      return { ok:true, status:200, headers:new Map(), text:async () => JSON.stringify(payload()) }
    },
  })
  expect(captured.url).toBe('https://hom.bry.com.br/api/pdf-verification-service/v1/signatures/verify')
  expect(captured.url).not.toContain(TOKEN)
  expect(captured.init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  expect(captured.init.method).toBe('POST')
  expect(captured.init.redirect).toBe('manual')

  const form = captured.init.body
  expect(form).toBeInstanceOf(FormData)
  expect(form.get('signatures[0][nonce]')).toEqual(form.get('nonce'))
  const content = form.get('signatures[0][content]')
  expect(content).toBeInstanceOf(Blob)
  expect(content.type).toBe('application/pdf')
  expect(await content.text()).toBe('%PDF-1.7 assinado')
})

test('timeout, rede, redirecionamento e resposta ilegivel sao classificados', async () => {
  const aborting = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name:'AbortError' })))
  })
  const timedOut = await verifySignedPdf(config(), Buffer.from('%PDF-'), { fetchImpl:aborting }).catch(error => error)
  expect(timedOut).toBeInstanceOf(BryVerifyError)
  expect(timedOut.kind).toBe('timeout')

  const offline = await verifySignedPdf(config(), Buffer.from('%PDF-'), {
    fetchImpl:async () => { throw new Error('ECONNREFUSED') },
  }).catch(error => error)
  expect(offline.kind).toBe('network')

  const redirected = await verifySignedPdf(config(), Buffer.from('%PDF-'), {
    fetchImpl:async () => ({ ok:false, status:302, headers:new Map(), text:async () => '' }),
  }).catch(error => error)
  expect(redirected.kind).toBe('invalid_response')

  const garbled = await verifySignedPdf(config(), Buffer.from('%PDF-'), {
    fetchImpl:async () => ({ ok:true, status:200, headers:new Map(), text:async () => 'nao-json' }),
  }).catch(error => error)
  expect(garbled.kind).toBe('invalid_response')
})

test('erros HTTP sao classificados e nunca vazam o token do verificador', async () => {
  for (const [status, kind] of [[401, 'auth'], [403, 'auth'], [429, 'rate_limit'], [500, 'provider']]) {
    const error = await verifySignedPdf(config(), Buffer.from('%PDF-'), {
      fetchImpl:async () => ({
        ok:false,
        status,
        headers:new Map(),
        text:async () => `falhou com Bearer ${TOKEN} em https://hom.bry.com.br/interno`,
      }),
    }).catch(nextError => nextError)
    expect(error.kind, String(status)).toBe(kind)
    expect(error.message, String(status)).not.toContain(TOKEN)
    expect(error.message, String(status)).not.toContain('/interno')
  }
})

test('nenhuma chamada acontece sem configuracao ou sem PDF', async () => {
  let called = false
  const unconfigured = bryVerifyConfig(env({ BRY_VERIFY_TOKEN:'' }))
  const offError = await verifySignedPdf(unconfigured, Buffer.from('%PDF-'), {
    fetchImpl:async () => { called = true },
  }).catch(error => error)
  expect(offError.kind).toBe('config')

  const emptyError = await verifySignedPdf(config(), Buffer.alloc(0), {
    fetchImpl:async () => { called = true },
  }).catch(error => error)
  expect(emptyError.kind).toBe('config')
  expect(called).toBe(false)
})

test('detalhe do verificador e sanitizado de credenciais e URLs', () => {
  const detail = sanitizeVerifyDetail(`Bearer ${TOKEN} em https://hom.bry.com.br/x`)
  expect(detail).not.toContain(TOKEN)
  expect(detail).toContain('[redigido]')
  expect(detail).toContain('[link omitido]')
  expect(sanitizeVerifyDetail('x'.repeat(500)).length).toBeLessThanOrEqual(200)
})
