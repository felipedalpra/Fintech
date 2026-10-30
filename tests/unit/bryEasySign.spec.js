import { expect, test } from '@playwright/test'
import {
  BRY_CFM_OIDS,
  BRY_DOCUMENT_TYPE_OIDS,
  BryEasySignError,
  bryEasySignConfig,
  buildCfmSignerMetadata,
  buildEnvelopePayload,
  cancelEnvelope,
  createEnvelope,
  documentTypeOid,
  MAX_ENVELOPE_NAME,
  downloadSignedDocument,
  fetchEnvelope,
  mapEnvelopeToInternalTransition,
  normalizeEnvelopeCreation,
  normalizeEnvelopeState,
  parseBryWebhookNotification,
  parseProfessionalRegistration,
  publicBryEasySignState,
  sanitizeProviderDetail,
  startEnvelope,
  webhookSecretMatches,
} from '../../api/_lib/bryEasySign.js'
import { resetBryTokenCache } from '../../api/_lib/bryToken.js'

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzdXJnaW1ldHJpY3MifQ.assinatura-secreta-da-bry'
const CREDENTIAL_ID = '70000000-0000-4000-8000-000000000001'

function env(overrides = {}) {
  return {
    BRY_EASY_SIGN_ENABLED:'true',
    BRY_EASY_SIGN_BASE_URL:'https://easysign.hom.bry.com.br',
    BRY_EASY_SIGN_TOKEN:TOKEN,
    BRY_EASY_SIGN_CREDENTIAL_ID:CREDENTIAL_ID,
    BRY_EASY_SIGN_SIGNATURE_MODE:'QUALIFIED',
    BRY_EASY_SIGN_SIGNATURE_PROFILE:'TIMESTAMP',
    BRY_EASY_SIGN_WEBHOOK_SECRET:'s'.repeat(40),
    BRY_EASY_SIGN_REQUEST_TIMEOUT_MS:'1500',
    ...overrides,
  }
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok:status >= 200 && status < 300,
    status,
    headers:new Map(Object.entries({ 'content-type':'application/json', ...headers })),
    text:async () => JSON.stringify(body),
    arrayBuffer:async () => Buffer.from(JSON.stringify(body)),
    body:null,
  }
}

// ---------------------------------------------------------------------------
// Configuracao e flag
// ---------------------------------------------------------------------------

test('a feature fica indisponivel sem configuracao completa e nunca cai em producao por omissao', () => {
  expect(bryEasySignConfig(env({ BRY_EASY_SIGN_ENABLED:'false' })).ready).toBe(false)

  const missingUrl = bryEasySignConfig(env({ BRY_EASY_SIGN_BASE_URL:'' }))
  expect(missingUrl.ready).toBe(false)
  expect(missingUrl.baseUrl).toBe('')
  expect(missingUrl.problems.join(' ')).toContain('BRY_EASY_SIGN_BASE_URL')

  // Nenhum fallback silencioso para o host de producao.
  expect(missingUrl.environment).toBe('')
})

test('allowlist aceita apenas os hosts oficiais, em HTTPS, sem credencial embutida', () => {
  expect(bryEasySignConfig(env({ BRY_EASY_SIGN_BASE_URL:'https://easysign.bry.com.br' })).environment).toBe('production')
  expect(bryEasySignConfig(env({ BRY_EASY_SIGN_BASE_URL:'https://easysign.hom.bry.com.br' })).environment).toBe('homologation')

  for (const url of [
    'http://easysign.bry.com.br',
    'https://easysign.bry.com.br.evil.test',
    'https://evil.test',
    'https://user:senha@easysign.bry.com.br',
    'https://easysign.bry.com.br:8443',
  ]) {
    const config = bryEasySignConfig(env({ BRY_EASY_SIGN_BASE_URL:url }))
    expect(config.ready, url).toBe(false)
    expect(config.environment, url).toBe('')
  }
})

