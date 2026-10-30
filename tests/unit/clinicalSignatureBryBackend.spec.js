import { expect, test } from '@playwright/test'
import {
  abandonClinicalSignature,
  clinicalSignatureLink,
  clinicalSignatureState,
  handleBryWebhook,
  openClinicalSignatureArtifact,
  reconcileClinicalSignature,
  requestClinicalSignature,
} from '../../api/_lib/clinicalSignatureBry.js'
import { BryEasySignError, bryEasySignConfig } from '../../api/_lib/bryEasySign.js'
import { BryVerifyError } from '../../api/_lib/bryVerify.js'
import {
  buildClinicalSignatureEnvelope,
  hashClinicalSignatureEnvelope,
} from '../../api/_lib/clinicalSignature.js'

// Mocks existem SOMENTE aqui: nenhum teste chama a BRy ou o Supabase de verdade.

const OWNER = '10000000-0000-4000-8000-000000000001'
const AUTHOR = '20000000-0000-4000-8000-000000000001'
const OTHER_DOCTOR = '20000000-0000-4000-8000-000000000002'
const DOCUMENT = '30000000-0000-4000-8000-000000000001'
const ATTEMPT = '60000000-0000-4000-8000-000000000001'
const CONNECTION = '50000000-0000-4000-8000-000000000001'
const CREDENTIAL = '70000000-0000-4000-8000-000000000001'
const ENVELOPE = '80000000-0000-4000-8000-000000000001'
const REQUEST_ID = '90000000-0000-4000-8000-000000000001'
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJicnkifQ.segredo-da-bry'

// ---------------------------------------------------------------------------
// Supabase falso em memoria
// ---------------------------------------------------------------------------

function matches(row, filters) {
  return filters.every(({ kind, column, value }) => {
    if (kind === 'eq') return String(row[column] ?? '') === String(value ?? '')
    if (kind === 'in') return value.map(String).includes(String(row[column] ?? ''))
    return true
  })
}

