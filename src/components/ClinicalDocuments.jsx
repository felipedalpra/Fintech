import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { today, uid } from '../utils.js'
import {
  buildClinicalDocumentRpcArgs,
  clinicalDocumentDefaults,
  clinicalDocumentTypeLabel,
  CLINICAL_DOCUMENT_TYPES,
  openClinicalDocumentPrint,
  professionalRegistration,
} from '../lib/clinicalDocuments.js'
import {
  clinicalSignatureActionState,
  clinicalSignerReadiness,
  hasCompleteClinicalSignatureEvidence,
  isClinicalSignatureEligible,
  latestAttemptByDocument,
} from '../lib/clinicalSignature.js'
import {
  abandonClinicalSignature,
  fetchClinicalSignatureLink,
  fetchClinicalSignatureState,
  openClinicalSignatureArtifact,
  reconcileClinicalSignature,
  requestClinicalSignature,
} from '../lib/clinicalSignatureBryClient.js'
import { Btn } from './UI.jsx'
import { loadClinicalProtocols } from '../lib/clinicalProtocolClient.js'
import { applyProtocolToDocumentDraft } from '../lib/clinicalProtocols.js'

const { EXAM_REQUEST, SIMPLE_PRESCRIPTION } = CLINICAL_DOCUMENT_TYPES

async function fetchDocuments(patientId, ownerId) {
  const { data, error } = await supabase
    .from('clinical_documents')
    .select('*')
    .eq('patient_id', patientId)
    .eq('user_id', ownerId)
    .order('created_at', { ascending:false })
  if (error) throw error
  return data || []
}

async function fetchSignatureEvidence(documents, ownerId) {
  if (documents.length === 0) return { rows:[], available:true }
  const { data, error } = await supabase
    .from('clinical_document_signatures')
    .select('id, document_id, status, created_at, signed_file_path, signed_file_sha256, signature_standard, certificate_subject, certificate_serial, certificate_issuer, certificate_valid_from, certificate_valid_until, signed_at')
    .eq('user_id', ownerId)
    .in('document_id', documents.map(document => document.id))
    .order('created_at', { ascending:false })
  if (error) return { rows:[], available:false }
  return { rows:data || [], available:true }
}

// Tentativa lida direto do Supabase (snake_case) normalizada para o mesmo
// formato que o backend devolve, para a tela ter um unico caminho de render.
function legacyAttempt(row) {
  return {
    id:row.id,
    documentId:row.document_id,
    status:row.status,
    createdAt:row.created_at,
    envelopeStatus:null,
    dispatchState:null,
    evidenceGapCode:null,
    hasStoredArtifact:Boolean(row.signed_file_path && row.signed_file_sha256),
    evidenceComplete:hasCompleteClinicalSignatureEvidence(row),
    failureMessage:null,
  }
}

// A fonte de verdade da flag e das tentativas e o backend. Se ele estiver
// indisponivel, caimos na leitura direta do historico: a integracao aparece
// como indisponivel e a via manual continua intacta.
async function fetchSignatureBundle(documents, ownerId) {
  if (documents.length === 0) {
    return { integration:{ available:false, reason:'desabilitada' }, attempts:[], available:true }
  }
  try {
    const state = await fetchClinicalSignatureState(documents.map(document => document.id))
    return {
      integration:state.integration || { available:false, reason:'desabilitada' },
      attempts:state.attempts || [],
      available:state.evidenceAvailable !== false,
    }
  } catch {
    const fallback = await fetchSignatureEvidence(documents, ownerId)
    return {
      integration:{ available:false, reason:'indisponivel' },
      attempts:fallback.rows.map(legacyAttempt),
      available:fallback.available,
    }
  }
}

async function fetchDocumentBundle(patientId, ownerId) {
  const documents = await fetchDocuments(patientId, ownerId)
  const signatures = await fetchSignatureBundle(documents, ownerId)
  return { documents, signatures }
}

function dateLabel(value) {
  if (!value) return 'Data não informada'
  return new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
}

function DocumentSummary({ record }) {
  const data = record.document_data || {}
  if (record.document_type === SIMPLE_PRESCRIPTION) {
    return <>{(data.items || []).map(item => [item.medication, item.presentation, item.directions].filter(Boolean).join(' — ')).filter(Boolean).join(' · ') || 'Receita sem itens disponíveis'}</>
  }
  return <>{(data.exams || []).join(', ') || 'Pedido sem exames disponíveis'}</>
}

