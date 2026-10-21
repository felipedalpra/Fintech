import crypto from 'crypto'

export const CLINICAL_SIGNATURE_RENDERING_VERSION = 'clinical-pdf-v1'
export const CLINICAL_SIGNATURE_TERMINAL_STATUSES = new Set(['signed', 'failed', 'cancelled'])
export const CLINICAL_SIGNATURE_STANDARDS = new Set(['PAdES-B-B', 'PAdES-B-T', 'PAdES-B-LT', 'PAdES-B-LTA'])

const CONNECTION_FIELDS = new Set(['provider', 'signingMode'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key])
      return result
    }, {})
  }
  return value ?? null
}

export function buildClinicalSignatureEnvelope({ document, signer, renderingVersion = CLINICAL_SIGNATURE_RENDERING_VERSION }) {
  if (!document?.id || !document?.user_id || !document?.patient_id) throw new Error('Documento clínico inválido para assinatura.')
  if (!signer?.userId || !signer?.name || !signer?.registration || !signer?.cpf) {
    throw new Error('Identidade do signatário incompleta para assinatura.')
  }
  if (!document.created_by || signer.userId !== document.created_by) {
    throw new Error('Somente o profissional que emitiu o documento pode assiná-lo.')
  }
  const sameIdentity = [
    [signer.name, document.author_name],
    [signer.registration, document.author_registration],
    [signer.council || 'CRM', document.author_council || 'CRM'],
  ].every(([current, snapshot]) => String(current || '').trim().toLocaleLowerCase('pt-BR') === String(snapshot || '').trim().toLocaleLowerCase('pt-BR'))
  if (!sameIdentity) throw new Error('A identidade do signatário diverge da autoria imutável do documento.')
  if (!isValidCpf(signer.cpf)) throw new Error('CPF do signatário inválido.')

  return canonicalize({
    rendering_version:renderingVersion,
    document:{
      id:document.id,
      owner_id:document.user_id,
      patient_id:document.patient_id,
      created_by:document.created_by,
      document_type:document.document_type,
      issue_date:document.issue_date,
      document_data:document.document_data,
      patient_name:document.patient_name,
      patient_cpf:document.patient_cpf,
      patient_address:document.patient_address,
      author_name:document.author_name,
      author_registration:document.author_registration,
      author_council:document.author_council,
      issuer_contact:document.issuer_contact,
      issuer_address:document.issuer_address,
      clinic_name:document.clinic_name,
      clinic_logo_data_url:document.clinic_logo_data_url,
      request_id:document.request_id,
      request_fingerprint:document.request_fingerprint,
      created_at:document.created_at,
    },
    signer:{
      user_id:signer.userId,
      name:String(signer.name).trim(),
      registration:String(signer.registration).trim(),
      council:String(signer.council || 'CRM').trim(),
      cpf:String(signer.cpf).replace(/\D/g, ''),
      rqe:String(signer.rqe || '').trim() || null,
    },
  })
}

export function hashClinicalSignatureEnvelope(envelope) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(envelope)), 'utf8').digest('hex')
}

export function assertSafeClinicalSignatureConnection(connection = {}, credentialHandle = {}) {
  const unexpectedField = Object.keys(connection).find(field => !CONNECTION_FIELDS.has(field))
  if (unexpectedField) throw new Error(`Campo não permitido na conexão de assinatura: ${unexpectedField}.`)
  if (!connection.provider || !credentialHandle.id) {
    throw new Error('Provedor e identificador interno da credencial são obrigatórios.')
  }
  const provider = String(connection.provider).trim().toLowerCase()
  const credentialId = String(credentialHandle.id).trim().toLowerCase()
  const credentialStore = String(credentialHandle.store || 'vault').trim().toLowerCase()
  const signingMode = String(connection.signingMode || 'remote_icp_brasil').trim()
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(provider)) throw new Error('Identificador do provedor inválido.')
  if (!['vault', 'kms', 'hsm', 'provider'].includes(credentialStore)) throw new Error('Cofre de credencial inválido.')
  if (!UUID_PATTERN.test(credentialId)) throw new Error('A credencial deve usar somente o UUID interno emitido pelo cofre.')
  if (!['remote_icp_brasil', 'a1_vault'].includes(signingMode)) throw new Error('Modo de assinatura inválido.')
  return {
    provider,
    credentialReference:`${credentialStore}://${credentialId}`,
    signingMode,
  }
}

export function buildClinicalSignedFilePath({ ownerId, documentId, signatureId }) {
  if (![ownerId, documentId, signatureId].every(value => UUID_PATTERN.test(String(value || '')))) {
    throw new Error('Escopo inválido para armazenar o documento assinado.')
  }
  return `clinical-signatures/${ownerId}/${documentId}/${signatureId}.pdf`
}

export function normalizeClinicalSignatureEvidence(payload = {}, scope = {}) {
  const status = String(payload.status || '').trim().toLowerCase()
  if (!['pending', 'signed', 'failed', 'cancelled'].includes(status)) throw new Error('Estado de assinatura inválido.')

  const evidence = {
    status,
    provider_request_id:String(payload.providerRequestId || '').trim() || null,
    signed_file_path:null,
    signed_file_sha256:String(payload.signedFileSha256 || '').trim().toLowerCase() || null,
    signature_standard:String(payload.signatureStandard || '').trim() || null,
    certificate_subject:String(payload.certificateSubject || '').trim() || null,
    certificate_serial:String(payload.certificateSerial || '').trim() || null,
    certificate_issuer:String(payload.certificateIssuer || '').trim() || null,
    signed_at:payload.signedAt || null,
    validation_url:String(payload.validationUrl || '').trim() || null,
    failure_code:String(payload.failureCode || '').trim() || null,
    failure_message:String(payload.failureMessage || '').trim() || null,
  }

  if (status === 'signed') {
    evidence.signed_file_path = buildClinicalSignedFilePath(scope)
    if (!evidence.signed_file_path || !/^[0-9a-f]{64}$/.test(evidence.signed_file_sha256 || '')
      || !CLINICAL_SIGNATURE_STANDARDS.has(evidence.signature_standard)
      || !evidence.certificate_subject || !evidence.certificate_serial || !evidence.certificate_issuer
      || !payload.certificateValidFrom || !payload.certificateValidUntil || !evidence.signed_at) {
      throw new Error('Evidências da assinatura concluída estão incompletas.')
    }
    const validFrom = new Date(payload.certificateValidFrom)
    const validUntil = new Date(payload.certificateValidUntil)
    const signedAt = new Date(evidence.signed_at)
    if ([validFrom, validUntil, signedAt].some(value => Number.isNaN(value.getTime()))
      || validUntil <= validFrom || signedAt < validFrom || signedAt > validUntil) {
      throw new Error('Período do certificado ou data da assinatura inválidos.')
    }
    evidence.certificate_valid_from = validFrom.toISOString()
    evidence.certificate_valid_until = validUntil.toISOString()
  }
  return evidence
}

function isValidCpf(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false
  const digit = length => {
    let sum = 0
    for (let index = 0; index < length; index += 1) sum += Number(digits[index]) * (length + 1 - index)
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }
  return digit(9) === Number(digits[9]) && digit(10) === Number(digits[10])
}

