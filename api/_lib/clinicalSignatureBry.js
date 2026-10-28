// api/_lib/clinicalSignatureBry.js
// Orquestracao server-side da assinatura clinica pela BRy Easy Sign.
//
// Invariantes que este arquivo sustenta:
//  - nada vindo do navegador e confiado: ownerId, autoria, CRM, CPF, caminhos e
//    status sao sempre relidos do banco com a service role;
//  - o documento clinico (`clinical_documents`) nunca e alterado;
//  - cada envio e uma tentativa append-only e idempotente;
//  - o webhook nao e fonte de verdade: so dispara reconciliacao autenticada;
//  - uma tentativa so poderia virar `signed` com PDF persistido, SHA-256 e
//    evidencias completas do certificado -- hoje impossivel (ver
//    BRY_EVIDENCE_GAP_MACHINE_READABLE), entao ela permanece pendente com
//    motivo auditavel em vez de declarar assinatura que nao pode comprovar;
//  - o link individual de assinatura e sensivel: devolvido somente ao proprio
//    profissional, nunca persistido nem registrado em log.

import {
  decryptPayload,
  fetchEncryptedProfile,
  getAdminSupabase,
  getAuthenticatedUser,
} from './secureProfile.js'
import {
  BRY_EVIDENCE_GAP_MACHINE_READABLE,
  BryEasySignError,
  bryEasySignConfig,
  buildEnvelopePayload,
  createEnvelope,
  downloadEvidenceReport,
  downloadSignedDocument,
  fetchEnvelope,
  mapEnvelopeToInternalTransition,
  parseBryWebhookNotification,
  publicBryEasySignState,
  webhookSecretMatches,
} from './bryEasySign.js'
import {
  assertSafeClinicalSignatureConnection,
  buildClinicalSignatureEnvelope,
  buildClinicalSignedFilePath,
  CLINICAL_SIGNATURE_RENDERING_VERSION,
  clinicalSignatureEvidenceComplete,
  hashClinicalSignatureEnvelope,
} from './clinicalSignature.js'
import { renderClinicalDocumentPdf, sha256Hex } from './clinicalDocumentPdf.js'
import { createClient } from '@supabase/supabase-js'

export const BRY_PROVIDER = 'bry_easy_sign'
const SIGNED_BUCKET = 'clinical-signatures'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ARTIFACT_URL_TTL_SECONDS = 60

// Ponto de injecao usado SOMENTE pelos testes: em producao as dependencias
// reais sao sempre as default. Nenhum teste faz chamada real a BRy ou ao
// Supabase, e nenhuma dependencia e configuravel por requisicao.
export const defaultClinicalSignatureDeps = Object.freeze({
  context:clinicalSignatureContext,
  config:bryEasySignConfig,
  loadSigner:loadSignerIdentity,
  renderPdf:renderClinicalDocumentPdf,
  bry:Object.freeze({ createEnvelope, fetchEnvelope, downloadSignedDocument, downloadEvidenceReport }),
})

const ATTEMPT_PUBLIC_FIELDS = [
  'id', 'document_id', 'status', 'created_at', 'updated_at', 'provider',
  'provider_envelope_status', 'provider_environment', 'dispatch_state',
  'evidence_gap_code', 'reconciled_at', 'signed_file_path', 'signed_file_sha256',
  'evidence_report_path', 'rendered_pdf_sha256', 'signature_standard',
  'certificate_subject', 'certificate_serial', 'certificate_issuer',
  'certificate_valid_from', 'certificate_valid_until', 'signed_at',
  'validation_url', 'failure_code', 'failure_message',
].join(', ')

function httpError(message, statusCode, code = null) {
  return Object.assign(new Error(message), { statusCode, publicCode:code })
}

// ---------------------------------------------------------------------------
// Contexto autenticado
// ---------------------------------------------------------------------------

function bearer(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  return String(header).startsWith('Bearer ') ? String(header).slice(7) : ''
}

