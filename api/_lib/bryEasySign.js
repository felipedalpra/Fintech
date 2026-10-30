// api/_lib/bryEasySign.js
// Cliente isolado da API BRy Easy Sign (assinatura clinica ICP-Brasil).
//
// Regras que este arquivo sustenta:
//  - o token JWT da BRy existe somente aqui, lido de variavel server-side/cofre;
//    nunca entra em query string, log, mensagem de erro ou resposta de API;
//  - o host e conferido contra a allowlist oficial, sem fallback silencioso para
//    producao quando a configuracao estiver ausente ou errada;
//  - toda chamada tem timeout proprio com AbortController, limite de resposta e
//    mensagem sanitizada para o usuario;
//  - um POST que falha por timeout/rede fica marcado como AMBIGUO: a BRy nao
//    oferece idempotency key, entao nunca reenviamos cegamente.
//
// Contratos conferidos na documentacao oficial da BRy (28/10/2026):
//   POST   /api/service/sign/v1/signatures
//   GET    /api/service/sign/v1/signatures/{requestId}
//   GET    /api/service/sign/v1/signatures/{requestId}/status
//   GET    /api/service/sign/v1/signatures/{requestId}/documents/{documentNonce}/signed
//   GET    /api/service/sign/v1/signatures/{requestId}/documents/{documentNonce}/report
//   DELETE /api/service/sign/v1/signatures/{requestId}

import { bryTokenConfig, getBryAccessToken } from './bryToken.js'

const PRODUCTION_HOST = 'easysign.bry.com.br'
const HOMOLOGATION_HOST = 'easysign.hom.bry.com.br'

export const BRY_ALLOWED_HOSTS = Object.freeze({
  [PRODUCTION_HOST]:'production',
  [HOMOLOGATION_HOST]:'homologation',
})

export const BRY_ENVELOPE_STATUSES = Object.freeze(['DRAFT', 'CREATED', 'ONGOING', 'FINISHED', 'EXPIRED', 'DELETED'])
export const BRY_SIGNATURE_MODES = Object.freeze(['SIMPLE', 'ADVANCED', 'QUALIFIED'])

// OIDs de tipo de documento medico (guia de assinatura medica da BRy).
// Enviados como CHAVE em documents[].metadata, com valor vazio.
export const BRY_DOCUMENT_TYPE_OIDS = Object.freeze({
  simple_prescription:'2.16.76.1.12.1.1',
  exam_request:'2.16.76.1.12.1.3',
})

