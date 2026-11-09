// api/_lib/bryVerify.js
// Cliente do BRy Verifica, usado para comprovar a assinatura do PDF baixado
// da Easy Sign antes de declarar o documento clinico como assinado.
//
// Contrato oficial confirmado em 09/11/2026:
//   POST /api/service/verifications/verify (multipart/form-data: document)
//   POST /api/service/reports/generate    ({ verificationId })
//
// O Verifica usa o mesmo JWT client_credentials da Easy Sign. Nenhum token
// fixo separado e armazenado, e o relatorio qualificado e gerado logo depois
// da verificacao porque o verificationId expira.

import { bryTokenConfig, getBryAccessToken } from './bryToken.js'

const VERIFY_PATH = '/api/service/verifications/verify'
const REPORT_PATH = '/api/service/reports/generate'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_JSON_BYTES = 4 * 1024 * 1024
const MAX_PDF_BYTES = 25 * 1024 * 1024

export const BRY_VERIFY_HOSTS = Object.freeze({
  'verifica.bry.com.br':'production',
  'verifica.hom.bry.com.br':'homologation',
})

export class BryVerifyError extends Error {
  constructor(message, { kind = 'provider', statusCode = null } = {}) {
    super(message)
    this.name = 'BryVerifyError'
    this.kind = kind
    this.statusCode = statusCode
  }
}

export const VERIFY_GAPS = Object.freeze({
  NOT_CONFIGURED:'verify_service_not_configured',
  SERVICE_UNAVAILABLE:'verify_service_unavailable',
  SIGNATURE_INVALID:'verify_signature_invalid',
  NOT_PADES:'verify_signature_not_pades',
  NOT_ICP_BRASIL:'verify_certificate_not_icp_brasil',
  CERTIFICATE_INCOMPLETE:'verify_certificate_evidence_incomplete',
  TIMESTAMP_NOT_VERIFIED:'verify_timestamp_not_verified',
  REPORT_UNAVAILABLE:'verify_report_unavailable',
})