test('credential id precisa ser o UUID opaco do cofre e o timeout fica dentro de limites seguros', () => {
  expect(bryEasySignConfig(env({ BRY_EASY_SIGN_CREDENTIAL_ID:'minha-senha' })).ready).toBe(false)
  expect(bryEasySignConfig(env({ BRY_EASY_SIGN_CREDENTIAL_ID:TOKEN })).ready).toBe(false)
  expect(bryEasySignConfig(env()).timeoutMs).toBe(1500)
  expect(bryEasySignConfig(env({ BRY_EASY_SIGN_REQUEST_TIMEOUT_MS:'1' })).timeoutMs).toBe(20_000)
  expect(bryEasySignConfig(env({ BRY_EASY_SIGN_REQUEST_TIMEOUT_MS:'999999' })).timeoutMs).toBe(20_000)
})

test('o estado publico nunca expoe token, credencial ou URL interna', () => {
  const state = publicBryEasySignState(bryEasySignConfig(env()))
  const serialized = JSON.stringify(state)
  expect(state.available).toBe(true)
  expect(serialized).not.toContain(TOKEN)
  expect(serialized).not.toContain(CREDENTIAL_ID)
  expect(serialized).not.toContain('easysign')
  expect(Object.keys(state).sort()).toEqual(['available', 'environment', 'reason', 'requestedMode'])
})

test('modo pedido nao vira promessa: desabilitado nao reporta modo algum', () => {
  const off = publicBryEasySignState(bryEasySignConfig(env({ BRY_EASY_SIGN_ENABLED:'false' })))
  expect(off.requestedMode).toBeNull()
  expect(off.reason).toBe('desabilitada')
})

// ---------------------------------------------------------------------------
// OIDs e metadados CFM
// ---------------------------------------------------------------------------

test('cada tipo clinico usa o OID medico correto', () => {
  expect(documentTypeOid('exam_request')).toBe('2.16.76.1.12.1.3')
  expect(documentTypeOid('simple_prescription')).toBe('2.16.76.1.12.1.1')
  expect(BRY_DOCUMENT_TYPE_OIDS.exam_request).toBe('2.16.76.1.12.1.3')
  expect(() => documentTypeOid('atestado')).toThrow(/OID medico/)
  expect(() => documentTypeOid('')).toThrow(/OID medico/)
})

test('metadados CFM saem nos OIDs do conselho, com UF derivada do registro', () => {
  const metadata = buildCfmSignerMetadata({
    registration:'CRM-RS 12345', council:'CRM', specialty:'Cirurgia Plástica',
  })
  expect(metadata[BRY_CFM_OIDS.registration]).toBe('12345')
  expect(metadata[BRY_CFM_OIDS.registrationState]).toBe('RS')
  expect(metadata[BRY_CFM_OIDS.specialty]).toBe('Cirurgia Plástica')
})

test('UF ilegivel falha fechada em vez de inventar estado', () => {
  expect(parseProfessionalRegistration('CRM/SP 9988', { council:'CRM' })).toEqual({ number:'9988', state:'SP' })
  expect(parseProfessionalRegistration('12345', { council:'CRM', fallbackState:'mg' })).toEqual({ number:'12345', state:'MG' })
  expect(() => parseProfessionalRegistration('12345', { council:'CRM' })).toThrow(/UF/)
  expect(() => parseProfessionalRegistration('CRM-XX 12345', { council:'CRM' })).toThrow(/UF/)
  expect(() => parseProfessionalRegistration('CRM-RS', { council:'CRM' })).toThrow(/numero do registro/)
  expect(() => parseProfessionalRegistration('', { council:'CRM' })).toThrow(/ausente/)
})

test('especialidade ausente e omitida, nunca enviada vazia', () => {
  const metadata = buildCfmSignerMetadata({ registration:'CRM-RS 12345', council:'CRM', specialty:'  ' })
  expect(Object.hasOwn(metadata, BRY_CFM_OIDS.specialty)).toBe(false)
})

// ---------------------------------------------------------------------------
// Payload do envelope
// ---------------------------------------------------------------------------

const signer = {
  name:'Dra. Vitória Ribeiro',
  registration:'CRM-RS 12345',
  council:'CRM',
  cpf:'529.982.247-25',
  specialty:'Cirurgia Plástica',
}