// OIDs do profissional regido pelo CFM. Enviados em signersData[].metadata.
export const BRY_CFM_OIDS = Object.freeze({
  registration:'2.16.76.1.4.2.2.1',
  registrationState:'2.16.76.1.4.2.2.2',
  specialty:'2.16.76.1.4.2.2.3',
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BRAZIL_STATES = Object.freeze([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
])

export const MAX_ENVELOPE_NAME = 50
const MAX_JSON_BYTES = 2 * 1024 * 1024
const MAX_PDF_BYTES = 25 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20_000

export class BryEasySignError extends Error {
  // kind: config | timeout | network | auth | rate_limit | not_found | provider | invalid_response | too_large
  constructor(message, { kind = 'provider', statusCode = null, ambiguous = false } = {}) {
    super(message)
    this.name = 'BryEasySignError'
    this.kind = kind
    this.statusCode = statusCode
    // ambiguous = nao sabemos se a BRy processou. Nunca reenviar automaticamente.
    this.ambiguous = ambiguous
  }
}

function configError(message) {
  return new BryEasySignError(message, { kind:'config' })
}

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

// A fonte de verdade da feature flag e o backend. Sem configuracao valida a
// integracao fica indisponivel e a via manual continua sendo a unica oferecida.
export function bryEasySignConfig(env = process.env) {
  const read = name => String(env[name] || '').trim()
  const enabledRaw = read('BRY_EASY_SIGN_ENABLED').toLowerCase()
  const enabled = enabledRaw === 'true' || enabledRaw === '1'

  const problems = []
  const baseUrlRaw = read('BRY_EASY_SIGN_BASE_URL')
  let baseUrl = ''
  let environment = ''
  if (!baseUrlRaw) {
    // Nunca assumir producao por omissao: um envelope de teste em producao
    // consome credito real e gera documento clinico valido.
    problems.push('BRY_EASY_SIGN_BASE_URL nao configurada')
  } else {
    try {
      const url = new URL(baseUrlRaw)
      const matchedEnvironment = BRY_ALLOWED_HOSTS[url.hostname.toLowerCase()]
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !matchedEnvironment) {
        problems.push('BRY_EASY_SIGN_BASE_URL fora da allowlist oficial da BRy')
      } else {
        baseUrl = url.origin
        environment = matchedEnvironment
      }
    } catch {
      problems.push('BRY_EASY_SIGN_BASE_URL invalida')
    }
  }

  // A autenticacao e delegada a api/_lib/bryToken.js: o access_token da BRy dura
  // poucos minutos e precisa ser renovado, entao nao existe token fixo aqui.
  const auth = bryTokenConfig(env)
  problems.push(...auth.problems)

  // UUID opaco emitido pelo cofre. Nao e o segredo: e a referencia a ele.
  const credentialId = read('BRY_EASY_SIGN_CREDENTIAL_ID')
  if (!UUID_PATTERN.test(credentialId)) {
    problems.push('BRY_EASY_SIGN_CREDENTIAL_ID deve ser o UUID opaco emitido pelo cofre')
  }

  const signatureMode = read('BRY_EASY_SIGN_SIGNATURE_MODE').toUpperCase()
  if (!BRY_SIGNATURE_MODES.includes(signatureMode)) {
    problems.push('BRY_EASY_SIGN_SIGNATURE_MODE deve ser SIMPLE, ADVANCED ou QUALIFIED')
  }
  const signatureProfile = read('BRY_EASY_SIGN_SIGNATURE_PROFILE')
  if (signatureMode !== 'SIMPLE' && !signatureProfile) {
    problems.push('BRY_EASY_SIGN_SIGNATURE_PROFILE e obrigatorio fora do modo SIMPLE')
  }

  const webhookSecret = read('BRY_EASY_SIGN_WEBHOOK_SECRET')
  if (webhookSecret && webhookSecret.length < 32) {
    problems.push('BRY_EASY_SIGN_WEBHOOK_SECRET deve ter ao menos 32 caracteres')
  }

  const timeoutRaw = Number(read('BRY_EASY_SIGN_REQUEST_TIMEOUT_MS') || DEFAULT_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 60_000
    ? Math.floor(timeoutRaw)
    : DEFAULT_TIMEOUT_MS

  return {
    enabled,
    configured:problems.length === 0,
    // `ready` e o unico sinal que libera chamada real a BRy.
    ready:enabled && problems.length === 0,
    problems,
    baseUrl,
    environment,
    auth,
    credentialId,
    signatureMode,
    signatureProfile,
    hashAlgorithm:read('BRY_EASY_SIGN_HASH_ALGORITHM') || 'SHA256',
    webhookSecret,
    timeoutMs,
  }
}

// Visao segura para o navegador: nunca inclui token, credencial ou URL interna.
export function publicBryEasySignState(config) {
  return {
    available:Boolean(config.ready),
    environment:config.ready ? config.environment : null,
    // O modo pedido e informativo. A UI NAO pode prometer assinatura
    // qualificada so porque o modo pedido foi QUALIFIED.
    requestedMode:config.ready ? config.signatureMode : null,
    reason:config.ready ? null : (config.enabled ? 'configuracao_incompleta' : 'desabilitada'),
  }
}

// ---------------------------------------------------------------------------
// Identidade profissional -> metadados CFM
// ---------------------------------------------------------------------------

// Separa "CRM-RS 12345" / "CRM/RS 12345" / "12345" + UF explicita.
// Falha fechada: UF errada em documento medico e dado errado, pior que recusar.
export function parseProfessionalRegistration(registration, { council = 'CRM', fallbackState = '' } = {}) {
  const raw = String(registration || '').trim()
  if (!raw) throw configError('Registro profissional ausente no snapshot do documento.')

  const councilToken = String(council || 'CRM').trim().toUpperCase()
  const normalized = raw.toUpperCase().replace(/\s+/g, ' ')
  const withoutCouncil = normalized.startsWith(councilToken)
    ? normalized.slice(councilToken.length).replace(/^[\s\-/:.]+/, '')
    : normalized

  const stateMatch = withoutCouncil.match(/\b([A-Z]{2})\b/)
  const digits = withoutCouncil.replace(/\D/g, '')
  const state = stateMatch && BRAZIL_STATES.includes(stateMatch[1])
    ? stateMatch[1]
    : String(fallbackState || '').trim().toUpperCase()

  if (!digits) throw configError('Nao foi possivel identificar o numero do registro profissional.')
  if (!BRAZIL_STATES.includes(state)) {
    throw configError('Nao foi possivel identificar a UF do registro profissional. Complete o perfil seguro antes de assinar.')
  }
  return { number:digits, state }
}

export function buildCfmSignerMetadata({ registration, council, specialty, fallbackState }) {
  const { number, state } = parseProfessionalRegistration(registration, { council, fallbackState })
  const metadata = {
    [BRY_CFM_OIDS.registration]:number,
    [BRY_CFM_OIDS.registrationState]:state,
  }
  // Especialidade entra somente quando existe de fato no perfil seguro. A BRy
  // ainda nao confirmou se o OID e obrigatorio; enviar vazio seria dado falso.
  const normalizedSpecialty = String(specialty || '').trim()
  if (normalizedSpecialty) metadata[BRY_CFM_OIDS.specialty] = normalizedSpecialty
  return metadata
}

export function documentTypeOid(documentType) {
  const oid = BRY_DOCUMENT_TYPE_OIDS[String(documentType || '')]
  if (!oid) throw configError('Tipo de documento clinico sem OID medico definido para a BRy.')
  return oid
}

// ---------------------------------------------------------------------------
// Payload do envelope
// ---------------------------------------------------------------------------

// Puro e testavel: nenhum segredo entra aqui.
export function buildEnvelopePayload({
  documentType,
  fileName,
  pdfBase64,
  envelopeName,
  clientName,
  signer,
  signatureMode,
  signatureProfile,
  hashAlgorithm = 'SHA256',
  expirationSeconds = 604_800,
  startAsDraft = true,
}) {
  if (!BRY_SIGNATURE_MODES.includes(signatureMode)) {
    throw configError('Modo de assinatura BRy invalido.')
  }
  if (!pdfBase64) throw configError('PDF do documento clinico ausente.')
  if (!String(signer?.name || '').trim()) throw configError('Nome do signatario ausente.')
  const cpf = String(signer?.cpf || '').replace(/\D/g, '')
  if (cpf.length !== 11) throw configError('CPF do signatario invalido.')

  const signatureConfig = { mode:signatureMode }
  // hashAlgorithm/profile valem somente para ADVANCED e QUALIFIED.
  if (signatureMode !== 'SIMPLE') {
    signatureConfig.hashAlgorithm = hashAlgorithm
    if (signatureProfile) signatureConfig.profile = signatureProfile
  }

  return {
    // A API limita `name` e `clientName` a 50 caracteres (confirmado ao vivo em
    // 29/10/2026; o schema publicado nao documenta o limite). Cortamos aqui para
    // que um nome de clinica longo nunca derrube a criacao do envelope.
    name:String(envelopeName || '').slice(0, MAX_ENVELOPE_NAME),
    clientName:String(clientName || '').slice(0, MAX_ENVELOPE_NAME),
    expiration:expirationSeconds,
    language:'pt-br',
    // Criado como rascunho e iniciado em uma segunda chamada (orientacao da BRy
    // em 29/10/2026). Assim, se a criacao der timeout e um envelope duplicado
    // existir, ele NAO chega ao profissional: rascunho nao notifica ninguem.
    startAsDraft,
    // A BRy guarda o artefato de forma temporaria; a guarda definitiva e nossa.
    keepDocument:false,
    documents:[{
      filename:fileName,
      // base64Document com "D" maiusculo: confirmado pela BRy em 29/10/2026.
      // O schema publico grafa `base64document`, mas a API aceita a forma do
      // Quickstart; a BRy vai corrigir a documentacao.
      base64Document:pdfBase64,
      // O OID do tipo de documento medico e a CHAVE, com valor vazio.
      metadata:{ [documentTypeOid(documentType)]:'' },
    }],
    signersData:[{
      name:String(signer.name).trim(),
      personal_identifier:cpf,
      personal_identifier_type:'CPF',
      // LISTA, nao string: a API ao vivo recusa `typeMessaging` como texto com
      // "cannot unmarshal string into ... of type []string" (confirmado em
      // 29/10/2026). O schema publicado descreve um enum simples.
      // LINK: a SurgiMetrics devolve o link apenas ao proprio profissional.
      // Nunca pedimos para a BRy notificar por e-mail/WhatsApp.
      typeMessaging:['LINK'],
      signatureConfig,
      metadata:buildCfmSignerMetadata({
        registration:signer.registration,
        council:signer.council,
        specialty:signer.specialty,
        fallbackState:signer.registrationState,
      }),
    }],
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function assertAllowedUrl(url) {
  const environment = BRY_ALLOWED_HOSTS[url.hostname.toLowerCase()]
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !environment) {
    throw configError('URL da BRy fora da allowlist oficial.')
  }
  return environment
}

// Mensagens do provedor podem conter dados do envelope; o token nunca e
// ecoado porque nunca sai do header. Ainda assim truncamos e removemos
// qualquer coisa com aparencia de credencial antes de propagar.
export function sanitizeProviderDetail(detail) {
  return String(detail || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[redigido]')
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redigido]')
    .replace(/https?:\/\/\S+/g, '[link omitido]')
    .slice(0, 200)
}

function classifyHttpError(status, detail) {
  const safeDetail = sanitizeProviderDetail(detail)
  if (status === 401 || status === 403) {
    return new BryEasySignError('A BRy recusou a credencial da aplicacao.', { kind:'auth', statusCode:status })
  }
  if (status === 404) {
    return new BryEasySignError('Envelope nao encontrado na BRy.', { kind:'not_found', statusCode:status })
  }
  if (status === 429) {
    return new BryEasySignError('A BRy recusou a chamada por limite de uso. Tente novamente mais tarde.', { kind:'rate_limit', statusCode:status })
  }
  if (status >= 500) {
    // 5xx em POST tambem e ambiguo: a BRy pode ter criado o envelope.
    return new BryEasySignError('A BRy esta indisponivel no momento.', { kind:'provider', statusCode:status })
  }
  return new BryEasySignError(`A BRy recusou a solicitacao${safeDetail ? `: ${safeDetail}` : '.'}`, { kind:'provider', statusCode:status })
}

async function readLimited(response, maxBytes, { ambiguous = false } = {}) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) {
    throw new BryEasySignError('A resposta da BRy excedeu o tamanho permitido.', { kind:'too_large', ambiguous })
  }
  const reader = response.body?.getReader?.()
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) {
      throw new BryEasySignError('A resposta da BRy excedeu o tamanho permitido.', { kind:'too_large', ambiguous })
    }
    return buffer
  }
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BryEasySignError('A resposta da BRy excedeu o tamanho permitido.', { kind:'too_large', ambiguous })
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