function fakeSupabase(tables = {}, { storage = {}, failTables = {} } = {}) {
  const db = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]))
  const calls = { inserts:[], updates:[], uploads:[], signedUrls:[] }

  function builder(table, { payload = null, mode = 'select' } = {}) {
    const filters = []
    const api = {
      select() { return api },
      order() { return api },
      limit() { return api },
      eq(column, value) { filters.push({ kind:'eq', column, value }); return api },
      in(column, value) { filters.push({ kind:'in', column, value }); return api },
      maybeSingle() { return api.then(result => ({ data:result.data?.[0] ?? null, error:result.error })) },
      single() {
        return api.then(result => ({
          data:result.data?.[0] ?? null,
          error:result.error || (result.data?.length ? null : { code:'PGRST116', message:'no rows' }),
        }))
      },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (failTables[table]) return { data:null, error:failTables[table] }
          if (!db[table]) db[table] = []
          if (mode === 'insert') {
            const unique = table === 'clinical_document_signatures' && db[table].some(row => row.user_id === payload.user_id
              && row.document_id === payload.document_id && row.request_id === payload.request_id)
            if (unique) return { data:null, error:{ code:'23505', message:'duplicate key' } }
            const row = { id:payload.id || ATTEMPT, created_at:'2026-10-28T10:00:00Z', ...payload }
            db[table].push(row)
            calls.inserts.push({ table, row })
            return { data:[row], error:null }
          }
          if (mode === 'update') {
            const target = db[table].filter(row => matches(row, filters))
            target.forEach(row => Object.assign(row, payload))
            calls.updates.push({ table, patch:payload, affected:target.length })
            return { data:target, error:null }
          }
          return { data:db[table].filter(row => matches(row, filters)), error:null }
        }).then(resolve, reject)
      },
    }
    return api
  }

  return {
    db,
    calls,
    from(table) {
      return {
        select() { return builder(table) },
        insert(payload) { return builder(table, { payload, mode:'insert' }) },
        update(payload) { return builder(table, { payload, mode:'update' }) },
      }
    },
    storage:{
      from(bucket) {
        return {
          async upload(path, buffer, options) {
            calls.uploads.push({ bucket, path, bytes:buffer?.length ?? 0, options })
            if (!storage.files) storage.files = {}
            storage.files[path] = buffer
            return storage.uploadError ? { error:storage.uploadError } : { data:{ path }, error:null }
          },
          async download(path) {
            const stored = storage.files?.[path]
            if (!stored) return { data:null, error:{ message:'not found' } }
            return { data:{ arrayBuffer:async () => stored }, error:null }
          },
          async createSignedUrl(path, ttl) {
            calls.signedUrls.push({ bucket, path, ttl })
            return storage.signedUrlError
              ? { data:null, error:storage.signedUrlError }
              : { data:{ signedUrl:`https://storage.test/${path}?token=abc` }, error:null }
          },
        }
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Dados base
// ---------------------------------------------------------------------------

const documentRow = {
  id:DOCUMENT,
  user_id:OWNER,
  patient_id:'40000000-0000-4000-8000-000000000001',
  created_by:AUTHOR,
  document_type:'exam_request',
  issue_date:'2026-10-28',
  patient_name:'Ana',
  author_name:'Dra. Vitória',
  author_registration:'CRM-RS 12345',
  author_council:'CRM',
  issuer_contact:'contato@clinica.test',
  issuer_address:'Av. Clínica, 100',
  clinic_name:'Clínica Exemplo',
  document_data:{ exams:['Hemograma'] },
  created_at:'2026-10-28T09:00:00Z',
}

const connectionRow = {
  id:CONNECTION,
  user_id:OWNER,
  professional_user_id:AUTHOR,
  provider:'bry_easy_sign',
  signing_mode:'remote_icp_brasil',
  credential_reference:`vault://${CREDENTIAL}`,
  professional_name:'Dra. Vitória',
  professional_registration:'CRM-RS 12345',
  professional_council:'CRM',
  status:'active',
  provider_environment:'homologation',
  requested_signature_mode:'QUALIFIED',
}

const signerIdentity = {
  userId:AUTHOR,
  name:'Dra. Vitória',
  registration:'CRM-RS 12345',
  council:'CRM',
  cpf:'529.982.247-25',
  specialty:'Cirurgia Plástica',
  registrationState:'RS',
}

// O hash da tentativa precisa ser o hash real do envelope canonico; qualquer
// valor arbitrario faria o backend tratar a solicitacao como divergente.
const PAYLOAD_SHA256 = hashClinicalSignatureEnvelope(
  buildClinicalSignatureEnvelope({ document:documentRow, signer:signerIdentity }),
)

const pendingAttempt = {
  id:ATTEMPT,
  user_id:OWNER,
  document_id:DOCUMENT,
  requested_by:AUTHOR,
  signer_user_id:AUTHOR,
  connection_id:CONNECTION,
  request_id:REQUEST_ID,
  provider:'bry_easy_sign',
  status:'pending',
  dispatch_state:'sent',
  provider_request_id:ENVELOPE,
  provider_document_id:'doc-1',
  provider_signer_id:'signer-1',
  provider_envelope_status:'ONGOING',
  provider_environment:'homologation',
  rendering_version:'clinical-pdf-v2',
  document_payload_sha256:PAYLOAD_SHA256,
  created_at:'2026-10-28T10:00:00Z',
}

function config(overrides = {}) {
  return () => bryEasySignConfig({
    BRY_EASY_SIGN_ENABLED:'true',
    BRY_EASY_SIGN_BASE_URL:'https://easysign.hom.bry.com.br',
    BRY_EASY_SIGN_TOKEN:TOKEN,
    BRY_EASY_SIGN_CREDENTIAL_ID:CREDENTIAL,
    BRY_EASY_SIGN_SIGNATURE_MODE:'QUALIFIED',
    BRY_EASY_SIGN_SIGNATURE_PROFILE:'TIMESTAMP',
    BRY_EASY_SIGN_WEBHOOK_SECRET:'s'.repeat(40),
    ...overrides,
  })
}

// Verificador desligado por padrao: o caminho normal dos testes antigos e o de
// evidencia pendente. Os testes do estado `signed` injetam um verificador.
function verifyOff() {
  return { ready:false, configured:false, problems:['BRY_VERIFY_BASE_URL nao configurada'] }
}

function verifyOn() {
  return { ready:true, configured:true, problems:[], baseUrl:'https://hom.bry.com.br', token:'jwt', path:'/verify', timeoutMs:5000 }
}

function verificationPayload(overrides = {}) {
  return {
    generalStatus:'VALID',
    signatureFormat:'PADES',
    signatureStatus:{
      signingTime:'2026-10-28T12:00:00.000Z',
      chainStatus:{
        certificateStatusList:[
          { statusType:'TIMESTAMP', certificateInfo:{ serial:'TS', subjectDN:{ cn:'AC Tempo' }, issuerDN:{ cn:'AC Tempo' }, validity:{ notBefore:'2026-01-01T00:00:00Z', notAfter:'2027-01-01T00:00:00Z' } } },
          { type:'ChainCertificate', certificateInfo:{ serial:'AC01', subjectDN:{ cn:'AC Raiz' }, issuerDN:{ cn:'AC Raiz' }, validity:{ notBefore:'2020-01-01T00:00:00Z', notAfter:'2030-01-01T00:00:00Z' } } },
          { type:'FinalCertificate', certificateInfo:{
            cpf:'52998224725',
            certificateType:'A3',
            serial:'0A1B2C',
            subjectDN:{ cn:'VITORIA RIBEIRO:52998224725', formattedCn:'VITORIA RIBEIRO' },
            issuerDN:{ cn:'AC Exemplo ICP-Brasil', o:'ICP-Brasil' },
            validity:{ notBefore:'2026-01-01T00:00:00Z', notAfter:'2027-01-01T00:00:00Z' },
          } },
        ],
      },
    },
    ...overrides,
  }
}

function deps({ admin, user = { id:AUTHOR }, ownerId = OWNER, configFactory = config(), bry = {}, renderPdf, signer, verifyConfigFactory = verifyOff, verifyImpl } = {}) {
  return {
    context:async () => ({ user, ownerId, admin, scoped:null }),
    config:configFactory,
    loadSigner:async () => signer || { ...signerIdentity, userId:user.id },
    renderPdf:renderPdf || (async () => ({ buffer:Buffer.from('%PDF-1.7 teste'), sha256:'c'.repeat(64) })),
    verifyConfig:verifyConfigFactory,
    verify:{ verifySignedPdf:verifyImpl || (async () => verificationPayload()) },
    bry:{
      startEnvelope:async () => null,
      // Ecoa os nonces recebidos, como a BRy faz de verdade.
      createEnvelope:async (_config, body) => ({
        envelopeId:ENVELOPE,
        documentsByNonce:new Map((body?.documents || []).map(d => [d.documentNonce, { documentId:d.documentNonce, documentUuid:'u' }])),
        signerId:'signer-1',
        envelopeStatus:'CREATED',
        signingUrl:`https://easysign.hom.bry.com.br/${ENVELOPE}/sign/signer-1`,
      }),
      fetchEnvelope:async () => ({ envelopeStatus:'ONGOING', signerStatus:'PENDING', signingUrl:null, signedAt:null }),
      downloadSignedDocument:async () => Buffer.from('%PDF-1.7 assinado'),
      downloadEvidenceReport:async () => Buffer.from('%PDF-1.7 relatorio'),
      ...bry,
    },
  }
}

function requestBody(overrides = {}) {
  return {
    headers:{ authorization:'Bearer sessao' },
    query:{},
    body:{ documentIds:[DOCUMENT], requestId:REQUEST_ID, ...overrides },
  }
}

// ---------------------------------------------------------------------------
// Autorizacao
// ---------------------------------------------------------------------------

test('usuario nao autenticado nao chega ao fluxo de assinatura', async () => {
  const unauthenticated = {
    ...deps({ admin:fakeSupabase() }),
    context:async () => { throw Object.assign(new Error('Sessao ausente.'), { statusCode:401 }) },
  }
  const error = await requestClinicalSignature(requestBody(), unauthenticated).catch(nextError => nextError)
  expect(error.statusCode).toBe(401)
})

test('documento de outra clinica nao e encontrado, mesmo com id valido', async () => {
  // A consulta e sempre escopada pelo ownerId resolvido no servidor.
  const admin = fakeSupabase({ clinical_documents:[{ ...documentRow, user_id:'11111111-0000-4000-8000-000000000009' }] })
  const error = await requestClinicalSignature(requestBody(), deps({ admin })).catch(nextError => nextError)
  expect(error.statusCode).toBe(404)
  expect(admin.calls.inserts).toHaveLength(0)
})

test('profissional diferente do autor nao pode assinar', async () => {
  const admin = fakeSupabase({ clinical_documents:[documentRow] })
  const error = await requestClinicalSignature(requestBody(), deps({ admin, user:{ id:OTHER_DOCTOR } }))
    .catch(nextError => nextError)
  expect(error.statusCode).toBe(403)
  expect(error.publicCode).toBe('nao_autor')
  expect(admin.calls.inserts).toHaveLength(0)
})

test('feature desabilitada falha fechada antes de qualquer chamada ou escrita', async () => {
  let called = false
  const admin = fakeSupabase({ clinical_documents:[documentRow] })
  const error = await requestClinicalSignature(requestBody(), deps({
    admin,
    configFactory:config({ BRY_EASY_SIGN_ENABLED:'false' }),
    bry:{ createEnvelope:async () => { called = true } },
  })).catch(nextError => nextError)
  expect(error.publicCode).toBe('integracao_indisponivel')
  expect(called).toBe(false)
  expect(admin.calls.inserts).toHaveLength(0)
})

test('documento e solicitacao com identificador invalido sao recusados', async () => {
  const admin = fakeSupabase({ clinical_documents:[documentRow] })
  for (const body of [{ documentIds:['nao-uuid'] }, { requestId:'nao-uuid' }, { documentIds:['../../etc'] }, { documentIds:[] }]) {
    const error = await requestClinicalSignature(requestBody(body), deps({ admin })).catch(nextError => nextError)
    expect(error.statusCode).toBe(400)
  }
})

// ---------------------------------------------------------------------------
// Estado publico
// ---------------------------------------------------------------------------

test('o estado devolvido ao navegador nunca inclui segredo nem caminho de storage', async () => {
  const admin = fakeSupabase({
    clinical_document_signatures:[{
      ...pendingAttempt,
      signed_file_path:`clinical-signatures/${OWNER}/${DOCUMENT}/${ATTEMPT}.pdf`,
      signed_file_sha256:'d'.repeat(64),
      evidence_gap_code:'verify_service_not_configured',
    }],
  })
  const state = await clinicalSignatureState({ admin, ownerId:OWNER, documentIds:[DOCUMENT], deps:deps({ admin }) })
  const serialized = JSON.stringify(state)
  expect(state.attempts).toHaveLength(1)
  expect(state.attempts[0].hasStoredArtifact).toBe(true)
  expect(state.attempts[0].evidenceComplete).toBe(false)
  expect(serialized).not.toContain(TOKEN)
  expect(serialized).not.toContain(CREDENTIAL)
  expect(serialized).not.toContain('clinical-signatures/')
  expect(serialized).not.toContain('d'.repeat(64))
})

test('migration ausente degrada sem bloquear o historico e a via manual', async () => {
  const admin = fakeSupabase({}, { failTables:{ clinical_document_signatures:{ code:'42P01', message:'missing' } } })
  const state = await clinicalSignatureState({ admin, ownerId:OWNER, documentIds:[DOCUMENT], deps:deps({ admin }) })
  expect(state.evidenceAvailable).toBe(false)
  expect(state.attempts).toEqual([])
})

// ---------------------------------------------------------------------------
// Tentativa pendente e assinatura valida
// ---------------------------------------------------------------------------

test('documento com tentativa pendente nao gera segunda solicitacao', async () => {
  // A chave idempotente e nova, mas o banco recusa pela regra de escopo.
  let created = false
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
    clinical_document_signatures:[pendingAttempt],
  }, {
    failTables:{},
  })
  // Simula o trigger de escopo recusando a insercao.
  const guarded = {
    ...admin,
    from(table) {
      const base = admin.from(table)
      if (table !== 'clinical_document_signatures') return base
      return {
        ...base,
        insert:() => ({
          select:() => ({ single:async () => ({ data:null, error:{ code:'42501', message:'A conexao ou o profissional nao esta ativo, ou o documento ja possui tentativa pendente/assinatura valida.' } }) }),
        }),
      }
    },
  }
  const error = await requestClinicalSignature(
    requestBody({ requestId:'90000000-0000-4000-8000-000000000002' }),
    deps({ admin:guarded, bry:{ createEnvelope:async () => { created = true } } }),
  ).catch(nextError => nextError)
  expect(error.publicCode).toBe('tentativa_em_andamento')
  expect(error.statusCode).toBe(409)
  expect(created).toBe(false)
})

test('a mesma chave idempotente nao cria segundo envelope nem consome outro credito', async () => {
  let creations = 0
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
    clinical_document_signatures:[pendingAttempt],
  })
  const response = await requestClinicalSignature(requestBody(), deps({
    admin,
    bry:{
      createEnvelope:async () => { creations += 1; throw new Error('nao deveria criar') },
      fetchEnvelope:async () => ({
        envelopeStatus:'ONGOING', signerStatus:'PENDING', signedAt:null,
        signingUrl:`https://easysign.hom.bry.com.br/${ENVELOPE}/sign/signer-1`,
      }),
    },
  }))
  expect(creations).toBe(0)
  expect(response.reused).toBe(true)
  expect(response.signingUrl).toContain('/sign/signer-1')
  expect(admin.calls.inserts.filter(entry => entry.table === 'clinical_document_signatures')).toHaveLength(0)
})

