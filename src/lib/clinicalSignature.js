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

const BRAZIL_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

// A UF do registro é obrigatória no documento assinado (OID 2.16.76.1.4.2.2.2).
// O servidor recusa a assinatura sem ela, em vez de mandar uma UF errada num
// documento médico — então a tela precisa cobrar a mesma coisa, senão o
// profissional vê "identidade completa" e toma erro só na hora de assinar.
export function hasProfessionalState(profile = {}) {
  const registration = String(profile?.doctor?.registrationId || '').toUpperCase()
  const clinicState = String(profile?.clinic?.state || '').trim().toUpperCase()
  const match = registration.match(/\b([A-Z]{2})\b/)
  return Boolean((match && BRAZIL_STATES.includes(match[1])) || BRAZIL_STATES.includes(clinicState))
}

export function clinicalSignerReadiness(profile = {}) {
  const doctor = profile?.doctor || {}
  const missing = []
  if (!String(doctor.fullName || '').trim()) missing.push('nome completo')
  if (!String(doctor.registrationId || '').trim()) missing.push('CRM')
  else if (!hasProfessionalState(profile)) missing.push('UF no CRM (ex.: CRM-RS 12345)')
  if (!isValidCpf(doctor.cpf)) missing.push('CPF válido')
  return {
    ready:missing.length === 0,
    missing,
  }
}

export const CLINICAL_SIGNATURE_ELIGIBLE_TYPES = ['exam_request', 'simple_prescription']

// Explicacao, para o profissional, de cada motivo auditavel de uma assinatura
// concluida no provedor ainda nao poder ser declarada. Ver api/_lib/bryVerify.js.
const EVIDENCE_GAP_NOTES = {
  verify_service_not_configured:'A verificação da assinatura ainda não está configurada nesta instalação.',
  verify_service_unavailable:'O serviço de verificação da BRy não respondeu. Tente atualizar o status mais tarde.',
  verify_signature_invalid:'A verificação da BRy não considerou a assinatura válida. Não use este documento como assinado.',
  verify_signature_not_pades:'O arquivo devolvido não tem assinatura no padrão PAdES.',
  verify_certificate_evidence_incomplete:'A verificação não devolveu os dados completos do certificado.',
  verify_timestamp_not_verified:'Foi pedido carimbo do tempo, mas a verificação não o confirmou.',
}

export function clinicalSignatureEvidenceGapNote(code) {
  return EVIDENCE_GAP_NOTES[code] || 'A evidência da assinatura ainda não pôde ser confirmada.'
}

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
    canOpenSigningPage:false,
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
      // Assinada no provedor, mas sem evidência verificável do certificado:
      // o arquivo é preservado e a tela diz exatamente o que falta.
      const invalid = attempt.evidenceGapCode === 'verify_signature_invalid'
      return {
        ...base,
        canReconcile:isAuthor,
        canOpenArtifact:Boolean(attempt.hasStoredArtifact),
        label:invalid ? 'Assinatura não validada pela BRy' : 'Assinada na BRy · evidência pendente',
        tone:invalid ? 'failed' : 'pending',
        note:clinicalSignatureEvidenceGapNote(attempt.evidenceGapCode),
      }
    }
    return {
      ...base,
      // O link não fica guardado: reabrir a página é uma consulta ao provedor,
      // sem criar envelope novo nem consumir crédito.
      canOpenSigningPage:isAuthor,
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