const DOC_NONCE = '60000000-0000-4000-8000-000000000001'

function payload(overrides = {}) {
  return buildEnvelopePayload({
    documents:[{
      documentNonce:DOC_NONCE,
      fileName:'exam.pdf',
      pdfBase64:'JVBERi0=',
      documentType:'exam_request',
    }],
    envelopeName:'envelope',
    clientName:'Clínica',
    signer,
    signatureMode:'QUALIFIED',
    signatureProfile:'TIMESTAMP',
    ...overrides,
  })
}

test('o envelope leva o OID do documento como chave e os OIDs CFM no signatario', () => {
  const body = payload()
  expect(body.documents).toHaveLength(1)
  expect(body.documents[0].metadata).toEqual({ '2.16.76.1.12.1.3':'' })
  // O nonce e NOSSO: e por ele que o artefato assinado volta ao documento certo.
  expect(body.documents[0].documentNonce).toBe(DOC_NONCE)
  expect(body.signersData[0].metadata[BRY_CFM_OIDS.registration]).toBe('12345')
  // base64Document com "D" maiusculo: caixa confirmada pela BRy em 29/10/2026.
  expect(body.documents[0].base64Document).toBe('JVBERi0=')
  expect(Object.hasOwn(body.documents[0], 'base64document')).toBe(false)
  // LISTA: a API ao vivo recusa string. Nunca pedimos para a BRy notificar o
  // paciente ou terceiros — LINK devolve o link para a propria aplicacao.
  expect(body.signersData[0].typeMessaging).toEqual(['LINK'])
  // A guarda definitiva do artefato e nossa, nao da BRy.
  expect(body.keepDocument).toBe(false)
})

test('o envelope nasce como rascunho, para que um duplicado nunca chegue ao medico', () => {
  // Orientacao da BRy em 29/10/2026 para o cenario de timeout na criacao.
  expect(payload().startAsDraft).toBe(true)
  expect(payload({ startAsDraft:false }).startAsDraft).toBe(false)
})

test('o modo e o perfil confirmados pela BRy para documento medico passam intactos', () => {
  // QUALIFIED + SHA256 + TIMESTAMP, confirmado em 29/10/2026.
  const body = payload({ signatureMode:'QUALIFIED', signatureProfile:'TIMESTAMP', hashAlgorithm:'SHA256' })
  expect(body.signersData[0].signatureConfig).toEqual({
    mode:'QUALIFIED', hashAlgorithm:'SHA256', profile:'TIMESTAMP',
  })
})

test('o modo qualificado nunca sofre downgrade silencioso', () => {
  expect(payload().signersData[0].signatureConfig).toEqual({
    mode:'QUALIFIED', hashAlgorithm:'SHA256', profile:'TIMESTAMP',
  })
  // ADVANCED continua sendo ADVANCED; nada promove nem rebaixa automaticamente.
  expect(payload({ signatureMode:'ADVANCED' }).signersData[0].signatureConfig.mode).toBe('ADVANCED')
  // SIMPLE nao recebe perfil/hash, que a BRy define apenas para os outros modos.
  expect(payload({ signatureMode:'SIMPLE' }).signersData[0].signatureConfig).toEqual({ mode:'SIMPLE' })
  expect(() => payload({ signatureMode:'BASICO' })).toThrow(/invalido/)
})

test('payload recusa CPF invalido, PDF ausente e signatario sem nome', () => {
  expect(() => payload({ signer:{ ...signer, cpf:'123' } })).toThrow(/CPF/)
  expect(() => payload({ documents:[{ documentNonce:DOC_NONCE, documentType:'exam_request', pdfBase64:'' }] })).toThrow(/PDF/)
  expect(() => payload({ signer:{ ...signer, name:'  ' } })).toThrow(/Nome/)
})

test('o payload enviado a BRy nao contem token nem referencia de credencial', () => {
  const serialized = JSON.stringify(payload())
  expect(serialized).not.toContain(TOKEN)
  expect(serialized).not.toContain(CREDENTIAL_ID)
  expect(serialized).not.toContain('vault://')
})