// `fetchImpl` existe para os testes: nenhuma chamada real a BRy em teste.
async function bryRequest(config, { method, path, body, expect = 'json', maxBytes }, { fetchImpl = fetch, tokenOptions } = {}) {
  if (!config?.ready) throw configError('Integracao BRy Easy Sign indisponivel.')
  const url = new URL(`${config.baseUrl}${path}`)
  assertAllowedUrl(url)
  // Um POST interrompido pode ter sido processado pela BRy. Sem idempotency key
  // no contrato publico, o resultado e AMBIGUO e nao pode ser reenviado.
  const ambiguousOnFailure = method !== 'GET'

  // Token obtido (e renovado) na hora da chamada. Nunca fica em variavel de
  // ambiente nem e reaproveitado alem da sua validade.
  const accessToken = await getBryAccessToken(config.auth, tokenOptions)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  let response
  try {
    response = await fetchImpl(url.toString(), {
      method,
      // Token somente em header. Jamais em query string.
      headers:{
        Authorization:`Bearer ${accessToken}`,
        Accept:expect === 'pdf' ? 'application/pdf' : 'application/json',
        ...(body ? { 'Content-Type':'application/json' } : {}),
      },
      body:body ? JSON.stringify(body) : undefined,
      signal:controller.signal,
      redirect:'manual',
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new BryEasySignError('A BRy nao respondeu no tempo limite.', { kind:'timeout', ambiguous:ambiguousOnFailure })
    }
    throw new BryEasySignError('Nao foi possivel contatar a BRy.', { kind:'network', ambiguous:ambiguousOnFailure })
  } finally {
    clearTimeout(timer)
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    throw new BryEasySignError('A BRy redirecionou a chamada de forma inesperada.', { kind:'invalid_response', ambiguous:ambiguousOnFailure })
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const error = classifyHttpError(response.status, detail)
    if (response.status >= 500) error.ambiguous = ambiguousOnFailure
    throw error
  }

  const buffer = await readLimited(response, maxBytes, { ambiguous:ambiguousOnFailure })
  if (expect === 'pdf') {
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase()
    if (contentType && contentType !== 'application/pdf' && contentType !== 'application/octet-stream') {
      throw new BryEasySignError('A BRy devolveu um conteudo que nao e PDF.', { kind:'invalid_response' })
    }
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new BryEasySignError('A BRy devolveu um arquivo que nao comeca como PDF.', { kind:'invalid_response' })
    }
    return buffer
  }
  if (expect === 'none') return null
  try {
    return JSON.parse(buffer.toString('utf8') || '{}')
  } catch {
    throw new BryEasySignError('A BRy devolveu uma resposta ilegivel.', { kind:'invalid_response', ambiguous:ambiguousOnFailure })
  }
}

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

