export const CLINICAL_SIGNATURE_STATUS = {
  PENDING:'pending',
  SIGNED:'signed',
  FAILED:'failed',
  CANCELLED:'cancelled',
}

const STATUS_PRESENTATION = {
  pending:{ label:'Assinatura em processamento', tone:'pending' },
  signed:{ label:'Assinado digitalmente', tone:'signed' },
  failed:{ label:'Falha na assinatura', tone:'failed' },
  cancelled:{ label:'Assinatura cancelada', tone:'muted' },
}

const SIGNATURE_STANDARDS = new Set(['PAdES-B-B', 'PAdES-B-T', 'PAdES-B-LT', 'PAdES-B-LTA'])

export function hasCompleteClinicalSignatureEvidence(signature = {}) {
  if (signature.status !== 'signed') return false
  const validFrom = new Date(signature.certificate_valid_from || '')
  const validUntil = new Date(signature.certificate_valid_until || '')
  const signedAt = new Date(signature.signed_at || '')
  return Boolean(
    String(signature.signed_file_path || '').trim()
    && /^[0-9a-f]{64}$/.test(String(signature.signed_file_sha256 || ''))
    && SIGNATURE_STANDARDS.has(signature.signature_standard)
    && String(signature.certificate_subject || '').trim()
    && String(signature.certificate_serial || '').trim()
    && String(signature.certificate_issuer || '').trim()
    && ![validFrom, validUntil, signedAt].some(value => Number.isNaN(value.getTime()))
    && validUntil > validFrom
    && signedAt >= validFrom
    && signedAt <= validUntil
  )
}

export function latestClinicalSignatureByDocument(signatures = []) {
  const grouped = signatures.reduce((result, signature) => {
    if (!signature?.document_id) return result
    if (!result[signature.document_id]) result[signature.document_id] = []
    result[signature.document_id].push(signature)
    return result
  }, {})
  return Object.entries(grouped).reduce((result, [documentId, attempts]) => {
    const ordered = [...attempts].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    result[documentId] = ordered.find(hasCompleteClinicalSignatureEvidence) || ordered[0]
    return result
  }, {})
}

export function clinicalSignaturePresentation(signature, { evidenceAvailable = true } = {}) {
  if (!evidenceAvailable) return { label:'Status digital indisponível', tone:'muted' }
  if (!signature) return { label:'Assinatura digital não configurada', tone:'muted' }
  if (signature.status === 'signed' && !hasCompleteClinicalSignatureEvidence(signature)) {
    return { label:'Evidência digital inconsistente', tone:'failed' }
  }
  return STATUS_PRESENTATION[signature.status] || { label:'Status de assinatura desconhecido', tone:'muted' }
}

export function isValidCpf(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false
  const checkDigit = length => {
    let sum = 0
    for (let index = 0; index < length; index += 1) sum += Number(digits[index]) * (length + 1 - index)
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }
  return checkDigit(9) === Number(digits[9]) && checkDigit(10) === Number(digits[10])
}

export function clinicalSignerReadiness(profile = {}) {
  const doctor = profile?.doctor || {}
  const missing = []
  if (!String(doctor.fullName || '').trim()) missing.push('nome completo')
  if (!String(doctor.registrationId || '').trim()) missing.push('CRM')
  if (!isValidCpf(doctor.cpf)) missing.push('CPF válido')
  return {
    ready:missing.length === 0,
    missing,
  }
}