// ---------------------------------------------------------------------------
// Normalizacao de resposta
// ---------------------------------------------------------------------------

const creationResponse = {
  uuid:'80000000-0000-4000-8000-000000000001',
  status:'CREATED',
  documents:[{ documentNonce:DOC_NONCE, documentUuid:'uuid-1' }],
  signers:[{ signerNonce:'signer-1', link:{ href:'https://easysign.hom.bry.com.br/80000000-0000-4000-8000-000000000001/sign/signer-1' } }],
}

test('identificadores do envelope vem de uuid/documentNonce/signerNonce', () => {
  const normalized = normalizeEnvelopeCreation(creationResponse)
  expect(normalized.envelopeId).toBe('80000000-0000-4000-8000-000000000001')
  expect(normalized.documentsByNonce.get(DOC_NONCE).documentId).toBe(DOC_NONCE)
  expect(normalized.signerId).toBe('signer-1')
  expect(normalized.envelopeStatus).toBe('CREATED')
})

test('resposta sem identificadores do envelope e tratada como ambigua', () => {
  for (const broken of [
    { ...creationResponse, uuid:'' },
    { ...creationResponse, documents:[] },
    { ...creationResponse, signers:[{}] },
  ]) {
    const error = (() => { try { normalizeEnvelopeCreation(broken) } catch (nextError) { return nextError } })()
    expect(error).toBeInstanceOf(BryEasySignError)
    expect(error.kind).toBe('invalid_response')
    // Ambiguo: a BRy pode ter criado o envelope mesmo devolvendo resposta ruim.
    expect(error.ambiguous).toBe(true)
  }
})

test('o link e opcional na criacao, porque o envelope nasce em rascunho', () => {
  // Sem link ainda nao e erro: o envelope e iniciado depois e o link e
  // recuperado na consulta. O que importa e ter os identificadores.
  const withoutLink = normalizeEnvelopeCreation({ ...creationResponse, signers:[{ signerNonce:'signer-1' }] })
  expect(withoutLink.signerId).toBe('signer-1')
  expect(withoutLink.signingUrl).toBeNull()

  // Link fora da allowlist e descartado, nunca propagado.
  const phishing = normalizeEnvelopeCreation({
    ...creationResponse,
    signers:[{ signerNonce:'signer-1', link:{ href:'https://phishing.test/sign' } }],
  })
  expect(phishing.signingUrl).toBeNull()
})

test('o estado do envelope descarta link fora da allowlist e converte evidenceDate', () => {
  const state = normalizeEnvelopeState({
    status:'FINISHED',
    documents:[{ documentNonce:'doc-1' }],
    signers:[{
      signerNonce:'signer-1',
      status:'SIGNED',
      evidenceDate:1_793_000_000,
      signatureConfig:{ signatureMode:'ADVANCED', profile:'TIMESTAMP' },
      link:{ href:'https://phishing.test/sign' },
    }],
  })
  expect(state.envelopeStatus).toBe('FINISHED')
  expect(state.signerStatus).toBe('SIGNED')
  expect(state.signingUrl).toBeNull()
  expect(state.signedAt).toBe(new Date(1_793_000_000 * 1000).toISOString())
  // A resposta devolve `signatureMode`; o schema publicado usa `mode`. Ambos
  // sao aceitos, e os dois continuam sendo o SOLICITADO, nunca evidencia.
  expect(state.requestedMode).toBe('ADVANCED')
  expect(normalizeEnvelopeState({ signers:[{ signatureConfig:{ mode:'QUALIFIED' } }] }).requestedMode).toBe('QUALIFIED')
})

test('status desconhecido do envelope nao e inventado', () => {
  expect(normalizeEnvelopeState({ status:'ALGO_NOVO' }).envelopeStatus).toBeNull()
})

// ---------------------------------------------------------------------------
// HTTP: timeout, erros, limites e ausencia de segredo
// ---------------------------------------------------------------------------

const config = () => bryEasySignConfig(env())