// Toda acao (exceto o webhook publico) exige sessao Supabase valida, clinica
// resolvida pelo banco e acesso clinico confirmado pelas proprias RPCs.
export async function clinicalSignatureContext(req) {
  const token = bearer(req)
  if (!token) throw httpError('Sessao ausente.', 401)
  const user = await getAuthenticatedUser(req)

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) throw httpError('Supabase nao configurado.', 500)
  const scoped = createClient(supabaseUrl, supabaseAnonKey, {
    global:{ headers:{ Authorization:`Bearer ${token}` } },
    auth:{ persistSession:false, autoRefreshToken:false },
  })

  const { data:ownerId, error:ownerError } = await scoped.rpc('data_owner_id')
  if (ownerError || !ownerId) throw httpError('Nao foi possivel identificar a clinica.', 403)
  const { data:clinicalAccess, error:accessError } = await scoped.rpc('has_clinical_access')
  if (accessError || clinicalAccess !== true) {
    throw httpError('Seu perfil nao tem acesso clinico.', 403)
  }

  return { user, ownerId, scoped, admin:getAdminSupabase() }
}

// ---------------------------------------------------------------------------
// Leitura de estado
// ---------------------------------------------------------------------------

function missingRelation(error) {
  return ['42P01', 'PGRST205', 'PGRST204', '42703'].includes(String(error?.code || ''))
}

// Estado publico: flag resolvida no backend + tentativas do documento.
// Nunca inclui token, credencial, caminho absoluto de storage ou link BRy.
export async function clinicalSignatureState({ admin, ownerId, documentIds = [], deps = defaultClinicalSignatureDeps }) {
  const config = deps.config()
  const integration = publicBryEasySignState(config)
  const ids = documentIds.filter(id => UUID_PATTERN.test(String(id || '')))
  if (ids.length === 0) return { integration, attempts:[], evidenceAvailable:true }

  const { data, error } = await admin
    .from('clinical_document_signatures')
    .select(ATTEMPT_PUBLIC_FIELDS)
    .eq('user_id', ownerId)
    .in('document_id', ids)
    .order('created_at', { ascending:false })

  if (error) {
    // Migration ainda nao aplicada: a via manual nao pode ser bloqueada.
    if (missingRelation(error)) return { integration, attempts:[], evidenceAvailable:false }
    throw error
  }
  return { integration, attempts:(data || []).map(publicAttempt), evidenceAvailable:true }
}

// Expoe somente o necessario para a UI decidir estados; o caminho do artefato
// virou booleano para nao vazar a topologia do bucket.
export function publicAttempt(row) {
  if (!row) return null
  return {
    id:row.id,
    documentId:row.document_id,
    status:row.status,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    envelopeStatus:row.provider_envelope_status || null,
    environment:row.provider_environment || null,
    dispatchState:row.dispatch_state || null,
    evidenceGapCode:row.evidence_gap_code || null,
    reconciledAt:row.reconciled_at || null,
    hasStoredArtifact:Boolean(row.signed_file_path && row.signed_file_sha256),
    // Avaliado no servidor: a tela nunca deduz assinatura concluida sozinha.
    evidenceComplete:clinicalSignatureEvidenceComplete(row),
    hasEvidenceReport:Boolean(row.evidence_report_path && row.evidence_report_sha256),
    signatureStandard:row.signature_standard || null,
    certificateSubject:row.certificate_subject || null,
    certificateSerial:row.certificate_serial || null,
    certificateIssuer:row.certificate_issuer || null,
    certificateValidFrom:row.certificate_valid_from || null,
    certificateValidUntil:row.certificate_valid_until || null,
    signedAt:row.signed_at || null,
    validationUrl:row.validation_url || null,
    failureCode:row.failure_code || null,
    failureMessage:row.failure_message || null,
  }
}