export function bryVerifyConfig(env = process.env) {
  const read = name => String(env[name] || '').trim()
  const problems = []
  const baseUrlRaw = read('BRY_VERIFY_BASE_URL')
  let baseUrl = ''
  let environment = ''

  if (!baseUrlRaw) {
    problems.push('BRY_VERIFY_BASE_URL nao configurada')
  } else {
    try {
      const url = new URL(baseUrlRaw)
      const matchedEnvironment = BRY_VERIFY_HOSTS[url.hostname.toLowerCase()]
      if (url.protocol !== 'https:' || url.username || url.password
        || (url.port && url.port !== '443') || !matchedEnvironment) {
        problems.push('BRY_VERIFY_BASE_URL fora da allowlist oficial da BRy')
      } else {
        baseUrl = url.origin
        environment = matchedEnvironment
      }
    } catch {
      problems.push('BRY_VERIFY_BASE_URL invalida')
    }
  }

  const auth = bryTokenConfig(env)
  problems.push(...auth.problems)
  if (environment && auth.ready && auth.usesClientCredentials) {
    const tokenEnvironment = auth.tokenBaseUrl.includes('cloud-hom.bry.com.br')
      ? 'homologation'
      : 'production'
    if (environment !== tokenEnvironment) {
      problems.push('BRY_VERIFY_BASE_URL e BRY_EASY_SIGN_TOKEN_URL devem usar o mesmo ambiente')
    }
  }

  const timeoutRaw = Number(read('BRY_VERIFY_REQUEST_TIMEOUT_MS') || DEFAULT_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 60_000
    ? Math.floor(timeoutRaw)
    : DEFAULT_TIMEOUT_MS

  return {
    configured:problems.length === 0,
    ready:problems.length === 0,
    problems,
    baseUrl,
    environment,
    auth,
    verifyPath:VERIFY_PATH,
    reportPath:REPORT_PATH,
    timeoutMs,
  }
}

function text(value) {
  return String(value ?? '').trim()
}

function statusValue(value) {
  return text(value?.status?.status ?? value?.status ?? value).toUpperCase()
}

function millisecondsDate(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' || /^\d+$/.test(String(value))
    ? new Date(Number(value))
    : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function normalizeNewVerification(payload) {
  const result = payload?.verificationResult
  if (!result || !Array.isArray(result.signatures)) return null
  const signatures = result.signatures.filter(Boolean)
  const signature = signatures.length === 1 ? signatures[0] : null
  const certificate = signature?.signatureCertificate || null
  const stamps = Array.isArray(signature?.signatureStamps) ? signature.signatureStamps : []
  return {
    generalStatus:statusValue(result),
    signatureStatus:statusValue(signature),
    certificateStatus:statusValue(certificate),
    signatureCount:signatures.length,
    signatureFormat:text(signature?.format).toUpperCase(),
    certificateSubject:text(certificate?.name),
    certificateSerial:text(certificate?.serialNumber),
    certificateIssuer:text(certificate?.issuer),
    certificateValidFrom:millisecondsDate(certificate?.validity?.notBefore),
    certificateValidUntil:millisecondsDate(certificate?.validity?.notAfter),
    signedAt:millisecondsDate(signature?.date),
    icpBrasil:certificate?.icpBrasil === true && signature?.icpBrasil === true,
    verifiedTimestamp:stamps.some(stamp => statusValue(stamp) === 'VALID'),
  }
}

// Compatibilidade defensiva com a resposta antiga do HUB. Ela nao e mais
// chamada pelo produto, mas tentativas anteriores continuam analisaveis.
function firstLegacySignatureStatus(payload) {
  const status = payload?.signatureStatus
  if (Array.isArray(status)) return status.length === 1 ? status[0] : null
  return status || null
}

export function selectSignerCertificate(signatureStatus) {
  const list = signatureStatus?.chainStatus?.certificateStatusList
  const entries = (Array.isArray(list) ? list : [])
    .filter(entry => entry?.certificateInfo)
    .filter(entry => text(entry.statusType).toUpperCase() !== 'TIMESTAMP')
  if (entries.length === 0) return null
  const final = entries.find(entry => {
    const info = entry.certificateInfo || {}
    return Boolean(info.cpf || info.certificateType || entry.type === 'FinalCertificate')
  })
  return (final || entries[entries.length - 1]).certificateInfo
}

export function hasVerifiedTimestamp(signatureStatus) {
  if (!signatureStatus) return false
  const referenceType = text(signatureStatus.verificationReferenceType
    || signatureStatus.verificationReference?.verificationReferenceType).toUpperCase()
  if (referenceType.includes('TIMESTAMP')) return true
  const list = signatureStatus.chainStatus?.certificateStatusList
  return (Array.isArray(list) ? list : [])
    .some(entry => text(entry?.statusType).toUpperCase() === 'TIMESTAMP')
}

function normalizeLegacyVerification(payload) {
  const signatureStatus = firstLegacySignatureStatus(payload)
  const certificate = selectSignerCertificate(signatureStatus)
  const subject = certificate?.subjectDN || {}
  const issuer = certificate?.issuerDN || {}
  return {
    generalStatus:text(payload?.generalStatus).toUpperCase(),
    signatureStatus:text(payload?.generalStatus).toUpperCase(),
    certificateStatus:text(payload?.generalStatus).toUpperCase(),
    signatureCount:signatureStatus ? 1 : 0,
    signatureFormat:text(payload?.signatureFormat).toUpperCase(),
    certificateSubject:text(subject.formattedCn) || text(subject.cn) || text(subject.dn),
    certificateSerial:text(certificate?.serial),
    certificateIssuer:text(issuer.cn) || text(issuer.dn) || text(issuer.o),
    certificateValidFrom:millisecondsDate(certificate?.validity?.notBefore),
    certificateValidUntil:millisecondsDate(certificate?.validity?.notAfter),
    signedAt:millisecondsDate(signatureStatus?.signingTime),
    icpBrasil:true,
    verifiedTimestamp:hasVerifiedTimestamp(signatureStatus),
  }
}

export function normalizeVerificationEvidence(payload, { requestedProfile = '' } = {}) {
  const normalized = normalizeNewVerification(payload) || normalizeLegacyVerification(payload)
  const validStatuses = new Set(['VALID', 'VALID_WITH_ALERT', 'WARN'])
  if (!validStatuses.has(normalized.generalStatus)
    || !validStatuses.has(normalized.signatureStatus)
    || !validStatuses.has(normalized.certificateStatus)
    || normalized.signatureCount !== 1) {
    return { ok:false, gap:VERIFY_GAPS.SIGNATURE_INVALID, generalStatus:normalized.generalStatus || null }
  }
  if (normalized.signatureFormat !== 'PADES') {
    return { ok:false, gap:VERIFY_GAPS.NOT_PADES, generalStatus:normalized.generalStatus }
  }
  if (!normalized.icpBrasil) {
    return { ok:false, gap:VERIFY_GAPS.NOT_ICP_BRASIL, generalStatus:normalized.generalStatus }
  }

  const validFrom = normalized.certificateValidFrom
  const validUntil = normalized.certificateValidUntil
  const signedAt = normalized.signedAt
  if (!normalized.certificateSubject || !normalized.certificateSerial
    || !normalized.certificateIssuer || !validFrom || !validUntil || !signedAt
    || validUntil <= validFrom || signedAt < validFrom || signedAt > validUntil) {
    return { ok:false, gap:VERIFY_GAPS.CERTIFICATE_INCOMPLETE, generalStatus:normalized.generalStatus }
  }

  if (!normalized.verifiedTimestamp && text(requestedProfile).toUpperCase().includes('TIMESTAMP')) {
    return { ok:false, gap:VERIFY_GAPS.TIMESTAMP_NOT_VERIFIED, generalStatus:normalized.generalStatus }
  }

  return {
    ok:true,
    generalStatus:normalized.generalStatus,
    verificationId:text(payload?.verificationId) || null,
    evidence:{
      signatureStandard:normalized.verifiedTimestamp ? 'PAdES-B-T' : 'PAdES-B-B',
      certificateSubject:normalized.certificateSubject.slice(0, 300),
      certificateSerial:normalized.certificateSerial.slice(0, 120),
      certificateIssuer:normalized.certificateIssuer.slice(0, 300),
      certificateValidFrom:validFrom.toISOString(),
      certificateValidUntil:validUntil.toISOString(),
      signedAt:signedAt.toISOString(),
    },
  }
}

export function sanitizeVerifyDetail(detail) {
  return String(detail || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[redigido]')
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redigido]')
    .replace(/https?:\/\/\S+/g, '[link omitido]')
    .slice(0, 200)
}

function classifyHttpError(response, detail = '') {
  const kind = response.status === 401 || response.status === 403 ? 'auth'
    : response.status === 429 ? 'rate_limit'
      : 'provider'
  const safeDetail = sanitizeVerifyDetail(detail)
  return new BryVerifyError(
    `A verificacao recusou a solicitacao${safeDetail ? `: ${safeDetail}` : '.'}`,
    { kind, statusCode:response.status },
  )
}

async function bryVerifyFetch(config, path, init, { fetchImpl = fetch, tokenOptions = {} } = {}) {
  if (!config?.ready) throw new BryVerifyError('Servico de verificacao indisponivel.', { kind:'config' })
  const accessToken = await getBryAccessToken(config.auth, tokenOptions)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers:{ ...init.headers, Authorization:`Bearer ${accessToken}` },
      signal:controller.signal,
      redirect:'manual',
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      throw new BryVerifyError('A verificacao redirecionou a chamada de forma inesperada.', { kind:'invalid_response' })
    }
    if (!response.ok) throw classifyHttpError(response, await response.text().catch(() => ''))
    return response
  } catch (error) {
    if (error instanceof BryVerifyError) throw error
    if (error?.name === 'AbortError') {
      throw new BryVerifyError('A verificacao nao respondeu no tempo limite.', { kind:'timeout' })
    }
    throw new BryVerifyError('Nao foi possivel contatar o servico de verificacao.', { kind:'network' })
  } finally {
    clearTimeout(timer)
  }
}