test('solicitacao reapresentada com conteudo diferente e recusada', async () => {
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
    clinical_document_signatures:[{ ...pendingAttempt, document_payload_sha256:'f'.repeat(64), provider_request_id:null, dispatch_state:'reserved' }],
  })
  const error = await requestClinicalSignature(requestBody(), deps({ admin })).catch(nextError => nextError)
  expect(error.publicCode).toBe('solicitacao_divergente')
})

// ---------------------------------------------------------------------------
// Resultado ambiguo
// ---------------------------------------------------------------------------

test('timeout ambiguo grava resultado desconhecido e nao reenvia', async () => {
  let attempts = 0
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
  })
  const error = await requestClinicalSignature(requestBody(), deps({
    admin,
    bry:{
      createEnvelope:async () => {
        attempts += 1
        throw new BryEasySignError('A BRy nao respondeu no tempo limite.', { kind:'timeout', ambiguous:true })
      },
    },
  })).catch(nextError => nextError)

  expect(attempts).toBe(1)
  expect(error.statusCode).toBe(504)
  expect(error.publicCode).toBe('resultado_desconhecido')
  const unknownPatch = admin.calls.updates.find(entry => entry.patch.dispatch_state === 'unknown')
  expect(unknownPatch).toBeTruthy()
  expect(unknownPatch.patch.failure_code).toBe('dispatch_result_unknown')
  // A tentativa continua pendente: nao foi marcada como falha nem como assinada.
  expect(admin.db.clinical_document_signatures[0].status).toBe('pending')
})

test('tentativa com resultado desconhecido bloqueia nova solicitacao automatica', async () => {
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
    clinical_document_signatures:[{ ...pendingAttempt, provider_request_id:null, dispatch_state:'unknown' }],
  })
  const error = await requestClinicalSignature(requestBody(), deps({ admin })).catch(nextError => nextError)
  expect(error.publicCode).toBe('resultado_desconhecido')
})

test('erro definitivo do provedor encerra a tentativa com causa auditavel', async () => {
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
  })
  const error = await requestClinicalSignature(requestBody(), deps({
    admin,
    bry:{
      createEnvelope:async () => { throw new BryEasySignError('A BRy recusou a credencial da aplicacao.', { kind:'auth', statusCode:401 }) },
    },
  })).catch(nextError => nextError)
  expect(error.statusCode).toBe(502)
  expect(admin.db.clinical_document_signatures[0].status).toBe('failed')
  expect(admin.db.clinical_document_signatures[0].failure_code).toBe('provider_auth')
  expect(error.message).not.toContain(TOKEN)
})

test('falha ao renderizar o PDF encerra a tentativa sem travar o documento', async () => {
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
  })
  let created = false
  const error = await requestClinicalSignature(requestBody(), deps({
    admin,
    renderPdf:async () => { throw new Error('fonte indisponivel') },
    bry:{ createEnvelope:async () => { created = true } },
  })).catch(nextError => nextError)
  expect(error.publicCode).toBe('render_falhou')
  expect(created).toBe(false)
  expect(admin.db.clinical_document_signatures[0].status).toBe('failed')
  expect(admin.db.clinical_document_signatures[0].failure_code).toBe('render_failed')
})

// ---------------------------------------------------------------------------
// Caminho feliz da solicitacao
// ---------------------------------------------------------------------------

test('solicitacao bem-sucedida grava identificadores e devolve so o link ao autor', async () => {
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
  })
  const response = await requestClinicalSignature(requestBody(), deps({ admin }))

  const row = admin.db.clinical_document_signatures[0]
  expect(row.status).toBe('pending')
  expect(row.dispatch_state).toBe('sent')
  expect(row.provider_request_id).toBe(ENVELOPE)
  expect(row.provider_document_id).toBe(row.id)
  expect(row.rendered_pdf_sha256).toBe('c'.repeat(64))
  expect(row.rendering_version).toBe('clinical-pdf-v2')
  // O link nunca e persistido.
  expect(JSON.stringify(row)).not.toContain('/sign/signer-1')
  expect(response.signingUrl).toContain('/sign/signer-1')
  // Nem o link nem o segredo aparecem no estado publico da tentativa.
  expect(JSON.stringify(response.attempts)).not.toContain('/sign/')
  expect(JSON.stringify(response.attempts)).not.toContain(TOKEN)
})