// Normaliza a resposta de criacao. O envelope vem em `uuid` (nao `requestId`).
// Devolve o link individual do signatario, que e SENSIVEL: nunca persistido,
// nunca registrado em log.
export function normalizeEnvelopeCreation(payload) {
  const envelopeId = String(payload?.uuid || '').trim()
  const documents = Array.isArray(payload?.documents) ? payload.documents : []
  const signers = Array.isArray(payload?.signers) ? payload.signers : []
  const documentId = String(documents[0]?.documentNonce || '').trim()
  const signer = signers[0] || {}
  const signerId = String(signer.signerNonce || '').trim()
  const signingUrl = String(signer.link?.href || '').trim()

  if (!envelopeId || !documentId || !signerId) {
    throw new BryEasySignError('A BRy nao devolveu os identificadores do envelope.', { kind:'invalid_response', ambiguous:true })
  }

  // O link e OPCIONAL na criacao: o envelope nasce como rascunho e so pode ser
  // assinado depois do /start, entao a BRy pode nao devolve-lo aqui. Quem chama
  // recupera o link consultando o envelope depois de inicia-lo. Fora da
  // allowlist, o link e descartado em vez de propagado.
  let safeSigningUrl = null
  if (signingUrl) {
    try {
      const parsed = new URL(signingUrl)
      assertAllowedUrl(parsed)
      safeSigningUrl = parsed.toString()
    } catch { safeSigningUrl = null }
  }

  return {
    envelopeId,
    documentId,
    signerId,
    envelopeStatus:normalizeEnvelopeStatus(payload?.status),
    signingUrl:safeSigningUrl,
  }
}