export async function verifySignedPdf(config, pdfBuffer, { fileName = 'documento.pdf', fetchImpl = fetch, tokenOptions = {} } = {}) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new BryVerifyError('PDF assinado ausente para verificacao.', { kind:'config' })
  }
  const form = new FormData()
  form.append('document', new Blob([pdfBuffer], { type:'application/pdf' }), fileName)
  form.append('dateFormatZone', 'America/Sao_Paulo')
  form.append('dateFormatLocale', 'pt-BR')

  const response = await bryVerifyFetch(config, config.verifyPath, {
    method:'POST', headers:{ Accept:'application/json' }, body:form,
  }, { fetchImpl, tokenOptions })
  const raw = await response.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_BYTES) {
    throw new BryVerifyError('A resposta da verificacao excedeu o tamanho permitido.', { kind:'too_large' })
  }
  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw new BryVerifyError('A verificacao devolveu uma resposta ilegivel.', { kind:'invalid_response' })
  }
}

export async function generateVerificationReport(config, verificationId, { fetchImpl = fetch, tokenOptions = {} } = {}) {
  const id = text(verificationId)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new BryVerifyError('Identificador da verificacao ausente ou invalido.', { kind:'invalid_response' })
  }
  const response = await bryVerifyFetch(config, config.reportPath, {
    method:'POST',
    headers:{ Accept:'application/pdf', 'Content-Type':'application/json' },
    body:JSON.stringify({ verificationId:id }),
  }, { fetchImpl, tokenOptions })
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_PDF_BYTES) {
    throw new BryVerifyError('O relatorio excedeu o tamanho permitido.', { kind:'too_large' })
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0 || buffer.length > MAX_PDF_BYTES || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new BryVerifyError('A verificacao nao devolveu um relatorio PDF valido.', { kind:'invalid_response' })
  }
  return buffer
}