test('a auditoria registra a solicitacao sem link, token ou dado do paciente', async () => {
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
  })
  await requestClinicalSignature(requestBody(), deps({ admin }))
  const log = admin.calls.inserts.find(entry => entry.table === 'audit_logs')
  expect(log.row.action).toBe('request_clinical_signature')
  expect(log.row.details.document_count).toBe(1)
  expect(log.row.user_id).toBe(OWNER)
  expect(log.row.actor_id).toBe(AUTHOR)
  const serialized = JSON.stringify(log.row)
  expect(serialized).not.toContain('/sign/')
  expect(serialized).not.toContain(TOKEN)
  expect(serialized).not.toContain('Ana')
})

// ---------------------------------------------------------------------------
// Reconciliacao
// ---------------------------------------------------------------------------

test('reconciliacao autenticada consulta a BRy e nunca confia em payload externo', async () => {
  let queried = 0
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const result = await reconcileClinicalSignature(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } },
    deps({ admin, bry:{ fetchEnvelope:async () => { queried += 1; return { envelopeStatus:'ONGOING', signerStatus:'PENDING' } } } }),
  )
  expect(queried).toBe(1)
  expect(result.outcome).toBe('aguardando')
  expect(result.attempt.status).toBe('pending')
})

test('envelope concluido guarda o PDF e o relatorio, mas nao declara assinatura', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const result = await reconcileClinicalSignature(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } },
    deps({ admin, bry:{ fetchEnvelope:async () => ({ envelopeStatus:'FINISHED', signerStatus:'SIGNED', signedAt:'2026-10-28T12:00:00Z' }) } }),
  )

  expect(result.outcome).toBe('evidencia_pendente')
  const row = admin.db.clinical_document_signatures[0]
  // Nunca `signed` sem evidencia verificavel do certificado.
  expect(row.status).toBe('pending')
  // Verificador desligado nesta instalacao: motivo auditavel, nao assinatura.
  expect(row.evidence_gap_code).toBe('verify_service_not_configured')
  expect(row.signed_file_path).toBe(`clinical-signatures/${OWNER}/${DOCUMENT}/${ATTEMPT}.pdf`)
  expect(row.signed_file_sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(row.evidence_report_sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(result.attempt.evidenceComplete).toBe(false)
  // O artefato vai para bucket privado, sem sobrescrever nada.
  expect(admin.calls.uploads[0].bucket).toBe('clinical-signatures')
  expect(admin.calls.uploads[0].options.upsert).toBe(false)
})

test('reconciliar duas vezes o mesmo estado nao baixa nem sobrescreve o artefato de novo', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const bry = { fetchEnvelope:async () => ({ envelopeStatus:'FINISHED', signerStatus:'SIGNED' }) }
  const request = { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } }
  let downloads = 0
  const injected = deps({
    admin,
    bry:{ ...bry, downloadSignedDocument:async () => { downloads += 1; return Buffer.from('%PDF-1.7 assinado') } },
  })
  await reconcileClinicalSignature(request, injected)
  await reconcileClinicalSignature(request, injected)
  expect(downloads).toBe(1)
  // Dois objetos por tentativa: o PDF assinado e o relatorio de evidencias.
  expect(admin.calls.uploads).toHaveLength(2)
})

test('expiracao e recusa terminalizam e deixam de aceitar nova reconciliacao', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const request = { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } }
  const expired = deps({ admin, bry:{ fetchEnvelope:async () => ({ envelopeStatus:'EXPIRED' }) } })
  expect((await reconcileClinicalSignature(request, expired)).outcome).toBe('failed')
  expect(admin.db.clinical_document_signatures[0].failure_code).toBe('envelope_expired')
  // Reapresentar um estado "concluido" depois nao reabre a tentativa terminal.
  const late = deps({ admin, bry:{ fetchEnvelope:async () => ({ envelopeStatus:'FINISHED', signerStatus:'SIGNED' }) } })
  expect((await reconcileClinicalSignature(request, late)).outcome).toBe('ja_terminal')
  expect(admin.db.clinical_document_signatures[0].status).toBe('failed')
})

test('somente o signatario reconcilia ou encerra a tentativa', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const request = { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT, confirm:true } }
  for (const action of [reconcileClinicalSignature, abandonClinicalSignature]) {
    const error = await action(request, deps({ admin, user:{ id:OTHER_DOCTOR } })).catch(nextError => nextError)
    expect(error.statusCode).toBe(403)
    expect(error.publicCode).toBe('nao_autor')
  }
})

test('tentativa de outra clinica nao e encontrada', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[{ ...pendingAttempt, user_id:'11111111-0000-4000-8000-000000000009' }] })
  const error = await reconcileClinicalSignature(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } },
    deps({ admin }),
  ).catch(nextError => nextError)
  expect(error.statusCode).toBe(404)
})

// ---------------------------------------------------------------------------
// Encerramento explicito
// ---------------------------------------------------------------------------

test('encerrar tentativa exige confirmacao e so vale para resultado desconhecido', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[{ ...pendingAttempt, dispatch_state:'unknown' }] })
  const noConfirm = await abandonClinicalSignature(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } },
    deps({ admin }),
  ).catch(error => error)
  expect(noConfirm.statusCode).toBe(400)

  const sentAttempt = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const notApplicable = await abandonClinicalSignature(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT, confirm:true } },
    deps({ admin:sentAttempt }),
  ).catch(error => error)
  expect(notApplicable.publicCode).toBe('encerramento_nao_aplicavel')

  const result = await abandonClinicalSignature(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT, confirm:true } },
    deps({ admin }),
  )
  expect(result.attempt.status).toBe('failed')
  expect(admin.db.clinical_document_signatures[0].failure_code).toBe('dispatch_result_unknown_abandoned')
})

// ---------------------------------------------------------------------------
// Download do artefato
// ---------------------------------------------------------------------------

const storedAttempt = {
  ...pendingAttempt,
  signed_file_path:`clinical-signatures/${OWNER}/${DOCUMENT}/${ATTEMPT}.pdf`,
  signed_file_sha256:'d'.repeat(64),
  evidence_report_path:`clinical-signatures/${OWNER}/${DOCUMENT}/${ATTEMPT}-report.pdf`,
  evidence_report_sha256:'e'.repeat(64),
}

test('abertura autorizada gera URL assinada curta e registra auditoria', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[storedAttempt] })
  const response = await openClinicalSignatureArtifact(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT, kind:'signed' } },
    deps({ admin }),
  )
  expect(response.url).toContain('https://storage.test/')
  expect(response.expiresInSeconds).toBe(60)
  expect(admin.calls.signedUrls[0].ttl).toBe(60)
  const log = admin.calls.inserts.find(entry => entry.table === 'audit_logs')
  expect(log.row.action).toBe('open_clinical_signature_artifact')
})

