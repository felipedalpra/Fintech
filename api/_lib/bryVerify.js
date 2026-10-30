// api/_lib/bryVerify.js
// Cliente do servico de verificacao de assinatura PDF/PAdES da BRy.
//
// Por que existe: a Easy Sign nao devolve, em campo legivel por maquina,
// titular/serie/emissor/validade do certificado nem o instante da assinatura.
// Em 29/10/2026 a BRy orientou baixar o PDF assinado e submete-lo ao servico de
// verificacao, que responde em JSON. Este arquivo isola essa segunda API.
//
// Contrato conferido na documentacao oficial em 29/10/2026:
//   POST /api/pdf-verification-service/v1/signatures/verify   (multipart/form-data)
//     signatures[0][nonce], signatures[0][content]
//   Resposta: generalStatus, signatureStatus, signatureFormat
//     signatureStatus.signingTime
//     signatureStatus.chainStatus.certificateStatusList[].certificateInfo
//       .subjectDN{cn,formattedCn,dn} .serial .issuerDN{cn,o,dn}
//       .validity{notBefore,notAfter}
//
// PENDENTE de confirmacao com a BRy (ver docs/BRY_EASY_SIGN_INTEGRATION.md):
//  - o HOST oficial deste servico. A documentacao publica usa `example.com` como
//    placeholder, por isso a allowlist aqui aceita somente o dominio bry.com.br
//    e o host exato precisa vir de BRY_VERIFY_BASE_URL;
//  - qual entrada de certificateStatusList e a do signatario (a doc pede para
//    confirmar com resposta real);
//  - se signatureStatus vem como objeto ou lista quando ha mais de uma
//    assinatura. Tratamos as duas formas.

import crypto from 'crypto'

const DEFAULT_VERIFY_PATH = '/api/pdf-verification-service/v1/signatures/verify'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_JSON_BYTES = 4 * 1024 * 1024

// A verificacao so aceita um documento cujo resultado geral seja valido.
const ACCEPTED_GENERAL_STATUSES = Object.freeze(['VALID', 'VALID_WITH_ALERT'])

export class BryVerifyError extends Error {
  constructor(message, { kind = 'provider', statusCode = null } = {}) {
    super(message)
    this.name = 'BryVerifyError'
    this.kind = kind
    this.statusCode = statusCode
  }
}

// Motivos auditaveis de a verificacao nao sustentar o estado `signed`.
export const VERIFY_GAPS = Object.freeze({
  NOT_CONFIGURED:'verify_service_not_configured',
  SERVICE_UNAVAILABLE:'verify_service_unavailable',
  SIGNATURE_INVALID:'verify_signature_invalid',
  NOT_PADES:'verify_signature_not_pades',
  CERTIFICATE_INCOMPLETE:'verify_certificate_evidence_incomplete',
  TIMESTAMP_NOT_VERIFIED:'verify_timestamp_not_verified',
})

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

// Allowlist por dominio: a BRy ainda nao publicou o host deste servico, e
// inventar um subdominio seria pior do que exigir configuracao explicita.
function allowedVerifyHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return host === 'bry.com.br' || host.endsWith('.bry.com.br')
}

