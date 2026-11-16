export const CLINICAL_SIGNATURE_STATUS = {
  PENDING:'pending',
  SIGNED:'signed',
  FAILED:'failed',
  CANCELLED:'cancelled',
}

const STATUS_PRESENTATION = {
  pending:{ label:'Assinatura em andamento', tone:'pending' },
  signed:{ label:'Assinado', tone:'signed' },
  failed:{ label:'A assinatura não deu certo', tone:'failed' },
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
    return { label:'Precisa de revisão antes de usar', tone:'failed' }
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

export const CLINICAL_SIGNATURE_ELIGIBLE_TYPES = ['exam_request', 'simple_prescription', 'uploaded_pdf']

// Explicacao, para o profissional, de cada motivo auditavel de uma assinatura
// concluida no provedor ainda nao poder ser declarada. Ver api/_lib/bryVerify.js.
const EVIDENCE_GAP_NOTES = {
  verify_service_not_configured:'A confirmação automática da assinatura ainda não está configurada aqui.',
  verify_service_unavailable:'Não conseguimos confirmar agora. Tente atualizar o status mais tarde.',
  verify_signature_invalid:'Essa assinatura não foi confirmada como válida. Não use este documento como assinado.',
  verify_signature_not_pades:'O arquivo devolvido não está no formato de assinatura esperado.',
  verify_certificate_not_icp_brasil:'Não conseguimos confirmar que foi usado um certificado digital ICP-Brasil.',
  verify_certificate_evidence_incomplete:'Faltam informações do certificado para confirmar esta assinatura.',
  verify_timestamp_not_verified:'Pedimos a confirmação da data e hora da assinatura, mas ela ainda não veio.',
  verify_report_unavailable:'Não conseguimos guardar o comprovante desta assinatura. Atualize o status para tentar de novo.',
}

export function clinicalSignatureEvidenceGapNote(code) {
  return EVIDENCE_GAP_NOTES[code] || 'Ainda não conseguimos confirmar esta assinatura.'
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
        note:'Por enquanto, imprima e assine à mão.',
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
        label:'Não conseguimos confirmar o que aconteceu',
        tone:'failed',
        note:'Para não cobrar duas vezes sem querer, não tentamos de novo automaticamente. Atualize o status ou encerre esta tentativa.',
      }
    }
    if (attempt.evidenceGapCode) {
      // Assinada no provedor, mas ainda sem confirmação completa do
      // certificado: o arquivo é preservado e a tela diz exatamente o que falta.
      const invalid = attempt.evidenceGapCode === 'verify_signature_invalid'
      return {
        ...base,
        canReconcile:isAuthor,
        canOpenArtifact:Boolean(attempt.hasStoredArtifact),
        label:invalid ? 'A assinatura não foi aceita' : 'Assinado, confirmando os detalhes',
        tone:invalid ? 'failed' : 'pending',
        note:clinicalSignatureEvidenceGapNote(attempt.evidenceGapCode),
      }
    }
    return {
      ...base,
      // O link não fica guardado: reabrir a página é só consultar o estado
      // atual, sem criar um novo pedido nem gerar custo de novo.
      canOpenSigningPage:isAuthor,
      canReconcile:isAuthor,
      label:'Assinatura em andamento',
      tone:'pending',
      note:'Termine na página que abriu e depois atualize o status aqui.',
    }
  }

  if (attempt.status === 'signed') {
    // `evidenceComplete` e calculado no backend sobre a linha do banco.
    if (!attempt.evidenceComplete) {
      return { ...base, label:'Precisa de revisão antes de usar', tone:'failed', note:'Por enquanto, use a versão impressa.' }
    }
    return { ...base, canOpenSigned:true, label:'Assinado', tone:'signed' }
  }

  const terminalLabel = attempt.status === 'cancelled' ? 'Assinatura cancelada' : 'A assinatura não deu certo'
  return {
    ...base,
    canRetry:isAuthor && available,
    canOpenArtifact:Boolean(attempt.hasStoredArtifact),
    label:terminalLabel,
    tone:attempt.status === 'cancelled' ? 'muted' : 'failed',
    note:attempt.failureMessage || '',
  }
}

// Reduz os varios "can*" de clinicalSignatureActionState a um unico botao.
// Usado pela ficha do paciente, que so mostra selo + 1 acao e leva para a
// central de assinatura (Clinico -> Documentos) para o resto do fluxo.
export function clinicalSignaturePrimaryActionLabel(state = {}) {
  if (state.canRequest) return 'Assinar'
  if (state.canRetry) return 'Tentar de novo'
  if (state.canOpenSigningPage || state.canReconcile) return 'Acompanhar assinatura'
  if (state.canOpenSigned) return 'Ver documento assinado'
  if (state.canOpenArtifact) return 'Ver arquivo'
  return ''
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
