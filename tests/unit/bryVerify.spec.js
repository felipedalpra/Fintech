import { expect, test } from '@playwright/test'
import {
  BryVerifyError,
  bryVerifyConfig,
  generateVerificationReport,
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
    BRY_VERIFY_BASE_URL:'https://verifica.hom.bry.com.br',
    BRY_EASY_SIGN_TOKEN:TOKEN,
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
  expect(bryVerifyConfig(env({ BRY_VERIFY_BASE_URL:'https://verifica.bry.com.br' })).ready).toBe(true)

  for (const url of [
    '',
    'http://verifica.hom.bry.com.br',
    'https://hom.bry.com.br',
    'https://bry.com.br',
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

test('o Verifica compartilha a autenticacao da Easy Sign e o timeout tem limites', () => {
  expect(bryVerifyConfig(env({ BRY_EASY_SIGN_TOKEN:'' })).ready).toBe(false)
  expect(config().timeoutMs).toBe(1500)
  expect(bryVerifyConfig(env({ BRY_VERIFY_REQUEST_TIMEOUT_MS:'1' })).timeoutMs).toBe(30_000)
  expect(bryVerifyConfig(env({ BRY_VERIFY_REQUEST_TIMEOUT_MS:'999999' })).timeoutMs).toBe(30_000)
  expect(config().verifyPath).toBe('/api/service/verifications/verify')
  expect(config().reportPath).toBe('/api/service/reports/generate')
})

test('credenciais renovaveis nao podem misturar homologacao e producao', () => {
  const credentials = {
    BRY_EASY_SIGN_TOKEN:'',
    BRY_EASY_SIGN_CLIENT_ID:'cliente',
    BRY_EASY_SIGN_CLIENT_SECRET:'segredo',
  }
  expect(bryVerifyConfig(env(credentials)).ready).toBe(false)
  expect(bryVerifyConfig(env({
    ...credentials,
    BRY_EASY_SIGN_TOKEN_URL:'https://cloud-hom.bry.com.br',
  })).ready).toBe(true)
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
  expect(normalizeVerificationEvidence(payload({ signatureStatus:undefined })).gap).toBe(VERIFY_GAPS.SIGNATURE_INVALID)
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

function verificaPayload(overrides = {}) {
  const signature = {
    status:{ status:'VALID', message:'Assinatura aprovada' },
    signatureCertificate:{
      status:{ status:'VALID' },
      name:'VITORIA RIBEIRO',
      issuer:'AC Exemplo ICP-Brasil',
      icpBrasil:true,
      serialNumber:'0A1B2C',
      validity:{
        notBefore:Date.parse('2026-01-01T00:00:00Z'),
        notAfter:Date.parse('2027-01-01T00:00:00Z'),
      },
    },
    signatureStamps:[{ status:{ status:'VALID' }, date:Date.parse('2026-10-28T12:00:00Z') }],
    format:'PAdES',
    date:Date.parse('2026-10-28T12:00:00Z'),
    icpBrasil:true,
  }
  return {
    verificationId:'70000000-0000-4000-8000-000000000001',
    verificationResult:{
      status:{ status:'VALID', message:'Documento aprovado' },
      signatures:[signature],
    },
    ...overrides,
  }
}

test('a resposta oficial do BRy Verifica comprova certificado ICP-Brasil e carimbo', () => {
  const result = normalizeVerificationEvidence(verificaPayload(), { requestedProfile:'TIMESTAMP' })
  expect(result.ok).toBe(true)
  expect(result.verificationId).toBe('70000000-0000-4000-8000-000000000001')
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

test('o endpoint novo falha fechado sem ICP-Brasil, com varias assinaturas ou sem carimbo', () => {
  const notIcp = verificaPayload()
  notIcp.verificationResult.signatures[0].signatureCertificate.icpBrasil = false
  expect(normalizeVerificationEvidence(notIcp).gap).toBe(VERIFY_GAPS.NOT_ICP_BRASIL)

  const multiple = verificaPayload()
  multiple.verificationResult.signatures.push({ ...multiple.verificationResult.signatures[0] })
  expect(normalizeVerificationEvidence(multiple).gap).toBe(VERIFY_GAPS.SIGNATURE_INVALID)

  const noStamp = verificaPayload()
  noStamp.verificationResult.signatures[0].signatureStamps = []
  expect(normalizeVerificationEvidence(noStamp, { requestedProfile:'TIMESTAMP' }).gap)
    .toBe(VERIFY_GAPS.TIMESTAMP_NOT_VERIFIED)
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
  expect(captured.url).toBe('https://verifica.hom.bry.com.br/api/service/verifications/verify')
  expect(captured.url).not.toContain(TOKEN)
  expect(captured.init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  expect(captured.init.method).toBe('POST')
  expect(captured.init.redirect).toBe('manual')

  const form = captured.init.body
  expect(form).toBeInstanceOf(FormData)
  expect(form.get('dateFormatZone')).toBe('America/Sao_Paulo')
  expect(form.get('dateFormatLocale')).toBe('pt-BR')
  const content = form.get('document')
  expect(content).toBeInstanceOf(Blob)
  expect(content.type).toBe('application/pdf')
  expect(await content.text()).toBe('%PDF-1.7 assinado')
})

test('o relatorio qualificado e gerado imediatamente com o verificationId', async () => {
  let captured = null
  const report = await generateVerificationReport(
    config(),
    '70000000-0000-4000-8000-000000000001',
    {
      fetchImpl:async (url, init) => {
        captured = { url, init }
        return {
          ok:true,
          status:200,
          headers:new Map([['content-type', 'application/pdf']]),
          arrayBuffer:async () => Buffer.from('%PDF-1.7 relatorio'),
        }
      },
    },
  )
  expect(captured.url).toBe('https://verifica.hom.bry.com.br/api/service/reports/generate')
  expect(captured.init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  expect(JSON.parse(captured.init.body)).toEqual({ verificationId:'70000000-0000-4000-8000-000000000001' })
  expect(report.toString()).toBe('%PDF-1.7 relatorio')
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
        text:async () => `falhou com Bearer ${TOKEN} em https://verifica.hom.bry.com.br/interno`,
      }),
    }).catch(nextError => nextError)
    expect(error.kind, String(status)).toBe(kind)
    expect(error.message, String(status)).not.toContain(TOKEN)
    expect(error.message, String(status)).not.toContain('/interno')
  }
})

test('nenhuma chamada acontece sem configuracao ou sem PDF', async () => {
  let called = false
  const unconfigured = bryVerifyConfig(env({ BRY_EASY_SIGN_TOKEN:'' }))
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
  const detail = sanitizeVerifyDetail(`Bearer ${TOKEN} em https://verifica.hom.bry.com.br/x`)
  expect(detail).not.toContain(TOKEN)
  expect(detail).toContain('[redigido]')
  expect(detail).toContain('[link omitido]')
  expect(sanitizeVerifyDetail('x'.repeat(500)).length).toBeLessThanOrEqual(200)
})