export function bryVerifyConfig(env = process.env) {
  const read = name => String(env[name] || '').trim()
  const problems = []

  const baseUrlRaw = read('BRY_VERIFY_BASE_URL')
  let baseUrl = ''
  if (!baseUrlRaw) {
    problems.push('BRY_VERIFY_BASE_URL nao configurada')
  } else {
    try {
      const url = new URL(baseUrlRaw)
      if (url.protocol !== 'https:' || url.username || url.password
        || (url.port && url.port !== '443') || !allowedVerifyHost(url.hostname)) {
        problems.push('BRY_VERIFY_BASE_URL deve ser HTTPS em um host oficial bry.com.br')
      } else {
        baseUrl = url.origin
      }
    } catch {
      problems.push('BRY_VERIFY_BASE_URL invalida')
    }
  }

  const token = read('BRY_VERIFY_TOKEN')
  if (!token) problems.push('BRY_VERIFY_TOKEN nao configurado')

  const pathRaw = read('BRY_VERIFY_PATH') || DEFAULT_VERIFY_PATH
  if (!pathRaw.startsWith('/')) problems.push('BRY_VERIFY_PATH deve comecar com /')

  const timeoutRaw = Number(read('BRY_VERIFY_REQUEST_TIMEOUT_MS') || DEFAULT_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 60_000
    ? Math.floor(timeoutRaw)
    : DEFAULT_TIMEOUT_MS

  return {
    configured:problems.length === 0,
    ready:problems.length === 0,
    problems,
    baseUrl,
    token,
    path:pathRaw,
    timeoutMs,
  }
}

// ---------------------------------------------------------------------------
// Normalizacao da resposta (pura e testavel)
// ---------------------------------------------------------------------------

function firstSignatureStatus(payload) {
  const status = payload?.signatureStatus
  if (Array.isArray(status)) return status[0] || null
  return status || null
}

function text(value) {
  return String(value ?? '').trim()
}

// O certificado do signatario e o "final" da cadeia. A doc nao garante a
// posicao, mas marca a entrada final com certificateType/cpf; usamos isso e,
// na falta, o ultimo elemento, sempre conferindo os campos obrigatorios depois.
export function selectSignerCertificate(signatureStatus) {
  const list = signatureStatus?.chainStatus?.certificateStatusList
  const entries = Array.isArray(list) ? list : []
  const certificates = entries
    .filter(entry => entry && entry.certificateInfo)
    .filter(entry => text(entry.statusType).toUpperCase() !== 'TIMESTAMP')
  if (certificates.length === 0) return null
  const final = certificates.find(entry => {
    const info = entry.certificateInfo || {}
    return Boolean(info.cpf || info.certificateType || entry.type === 'FinalCertificate')
  })
  return (final || certificates[certificates.length - 1]).certificateInfo
}

// Um carimbo do tempo conta como evidencia somente se a propria verificacao o
// reconhecer. Nada aqui olha o modo solicitado.
export function hasVerifiedTimestamp(signatureStatus) {
  if (!signatureStatus) return false
  const referenceType = text(signatureStatus.verificationReferenceType
    || signatureStatus.verificationReference?.verificationReferenceType).toUpperCase()
  if (referenceType.includes('TIMESTAMP')) return true
  const list = signatureStatus.chainStatus?.certificateStatusList
  return (Array.isArray(list) ? list : [])
    .some(entry => text(entry?.statusType).toUpperCase() === 'TIMESTAMP')
}

function subjectName(certificateInfo) {
  const subject = certificateInfo?.subjectDN || {}
  return text(subject.formattedCn) || text(subject.cn) || text(subject.dn)
}

function issuerName(certificateInfo) {
  const issuer = certificateInfo?.issuerDN || {}
  return text(issuer.cn) || text(issuer.dn) || text(issuer.o)
}

// Converte a resposta da verificacao em evidencia utilizavel, ou devolve o
// motivo auditavel de nao servir. NUNCA deduz o padrao do modo pedido:
//  - carimbo do tempo reconhecido pela verificacao -> PAdES-B-T;
//  - sem carimbo reconhecido -> PAdES-B-B, e somente quando o perfil pedido
//    tambem nao previa carimbo. Se o perfil pedido era TIMESTAMP e a
//    verificacao nao confirma carimbo, isso e uma divergencia: falha fechada.
// B-LT/B-LTA exigem evidencia de arquivamento que esta resposta nao oferece, e
// por isso nunca sao declarados -- subdeclarar e seguro, superdeclarar nao.
export function normalizeVerificationEvidence(payload, { requestedProfile = '' } = {}) {
  const generalStatus = text(payload?.generalStatus).toUpperCase()
  if (!ACCEPTED_GENERAL_STATUSES.includes(generalStatus)) {
    return { ok:false, gap:VERIFY_GAPS.SIGNATURE_INVALID, generalStatus:generalStatus || null }
  }
  if (text(payload?.signatureFormat).toUpperCase() !== 'PADES') {
    return { ok:false, gap:VERIFY_GAPS.NOT_PADES, generalStatus }
  }

  const signatureStatus = firstSignatureStatus(payload)
  const certificateInfo = selectSignerCertificate(signatureStatus)
  const subject = subjectName(certificateInfo)
  const serial = text(certificateInfo?.serial)
  const issuer = issuerName(certificateInfo)
  const validFromRaw = certificateInfo?.validity?.notBefore
  const validUntilRaw = certificateInfo?.validity?.notAfter
  const signedAtRaw = signatureStatus?.signingTime

  if (!subject || !serial || !issuer || !validFromRaw || !validUntilRaw || !signedAtRaw) {
    return { ok:false, gap:VERIFY_GAPS.CERTIFICATE_INCOMPLETE, generalStatus }
  }

  const validFrom = new Date(validFromRaw)
  const validUntil = new Date(validUntilRaw)
  const signedAt = new Date(signedAtRaw)
  if ([validFrom, validUntil, signedAt].some(value => Number.isNaN(value.getTime()))
    || validUntil <= validFrom || signedAt < validFrom || signedAt > validUntil) {
    return { ok:false, gap:VERIFY_GAPS.CERTIFICATE_INCOMPLETE, generalStatus }
  }

  const timestamped = hasVerifiedTimestamp(signatureStatus)
  if (!timestamped && text(requestedProfile).toUpperCase().includes('TIMESTAMP')) {
    // Pedimos carimbo do tempo e a verificacao nao confirma: nao e um nivel
    // menor, e uma divergencia que precisa de analise humana.
    return { ok:false, gap:VERIFY_GAPS.TIMESTAMP_NOT_VERIFIED, generalStatus }
  }

  return {
    ok:true,
    generalStatus,
    evidence:{
      signatureStandard:timestamped ? 'PAdES-B-T' : 'PAdES-B-B',
      certificateSubject:subject.slice(0, 300),
      certificateSerial:serial.slice(0, 120),
      certificateIssuer:issuer.slice(0, 300),
      certificateValidFrom:validFrom.toISOString(),
      certificateValidUntil:validUntil.toISOString(),
      signedAt:signedAt.toISOString(),
    },
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export function sanitizeVerifyDetail(detail) {
  return String(detail || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[redigido]')
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redigido]')
    .replace(/https?:\/\/\S+/g, '[link omitido]')
    .slice(0, 200)
}

// Submete o PDF assinado ao verificador. O token vai somente no header e o
// documento clinico nao e registrado em log em nenhuma hipotese.
export async function verifySignedPdf(config, pdfBuffer, { fileName = 'documento.pdf', fetchImpl = fetch } = {}) {
  if (!config?.ready) throw new BryVerifyError('Servico de verificacao indisponivel.', { kind:'config' })
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new BryVerifyError('PDF assinado ausente para verificacao.', { kind:'config' })
  }

  const form = new FormData()
  // nonce apenas correlaciona a requisicao; nao e segredo nem identificador
  // clinico, por isso e aleatorio e descartavel.
  const nonce = crypto.randomBytes(8).toString('hex')
  form.append('nonce', nonce)
  form.append('signatures[0][nonce]', nonce)
  form.append('signatures[0][content]', new Blob([pdfBuffer], { type:'application/pdf' }), fileName)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  let response
  try {
    response = await fetchImpl(`${config.baseUrl}${config.path}`, {
      method:'POST',
      headers:{ Authorization:`Bearer ${config.token}`, Accept:'application/json' },
      body:form,
      signal:controller.signal,
      redirect:'manual',
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new BryVerifyError('A verificacao nao respondeu no tempo limite.', { kind:'timeout' })
    }
    throw new BryVerifyError('Nao foi possivel contatar o servico de verificacao.', { kind:'network' })
  } finally {
    clearTimeout(timer)
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    throw new BryVerifyError('A verificacao redirecionou a chamada de forma inesperada.', { kind:'invalid_response' })
  }
  if (!response.ok) {
    const detail = sanitizeVerifyDetail(await response.text().catch(() => ''))
    const kind = response.status === 401 || response.status === 403 ? 'auth'
      : response.status === 429 ? 'rate_limit'
        : response.status >= 500 ? 'provider' : 'provider'
    throw new BryVerifyError(`A verificacao recusou a solicitacao${detail ? `: ${detail}` : '.'}`, {
      kind, statusCode:response.status,
    })
  }

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