async function loadAttempt(admin, ownerId, attemptId) {
  const { data, error } = await admin
    .from('clinical_document_signatures')
    .select('*')
    .eq('user_id', ownerId)
    .eq('id', attemptId)
    .maybeSingle()
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Identidade do signatario
// ---------------------------------------------------------------------------

async function loadSignerIdentity(user) {
  const record = await fetchEncryptedProfile(user.id)
  const profile = record?.encrypted_payload ? decryptPayload(record.encrypted_payload) : null
  const doctor = profile?.doctor || {}
  return {
    userId:user.id,
    name:String(doctor.fullName || '').trim(),
    registration:String(doctor.registrationId || '').trim(),
    council:'CRM',
    cpf:String(doctor.cpf || '').trim(),
    rqe:String(doctor.rqe || '').trim(),
    specialty:String(doctor.specialty || '').trim(),
    registrationState:String(profile?.clinic?.state || '').trim(),
  }
}

// ---------------------------------------------------------------------------
// Conexao
// ---------------------------------------------------------------------------

// A conexao guarda somente metadados + referencia opaca ao segredo do cofre.
// O navegador nunca escolhe provedor, modo ou credencial.
async function ensureConnection({ admin, ownerId, user, signer, config }) {
  const safe = assertSafeClinicalSignatureConnection(
    { provider:BRY_PROVIDER, signingMode:'remote_icp_brasil' },
    { id:config.credentialId, store:'vault' },
  )

  const { data:existing, error } = await admin
    .from('clinical_signature_connections')
    .select('*')
    .eq('user_id', ownerId)
    .eq('professional_user_id', user.id)
    .in('status', ['pending', 'active'])
    .maybeSingle()
  if (error && !missingRelation(error)) throw error
  if (error) throw httpError('A estrutura de assinatura clinica ainda nao foi aplicada no banco.', 503, 'migration_pendente')

  if (existing) {
    // Credencial, ambiente ou modo diferentes => rotacao exige NOVA conexao.
    const drifted = existing.credential_reference !== safe.credentialReference
      || (existing.provider_environment && existing.provider_environment !== config.environment)
      || (existing.requested_signature_mode && existing.requested_signature_mode !== config.signatureMode)
    if (drifted) {
      throw httpError(
        'A configuracao do provedor mudou desde a conexao atual. Revogue a conexao e conecte novamente antes de assinar.',
        409, 'conexao_desatualizada',
      )
    }
    if (existing.status !== 'active') {
      const { error:activateError } = await admin
        .from('clinical_signature_connections')
        .update({ status:'active', last_error_code:null, last_error_message:null })
        .eq('id', existing.id)
      if (activateError) throw activateError
      return { ...existing, status:'active' }
    }
    return existing
  }

  const { data:created, error:insertError } = await admin
    .from('clinical_signature_connections')
    .insert({
      user_id:ownerId,
      professional_user_id:user.id,
      provider:safe.provider,
      signing_mode:safe.signingMode,
      credential_reference:safe.credentialReference,
      professional_name:signer.name,
      professional_registration:signer.registration,
      professional_council:signer.council || 'CRM',
      status:'active',
      provider_environment:config.environment,
      requested_signature_mode:config.signatureMode,
      requested_signature_profile:config.signatureProfile || null,
    })
    .select('*')
    .single()
  if (insertError) throw translateDatabaseError(insertError)
  return created
}

// Mensagens do banco podem citar estrutura interna; traduzimos para texto
// acionavel sem expor detalhe de schema.
function translateDatabaseError(error) {
  const message = String(error?.message || '')
  if (message.includes('ja possui tentativa pendente')) {
    return httpError('Este documento ja tem uma assinatura pendente ou valida.', 409, 'tentativa_em_andamento')
  }
  if (message.includes('nao pertencem ao mesmo escopo')) {
    return httpError('A autoria do documento nao corresponde a identidade profissional cadastrada. Atualize o perfil seguro ou emita um novo documento.', 409, 'identidade_divergente')
  }
  if (message.includes('nao esta ativo')) {
    return httpError('A conexao de assinatura nao esta ativa para este profissional.', 409, 'conexao_inativa')
  }
  if (message.includes('imutavel')) {
    return httpError('Esta tentativa de assinatura e imutavel.', 409, 'tentativa_imutavel')
  }
  if (String(error?.code || '') === '23505') {
    return httpError('Esta solicitacao de assinatura ja foi registrada.', 409, 'solicitacao_duplicada')
  }
  if (missingRelation(error)) {
    return httpError('A estrutura de assinatura clinica ainda nao foi aplicada no banco.', 503, 'migration_pendente')
  }
  return httpError('Nao foi possivel registrar a tentativa de assinatura.', 500)
}

// ---------------------------------------------------------------------------
// Solicitar assinatura
// ---------------------------------------------------------------------------

export async function requestClinicalSignature(req, deps = defaultClinicalSignatureDeps) {
  const { user, ownerId, admin } = await deps.context(req)
  const config = deps.config()
  if (!config.ready) {
    // Falha fechada: sem configuracao valida a integracao nao existe para a UI.
    throw httpError('A assinatura digital pela BRy nao esta disponivel. Use a via manual.', 409, 'integracao_indisponivel')
  }

  const documentId = String(req.body?.documentId || '').trim()
  const requestId = String(req.body?.requestId || '').trim()
  if (!UUID_PATTERN.test(documentId)) throw httpError('Documento invalido.', 400)
  if (!UUID_PATTERN.test(requestId)) throw httpError('Identificador da solicitacao invalido.', 400)

  // O documento e relido do banco: nada do corpo da requisicao e aproveitado.
  const { data:document, error:documentError } = await admin
    .from('clinical_documents')
    .select('*')
    .eq('id', documentId)
    .eq('user_id', ownerId)
    .maybeSingle()
  if (documentError) throw translateDatabaseError(documentError)
  if (!document) throw httpError('Documento clinico nao encontrado nesta clinica.', 404)
  if (document.created_by !== user.id) {
    throw httpError('Somente o profissional que emitiu o documento pode assina-lo.', 403, 'nao_autor')
  }

  const signer = await deps.loadSigner(user)
  // Confere created_by, nome, conselho, CRM e CPF contra o snapshot imutavel.
  let envelope
  try {
    envelope = buildClinicalSignatureEnvelope({ document, signer })
  } catch (error) {
    throw httpError(error.message, 409, 'identidade_divergente')
  }
  const payloadSha256 = hashClinicalSignatureEnvelope(envelope)

  const connection = await ensureConnection({ admin, ownerId, user, signer, config })

  // --- reserva idempotente da tentativa ------------------------------------
  let attempt = await reserveAttempt({
    admin, ownerId, user, document, connection, requestId, payloadSha256, config,
  })

  if (attempt.provider_request_id) {
    // Mesma solicitacao reapresentada e envelope ja criado: nao reenvia e nao
    // consome credito. Recupera o link na BRy para o proprio profissional.
    const reused = await recoverSigningLink({ admin, ownerId, attempt, config, deps })
    await audit(admin, ownerId, user.id, 'request_clinical_signature', {
      document_id:documentId, attempt_id:attempt.id, outcome:'reused',
    })
    return reused
  }
  if (attempt.dispatch_state === 'unknown') {
    throw httpError(
      'Esta solicitacao ficou com resultado desconhecido na BRy. Atualize o status ou encerre a tentativa antes de tentar de novo.',
      409, 'resultado_desconhecido',
    )
  }

  // --- PDF deterministico --------------------------------------------------
  let rendered
  try {
    rendered = await deps.renderPdf(document)
  } catch (error) {
    // Nada foi enviado: encerra a tentativa para nao travar o documento.
    await terminalize(admin, attempt, {
      status:'failed',
      failureCode:'render_failed',
      failureMessage:'Nao foi possivel gerar o PDF do documento para assinatura.',
    })
    throw httpError('Nao foi possivel gerar o PDF do documento para assinatura.', 500, 'render_falhou')
  }

  let bryPayload
  try {
    bryPayload = buildEnvelopePayload({
      documentType:document.document_type,
      fileName:`${document.document_type}-${document.id}.pdf`,
      pdfBase64:rendered.buffer.toString('base64'),
      envelopeName:`SurgiMetrics ${document.document_type} ${document.id}`,
      clientName:String(document.clinic_name || document.author_name || 'SurgiMetrics').slice(0, 120),
      signer,
      signatureMode:config.signatureMode,
      signatureProfile:config.signatureProfile,
      hashAlgorithm:config.hashAlgorithm,
    })
  } catch (error) {
    await terminalize(admin, attempt, {
      status:'failed',
      failureCode:'payload_invalid',
      failureMessage:'Dados profissionais insuficientes para montar o envelope.',
    })
    throw httpError(error.message, 409, 'payload_invalido')
  }

  await updatePending(admin, attempt.id, { rendered_pdf_sha256:rendered.sha256 })

  // --- criacao do envelope na BRy -----------------------------------------
  let creation
  try {
    creation = await deps.bry.createEnvelope(config, bryPayload)
  } catch (error) {
    if (error instanceof BryEasySignError && error.ambiguous) {
      // Sem idempotency key na BRy, NAO reenviamos: gravamos resultado
      // desconhecido e deixamos a reconciliacao/encerramento para uma acao
      // humana explicita.
      await updatePending(admin, attempt.id, {
        dispatch_state:'unknown',
        failure_code:'dispatch_result_unknown',
        failure_message:'A BRy nao confirmou a criacao do envelope. O credito pode ter sido consumido.',
      })
      await audit(admin, ownerId, user.id, 'request_clinical_signature', {
        document_id:documentId, attempt_id:attempt.id, outcome:'ambiguous',
      })
      throw httpError(
        'A BRy nao confirmou a criacao da assinatura. Nao reenviamos automaticamente para nao duplicar cobranca. Use "Atualizar status" ou encerre a tentativa.',
        504, 'resultado_desconhecido',
      )
    }
    await terminalize(admin, attempt, {
      status:'failed',
      failureCode:`provider_${error?.kind || 'error'}`,
      failureMessage:error?.message || 'A BRy recusou a solicitacao.',
    })
    await audit(admin, ownerId, user.id, 'request_clinical_signature', {
      document_id:documentId, attempt_id:attempt.id, outcome:'failed',
    })
    throw httpError(error?.message || 'A BRy recusou a solicitacao.', 502, 'provedor_recusou')
  }

  await updatePending(admin, attempt.id, {
    provider_request_id:creation.envelopeId,
    provider_document_id:creation.documentId,
    provider_signer_id:creation.signerId,
    provider_envelope_status:creation.envelopeStatus,
    dispatch_state:'sent',
    failure_code:null,
    failure_message:null,
  })
  await audit(admin, ownerId, user.id, 'request_clinical_signature', {
    document_id:documentId, attempt_id:attempt.id, outcome:'sent', environment:config.environment,
  })

  attempt = await loadAttempt(admin, ownerId, attempt.id)
  return {
    attempt:publicAttempt(attempt),
    // Unico lugar em que o link sai do servidor, e so para o proprio autor.
    signingUrl:creation.signingUrl,
  }
}

async function reserveAttempt({ admin, ownerId, user, document, connection, requestId, payloadSha256, config }) {
  // A chave idempotente e consultada ANTES do insert: o trigger de escopo
  // recusa qualquer nova tentativa enquanto existir uma pendente para o
  // documento, entao a mesma solicitacao reapresentada nunca chegaria a
  // produzir violacao de unicidade -- ela seria lida como "ja em andamento".
  const { data:existing, error:lookupError } = await admin
    .from('clinical_document_signatures')
    .select('*')
    .eq('user_id', ownerId)
    .eq('document_id', document.id)
    .eq('request_id', requestId)
    .maybeSingle()
  if (lookupError) throw translateDatabaseError(lookupError)
  if (existing) {
    if (existing.document_payload_sha256 !== payloadSha256) {
      throw httpError('Esta solicitacao foi reapresentada com conteudo diferente.', 409, 'solicitacao_divergente')
    }
    if (existing.status !== 'pending') {
      throw httpError('Esta solicitacao de assinatura ja foi encerrada.', 409, 'tentativa_encerrada')
    }
    return existing
  }

  const { data, error } = await admin
    .from('clinical_document_signatures')
    .insert({
      user_id:ownerId,
      document_id:document.id,
      requested_by:user.id,
      signer_user_id:user.id,
      connection_id:connection.id,
      request_id:requestId,
      provider:BRY_PROVIDER,
      status:'pending',
      rendering_version:CLINICAL_SIGNATURE_RENDERING_VERSION,
      document_payload_sha256:payloadSha256,
      dispatch_state:'reserved',
      provider_environment:config.environment,
    })
    .select('*')
    .single()

  if (!error) return data

  // Corrida: dois cliques simultaneos com a mesma chave. O vencedor ja gravou,
  // entao reaproveitamos a tentativa dele em vez de criar outra.
  if (String(error.code || '') === '23505') {
    const { data:raced } = await admin
      .from('clinical_document_signatures')
      .select('*')
      .eq('user_id', ownerId)
      .eq('document_id', document.id)
      .eq('request_id', requestId)
      .maybeSingle()
    if (raced?.status === 'pending' && raced.document_payload_sha256 === payloadSha256) return raced
  }
  throw translateDatabaseError(error)
}

// Recupera o link na BRy sem criar envelope novo (nenhum credito consumido).
async function recoverSigningLink({ admin, ownerId, attempt, config, deps = defaultClinicalSignatureDeps }) {
  let state = null
  try {
    state = await deps.bry.fetchEnvelope(config, attempt.provider_request_id)
  } catch {
    // Indisponibilidade da BRy nao pode apagar o estado local.
    state = null
  }
  if (state?.envelopeStatus && state.envelopeStatus !== attempt.provider_envelope_status) {
    await updatePending(admin, attempt.id, { provider_envelope_status:state.envelopeStatus })
  }
  const fresh = await loadAttempt(admin, ownerId, attempt.id)
  return {
    attempt:publicAttempt(fresh),
    signingUrl:state?.signingUrl || null,
    reused:true,
  }
}

// ---------------------------------------------------------------------------
// Reconciliacao autenticada
// ---------------------------------------------------------------------------

export async function reconcileClinicalSignature(req, deps = defaultClinicalSignatureDeps) {
  const { user, ownerId, admin } = await deps.context(req)
  const attemptId = String(req.body?.attemptId || '').trim()
  if (!UUID_PATTERN.test(attemptId)) throw httpError('Tentativa invalida.', 400)

  const attempt = await loadAttempt(admin, ownerId, attemptId)
  if (!attempt) throw httpError('Tentativa de assinatura nao encontrada nesta clinica.', 404)
  if (attempt.signer_user_id !== user.id) {
    throw httpError('Somente o profissional signatario pode atualizar esta assinatura.', 403, 'nao_autor')
  }

  const result = await reconcileAttempt({ admin, ownerId, attempt, deps })
  await audit(admin, ownerId, user.id, 'reconcile_clinical_signature', {
    attempt_id:attemptId, document_id:attempt.document_id, outcome:result.outcome,
  })
  const fresh = await loadAttempt(admin, ownerId, attemptId)
  return { attempt:publicAttempt(fresh), outcome:result.outcome }
}

// Consulta a BRy com JWT e aplica a transicao. Idempotente e tolerante a
// chamadas repetidas, atrasadas ou fora de ordem: a decisao vem sempre do
// estado atual lido do provedor, nunca de um payload recebido.
export async function reconcileAttempt({ admin, ownerId, attempt, deps = defaultClinicalSignatureDeps }) {
  const config = deps.config()
  if (!config.ready) throw httpError('Integracao BRy indisponivel.', 409, 'integracao_indisponivel')
  if (attempt.status !== 'pending') return { outcome:'ja_terminal' }
  if (!attempt.provider_request_id) {
    return { outcome:attempt.dispatch_state === 'unknown' ? 'resultado_desconhecido' : 'sem_envelope' }
  }

  const state = await deps.bry.fetchEnvelope(config, attempt.provider_request_id)
  const transition = mapEnvelopeToInternalTransition({ attempt, envelopeState:state })

  if (transition.action === 'terminalize') {
    await terminalize(admin, attempt, {
      status:transition.status,
      failureCode:transition.failureCode,
      failureMessage:transition.failureMessage,
      envelopeStatus:transition.envelopeStatus,
    })
    return { outcome:transition.status }
  }

  if (transition.action === 'collect_artifact') {
    await collectArtifact({ admin, ownerId, attempt, config, transition, deps })
    return { outcome:'evidencia_pendente' }
  }

  await updatePending(admin, attempt.id, {
    provider_envelope_status:transition.envelopeStatus || attempt.provider_envelope_status,
    reconciled_at:new Date().toISOString(),
  })
  return { outcome:'aguardando' }
}

// Baixa, confere e guarda o artefato final em bucket privado -- sem declarar
// assinatura concluida, porque a evidencia verificavel do certificado nao esta
// disponivel na API publica da BRy.
async function collectArtifact({ admin, ownerId, attempt, config, transition, deps = defaultClinicalSignatureDeps }) {
  const alreadyStored = Boolean(attempt.signed_file_path && attempt.signed_file_sha256)
  if (!alreadyStored) {
    const pdf = await deps.bry.downloadSignedDocument(config, attempt.provider_request_id, attempt.provider_document_id)
    const path = buildClinicalSignedFilePath({
      ownerId, documentId:attempt.document_id, signatureId:attempt.id,
    })
    const { error:uploadError } = await admin.storage.from(SIGNED_BUCKET).upload(path, pdf, {
      contentType:'application/pdf',
      // Nunca sobrescreve artefato ja assinado.
      upsert:false,
    })
    if (uploadError && !String(uploadError.message || '').toLowerCase().includes('exists')) {
      throw httpError('Nao foi possivel guardar o PDF assinado.', 502, 'armazenamento_falhou')
    }
    await updatePending(admin, attempt.id, {
      signed_file_path:path,
      signed_file_sha256:sha256Hex(pdf),
    })
  }

  // Relatorio de evidencias (PDF) arquivado junto. Nao substitui evidencia
  // legivel por maquina, mas preserva a prova que a BRy oferece hoje.
  if (!attempt.evidence_report_path) {
    try {
      const report = await deps.bry.downloadEvidenceReport(config, attempt.provider_request_id, attempt.provider_document_id)
      const reportPath = `${SIGNED_BUCKET}/${ownerId}/${attempt.document_id}/${attempt.id}-report.pdf`
      const { error:reportError } = await admin.storage.from(SIGNED_BUCKET).upload(reportPath, report, {
        contentType:'application/pdf', upsert:false,
      })
      if (!reportError || String(reportError.message || '').toLowerCase().includes('exists')) {
        await updatePending(admin, attempt.id, {
          evidence_report_path:reportPath,
          evidence_report_sha256:sha256Hex(report),
        })
      }
    } catch {
      // Relatorio indisponivel nao invalida o artefato ja guardado.
    }
  }

  await updatePending(admin, attempt.id, {
    provider_envelope_status:transition.envelopeStatus,
    // Nao gravamos `signed_at` da BRy como evidencia terminal: ele e apenas o
    // instante informado, sem certificado verificavel que o sustente.
    evidence_gap_code:transition.evidenceGapCode || BRY_EVIDENCE_GAP_MACHINE_READABLE,
    reconciled_at:new Date().toISOString(),
  })
}

async function updatePending(admin, attemptId, patch) {
  const { error } = await admin
    .from('clinical_document_signatures')
    .update(patch)
    .eq('id', attemptId)
    .eq('status', 'pending')
  if (error) throw translateDatabaseError(error)
}

async function terminalize(admin, attempt, { status, failureCode, failureMessage, envelopeStatus }) {
  const { error } = await admin
    .from('clinical_document_signatures')
    .update({
      status,
      failure_code:failureCode || null,
      failure_message:failureMessage ? String(failureMessage).slice(0, 300) : null,
      ...(envelopeStatus ? { provider_envelope_status:envelopeStatus } : {}),
      reconciled_at:new Date().toISOString(),
    })
    .eq('id', attempt.id)
    .eq('status', 'pending')
  if (error) throw translateDatabaseError(error)
}

// ---------------------------------------------------------------------------
// Encerrar tentativa de resultado desconhecido
// ---------------------------------------------------------------------------

// Unica saida para um POST ambiguo. Exige confirmacao explicita porque o
// credito na BRy pode ter sido consumido e um envelope orfao pode existir.
export async function abandonClinicalSignature(req, deps = defaultClinicalSignatureDeps) {
  const { user, ownerId, admin } = await deps.context(req)
  const attemptId = String(req.body?.attemptId || '').trim()
  if (!UUID_PATTERN.test(attemptId)) throw httpError('Tentativa invalida.', 400)
  if (req.body?.confirm !== true) throw httpError('Confirmacao explicita obrigatoria.', 400)

  const attempt = await loadAttempt(admin, ownerId, attemptId)
  if (!attempt) throw httpError('Tentativa de assinatura nao encontrada nesta clinica.', 404)
  if (attempt.signer_user_id !== user.id) {
    throw httpError('Somente o profissional signatario pode encerrar esta tentativa.', 403, 'nao_autor')
  }
  if (attempt.status !== 'pending') throw httpError('Esta tentativa ja esta encerrada.', 409)
  if (attempt.dispatch_state !== 'unknown') {
    throw httpError('Esta tentativa nao esta com resultado desconhecido.', 409, 'encerramento_nao_aplicavel')
  }

  await terminalize(admin, attempt, {
    status:'failed',
    failureCode:'dispatch_result_unknown_abandoned',
    failureMessage:'Tentativa encerrada pelo profissional apos resultado desconhecido na BRy.',
  })
  await audit(admin, ownerId, user.id, 'abandon_clinical_signature', {
    attempt_id:attemptId, document_id:attempt.document_id,
  })
  const fresh = await loadAttempt(admin, ownerId, attemptId)
  return { attempt:publicAttempt(fresh) }
}

// ---------------------------------------------------------------------------
// Abertura auditada do artefato
// ---------------------------------------------------------------------------

export async function openClinicalSignatureArtifact(req, deps = defaultClinicalSignatureDeps) {
  const { user, ownerId, admin } = await deps.context(req)
  const attemptId = String(req.body?.attemptId || '').trim()
  const kind = String(req.body?.kind || 'signed').trim()
  if (!UUID_PATTERN.test(attemptId)) throw httpError('Tentativa invalida.', 400)
  if (!['signed', 'report'].includes(kind)) throw httpError('Tipo de artefato invalido.', 400)

  const attempt = await loadAttempt(admin, ownerId, attemptId)
  if (!attempt) throw httpError('Tentativa de assinatura nao encontrada nesta clinica.', 404)

  const path = kind === 'signed' ? attempt.signed_file_path : attempt.evidence_report_path
  const expectedHash = kind === 'signed' ? attempt.signed_file_sha256 : attempt.evidence_report_sha256
  if (!path || !expectedHash) throw httpError('Nao existe artefato guardado para esta tentativa.', 404, 'sem_artefato')

  // O caminho nunca vem do cliente: e recomputado e comparado ao gravado.
  if (kind === 'signed') {
    const canonical = buildClinicalSignedFilePath({
      ownerId, documentId:attempt.document_id, signatureId:attempt.id,
    })
    if (canonical !== path) throw httpError('Caminho do artefato inconsistente.', 409, 'caminho_inconsistente')
  }

  const { data, error } = await admin.storage.from(SIGNED_BUCKET).createSignedUrl(path, ARTIFACT_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) throw httpError('Nao foi possivel abrir o artefato assinado.', 502)

  await audit(admin, ownerId, user.id, 'open_clinical_signature_artifact', {
    attempt_id:attemptId, document_id:attempt.document_id, kind,
  })
  return { url:data.signedUrl, expiresInSeconds:ARTIFACT_URL_TTL_SECONDS, kind }
}

// ---------------------------------------------------------------------------
// Webhook publico (apenas notificacao)
// ---------------------------------------------------------------------------

// Roteado ANTES da autenticacao de usuario. Nao confia em nada do corpo alem
// do identificador do envelope, e sempre reconcilia consultando a BRy com JWT.
export async function handleBryWebhook(req, rawBody, deps = defaultClinicalSignatureDeps) {
  const config = deps.config()
  const provided = req.headers?.['x-bry-webhook-secret'] || req.query?.secret || ''
  if (!config.webhookSecret || !webhookSecretMatches(config, provided)) {
    // Fecha sem revelar se o segredo existe.
    return { statusCode:404, body:{ error:'Not found' } }
  }
  if (!config.ready) {
    // Aceita e descarta: nao enfileira trabalho que nao pode validar.
    return { statusCode:202, body:{ ok:true, ignored:'integracao_indisponivel' } }
  }

  const { envelopeIds, rejected } = parseBryWebhookNotification(rawBody)
  if (rejected) return { statusCode:202, body:{ ok:true, ignored:rejected } }

  const admin = deps.adminFactory ? deps.adminFactory() : getAdminSupabase()
  let reconciled = 0
  for (const envelopeId of envelopeIds) {
    const { data:rows, error } = await admin
      .from('clinical_document_signatures')
      .select('*')
      .eq('provider', BRY_PROVIDER)
      .eq('provider_request_id', envelopeId)
      .eq('status', 'pending')
    if (error) break
    for (const attempt of rows || []) {
      try {
        await reconcileAttempt({ admin, ownerId:attempt.user_id, attempt, deps })
        reconciled += 1
      } catch {
        // Callback nunca propaga erro: a BRy repetiria o envio sem que isso
        // mudasse o resultado. A reconciliacao manual continua disponivel.
      }
    }
  }
  return { statusCode:200, body:{ ok:true, reconciled } }
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

// Detalhes de auditoria nunca incluem link de assinatura, token ou CPF.
async function audit(admin, ownerId, actorId, action, details = {}) {
  const { error } = await admin.from('audit_logs').insert({
    user_id:ownerId,
    actor_id:actorId,
    action,
    entity_type:'clinical_document_signature',
    details,
  })
  if (error && !['42P01', 'PGRST204', 'PGRST205'].includes(String(error.code || ''))) {
    // Auditoria indisponivel nao deve derrubar a operacao clinica, mas fica
    // visivel no log do servidor.
    console.warn('[clinical-signature] auditoria indisponivel:', error.code)
  }
}