test('abertura negada para outra clinica, tipo invalido e tentativa sem artefato', async () => {
  const foreign = fakeSupabase({ clinical_document_signatures:[{ ...storedAttempt, user_id:'11111111-0000-4000-8000-000000000009' }] })
  const notFound = await openClinicalSignatureArtifact(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } },
    deps({ admin:foreign }),
  ).catch(error => error)
  expect(notFound.statusCode).toBe(404)
  expect(foreign.calls.signedUrls).toHaveLength(0)

  const empty = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const noArtifact = await openClinicalSignatureArtifact(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } },
    deps({ admin:empty }),
  ).catch(error => error)
  expect(noArtifact.publicCode).toBe('sem_artefato')

  const stored = fakeSupabase({ clinical_document_signatures:[storedAttempt] })
  const badKind = await openClinicalSignatureArtifact(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT, kind:'../../segredo' } },
    deps({ admin:stored }),
  ).catch(error => error)
  expect(badKind.statusCode).toBe(400)
  expect(stored.calls.signedUrls).toHaveLength(0)
})

test('caminho gravado divergente do canonico bloqueia a abertura', async () => {
  const tampered = fakeSupabase({
    clinical_document_signatures:[{ ...storedAttempt, signed_file_path:'clinical-signatures/outra-clinica/x/y.pdf' }],
  })
  const error = await openClinicalSignatureArtifact(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT, kind:'signed' } },
    deps({ admin:tampered }),
  ).catch(nextError => nextError)
  expect(error.publicCode).toBe('caminho_inconsistente')
  expect(tampered.calls.signedUrls).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

function webhookRequest(secret, body) {
  return { headers:secret ? { 'x-bry-webhook-secret':secret } : {}, query:{}, body }
}

test('webhook sem segredo valido responde 404 sem revelar nada', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  for (const secret of [undefined, '', 'x'.repeat(40)]) {
    const result = await handleBryWebhook(
      webhookRequest(secret, { uuid:ENVELOPE }),
      { uuid:ENVELOPE },
      { ...deps({ admin }), adminFactory:() => admin },
    )
    expect(result.statusCode).toBe(404)
  }
  expect(admin.calls.updates).toHaveLength(0)
})

test('webhook valido apenas dispara reconciliacao autenticada', async () => {
  let queried = 0
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const result = await handleBryWebhook(
    webhookRequest('s'.repeat(40), { uuid:ENVELOPE }),
    { uuid:ENVELOPE },
    {
      ...deps({ admin, bry:{ fetchEnvelope:async () => { queried += 1; return { envelopeStatus:'FINISHED', signerStatus:'SIGNED' } } } }),
      adminFactory:() => admin,
    },
  )
  expect(result.statusCode).toBe(200)
  expect(result.body.reconciled).toBe(1)
  expect(queried).toBe(1)
  // O estado veio da consulta, nao do corpo do callback.
  expect(admin.db.clinical_document_signatures[0].status).toBe('pending')
  expect(admin.db.clinical_document_signatures[0].evidence_gap_code).toBe('verify_service_not_configured')
})

test('callback duplicado nao duplica trabalho nem artefato', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  let downloads = 0
  const injected = {
    ...deps({
      admin,
      bry:{
        fetchEnvelope:async () => ({ envelopeStatus:'FINISHED', signerStatus:'SIGNED' }),
        downloadSignedDocument:async () => { downloads += 1; return Buffer.from('%PDF-1.7 assinado') },
      },
    }),
    adminFactory:() => admin,
  }
  await handleBryWebhook(webhookRequest('s'.repeat(40), { uuid:ENVELOPE }), { uuid:ENVELOPE }, injected)
  await handleBryWebhook(webhookRequest('s'.repeat(40), { uuid:ENVELOPE }), { uuid:ENVELOPE }, injected)
  expect(downloads).toBe(1)
  expect(admin.calls.uploads).toHaveLength(2)
})

test('callback adulterado nao consegue marcar assinatura nem trocar o envelope', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const result = await handleBryWebhook(
    webhookRequest('s'.repeat(40), {}),
    {
      uuid:ENVELOPE,
      status:'FINISHED',
      signatureStandard:'PAdES-B-LTA',
      certificateSubject:'CN=Invasor',
      signedFileSha256:'0'.repeat(64),
    },
    {
      ...deps({ admin, bry:{ fetchEnvelope:async () => ({ envelopeStatus:'ONGOING', signerStatus:'PENDING' }) } }),
      adminFactory:() => admin,
    },
  )
  expect(result.statusCode).toBe(200)
  const row = admin.db.clinical_document_signatures[0]
  expect(row.status).toBe('pending')
  expect(row.signature_standard).toBeUndefined()
  expect(row.certificate_subject).toBeUndefined()
  expect(row.provider_request_id).toBe(ENVELOPE)
})

test('callback de envelope desconhecido ou invalido nao gera escrita', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const injected = { ...deps({ admin }), adminFactory:() => admin }

  const unknown = await handleBryWebhook(
    webhookRequest('s'.repeat(40), { uuid:'80000000-0000-4000-8000-00000000ffff' }),
    { uuid:'80000000-0000-4000-8000-00000000ffff' },
    injected,
  )
  expect(unknown.body.reconciled).toBe(0)

  const malformed = await handleBryWebhook(webhookRequest('s'.repeat(40), {}), '{', injected)
  expect(malformed.body.ignored).toBe('payload_invalido')
  expect(admin.calls.updates).toHaveLength(0)
})

test('webhook com integracao desabilitada e aceito e descartado', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const result = await handleBryWebhook(
    webhookRequest('s'.repeat(40), { uuid:ENVELOPE }),
    { uuid:ENVELOPE },
    {
      ...deps({ admin, configFactory:config({ BRY_EASY_SIGN_ENABLED:'false' }) }),
      adminFactory:() => admin,
    },
  )
  expect(result.statusCode).toBe(202)
  expect(result.body.ignored).toBe('integracao_indisponivel')
  expect(admin.calls.updates).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// Rascunho e inicio do envelope (orientacao da BRy em 29/10/2026)
// ---------------------------------------------------------------------------

test('a criacao inicia o envelope em seguida e nomeia o envelope pelo lote', async () => {
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
  })
  let payload = null
  let started = null
  await requestClinicalSignature(requestBody(), deps({
    admin,
    bry:{
      createEnvelope:async (_config, body) => {
        payload = body
        return {
          envelopeId:ENVELOPE, signerId:'signer-1', envelopeStatus:'DRAFT',
          documentsByNonce:new Map(body.documents.map(d => [d.documentNonce, { documentId:d.documentNonce }])),
          signingUrl:`https://easysign.hom.bry.com.br/${ENVELOPE}/sign/signer-1`,
        }
      },
      startEnvelope:async (_config, envelopeId) => { started = envelopeId },
    },
  }))

  expect(payload.startAsDraft).toBe(true)
  // Nome unico por LOTE (a chave idempotente): e por ele que um envelope orfao
  // e localizado na pagina de listagem da BRy.
  expect(payload.name).toBe(`SurgiMetrics ${REQUEST_ID}`)
  expect(payload.name.length).toBeLessThanOrEqual(50)
  // O nonce de cada documento e o id da tentativa.
  expect(payload.documents[0].documentNonce).toBe(admin.db.clinical_document_signatures[0].id)
  expect(started).toBe(ENVELOPE)
  expect(admin.db.clinical_document_signatures[0].provider_envelope_status).toBe('CREATED')
})