test('o token vai somente no header Authorization, nunca em query string', async () => {
  let captured = null
  await createEnvelope(config(), payload(), {
    fetchImpl:async (url, init) => { captured = { url, init }; return jsonResponse(creationResponse, { status:201 }) },
  })
  expect(captured.url).toBe('https://easysign.hom.bry.com.br/api/service/sign/v1/signatures')
  expect(captured.url).not.toContain(TOKEN)
  expect(captured.url).not.toContain('token')
  expect(captured.init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  expect(captured.init.method).toBe('POST')
  expect(captured.init.redirect).toBe('manual')
})

test('timeout em POST e classificado como ambiguo e nunca reenviado automaticamente', async () => {
  let calls = 0
  const fetchImpl = (url, init) => {
    calls += 1
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name:'AbortError' })))
    })
  }
  const error = await createEnvelope(config(), payload(), { fetchImpl }).catch(nextError => nextError)
  expect(error).toBeInstanceOf(BryEasySignError)
  expect(error.kind).toBe('timeout')
  expect(error.ambiguous).toBe(true)
  // Uma unica tentativa: nenhum retry cego de POST.
  expect(calls).toBe(1)
  expect(error.message).not.toContain(TOKEN)
})

test('GET interrompido nao e ambiguo, porque consultar de novo e seguro', async () => {
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name:'AbortError' })))
  })
  const error = await fetchEnvelope(config(), '80000000-0000-4000-8000-000000000001', { fetchImpl })
    .catch(nextError => nextError)
  expect(error.kind).toBe('timeout')
  expect(error.ambiguous).toBe(false)
})

test('erros HTTP sao classificados e nunca vazam token ou detalhe cru do provedor', async () => {
  const cases = [
    [401, 'auth', false],
    [403, 'auth', false],
    [404, 'not_found', false],
    [429, 'rate_limit', false],
    [500, 'provider', true],
    [400, 'provider', false],
  ]
  for (const [status, kind, ambiguous] of cases) {
    const error = await createEnvelope(config(), payload(), {
      fetchImpl:async () => ({
        ok:false,
        status,
        headers:new Map(),
        text:async () => `falha com Bearer ${TOKEN} em https://easysign.hom.bry.com.br/interno`,
      }),
    }).catch(nextError => nextError)
    expect(error.kind, String(status)).toBe(kind)
    expect(error.ambiguous, String(status)).toBe(ambiguous)
    expect(error.message, String(status)).not.toContain(TOKEN)
    expect(error.message, String(status)).not.toContain('easysign.hom.bry.com.br/interno')
  }
})

test('detalhe do provedor e sanitizado de credenciais, JWT e URLs', () => {
  const detail = sanitizeProviderDetail(`Bearer ${TOKEN} falhou em https://easysign.bry.com.br/x`)
  expect(detail).not.toContain(TOKEN)
  expect(detail).toContain('[redigido]')
  expect(detail).toContain('[link omitido]')
  expect(sanitizeProviderDetail('x'.repeat(500)).length).toBeLessThanOrEqual(200)
})

test('redirecionamento do provedor e recusado em vez de seguido', async () => {
  const error = await fetchEnvelope(config(), 'env-1', {
    fetchImpl:async () => ({ ok:false, status:302, headers:new Map([['location', 'https://evil.test']]), text:async () => '' }),
  }).catch(nextError => nextError)
  expect(error.kind).toBe('invalid_response')
})

test('resposta grande demais e cortada pelo limite declarado', async () => {
  const error = await fetchEnvelope(config(), 'env-1', {
    fetchImpl:async () => jsonResponse({}, { headers:{ 'content-length':String(50 * 1024 * 1024) } }),
  }).catch(nextError => nextError)
  expect(error.kind).toBe('too_large')
})