export function ClinicalDocuments({ patient, ownerId, viewerId = '', author, profile, profileLoading = false, clinicName, canPrescribe = false, initialProtocolApplication, onProtocolApplicationConsumed }) {
  const [records, setRecords] = useState([])
  const [signatureByDocument, setSignatureByDocument] = useState({})
  const [signatureIntegration, setSignatureIntegration] = useState({ available:false, reason:'desabilitada' })
  const [signatureEvidenceAvailable, setSignatureEvidenceAvailable] = useState(true)
  const [signatureBusy, setSignatureBusy] = useState('')
  const [signatureNotice, setSignatureNotice] = useState('')
  const [confirmSignatureFor, setConfirmSignatureFor] = useState('')
  const [confirmAbandonFor, setConfirmAbandonFor] = useState('')
  const [status, setStatus] = useState('loading')
  const [editingType, setEditingType] = useState('')
  const [requestId, setRequestId] = useState('')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [protocols, setProtocols] = useState([])

  useEffect(() => {
    let active = true
    setStatus('loading')
    setRecords([])
    setError('')
    fetchDocumentBundle(patient.id, ownerId)
      .then(({ documents, signatures }) => {
        if (!active) return
        setRecords(documents)
        setSignatureByDocument(latestAttemptByDocument(signatures.attempts))
        setSignatureIntegration(signatures.integration)
        setSignatureEvidenceAvailable(signatures.available)
        setStatus('ready')
      })
      .catch(() => {
        if (!active) return
        setStatus('error')
        setError('Não foi possível carregar os documentos clínicos.')
      })
    return () => { active = false }
  }, [patient.id, ownerId])

  useEffect(() => {
    let active = true
    loadClinicalProtocols(ownerId, { activeOnly:true }).then(rows => { if (active) setProtocols(rows) }).catch(() => { if (active) setProtocols([]) })
    return () => { active = false }
  }, [ownerId])

  useEffect(() => {
    if (!initialProtocolApplication || profileLoading) return
    const type = initialProtocolApplication.destination === 'prescription' ? SIMPLE_PRESCRIPTION : EXAM_REQUEST
    if (type === SIMPLE_PRESCRIPTION && !canPrescribe) {
      setError('Somente o perfil administrador pode emitir receitas.')
      onProtocolApplicationConsumed?.()
      return
    }
    const defaults = clinicalDocumentDefaults({ type, issueDate:today(), profile, clinicName })
    setEditingType(type)
    setRequestId(uid())
    setForm(applyProtocolToDocumentDraft(initialProtocolApplication.version, type, defaults))
    setError('')
    onProtocolApplicationConsumed?.()
  }, [initialProtocolApplication?.id, profileLoading, patient.id])

  const logoDataUrl = profile?.clinic?.logoDataUrl || ''
  const groupedCount = useMemo(() => ({
    exams:records.filter(item => item.document_type === EXAM_REQUEST).length,
    prescriptions:records.filter(item => item.document_type === SIMPLE_PRESCRIPTION).length,
  }), [records])
  const signerReadiness = useMemo(() => clinicalSignerReadiness(profile), [profile])

  function begin(type) {
    if (type === SIMPLE_PRESCRIPTION && !canPrescribe) {
      setError('Somente o perfil administrador pode emitir receitas.')
      return
    }
    setEditingType(type)
    setRequestId(uid())
    setForm(clinicalDocumentDefaults({ type, issueDate:today(), profile, clinicName }))
    setError('')
  }

  function update(field, value) {
    setForm(current => ({ ...current, [field]:value }))
  }

  function updateMedication(index, field, value) {
    setForm(current => ({
      ...current,
      items:current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]:value } : item),
    }))
  }

  function addMedication() {
    setForm(current => ({ ...current, items:[...current.items, { medication:'', presentation:'', quantity:'', directions:'' }] }))
  }

  function applyProtocol(versionId) {
    const version = protocols.map(item => item.currentVersion).find(item => item?.id === versionId)
    if (!version) return
    setForm(current => applyProtocolToDocumentDraft(version, editingType, current))
  }

  function removeMedication(index) {
    setForm(current => ({ ...current, items:current.items.filter((_, itemIndex) => itemIndex !== index) }))
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError('')
    let issued = false
    try {
      const args = buildClinicalDocumentRpcArgs({
        patientId:patient.id,
        requestId,
        type:editingType,
        form,
        patient,
        author,
      })
      const { error:saveError } = await supabase.rpc('create_clinical_document', args)
      if (saveError) throw saveError
      issued = true
      setEditingType('')
      setForm(null)
      const fresh = await fetchDocumentBundle(patient.id, ownerId)
      setRecords(fresh.documents)
      setSignatureByDocument(latestAttemptByDocument(fresh.signatures.attempts))
      setSignatureIntegration(fresh.signatures.integration)
      setSignatureEvidenceAvailable(fresh.signatures.available)
      setStatus('ready')
    } catch (nextError) {
      if (issued) {
        setStatus('error')
        setError('O documento foi emitido, mas o histórico não pôde ser atualizado. Recarregue antes de tentar novamente.')
      } else {
        setError(nextError.message || 'Não foi possível emitir o documento.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function retryLoad() {
    setStatus('loading')
    setError('')
    try {
      const fresh = await fetchDocumentBundle(patient.id, ownerId)
      setRecords(fresh.documents)
      setSignatureByDocument(latestAttemptByDocument(fresh.signatures.attempts))
      setSignatureIntegration(fresh.signatures.integration)
      setSignatureEvidenceAvailable(fresh.signatures.available)
      setStatus('ready')
    } catch {
      setStatus('error')
      setError('Não foi possível carregar os documentos clínicos.')
    }
  }

  async function refreshSignatures() {
    const fresh = await fetchSignatureBundle(records, ownerId)
    setSignatureByDocument(latestAttemptByDocument(fresh.attempts))
    setSignatureIntegration(fresh.integration)
    setSignatureEvidenceAvailable(fresh.available)
  }

  // Abre a pagina da BRy sem dar acesso a esta janela (window.opener) e sem
  // nunca renderizar o link no DOM: ele e sensivel.
  function openExternal(url) {
    const popup = window.open(url, '_blank', 'noopener,noreferrer')
    if (popup) {
      popup.opener = null
      return true
    }
    return false
  }

  async function startSignature(record) {
    if (signatureBusy) return
    setConfirmSignatureFor('')
    setSignatureBusy(record.id)
    setSignatureNotice('')
    setError('')
    try {
      // Chave idempotente da solicitacao: um reenvio apos falha de rede nao
      // cria um segundo envelope nem consome outro credito.
      // Lote de um: a ficha do paciente assina um documento por vez.
      const response = await requestClinicalSignature([record.id], uid())
      await refreshSignatures()
      if (response.signingUrl) {
        if (!openExternal(response.signingUrl)) {
          setSignatureNotice('O navegador bloqueou a janela da BRy. Libere pop-ups e use "Abrir página de assinatura".')
        }
      } else {
        setSignatureNotice('A solicitação foi registrada, mas a BRy não devolveu a página de assinatura. Use "Atualizar status".')
      }
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível solicitar a assinatura digital.')
      await refreshSignatures().catch(() => {})
    } finally {
      setSignatureBusy('')
    }
  }

  async function openSigningPage(attempt) {
    if (signatureBusy) return
    setSignatureBusy(attempt.id)
    setSignatureNotice('')
    setError('')
    try {
      const response = await fetchClinicalSignatureLink(attempt.id)
      if (!openExternal(response.signingUrl)) {
        setSignatureNotice('O navegador bloqueou a janela da BRy. Libere pop-ups e tente novamente.')
      }
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível abrir a página de assinatura.')
    } finally {
      setSignatureBusy('')
    }
  }

  async function refreshSignatureStatus(attempt) {
    if (signatureBusy) return
    setSignatureBusy(attempt.id)
    setSignatureNotice('')
    setError('')
    try {
      await reconcileClinicalSignature(attempt.id)
      await refreshSignatures()
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível atualizar o status da assinatura.')
    } finally {
      setSignatureBusy('')
    }
  }

  async function abandonSignature(attempt) {
    if (signatureBusy) return
    setConfirmAbandonFor('')
    setSignatureBusy(attempt.id)
    setSignatureNotice('')
    setError('')
    try {
      await abandonClinicalSignature(attempt.id)
      await refreshSignatures()
      setSignatureNotice('Tentativa encerrada. Você já pode solicitar uma nova assinatura.')
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível encerrar a tentativa.')
    } finally {
      setSignatureBusy('')
    }
  }

  async function openSignedArtifact(attempt, kind) {
    if (signatureBusy) return
    setSignatureBusy(attempt.id)
    setSignatureNotice('')
    setError('')
    try {
      const response = await openClinicalSignatureArtifact(attempt.id, kind)
      if (!openExternal(response.url)) {
        setSignatureNotice('O navegador bloqueou a abertura do arquivo. Libere pop-ups e tente novamente.')
      }
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível abrir o arquivo.')
    } finally {
      setSignatureBusy('')
    }
  }

  function print(record) {
    setError('')
    if (!openClinicalDocumentPrint(record, { logoDataUrl })) {
      setError('O navegador bloqueou a janela de impressão. Libere pop-ups para imprimir ou salvar em PDF.')
    }
  }

  if (status === 'loading') return <div className="clinical-loading">Carregando exames e receitas…</div>
  if (status === 'error') {
    return <div className="clinical-empty-panel" role="alert"><strong>{error}</strong><Btn variant="ghost" onClick={retryLoad}>Tentar carregar novamente</Btn></div>
  }

  if (editingType && form) {
    return (
      <div className="clinical-document-editor">
        <header className="clinical-document-editor__header">
          <div><span>Novo documento</span><h3>{clinicalDocumentTypeLabel(editingType)}</h3></div>
          <label>Data de emissão<input type="date" value={form.issue_date} readOnly aria-readonly="true" /></label>
        </header>

        {error && <div className="clinical-form-error" role="alert">{error}</div>}

        <div className="clinical-document-legal-note">
          Esta etapa prepara o documento para impressão e assinatura manual. Ela ainda não realiza assinatura eletrônica qualificada.
        </div>

        {protocols.some(item => editingType === EXAM_REQUEST ? item.currentVersion.exam_kit?.length : item.currentVersion.medication_favorites?.length) && <section className="clinical-protocol-apply"><div><strong>Usar modelo da clínica</strong><span>Revise todos os itens antes de emitir.</span></div><select aria-label="Modelo de protocolo para o documento" defaultValue="" onChange={event => applyProtocol(event.target.value)}><option value="">Selecionar protocolo</option>{protocols.filter(item => editingType === EXAM_REQUEST ? item.currentVersion.exam_kit?.length : item.currentVersion.medication_favorites?.length).map(item => <option key={item.currentVersion.id} value={item.currentVersion.id}>{item.currentVersion.name}</option>)}</select></section>}

        {editingType === EXAM_REQUEST ? (
          <div className="clinical-document-fields">
            <label><span>Exames solicitados *</span><textarea aria-label="Exames solicitados *" rows="7" value={form.exams_text} onChange={event => update('exams_text', event.target.value)} placeholder={'Um exame por linha\nHemograma completo\nCoagulograma\nEletrocardiograma'} /></label>
            <label><span>Indicação clínica</span><textarea aria-label="Indicação clínica" rows="3" value={form.clinical_indication} onChange={event => update('clinical_indication', event.target.value)} placeholder="Hipótese ou contexto clínico pertinente" /></label>
            <label><span>Orientações ao paciente</span><textarea aria-label="Orientações ao paciente" rows="3" value={form.instructions} onChange={event => update('instructions', event.target.value)} placeholder="Jejum, prazo ou outras orientações" /></label>
          </div>
        ) : (
          <div className="clinical-prescription-editor">
            <div className="clinical-document-warning"><strong>Somente receituário simples.</strong> Não inclua medicamentos controlados nem sujeitos à retenção nesta versão.</div>
            {form.items.map((item, index) => (
              <div className="clinical-medication-row" key={index}>
                <header><strong>Medicamento {index + 1}</strong>{form.items.length > 1 && <button type="button" onClick={() => removeMedication(index)}>Remover</button>}</header>
                <div>
                  <label><span>Medicamento *</span><input aria-label={`Medicamento ${index + 1} *`} value={item.medication} onChange={event => updateMedication(index, 'medication', event.target.value)} placeholder="Princípio ativo ou nome" /></label>
                  <label><span>Apresentação</span><input aria-label={`Apresentação ${index + 1}`} value={item.presentation} onChange={event => updateMedication(index, 'presentation', event.target.value)} placeholder="Concentração e forma" /></label>
                  <label><span>Quantidade</span><input aria-label={`Quantidade ${index + 1}`} value={item.quantity} onChange={event => updateMedication(index, 'quantity', event.target.value)} placeholder="Ex.: 1 caixa" /></label>
                  <label className="is-wide"><span>Modo de usar *</span><textarea aria-label={`Modo de usar ${index + 1} *`} rows="2" value={item.directions} onChange={event => updateMedication(index, 'directions', event.target.value)} placeholder="Via, dose, frequência e duração, sem abreviações ambíguas" /></label>
                </div>
              </div>
            ))}
            <Btn variant="ghost" onClick={addMedication}>+ Adicionar medicamento</Btn>
            <label className="clinical-confirmation"><input type="checkbox" checked={form.simple_prescription_confirmed} onChange={event => update('simple_prescription_confirmed', event.target.checked)} /><span>Confirmo que esta receita não contém medicamento controlado nem sujeito à retenção.</span></label>
          </div>
        )}

        <section className="clinical-document-issuer">
          <h4>Identificação profissional no documento</h4>
          <p><strong>{author.name || 'Profissional não configurado'}</strong> · {author.council || 'CRM'} {author.registration || 'não informado'}</p>
          <div>
            <label><span>Telefone ou e-mail profissional *</span><input aria-label="Telefone ou e-mail profissional *" value={form.issuer_contact} onChange={event => update('issuer_contact', event.target.value)} /></label>
            <label><span>Endereço profissional *</span><input aria-label="Endereço profissional *" value={form.issuer_address} onChange={event => update('issuer_address', event.target.value)} /></label>
            <label><span>Nome da clínica</span><input aria-label="Nome da clínica" value={form.clinic_name} onChange={event => update('clinic_name', event.target.value)} /></label>
          </div>
        </section>

        <footer className="clinical-document-actions">
          <p>Depois de emitido, o registro fica imutável no histórico. Para corrigir, emita um novo documento.</p>
          <div><Btn variant="ghost" disabled={saving} onClick={() => { setEditingType(''); setForm(null); setError('') }}>Cancelar</Btn><Btn disabled={saving} onClick={save}>{saving ? 'Emitindo…' : 'Emitir documento'}</Btn></div>
        </footer>
      </div>
    )
  }

  return (
    <div className="clinical-documents">
      <header className="clinical-documents__toolbar">
        <div><span>Documentos emitidos</span><strong>{records.length} no histórico</strong><small>{groupedCount.exams} exames · {groupedCount.prescriptions} receitas</small></div>
        <div><Btn variant="ghost" disabled={profileLoading} onClick={() => begin(EXAM_REQUEST)}>+ Pedido de exames</Btn>{canPrescribe && <Btn disabled={profileLoading} onClick={() => begin(SIMPLE_PRESCRIPTION)}>+ Receita simples</Btn>}</div>
      </header>

      {error && <div className="clinical-form-error" role="alert">{error}</div>}
      {profileLoading && <div className="clinical-document-access-note">Carregando dados profissionais e o timbre da clínica…</div>}
      <div className="clinical-signature-readiness" data-testid="clinical-signature-readiness">
        <div>
          <strong>Assinatura clínica ICP-Brasil</strong>
          <span>
            {signatureIntegration.available
              ? 'A assinatura acontece na página segura da BRy. O documento original permanece imutável e cada tentativa é registrada como evidência separada.'
              : 'Integração com a BRy indisponível nesta instalação. Os documentos continuam disponíveis para impressão e assinatura manual.'}
          </span>
        </div>
        <span className={signerReadiness.ready ? 'is-ready' : 'is-pending'}>
          {signerReadiness.ready ? 'Identidade profissional completa' : `Pendente: ${signerReadiness.missing.join(', ')}`}
        </span>
      </div>
      {/* Nunca prometer assinatura qualificada enquanto a integração não estiver
          habilitada e homologada. */}
      <div className="clinical-document-legal-note">
        {signatureIntegration.available
          ? 'A assinatura é feita pelo próprio profissional, com o certificado dele, na página da BRy. Esta tela nunca recebe certificado, chave privada ou senha.'
          : 'Enquanto a integração não estiver disponível, os PDFs continuam disponíveis para impressão e assinatura manual. Não envie certificado A1 ou senha por esta tela.'}
      </div>
      {signatureNotice && <div className="clinical-document-access-note" role="status">{signatureNotice}</div>}
      {!signatureEvidenceAvailable && <div className="clinical-document-access-note">O histórico clínico está disponível, mas o status de assinatura digital não pôde ser consultado. A via manual não foi afetada.</div>}
      {!canPrescribe && <div className="clinical-document-access-note">Receitas podem ser emitidas somente por usuários com perfil administrador. Você ainda pode consultar o histórico e emitir pedidos de exames.</div>}

      {records.length === 0 ? (
        <div className="clinical-empty-panel"><strong>Nenhum documento emitido</strong><p>Crie pedidos de exames ou receitas simples sem sair da ficha do paciente.</p></div>
      ) : (
        <div className="clinical-document-history">
          {records.map(record => {
            const attempt = signatureByDocument[record.id]
            const signatureState = clinicalSignatureActionState({
              record,
              attempt,
              integration:signatureIntegration,
              viewerId,
              evidenceAvailable:signatureEvidenceAvailable,
            })
            const busy = Boolean(signatureBusy) && (signatureBusy === record.id || signatureBusy === attempt?.id)
            const eligible = isClinicalSignatureEligible(record)
            return <article key={record.id} data-testid={`clinical-document-${record.id}`}>
              <div className={`clinical-document-icon is-${record.document_type}`}>{record.document_type === SIMPLE_PRESCRIPTION ? 'Rx' : 'Ex'}</div>
              <div className="clinical-document-history__body">
                <span>{clinicalDocumentTypeLabel(record.document_type)} · {dateLabel(record.issue_date)}</span>
                <strong><DocumentSummary record={record} /></strong>
                <small>{record.author_name} · {professionalRegistration(record)}</small>
                <small className={`clinical-signature-status is-${signatureState.tone}`} data-testid="clinical-signature-status">{signatureState.label}</small>
                {signatureState.note && <small className="clinical-signature-note">{signatureState.note}</small>}

                {confirmSignatureFor === record.id ? (
                  <div className="clinical-signature-confirm" role="group" aria-label="Confirmar assinatura digital">
                    <span>Esta solicitação consome créditos da BRy e abre a página segura de assinatura em outra aba. Confirmar?</span>
                    <div>
                      <Btn variant="ghost" disabled={busy} onClick={() => setConfirmSignatureFor('')}>Cancelar</Btn>
                      <Btn disabled={busy} onClick={() => startSignature(record)}>{busy ? 'Solicitando…' : 'Confirmar e assinar'}</Btn>
                    </div>
                  </div>
                ) : confirmAbandonFor === attempt?.id ? (
                  <div className="clinical-signature-confirm" role="group" aria-label="Encerrar tentativa de assinatura">
                    <span>A BRy não confirmou esta tentativa e o crédito pode já ter sido consumido. Encerrar para liberar uma nova solicitação?</span>
                    <div>
                      <Btn variant="ghost" disabled={busy} onClick={() => setConfirmAbandonFor('')}>Voltar</Btn>
                      <Btn disabled={busy} onClick={() => abandonSignature(attempt)}>{busy ? 'Encerrando…' : 'Encerrar tentativa'}</Btn>
                    </div>
                  </div>
                ) : (
                  <div className="clinical-signature-actions">
                    {signatureState.canRequest && (
                      <Btn variant="ghost" disabled={busy} onClick={() => setConfirmSignatureFor(record.id)}>Assinar com BRy</Btn>
                    )}
                    {signatureState.canRetry && (
                      <Btn variant="ghost" disabled={busy} onClick={() => setConfirmSignatureFor(record.id)}>Tentar assinar novamente</Btn>
                    )}
                    {signatureState.canOpenSigningPage && (
                      <Btn variant="ghost" disabled={busy} onClick={() => openSigningPage(attempt)}>Abrir página de assinatura</Btn>
                    )}
                    {signatureState.canReconcile && (
                      <Btn variant="ghost" disabled={busy} onClick={() => refreshSignatureStatus(attempt)}>{busy ? 'Atualizando…' : 'Atualizar status'}</Btn>
                    )}
                    {signatureState.canAbandon && (
                      <Btn variant="ghost" disabled={busy} onClick={() => setConfirmAbandonFor(attempt.id)}>Encerrar tentativa</Btn>
                    )}
                    {signatureState.canOpenSigned && (
                      <Btn variant="ghost" disabled={busy} onClick={() => openSignedArtifact(attempt, 'signed')}>Abrir PDF assinado</Btn>
                    )}
                    {!signatureState.canOpenSigned && signatureState.canOpenArtifact && (
                      <Btn variant="ghost" disabled={busy} onClick={() => openSignedArtifact(attempt, 'signed')}>Abrir arquivo devolvido pela BRy</Btn>
                    )}
                  </div>
                )}
              </div>
              {/* A via manual permanece sempre disponível, separada da digital. */}
              <Btn variant="ghost" onClick={() => print(record)}>{eligible && attempt?.evidenceComplete ? 'Imprimir via manual' : 'Imprimir / salvar PDF'}</Btn>
            </article>
          })}
        </div>
      )}
    </div>
  )
}