test('falha ao iniciar preserva o envelope registrado e nao entrega o link', async () => {
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
  })
  const error = await requestClinicalSignature(requestBody(), deps({
    admin,
    bry:{ startEnvelope:async () => { throw new BryEasySignError('indisponivel', { kind:'provider' }) } },
  })).catch(nextError => nextError)

  expect(error.publicCode).toBe('envelope_nao_iniciado')
  const row = admin.db.clinical_document_signatures[0]
  // A tentativa continua pendente e rastreada: nada de cobrar de novo.
  expect(row.status).toBe('pending')
  expect(row.provider_request_id).toBe(ENVELOPE)
  expect(row.provider_envelope_status).toBe('DRAFT')
  expect(row.failure_code).toBe('envelope_start_failed')
})

test('reconciliacao reinicia envelope preso em rascunho', async () => {
  const admin = fakeSupabase({
    clinical_document_signatures:[{ ...pendingAttempt, provider_envelope_status:'DRAFT', failure_code:'envelope_start_failed' }],
  })
  let started = 0
  const result = await reconcileClinicalSignature(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } },
    deps({
      admin,
      bry:{
        fetchEnvelope:async () => ({ envelopeStatus:'DRAFT', signerStatus:'PENDING' }),
        startEnvelope:async () => { started += 1 },
      },
    }),
  )
  expect(result.outcome).toBe('envelope_iniciado')
  expect(started).toBe(1)
  const row = admin.db.clinical_document_signatures[0]
  expect(row.provider_envelope_status).toBe('CREATED')
  expect(row.failure_code).toBeNull()
})

// ---------------------------------------------------------------------------
// Terminalizacao com evidencia verificada
// ---------------------------------------------------------------------------

function finishedDeps(overrides = {}) {
  return deps({
    bry:{ fetchEnvelope:async () => ({ envelopeStatus:'FINISHED', signerStatus:'SIGNED', signedAt:'2026-10-28T12:00:00Z' }) },
    verifyConfigFactory:verifyOn,
    ...overrides,
  })
}

const reconcileRequest = { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } }

test('evidencia verificada terminaliza a tentativa como assinada', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const result = await reconcileClinicalSignature(reconcileRequest, finishedDeps({ admin }))

  expect(result.outcome).toBe('signed')
  const row = admin.db.clinical_document_signatures[0]
  expect(row.status).toBe('signed')
  expect(row.signature_standard).toBe('PAdES-B-T')
  expect(row.certificate_subject).toBe('VITORIA RIBEIRO')
  expect(row.certificate_serial).toBe('0A1B2C')
  expect(row.certificate_issuer).toBe('AC Exemplo ICP-Brasil')
  expect(row.signed_at).toBe('2026-10-28T12:00:00.000Z')
  expect(row.evidence_gap_code).toBeNull()
  expect(row.signed_file_path).toBe(`clinical-signatures/${OWNER}/${DOCUMENT}/${ATTEMPT}.pdf`)
  expect(result.attempt.evidenceComplete).toBe(true)
})

test('o padrao gravado vem da verificacao, nao do modo pedido', async () => {
  // Pedimos QUALIFIED/TIMESTAMP, mas a verificacao nao confirma carimbo:
  // a tentativa NAO vira assinada.
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const result = await reconcileClinicalSignature(reconcileRequest, finishedDeps({
    admin,
    verifyImpl:async () => {
      const response = verificationPayload()
      response.signatureStatus.chainStatus.certificateStatusList =
        response.signatureStatus.chainStatus.certificateStatusList.filter(entry => entry.statusType !== 'TIMESTAMP')
      return response
    },
  }))
  expect(result.outcome).toBe('evidencia_pendente')
  const row = admin.db.clinical_document_signatures[0]
  expect(row.status).toBe('pending')
  expect(row.evidence_gap_code).toBe('verify_timestamp_not_verified')
  expect(row.signature_standard).toBeUndefined()
})

test('assinatura reprovada pela verificacao nunca vira assinada', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const result = await reconcileClinicalSignature(reconcileRequest, finishedDeps({
    admin,
    verifyImpl:async () => verificationPayload({ generalStatus:'INVALID_WITH_INTEGRITY_ERROR' }),
  }))
  expect(result.outcome).toBe('evidencia_pendente')
  const row = admin.db.clinical_document_signatures[0]
  expect(row.status).toBe('pending')
  expect(row.evidence_gap_code).toBe('verify_signature_invalid')
  // O artefato continua guardado para analise.
  expect(row.signed_file_sha256).toMatch(/^[0-9a-f]{64}$/)
})

test('verificador indisponivel preserva o artefato e permite tentar depois', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const failing = finishedDeps({
    admin,
    verifyImpl:async () => { throw new BryVerifyError('fora do ar', { kind:'network' }) },
  })
  const first = await reconcileClinicalSignature(reconcileRequest, failing)
  expect(first.outcome).toBe('evidencia_pendente')
  expect(admin.db.clinical_document_signatures[0].evidence_gap_code).toBe('verify_service_unavailable')

  // Nova reconciliacao, agora com o verificador de pe: rele o artefato do
  // bucket (sem depender da retencao de 30 dias da BRy) e conclui.
  let downloads = 0
  const recovering = finishedDeps({
    admin,
    bry:{
      fetchEnvelope:async () => ({ envelopeStatus:'FINISHED', signerStatus:'SIGNED' }),
      downloadSignedDocument:async () => { downloads += 1; return Buffer.from('%PDF-1.7 assinado') },
    },
  })
  const second = await reconcileClinicalSignature(reconcileRequest, recovering)
  expect(second.outcome).toBe('signed')
  expect(downloads).toBe(0)
  expect(admin.db.clinical_document_signatures[0].status).toBe('signed')
})

test('reconciliar de novo uma tentativa assinada nao reescreve a evidencia', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  await reconcileClinicalSignature(reconcileRequest, finishedDeps({ admin }))
  const signedRow = { ...admin.db.clinical_document_signatures[0] }

  const again = await reconcileClinicalSignature(reconcileRequest, finishedDeps({ admin }))
  expect(again.outcome).toBe('ja_terminal')
  expect(admin.db.clinical_document_signatures[0]).toEqual(signedRow)
})

test('o webhook tambem conclui a assinatura, mas so apos verificar o artefato', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const result = await handleBryWebhook(
    webhookRequest('s'.repeat(40), { uuid:ENVELOPE }),
    { uuid:ENVELOPE, status:'FINISHED', signatureStandard:'PAdES-B-LTA', certificateSubject:'CN=Invasor' },
    { ...finishedDeps({ admin }), adminFactory:() => admin },
  )
  expect(result.statusCode).toBe(200)
  const row = admin.db.clinical_document_signatures[0]
  expect(row.status).toBe('signed')
  // Nada do payload do callback entrou na evidencia.
  expect(row.signature_standard).toBe('PAdES-B-T')
  expect(row.certificate_subject).toBe('VITORIA RIBEIRO')
})

// ---------------------------------------------------------------------------
// Reabrir a pagina de assinatura
// ---------------------------------------------------------------------------

