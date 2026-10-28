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

export const CLINICAL_SIGNATURE_ELIGIBLE_TYPES = ['exam_request', 'simple_prescription']

// Motivo auditavel, devolvido pelo backend, de uma tentativa concluida no
// provedor nao poder ser declarada assinada. Ver api/_lib/bryEasySign.js.
export const BRY_EVIDENCE_GAP_MACHINE_READABLE = 'bry_evidence_not_machine_readable'

// Documento elegivel: tipo suportado e autoria rastreavel. Documentos legados
// sem `created_by` seguem apenas pela via manual.
export function isClinicalSignatureEligible(record = {}) {
  return CLINICAL_SIGNATURE_ELIGIBLE_TYPES.includes(record.document_type) && Boolean(record.created_by)
}

// Decide, de forma pura e testavel, o que a tela pode oferecer.
// Nenhuma decisao de autorizacao real depende disto: o backend reconfere tudo.
// Aqui apenas evitamos oferecer acoes que seriam recusadas.
export function clinicalSignatureActionState({
  record = {},
  attempt = null,
  integration = null,
  viewerId = '',
  evidenceAvailable = true,
} = {}) {
  const base = {
    canRequest:false,
    canReconcile:false,
    canRetry:false,
    canAbandon:false,
    canOpenSigned:false,
    canOpenArtifact:false,
    label:'',
    tone:'muted',
    note:'',
  }

  if (!evidenceAvailable) {
    return { ...base, label:'Status digital indisponível', note:'A via manual não foi afetada.' }
  }
  if (!isClinicalSignatureEligible(record)) {
    return { ...base, label:'Assinatura digital não disponível para este documento', note:'Use a via manual.' }
  }

  const isAuthor = Boolean(viewerId) && viewerId === record.created_by
  const available = Boolean(integration?.available)

  if (!attempt) {
    if (!available) {
      return {
        ...base,
        label:'Assinatura digital não configurada',
        note:'Enquanto a integração não estiver disponível, imprima e assine manualmente.',
      }
    }
    if (!isAuthor) {
      return {
        ...base,
        label:'Assinatura digital pendente',
        note:'Somente o profissional que emitiu o documento pode assiná-lo.',
      }
    }
    return { ...base, canRequest:true, label:'Pronta para assinar', tone:'pending' }
  }

  if (attempt.status === 'pending') {
    if (attempt.dispatchState === 'unknown') {
      return {
        ...base,
        canReconcile:isAuthor,
        canAbandon:isAuthor,
        label:'Resultado desconhecido na BRy',
        tone:'failed',
        note:'Não reenviamos automaticamente para não cobrar duas vezes. Atualize o status ou encerre a tentativa.',
      }
    }
    if (attempt.evidenceGapCode) {
      return {
        ...base,
        canReconcile:isAuthor,
        canOpenArtifact:Boolean(attempt.hasStoredArtifact),
        label:'Assinada na BRy · evidência pendente de homologação',
        tone:'pending',
        note:'O arquivo devolvido pela BRy foi guardado, mas a plataforma ainda não pode declarar assinatura qualificada.',
      }
    }
    return {
      ...base,
      canReconcile:isAuthor,
      label:'Assinatura em processamento',
      tone:'pending',
      note:'Conclua a assinatura na página da BRy e atualize o status.',
    }
  }

  if (attempt.status === 'signed') {
    // `evidenceComplete` e calculado no backend sobre a linha do banco.
    if (!attempt.evidenceComplete) {
      return { ...base, label:'Evidência digital inconsistente', tone:'failed', note:'Use a via manual até a revisão.' }
    }
    return { ...base, canOpenSigned:true, label:'Assinado digitalmente', tone:'signed' }
  }

  const terminalLabel = attempt.status === 'cancelled' ? 'Assinatura cancelada' : 'Falha na assinatura'
  return {
    ...base,
    canRetry:isAuthor && available,
    canOpenArtifact:Boolean(attempt.hasStoredArtifact),
    label:terminalLabel,
    tone:attempt.status === 'cancelled' ? 'muted' : 'failed',
    note:attempt.failureMessage || '',
  }
}

// Agrupa as tentativas devolvidas pelo backend (camelCase) por documento,
// preferindo uma assinatura com evidencia completa sobre tentativas mais novas.
// Assim uma falha posterior nunca esconde uma assinatura valida.
export function latestAttemptByDocument(attempts = []) {
  const grouped = attempts.reduce((result, attempt) => {
    if (!attempt?.documentId) return result
    if (!result[attempt.documentId]) result[attempt.documentId] = []
    result[attempt.documentId].push(attempt)
    return result
  }, {})
  return Object.entries(grouped).reduce((result, [documentId, list]) => {
    const ordered = [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    result[documentId] = ordered.find(attempt => attempt.evidenceComplete) || ordered[0]
    return result
  }, {})
}