test('download exige que o conteudo seja realmente um PDF', async () => {
  const notPdf = await downloadSignedDocument(config(), 'env-1', 'doc-1', {
    fetchImpl:async () => ({
      ok:true,
      status:200,
      headers:new Map([['content-type', 'text/html']]),
      arrayBuffer:async () => Buffer.from('<html>login</html>'),
      body:null,
    }),
  }).catch(error => error)
  expect(notPdf.kind).toBe('invalid_response')

  const fakePdf = await downloadSignedDocument(config(), 'env-1', 'doc-1', {
    fetchImpl:async () => ({
      ok:true,
      status:200,
      headers:new Map([['content-type', 'application/pdf']]),
      arrayBuffer:async () => Buffer.from('nao-e-pdf'),
      body:null,
    }),
  }).catch(error => error)
  expect(fakePdf.kind).toBe('invalid_response')

  const real = await downloadSignedDocument(config(), 'env-1', 'doc-1', {
    fetchImpl:async () => ({
      ok:true,
      status:200,
      headers:new Map([['content-type', 'application/pdf']]),
      arrayBuffer:async () => Buffer.from('%PDF-1.7\nconteudo'),
      body:null,
    }),
  })
  expect(real.subarray(0, 5).toString()).toBe('%PDF-')
})

test('nenhuma chamada acontece com a integracao indisponivel', async () => {
  let called = false
  const off = bryEasySignConfig(env({ BRY_EASY_SIGN_ENABLED:'false' }))
  const error = await createEnvelope(off, payload(), { fetchImpl:async () => { called = true } })
    .catch(nextError => nextError)
  expect(called).toBe(false)
  expect(error.kind).toBe('config')
})

test('cancelamento usa DELETE no envelope', async () => {
  let captured = null
  await cancelEnvelope(config(), 'env-1', {
    fetchImpl:async (url, init) => {
      captured = { url, method:init.method }
      return { ok:true, status:204, headers:new Map(), arrayBuffer:async () => Buffer.alloc(0), body:null }
    },
  })
  expect(captured.method).toBe('DELETE')
  expect(captured.url).toContain('/api/service/sign/v1/signatures/env-1')
})

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

test('o segredo do webhook e comparado em tempo constante e fecha sem segredo configurado', () => {
  const configured = bryEasySignConfig(env())
  expect(webhookSecretMatches(configured, 's'.repeat(40))).toBe(true)
  expect(webhookSecretMatches(configured, 's'.repeat(39))).toBe(false)
  expect(webhookSecretMatches(configured, 'x'.repeat(40))).toBe(false)
  expect(webhookSecretMatches(configured, '')).toBe(false)
  // Sem segredo configurado nada passa.
  expect(webhookSecretMatches(bryEasySignConfig(env({ BRY_EASY_SIGN_WEBHOOK_SECRET:'' })), '')).toBe(false)
})

test('segredo de webhook curto invalida a configuracao', () => {
  expect(bryEasySignConfig(env({ BRY_EASY_SIGN_WEBHOOK_SECRET:'curto' })).ready).toBe(false)
})

test('o callback so contribui com o identificador do envelope', () => {
  const envelopeId = '80000000-0000-4000-8000-000000000001'
  expect(parseBryWebhookNotification(JSON.stringify({ uuid:envelopeId, status:'FINISHED' })).envelopeIds).toEqual([envelopeId])
  expect(parseBryWebhookNotification({ collection:{ uuid:envelopeId } }).envelopeIds).toEqual([envelopeId])
  // Duplicidade no mesmo payload nao gera trabalho repetido.
  expect(parseBryWebhookNotification({ uuid:envelopeId, requestId:envelopeId }).envelopeIds).toEqual([envelopeId])
})

test('callback adulterado, vazio, gigante ou sem envelope e descartado', () => {
  expect(parseBryWebhookNotification('').rejected).toBe('payload_vazio')
  expect(parseBryWebhookNotification('{').rejected).toBe('payload_invalido')
  expect(parseBryWebhookNotification('[]').rejected).toBe('payload_invalido')
  expect(parseBryWebhookNotification(JSON.stringify({ status:'FINISHED' })).rejected).toBe('envelope_ausente')
  // Identificador que nao e UUID nao vira consulta.
  expect(parseBryWebhookNotification(JSON.stringify({ uuid:'../../etc/passwd' })).rejected).toBe('envelope_ausente')
  expect(parseBryWebhookNotification(JSON.stringify({ uuid:'x'.repeat(40_000) })).rejected).toBe('payload_excede_limite')
})