test('reabrir a pagina consulta o envelope e nao cria outro', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  let created = 0
  const response = await clinicalSignatureLink(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } },
    deps({
      admin,
      bry:{
        createEnvelope:async () => { created += 1 },
        fetchEnvelope:async () => ({
          envelopeStatus:'ONGOING', signerStatus:'PENDING',
          signingUrl:`https://easysign.hom.bry.com.br/${ENVELOPE}/sign/signer-1`,
        }),
      },
    }),
  )
  expect(created).toBe(0)
  expect(response.signingUrl).toContain('/sign/signer-1')
  // O link continua fora do banco e fora da auditoria.
  expect(JSON.stringify(admin.db.clinical_document_signatures[0])).not.toContain('/sign/')
  const log = admin.calls.inserts.find(entry => entry.table === 'audit_logs')
  expect(log.row.action).toBe('open_clinical_signature_page')
  expect(JSON.stringify(log.row)).not.toContain('/sign/')
})

test('reabrir a pagina e negado para nao-autor, outra clinica e tentativa encerrada', async () => {
  const request = { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } }

  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const notAuthor = await clinicalSignatureLink(request, deps({ admin, user:{ id:OTHER_DOCTOR } })).catch(error => error)
  expect(notAuthor.publicCode).toBe('nao_autor')

  const foreign = fakeSupabase({ clinical_document_signatures:[{ ...pendingAttempt, user_id:'11111111-0000-4000-8000-000000000009' }] })
  const notFound = await clinicalSignatureLink(request, deps({ admin:foreign })).catch(error => error)
  expect(notFound.statusCode).toBe(404)

  const terminal = fakeSupabase({ clinical_document_signatures:[{ ...pendingAttempt, status:'failed' }] })
  const closed = await clinicalSignatureLink(request, deps({ admin:terminal })).catch(error => error)
  expect(closed.publicCode).toBe('sem_assinatura_pendente')

  const off = await clinicalSignatureLink(request, deps({ admin, configFactory:config({ BRY_EASY_SIGN_ENABLED:'false' }) })).catch(error => error)
  expect(off.publicCode).toBe('integracao_indisponivel')
})

test('envelope sem link devolvido orienta atualizar o status', async () => {
  const admin = fakeSupabase({ clinical_document_signatures:[pendingAttempt] })
  const error = await clinicalSignatureLink(
    { headers:{ authorization:'Bearer s' }, query:{}, body:{ attemptId:ATTEMPT } },
    deps({ admin, bry:{ fetchEnvelope:async () => ({ envelopeStatus:'ONGOING', signingUrl:null }) } }),
  ).catch(nextError => nextError)
  expect(error.publicCode).toBe('sem_link')
})

test('criacao sem link recupera a pagina de assinatura apos iniciar o envelope', async () => {
  const admin = fakeSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
  })
  const order = []
  const response = await requestClinicalSignature(requestBody(), deps({
    admin,
    bry:{
      createEnvelope:async () => {
        order.push('create')
        // Rascunho sem link: cenario esperado com startAsDraft.
        return {
          envelopeId:ENVELOPE, signerId:'signer-1', envelopeStatus:'DRAFT', signingUrl:null,
          documentsByNonce:new Map(admin.db.clinical_document_signatures.map(r => [r.id, { documentId:r.id }])),
        }
      },
      startEnvelope:async () => { order.push('start') },
      fetchEnvelope:async () => {
        order.push('fetch')
        return { envelopeStatus:'CREATED', signingUrl:`https://easysign.hom.bry.com.br/${ENVELOPE}/sign/signer-1` }
      },
    },
  }))
  expect(order).toEqual(['create', 'start', 'fetch'])
  expect(response.signingUrl).toContain('/sign/signer-1')
})

// ---------------------------------------------------------------------------
// Assinatura em lote: ate 10 documentos num envelope
// ---------------------------------------------------------------------------

const DOCUMENT_2 = '30000000-0000-4000-8000-000000000002'
const documentRow2 = { ...documentRow, id:DOCUMENT_2, document_type:'simple_prescription',
  document_data:{ items:[{ medication:'Dipirona', directions:'1x ao dia' }] } }

// O fake atribui sempre o mesmo id; para o lote precisamos de ids distintos.
function batchSupabase(tables) {
  const admin = fakeSupabase(tables)
  let seq = 0
  const original = admin.from.bind(admin)
  admin.from = table => {
    const builder = original(table)
    if (table !== 'clinical_document_signatures') return builder
    return {
      ...builder,
      insert:payload => {
        seq += 1
        return builder.insert({ ...payload, id:`60000000-0000-4000-8000-00000000000${seq}` })
      },
    }
  }
  return admin
}

function batchBody(ids) {
  return { headers:{ authorization:'Bearer sessao' }, query:{}, body:{ documentIds:ids, requestId:REQUEST_ID } }
}

test('dois documentos viram UM envelope, cada um com seu OID e seu nonce', async () => {
  const admin = batchSupabase({
    clinical_documents:[documentRow, documentRow2],
    clinical_signature_connections:[connectionRow],
  })
  let payload = null
  let envelopesCriados = 0
  const response = await requestClinicalSignature(batchBody([DOCUMENT, DOCUMENT_2]), deps({
    admin,
    bry:{
      createEnvelope:async (_config, body) => {
        envelopesCriados += 1
        payload = body
        return {
          envelopeId:ENVELOPE, signerId:'signer-1', envelopeStatus:'DRAFT',
          documentsByNonce:new Map(body.documents.map(d => [d.documentNonce, { documentId:d.documentNonce }])),
          signingUrl:`https://easysign.hom.bry.com.br/${ENVELOPE}/sign/signer-1`,
        }
      },
    },
  }))

  // O ponto economico: UM envelope para dois documentos.
  expect(envelopesCriados).toBe(1)
  expect(payload.documents).toHaveLength(2)
  // Cada documento leva o OID do SEU tipo.
  expect(Object.keys(payload.documents[0].metadata)[0]).toBe('2.16.76.1.12.1.3')
  expect(Object.keys(payload.documents[1].metadata)[0]).toBe('2.16.76.1.12.1.1')

  const rows = admin.db.clinical_document_signatures
  expect(rows).toHaveLength(2)
  // As duas tentativas compartilham envelope e chave idempotente...
  expect(new Set(rows.map(r => r.provider_request_id))).toEqual(new Set([ENVELOPE]))
  expect(new Set(rows.map(r => r.request_id))).toEqual(new Set([REQUEST_ID]))
  // ...mas cada uma tem o SEU documento no provedor.
  expect(rows[0].provider_document_id).toBe(rows[0].id)
  expect(rows[1].provider_document_id).toBe(rows[1].id)
  expect(rows[0].provider_document_id).not.toBe(rows[1].provider_document_id)
  expect(response.attempts).toHaveLength(2)
})

test('se um documento nao voltar identificado, o lote inteiro falha', async () => {
  // Este e o cenario que colocaria a receita de um paciente na ficha de outro.
  const admin = batchSupabase({
    clinical_documents:[documentRow, documentRow2],
    clinical_signature_connections:[connectionRow],
  })
  const error = await requestClinicalSignature(batchBody([DOCUMENT, DOCUMENT_2]), deps({
    admin,
    bry:{
      createEnvelope:async (_config, body) => ({
        envelopeId:ENVELOPE, signerId:'signer-1', envelopeStatus:'DRAFT',
        // Devolve so o primeiro documento.
        documentsByNonce:new Map([[body.documents[0].documentNonce, { documentId:body.documents[0].documentNonce }]]),
        signingUrl:null,
      }),
    },
  })).catch(nextError => nextError)

  expect(error.publicCode).toBe('resultado_desconhecido')
  // Nenhuma tentativa recebeu identificador de documento: nada foi vinculado.
  for (const row of admin.db.clinical_document_signatures) {
    expect(row.provider_document_id).toBeUndefined()
    expect(row.dispatch_state).toBe('unknown')
  }
})