export function normalizeEnvelopeStatus(value) {
  const status = String(value || '').trim().toUpperCase()
  return BRY_ENVELOPE_STATUSES.includes(status) ? status : null
}

export async function createEnvelope(config, payload, options = {}) {
  const response = await bryRequest(config, {
    method:'POST',
    path:'/api/service/sign/v1/signatures',
    body:payload,
    maxBytes:MAX_JSON_BYTES,
  }, options)
  return normalizeEnvelopeCreation(response)
}

export async function fetchEnvelope(config, envelopeId, options = {}) {
  const response = await bryRequest(config, {
    method:'GET',
    path:`/api/service/sign/v1/signatures/${encodeURIComponent(envelopeId)}`,
    maxBytes:MAX_JSON_BYTES,
  }, options)
  return normalizeEnvelopeState(response)
}

// Estado real do envelope, lido da BRy com JWT. Nunca do webhook.
export function normalizeEnvelopeState(payload) {
  const signers = Array.isArray(payload?.signers) ? payload.signers : []
  const signer = signers[0] || {}
  const evidenceDateRaw = Number(signer.evidenceDate || 0)
  // evidenceDate: Unix timestamp da assinatura, quando houve assinatura.
  const signedAt = Number.isFinite(evidenceDateRaw) && evidenceDateRaw > 0
    ? new Date(evidenceDateRaw < 1e12 ? evidenceDateRaw * 1000 : evidenceDateRaw).toISOString()
    : null
  const documents = Array.isArray(payload?.documents) ? payload.documents : []

  // A consulta do envelope pode devolver novamente o link individual. Ele e
  // SENSIVEL: so e repassado ao proprio profissional, nunca persistido nem
  // registrado. Fora da allowlist, e descartado.
  let signingUrl = null
  const signingUrlRaw = String(signer.link?.href || '').trim()
  if (signingUrlRaw) {
    try {
      const parsed = new URL(signingUrlRaw)
      assertAllowedUrl(parsed)
      signingUrl = parsed.toString()
    } catch { signingUrl = null }
  }

  return {
    envelopeStatus:normalizeEnvelopeStatus(payload?.status),
    signerStatus:String(signer.status || '').trim().toUpperCase() || null,
    signingUrl,
    signedAt,
    documentId:String(documents[0]?.documentNonce || '').trim() || null,
    signerId:String(signer.signerNonce || '').trim() || null,
    // Modo/perfil AQUI sao o que foi SOLICITADO, nao prova do padrao aplicado.
    // A resposta devolve `signatureMode`; o schema publicado usa `mode`.
    requestedMode:String(signer.signatureConfig?.signatureMode || signer.signatureConfig?.mode || '')
      .trim().toUpperCase() || null,
    requestedProfile:String(signer.signatureConfig?.profile || '').trim() || null,
  }
}