test('nenhum estado do callback e aproveitado: ele nao pode marcar assinatura', () => {
  const parsed = parseBryWebhookNotification(JSON.stringify({
    uuid:'80000000-0000-4000-8000-000000000001',
    status:'FINISHED',
    signatureStandard:'PAdES-B-LTA',
    certificateSubject:'CN=Invasor',
  }))
  expect(Object.keys(parsed).sort()).toEqual(['envelopeIds', 'rejected'])
})

// ---------------------------------------------------------------------------
// Transicoes internas
// ---------------------------------------------------------------------------

const pending = { status:'pending' }

test('envelope em andamento nao muda nada', () => {
  for (const envelopeStatus of ['CREATED', 'ONGOING']) {
    expect(mapEnvelopeToInternalTransition({ attempt:pending, envelopeState:{ envelopeStatus } }).action).toBe('none')
  }
})

test('envelope preso em rascunho e reiniciado, porque ninguem foi notificado', () => {
  const transition = mapEnvelopeToInternalTransition({ attempt:pending, envelopeState:{ envelopeStatus:'DRAFT' } })
  expect(transition.action).toBe('start_envelope')
  // Mesmo em rascunho, uma tentativa terminal nao e reaberta.
  expect(mapEnvelopeToInternalTransition({ attempt:{ status:'failed' }, envelopeState:{ envelopeStatus:'DRAFT' } }).action).toBe('none')
})

test('iniciar envelope usa POST no caminho /start e nao espera corpo', async () => {
  let captured = null
  await startEnvelope(config(), '80000000-0000-4000-8000-000000000001', {
    fetchImpl:async (url, init) => {
      captured = { url, method:init.method }
      return { ok:true, status:204, headers:new Map(), arrayBuffer:async () => Buffer.alloc(0), body:null }
    },
  })
  expect(captured.method).toBe('POST')
  expect(captured.url).toBe('https://easysign.hom.bry.com.br/api/service/sign/v1/signatures/80000000-0000-4000-8000-000000000001/start')
})

test('envelope concluido coleta o artefato mas nao declara assinatura', () => {
  const transition = mapEnvelopeToInternalTransition({
    attempt:pending,
    envelopeState:{ envelopeStatus:'FINISHED', signerStatus:'SIGNED', signedAt:'2026-10-28T12:00:00.000Z' },
  })
  expect(transition.action).toBe('collect_artifact')
  // A transicao apenas manda COLETAR: quem decide se vira `signed` e a
  // verificacao do artefato, nunca esta tabela de estados.
  expect(transition.status).toBeUndefined()
  expect(transition.signedAt).toBe('2026-10-28T12:00:00.000Z')
})

test('expiracao, cancelamento e recusa terminalizam com causa auditavel', () => {
  expect(mapEnvelopeToInternalTransition({ attempt:pending, envelopeState:{ envelopeStatus:'EXPIRED' } }))
    .toMatchObject({ action:'terminalize', status:'failed', failureCode:'envelope_expired' })
  expect(mapEnvelopeToInternalTransition({ attempt:pending, envelopeState:{ envelopeStatus:'DELETED' } }))
    .toMatchObject({ action:'terminalize', status:'cancelled', failureCode:'envelope_deleted' })
  expect(mapEnvelopeToInternalTransition({ attempt:pending, envelopeState:{ envelopeStatus:'ONGOING', signerStatus:'REFUSED' } }))
    .toMatchObject({ action:'terminalize', status:'failed', failureCode:'signer_refused' })
})

test('callback atrasado ou fora de ordem nunca reabre tentativa terminal', () => {
  for (const status of ['signed', 'failed', 'cancelled']) {
    const transition = mapEnvelopeToInternalTransition({
      attempt:{ status },
      envelopeState:{ envelopeStatus:'FINISHED', signerStatus:'SIGNED' },
    })
    expect(transition.action, status).toBe('none')
    expect(transition.reason, status).toBe('tentativa_terminal')
  }
  // Evento antigo (ONGOING) chegando depois de EXPIRED nao "ressuscita" nada:
  // a decisao vem do estado atual lido da BRy, nao da ordem dos callbacks.
  expect(mapEnvelopeToInternalTransition({ attempt:{ status:'failed' }, envelopeState:{ envelopeStatus:'ONGOING' } }).action).toBe('none')
})