test('lote acima do limite da BRy e recusado antes de qualquer chamada', async () => {
  let chamou = false
  const admin = batchSupabase({ clinical_documents:[documentRow], clinical_signature_connections:[connectionRow] })
  const ids = Array.from({ length:11 }, (_, index) => `30000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`)
  const error = await requestClinicalSignature(batchBody(ids), deps({
    admin, bry:{ createEnvelope:async () => { chamou = true } },
  })).catch(nextError => nextError)
  expect(error.publicCode).toBe('lote_grande_demais')
  expect(chamou).toBe(false)
})

test('documento repetido no mesmo lote nao duplica tentativa', async () => {
  const admin = batchSupabase({ clinical_documents:[documentRow], clinical_signature_connections:[connectionRow] })
  const response = await requestClinicalSignature(batchBody([DOCUMENT, DOCUMENT, DOCUMENT]), deps({ admin }))
  expect(admin.db.clinical_document_signatures).toHaveLength(1)
  expect(response.attempts).toHaveLength(1)
})

test('um documento de outro profissional recusa o lote inteiro', async () => {
  // Todos serao assinados pela mesma identidade; misturar autoria seria falso.
  const admin = batchSupabase({
    clinical_documents:[documentRow, { ...documentRow2, created_by:OTHER_DOCTOR }],
    clinical_signature_connections:[connectionRow],
  })
  const error = await requestClinicalSignature(batchBody([DOCUMENT, DOCUMENT_2]), deps({ admin }))
    .catch(nextError => nextError)
  expect(error.publicCode).toBe('nao_autor')
  expect(admin.db.clinical_document_signatures ?? []).toHaveLength(0)
})

test('falha ao renderizar encerra TODAS as tentativas do lote', async () => {
  const admin = batchSupabase({
    clinical_documents:[documentRow, documentRow2],
    clinical_signature_connections:[connectionRow],
  })
  let criou = false
  await requestClinicalSignature(batchBody([DOCUMENT, DOCUMENT_2]), deps({
    admin,
    renderPdf:async () => { throw new Error('fonte indisponivel') },
    bry:{ createEnvelope:async () => { criou = true } },
  })).catch(() => {})
  expect(criou).toBe(false)
  expect(admin.db.clinical_document_signatures).toHaveLength(2)
  for (const row of admin.db.clinical_document_signatures) {
    expect(row.status).toBe('failed')
    expect(row.failure_code).toBe('render_failed')
  }
})

// ---------------------------------------------------------------------------
// Defeitos encontrados na revisao de codigo (30/10/2026)
// ---------------------------------------------------------------------------

test('o contrato do cliente aceita um id solto, nao so lista', async () => {
  // A ficha do paciente passava `record.id` (string) para um backend que exige
  // lista: Array.isArray falhava e TODA assinatura de documento unico dava 400.
  const admin = batchSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
  })
  const response = await requestClinicalSignature(batchBody([DOCUMENT]), deps({ admin }))
  expect(response.attempts).toHaveLength(1)
  expect(admin.db.clinical_document_signatures[0].provider_request_id).toBe(ENVELOPE)
})

test('documento ja em andamento recusa o lote ANTES de reservar qualquer tentativa', async () => {
  // Sem a pre-checagem, a reserva estourava no meio e as tentativas ja criadas
  // ficavam pendentes para sempre: a fila as escondia, o banco recusava nova
  // tentativa e o encerramento nao as alcancava.
  const admin = batchSupabase({
    clinical_documents:[documentRow, documentRow2],
    clinical_signature_connections:[connectionRow],
    clinical_document_signatures:[{
      ...pendingAttempt, id:'60000000-0000-4000-8000-0000000000ee',
      document_id:DOCUMENT_2, request_id:'90000000-0000-4000-8000-0000000000ee',
    }],
  })
  let criou = false
  const error = await requestClinicalSignature(batchBody([DOCUMENT, DOCUMENT_2]), deps({
    admin, bry:{ createEnvelope:async () => { criou = true } },
  })).catch(nextError => nextError)

  expect(error.publicCode).toBe('tentativa_em_andamento')
  expect(criou).toBe(false)
  // Nenhuma tentativa nova foi criada: o documento livre nao ficou bloqueado.
  expect(admin.db.clinical_document_signatures).toHaveLength(1)
})

test('documento ja assinado recusa o lote com mensagem propria', async () => {
  const admin = batchSupabase({
    clinical_documents:[documentRow, documentRow2],
    clinical_signature_connections:[connectionRow],
    clinical_document_signatures:[{
      ...pendingAttempt, id:'60000000-0000-4000-8000-0000000000ef',
      document_id:DOCUMENT_2, status:'signed', request_id:'90000000-0000-4000-8000-0000000000ef',
    }],
  })
  const error = await requestClinicalSignature(batchBody([DOCUMENT, DOCUMENT_2]), deps({ admin }))
    .catch(nextError => nextError)
  expect(error.publicCode).toBe('tentativa_em_andamento')
  expect(error.message).toContain('assinatura valida')
})

test('lote misto no reuso falha fechado em vez de deixar documento fora do envelope', async () => {
  // Reapresentar a mesma chave com um conjunto diferente deixaria a tentativa
  // nova fora do envelope: assinada na BRy e nunca concluida aqui.
  const admin = batchSupabase({
    clinical_documents:[documentRow, documentRow2],
    clinical_signature_connections:[connectionRow],
    clinical_document_signatures:[{
      ...pendingAttempt, id:'60000000-0000-4000-8000-0000000000f1',
      document_id:DOCUMENT, request_id:REQUEST_ID, provider_request_id:ENVELOPE,
      document_payload_sha256:PAYLOAD_SHA256,
    }],
  })
  const error = await requestClinicalSignature(batchBody([DOCUMENT, DOCUMENT_2]), deps({ admin }))
    .catch(nextError => nextError)
  expect(error.publicCode).toBe('lote_divergente')
})

test('dois despachos simultaneos nao criam dois envelopes nem gastam credito em dobro', async () => {
  const admin = batchSupabase({
    clinical_documents:[documentRow],
    clinical_signature_connections:[connectionRow],
  })
  let envelopes = 0
  const slowCreate = deps({
    admin,
    bry:{
      createEnvelope:async (_config, body) => {
        envelopes += 1
        await new Promise(resolve => setTimeout(resolve, 30))
        return {
          envelopeId:ENVELOPE, signerId:'signer-1', envelopeStatus:'DRAFT',
          documentsByNonce:new Map(body.documents.map(d => [d.documentNonce, { documentId:d.documentNonce }])),
          signingUrl:`https://easysign.hom.bry.com.br/${ENVELOPE}/sign/signer-1`,
        }
      },
    },
  })

  const [first, second] = await Promise.allSettled([
    requestClinicalSignature(batchBody([DOCUMENT]), slowCreate),
    requestClinicalSignature(batchBody([DOCUMENT]), slowCreate),
  ])
  const outcomes = [first, second]
  // Um envelope só, custe o que custar a corrida.
  expect(envelopes).toBe(1)
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const loser = outcomes.find(result => result.status === 'rejected')
  expect(loser.reason.publicCode).toBe('despacho_em_andamento')
})