export async function downloadSignedDocument(config, envelopeId, documentId, options = {}) {
  return bryRequest(config, {
    method:'GET',
    path:`/api/service/sign/v1/signatures/${encodeURIComponent(envelopeId)}/documents/${encodeURIComponent(documentId)}/signed`,
    expect:'pdf',
    maxBytes:MAX_PDF_BYTES,
  }, options)
}

// Relatorio de evidencias da BRy. E um PDF, nao JSON: serve para arquivamento
// junto ao documento, mas NAO fornece titular/serial/emissor/validade em campo
// legivel por maquina. Por isso nao basta para terminalizar como `signed`.
export async function downloadEvidenceReport(config, envelopeId, documentId, options = {}) {
  return bryRequest(config, {
    method:'GET',
    path:`/api/service/sign/v1/signatures/${encodeURIComponent(envelopeId)}/documents/${encodeURIComponent(documentId)}/report`,
    expect:'pdf',
    maxBytes:MAX_PDF_BYTES,
  }, options)
}

// Inicia um envelope criado como rascunho. Devolve 204 sem corpo.
// A documentacao nao define o comportamento ao reiniciar um envelope que ja
// saiu de DRAFT, entao quem chama confere o estado antes de tratar como falha.
export async function startEnvelope(config, envelopeId, options = {}) {
  return bryRequest(config, {
    method:'POST',
    path:`/api/service/sign/v1/signatures/${encodeURIComponent(envelopeId)}/start`,
    expect:'none',
    maxBytes:MAX_JSON_BYTES,
  }, options)
}

export async function cancelEnvelope(config, envelopeId, options = {}) {
  return bryRequest(config, {
    method:'DELETE',
    path:`/api/service/sign/v1/signatures/${encodeURIComponent(envelopeId)}`,
    expect:'none',
    maxBytes:MAX_JSON_BYTES,
  }, options)
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

// A documentacao publica declara `authType: NONE` para o webhook. Portanto o
// callback NAO e fonte de verdade: aqui so extraimos o identificador do
// envelope para disparar reconciliacao autenticada. Nenhum estado do payload
// e aproveitado.
export function parseBryWebhookNotification(rawBody, { maxBytes = 16 * 1024 } = {}) {
  let payload
  if (rawBody && typeof rawBody === 'object' && !Buffer.isBuffer(rawBody) && !(rawBody instanceof Uint8Array)) {
    // Corpo ja desserializado pelo runtime. Reserializamos somente para medir
    // o tamanho com o mesmo limite aplicado ao corpo bruto.
    let serialized
    try { serialized = JSON.stringify(rawBody) } catch { return { envelopeIds:[], rejected:'payload_invalido' } }
    if (!serialized || serialized === '{}') return { envelopeIds:[], rejected:'payload_vazio' }
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) return { envelopeIds:[], rejected:'payload_excede_limite' }
    payload = rawBody
  } else {
    const text = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody || '').toString('utf8')
    if (!text.trim()) return { envelopeIds:[], rejected:'payload_vazio' }
    if (Buffer.byteLength(text, 'utf8') > maxBytes) return { envelopeIds:[], rejected:'payload_excede_limite' }
    try { payload = JSON.parse(text) } catch { return { envelopeIds:[], rejected:'payload_invalido' } }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { envelopeIds:[], rejected:'payload_invalido' }
  }

  const candidates = [
    payload.uuid, payload.requestId, payload.request_id,
    payload.collectionUuid, payload.signatureUuid,
    payload?.collection?.uuid, payload?.signature?.uuid,
  ]
  const envelopeIds = [...new Set(candidates
    .map(value => String(value || '').trim())
    .filter(value => UUID_PATTERN.test(value)))]

  if (envelopeIds.length === 0) return { envelopeIds:[], rejected:'envelope_ausente' }
  // Limite duro: um callback nunca reconcilia um lote arbitrario.
  return { envelopeIds:envelopeIds.slice(0, 5), rejected:null }
}