test('reconciliacao repetida do mesmo estado e idempotente', () => {
  const state = { envelopeStatus:'FINISHED', signerStatus:'SIGNED' }
  const first = mapEnvelopeToInternalTransition({ attempt:pending, envelopeState:state })
  const second = mapEnvelopeToInternalTransition({ attempt:pending, envelopeState:state })
  expect(first).toEqual(second)
})

// ---------------------------------------------------------------------------
// Autenticacao por client_credentials
// ---------------------------------------------------------------------------

test('a chamada troca credenciais por JWT e usa o token obtido no header', async () => {
  resetBryTokenCache()
  const credentialsEnv = {
    ...env(),
    BRY_EASY_SIGN_TOKEN:'',
    BRY_EASY_SIGN_CLIENT_ID:'fca2d1d1-0000-4000-8000-000000000001',
    BRY_EASY_SIGN_CLIENT_SECRET:'segredo-da-aplicacao',
  }
  const withCredentials = bryEasySignConfig(credentialsEnv)
  expect(withCredentials.ready).toBe(true)

  const obtained = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvYnRpZG8ifQ.assinatura'
  let tokenCalls = 0
  let envelopeAuth = null
  await createEnvelope(withCredentials, payload(), {
    tokenOptions:{
      fetchImpl:async () => {
        tokenCalls += 1
        return {
          ok:true, status:200, headers:new Map(),
          text:async () => JSON.stringify({ access_token:obtained, expires_in:300 }),
        }
      },
    },
    fetchImpl:async (url, init) => {
      envelopeAuth = init.headers.Authorization
      return jsonResponse(creationResponse, { status:201 })
    },
  })
  expect(tokenCalls).toBe(1)
  expect(envelopeAuth).toBe(`Bearer ${obtained}`)
  // O segredo da aplicacao nunca chega ao envelope.
  expect(JSON.stringify(payload())).not.toContain('segredo-da-aplicacao')
})

test('sem credenciais nem token a integracao fica indisponivel', () => {
  const orphan = bryEasySignConfig({
    ...env(),
    BRY_EASY_SIGN_TOKEN:'',
    BRY_EASY_SIGN_CLIENT_ID:'',
    BRY_EASY_SIGN_CLIENT_SECRET:'',
  })
  expect(orphan.ready).toBe(false)
  expect(orphan.problems.join(' ')).toContain('BRY_EASY_SIGN_CLIENT_ID')
})

test('o estado publico continua sem expor credencial depois da mudanca de auth', () => {
  const state = publicBryEasySignState(bryEasySignConfig({
    ...env(),
    BRY_EASY_SIGN_TOKEN:'',
    BRY_EASY_SIGN_CLIENT_ID:'fca2d1d1-0000-4000-8000-000000000001',
    BRY_EASY_SIGN_CLIENT_SECRET:'segredo-da-aplicacao',
  }))
  const serialized = JSON.stringify(state)
  expect(serialized).not.toContain('segredo-da-aplicacao')
  expect(serialized).not.toContain('fca2d1d1')
})

test('nome e cliente do envelope respeitam o limite de 50 caracteres da API', () => {
  // A API ao vivo recusa com "Error validating tag 'max' of field 'Name'".
  const body = payload({
    envelopeName:'N'.repeat(120),
    clientName:'Clínica com um nome institucional bastante longo para caber',
  })
  expect(body.name).toHaveLength(MAX_ENVELOPE_NAME)
  expect(body.clientName.length).toBeLessThanOrEqual(MAX_ENVELOPE_NAME)

  // O formato que o orquestrador usa cabe: "SurgiMetrics " + UUID = 49.
  const real = `SurgiMetrics 60000000-0000-4000-8000-000000000001`
  expect(real.length).toBeLessThanOrEqual(MAX_ENVELOPE_NAME)
  expect(payload({ envelopeName:real }).name).toBe(real)
})