// Segredo de endpoint comparado em tempo constante. A ausencia de segredo
// configurado nao libera o webhook: ele fica fechado.
export function webhookSecretMatches(config, provided) {
  const expected = String(config?.webhookSecret || '')
  const candidate = String(provided || '')
  if (!expected || expected.length !== candidate.length) return false
  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ candidate.charCodeAt(index)
  }
  return mismatch === 0
}

// ---------------------------------------------------------------------------
// Reconciliacao: estado da BRy -> transicao interna
// ---------------------------------------------------------------------------

// A evidencia verificavel do certificado NAO vem da Easy Sign. Em 29/10/2026 a
// BRy orientou baixar o PDF assinado e submete-lo ao servico de verificacao
// (api/_lib/bryVerify.js), que responde em JSON. Por isso esta transicao apenas
// manda COLETAR o artefato: quem decide se a tentativa pode virar `signed` e a
// verificacao, em api/_lib/clinicalSignatureBry.js.

// Pura e testavel. Tolera callback duplicado, atrasado e fora de ordem porque
// nao olha o payload do webhook: decide apenas pelo estado lido da BRy com JWT.
export function mapEnvelopeToInternalTransition({ attempt = {}, envelopeState = {} }) {
  // Estado terminal nunca e reaberto, nem por callback antigo reapresentado.
  if (attempt.status && attempt.status !== 'pending') {
    return { action:'none', reason:'tentativa_terminal' }
  }

  const envelopeStatus = normalizeEnvelopeStatus(envelopeState.envelopeStatus)
  const signerStatus = String(envelopeState.signerStatus || '').trim().toUpperCase() || null

  if (signerStatus === 'REFUSED') {
    return {
      action:'terminalize',
      status:'failed',
      failureCode:'signer_refused',
      failureMessage:'O profissional recusou a assinatura na pagina da BRy.',
      envelopeStatus,
    }
  }
  if (envelopeStatus === 'DELETED') {
    return {
      action:'terminalize',
      status:'cancelled',
      failureCode:'envelope_deleted',
      failureMessage:'O envelope foi cancelado na BRy.',
      envelopeStatus,
    }
  }
  if (envelopeStatus === 'EXPIRED') {
    return {
      action:'terminalize',
      status:'failed',
      failureCode:'envelope_expired',
      failureMessage:'O prazo do envelope expirou antes da assinatura.',
      envelopeStatus,
    }
  }
  if (envelopeStatus === 'FINISHED' || signerStatus === 'SIGNED') {
    // Baixa e guarda o artefato, mas NAO declara assinatura concluida.
    return {
      action:'collect_artifact',
      envelopeStatus,
      signedAt:envelopeState.signedAt || null,
    }
  }
  if (envelopeStatus === 'DRAFT') {
    // Envelope criado mas nunca iniciado: a chamada de inicio falhou ou ficou
    // ambigua. Ninguem foi notificado, entao reiniciar e seguro.
    return { action:'start_envelope', envelopeStatus }
  }
  if (envelopeStatus === 'CREATED' || envelopeStatus === 'ONGOING') {
    return { action:'none', reason:'aguardando_assinatura', envelopeStatus }
  }
  return { action:'none', reason:'estado_desconhecido', envelopeStatus }
}
