import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { today, uid } from '../utils.js'
import {
  buildClinicalDocumentRpcArgs,
  clinicalDocumentDefaults,
  clinicalDocumentTypeLabel,
  CLINICAL_DOCUMENT_TYPES,
  hasCompletePatientAddress,
  openClinicalDocumentPrint,
  patientResidentialAddress,
  professionalRegistration,
} from '../lib/clinicalDocuments.js'
import {
  clinicalSignatureActionState,
  clinicalSignaturePrimaryActionLabel,
  clinicalSignerReadiness,
  hasCompleteClinicalSignatureEvidence,
  isClinicalSignatureEligible,
  latestAttemptByDocument,
} from '../lib/clinicalSignature.js'
import { fetchClinicalSignatureState } from '../lib/clinicalSignatureBryClient.js'
import { Btn } from './UI.jsx'
import { loadClinicalProtocols } from '../lib/clinicalProtocolClient.js'
import { applyProtocolToDocumentDraft, buildClinicalProtocolRpcArgs } from '../lib/clinicalProtocols.js'
import { buildClinicalDocumentTemplate, defaultClinicalDocumentTemplateName } from '../lib/clinicalDocumentTemplates.js'
import { AutoGrowTextarea } from './AutoGrowTextarea.jsx'

const { EXAM_REQUEST, SIMPLE_PRESCRIPTION } = CLINICAL_DOCUMENT_TYPES

async function fetchDocuments(patientId, ownerId) {
  const { data, error } = await supabase
    .from('clinical_documents')
    .select('*')
    .eq('patient_id', patientId)
    .eq('user_id', ownerId)
    .in('document_type', [EXAM_REQUEST, SIMPLE_PRESCRIPTION])
    // Arquivado some das telas, mas permanece integro no banco: documento de
    // prontuario nao e apagado (CFM/LGPD).
    .is('archived_at', null)
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

export function ClinicalDocuments({ patient, ownerId, viewerId = '', author, profile, profileLoading = false, clinicName, canPrescribe = false, initialDocumentType = '', onInitialDocumentTypeConsumed, initialProtocolApplication, onProtocolApplicationConsumed, onDocumentCreated, onOpenSignatureCenter }) {
  const [records, setRecords] = useState([])
  const [signatureByDocument, setSignatureByDocument] = useState({})
  const [signatureIntegration, setSignatureIntegration] = useState({ available:false, reason:'desabilitada' })
  const [signatureEvidenceAvailable, setSignatureEvidenceAvailable] = useState(true)
  const [status, setStatus] = useState('loading')
  const [editingType, setEditingType] = useState('')
  const [requestId, setRequestId] = useState('')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Arquivamento (soft delete) de documento emitido: some da tela, permanece
  // integro no banco. Documento de prontuario nao e apagado (CFM/LGPD).
  const [confirmArchiveFor, setConfirmArchiveFor] = useState('')
  const [archiveReason, setArchiveReason] = useState('')
  const [archiving, setArchiving] = useState(false)
  // O efeito que carrega os documentos ja sabe recarregar: mudar este token
  // e o que o dispara de novo, sem duplicar a logica de busca.
  const [reloadToken, setReloadToken] = useState(0)
  const [protocols, setProtocols] = useState([])
  const [editorExpanded, setEditorExpanded] = useState(false)
  const [selectedProtocolId, setSelectedProtocolId] = useState('')
  const [saveAsModel, setSaveAsModel] = useState(true)
  const [modelName, setModelName] = useState('')

  useEffect(() => {
    if (!editorExpanded) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [editorExpanded])

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
  }, [patient.id, ownerId, reloadToken])

  useEffect(() => {
    let active = true
    loadClinicalProtocols(ownerId, { activeOnly:true }).then(rows => { if (active) setProtocols(rows) }).catch(() => { if (active) setProtocols([]) })
    return () => { active = false }
  }, [ownerId])

  useEffect(() => {
    if (!initialDocumentType || profileLoading) return
    if (![EXAM_REQUEST, SIMPLE_PRESCRIPTION].includes(initialDocumentType)) {
      setError('Selecione um tipo de documento válido.')
      onInitialDocumentTypeConsumed?.()
      return
    }
    begin(initialDocumentType)
    onInitialDocumentTypeConsumed?.()
  }, [initialDocumentType, profileLoading, patient.id])

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
    setSelectedProtocolId(initialProtocolApplication.version.id || '')
    setSaveAsModel(false)
    setModelName(initialProtocolApplication.version.name || '')
    setError('')
    onProtocolApplicationConsumed?.()
  }, [initialProtocolApplication?.id, profileLoading, patient.id])

  const logoDataUrl = profile?.clinic?.logoDataUrl || ''
  const groupedCount = useMemo(() => ({
    exams:records.filter(item => item.document_type === EXAM_REQUEST).length,
    prescriptions:records.filter(item => item.document_type === SIMPLE_PRESCRIPTION).length,
  }), [records])
  const signerReadiness = useMemo(() => clinicalSignerReadiness(profile), [profile])
  const patientAddressComplete = hasCompletePatientAddress(patient)
  const patientAddress = patientResidentialAddress(patient)

  function begin(type) {
    if (type === SIMPLE_PRESCRIPTION && !canPrescribe) {
      setError('Somente o perfil administrador pode emitir receitas.')
      return
    }
    setEditingType(type)
    setRequestId(uid())
    setForm(clinicalDocumentDefaults({ type, issueDate:today(), profile, clinicName }))
    setSelectedProtocolId('')
    setSaveAsModel(true)
    setModelName(defaultClinicalDocumentTemplateName(type))
    setError('')
    setEditorExpanded(false)
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
    setSelectedProtocolId(versionId)
    if (!versionId) {
      setForm(clinicalDocumentDefaults({ type:editingType, issueDate:today(), profile, clinicName }))
      setSaveAsModel(true)
      setModelName(defaultClinicalDocumentTemplateName(editingType))
      return
    }
    const version = protocols.map(item => item.currentVersion).find(item => item?.id === versionId)
    if (!version) return
    setForm(current => applyProtocolToDocumentDraft(version, editingType, current))
    setSaveAsModel(false)
    setModelName(version.name || '')
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
      let templateWarning = ''
      if (saveAsModel) {
        try {
          const template = buildClinicalDocumentTemplate({ type:editingType, form, name:modelName })
          const templateArgs = buildClinicalProtocolRpcArgs({ protocolId:null, requestId:uid(), form:template })
          const { error:templateError } = await supabase.rpc('save_clinical_protocol', templateArgs)
          if (templateError) throw templateError
          const freshProtocols = await loadClinicalProtocols(ownerId, { activeOnly:true })
          setProtocols(freshProtocols)
        } catch (templateError) {
          templateWarning = ` O documento foi emitido, mas o modelo não foi salvo: ${templateError.message || 'tente novamente.'}`
        }
      }
      setEditingType('')
      setForm(null)
      setEditorExpanded(false)
      const fresh = await fetchDocumentBundle(patient.id, ownerId)
      setRecords(fresh.documents)
      setSignatureByDocument(latestAttemptByDocument(fresh.signatures.attempts))
      setSignatureIntegration(fresh.signatures.integration)
      setSignatureEvidenceAvailable(fresh.signatures.available)
      setStatus('ready')
      if (templateWarning) setError(templateWarning.trim())
      Promise.resolve(onDocumentCreated?.()).catch(() => {})
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
      <div className={`clinical-document-editor${editorExpanded ? ' is-expanded' : ''}`}>
        <header className="clinical-document-editor__header">
          <div><span>Novo documento</span><h3>{clinicalDocumentTypeLabel(editingType)}</h3></div>
          <div className="clinical-document-editor__header-actions">
            <label>Data de emissão<input type="date" value={form.issue_date} readOnly aria-readonly="true" /></label>
            <Btn variant="ghost" aria-expanded={editorExpanded} onClick={() => setEditorExpanded(value => !value)}>{editorExpanded ? 'Reduzir editor' : 'Expandir editor'}</Btn>
          </div>
        </header>

        {error && <div className="clinical-form-error" role="alert">{error}</div>}

        <div className="clinical-document-legal-note">
          Esta etapa prepara o documento para impressão e assinatura manual. Ela ainda não realiza assinatura eletrônica qualificada.
        </div>

        <section className="clinical-document-template-controls">
          <label className="clinical-document-template-select"><span>Modelo salvo</span><select aria-label="Modelo de protocolo para o documento" value={selectedProtocolId} onChange={event => applyProtocol(event.target.value)}>
            <option value="">Preencher sem modelo</option>
            {protocols.filter(item => editingType === EXAM_REQUEST ? item.currentVersion.exam_kit?.length : item.currentVersion.medication_favorites?.length).map(item => <option key={item.currentVersion.id} value={item.currentVersion.id}>{item.currentVersion.name}</option>)}
          </select></label>
          <label className="clinical-document-template-checkbox"><input className="clinical-document-template-checkbox__input" type="checkbox" checked={saveAsModel} onChange={event => setSaveAsModel(event.target.checked)} /> <span>Salvar para usar novamente</span></label>
          {saveAsModel && <label className="clinical-document-template-name"><span>Nome do modelo</span><input aria-label="Nome do modelo" value={modelName} onChange={event => setModelName(event.target.value)} placeholder={defaultClinicalDocumentTemplateName(editingType)} /></label>}
          {!saveAsModel && selectedProtocolId && <small>Este documento será emitido sem criar outro modelo.</small>}
        </section>

        {editingType === EXAM_REQUEST ? (
          <div className="clinical-document-fields">
            <label><span>Exames solicitados *</span><AutoGrowTextarea aria-label="Exames solicitados *" rows="7" minHeight={180} value={form.exams_text} onChange={event => update('exams_text', event.target.value)} placeholder={'Um exame por linha\nHemograma completo\nCoagulograma\nEletrocardiograma'} /></label>
            <label><span>Indicação clínica</span><AutoGrowTextarea aria-label="Indicação clínica" rows="3" minHeight={108} value={form.clinical_indication} onChange={event => update('clinical_indication', event.target.value)} placeholder="Hipótese ou contexto clínico pertinente" /></label>
            <label><span>Orientações ao paciente</span><AutoGrowTextarea aria-label="Orientações ao paciente" rows="3" minHeight={108} value={form.instructions} onChange={event => update('instructions', event.target.value)} placeholder="Jejum, prazo ou outras orientações" /></label>
          </div>
        ) : (
          <div className="clinical-prescription-editor">
            <div
              className={patientAddressComplete ? 'clinical-document-access-note' : 'clinical-document-warning'}
              data-testid="clinical-patient-address"
            >
              <strong>Endereço residencial do paciente (vem do cadastro):</strong>{' '}
              {patientAddressComplete ? patientAddress : 'incompleto — faltam rua, número, cidade e/ou estado.'}
              <br />
              <span>Para corrigir, acesse Relacionamento → Pacientes → Editar → Endereço. O endereço profissional da clínica é outro dado e aparece separadamente abaixo.</span>
            </div>
            <div className="clinical-document-warning"><strong>Somente receituário simples.</strong> Não inclua medicamentos controlados nem sujeitos à retenção nesta versão.</div>
            {form.items.map((item, index) => (
              <div className="clinical-medication-row" key={index}>
                <header><strong>Medicamento {index + 1}</strong>{form.items.length > 1 && <button type="button" onClick={() => removeMedication(index)}>Remover</button>}</header>
                <div>
                  <label><span>Medicamento *</span><input aria-label={`Medicamento ${index + 1} *`} value={item.medication} onChange={event => updateMedication(index, 'medication', event.target.value)} placeholder="Princípio ativo ou nome" /></label>
                  <label><span>Apresentação</span><input aria-label={`Apresentação ${index + 1}`} value={item.presentation} onChange={event => updateMedication(index, 'presentation', event.target.value)} placeholder="Concentração e forma" /></label>
                  <label><span>Quantidade</span><input aria-label={`Quantidade ${index + 1}`} value={item.quantity} onChange={event => updateMedication(index, 'quantity', event.target.value)} placeholder="Ex.: 1 caixa" /></label>
                  <label className="is-wide"><span>Modo de usar *</span><AutoGrowTextarea aria-label={`Modo de usar ${index + 1} *`} rows="2" minHeight={92} value={item.directions} onChange={event => updateMedication(index, 'directions', event.target.value)} placeholder="Via, dose, frequência e duração, sem abreviações ambíguas" /></label>
                </div>
              </div>
            ))}
            <Btn variant="ghost" onClick={addMedication}>+ Adicionar medicamento</Btn>
            <label className="clinical-confirmation"><input type="checkbox" checked={form.simple_prescription_confirmed} onChange={event => update('simple_prescription_confirmed', event.target.checked)} /><span>Confirmo que esta receita não contém medicamento controlado nem sujeito à retenção.</span></label>
          </div>
        )}

        <section className="clinical-document-issuer">
          <h4>Identificação profissional e endereço da clínica</h4>
          <p><strong>{author.name || 'Profissional não configurado'}</strong> · {author.council || 'CRM'} {author.registration || 'não informado'}</p>
          {editingType === SIMPLE_PRESCRIPTION && <p>Estes dados identificam o profissional e a clínica; não substituem o endereço residencial do paciente.</p>}
          <div>
            <label><span>Telefone ou e-mail profissional *</span><input aria-label="Telefone ou e-mail profissional *" value={form.issuer_contact} onChange={event => update('issuer_contact', event.target.value)} /></label>
            <label><span>Endereço profissional *</span><input aria-label="Endereço profissional *" value={form.issuer_address} onChange={event => update('issuer_address', event.target.value)} /></label>
            <label><span>Nome da clínica</span><input aria-label="Nome da clínica" value={form.clinic_name} onChange={event => update('clinic_name', event.target.value)} /></label>
          </div>
        </section>

        <footer className="clinical-document-actions">
          <p>Depois de emitido, o registro fica imutável no histórico. Para corrigir, emita um novo documento.</p>
          <div><Btn variant="ghost" disabled={saving} onClick={() => { setEditorExpanded(false); setEditingType(''); setForm(null); setError('') }}>Cancelar</Btn><Btn disabled={saving} onClick={save}>{saving ? 'Emitindo…' : 'Emitir documento'}</Btn></div>
        </footer>
      </div>
    )
  }

  // Arquivar NAO e apagar: a linha permanece integra no banco, com quem
  // arquivou e quando. Documento de prontuario tem guarda obrigatoria.
  async function archiveDocument(record) {
    setArchiving(true)
    setError('')
    try {
      const { error:archiveError } = await supabase.rpc('archive_clinical_document', {
        p_document_id:record.id,
        p_reason:archiveReason.trim() || null,
      })
      if (archiveError) throw archiveError
      setConfirmArchiveFor('')
      setArchiveReason('')
      setReloadToken(current => current + 1)
      if (onDocumentCreated) onDocumentCreated()
    } catch (caught) {
      setError(caught.message || 'Não foi possível arquivar este documento.')
    } finally {
      setArchiving(false)
    }
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
          <strong>Assinatura digital</strong>
          <span>
            {signatureIntegration.available
              ? 'Você assina com o seu próprio certificado digital ICP-Brasil, numa página externa segura. Esta tela nunca pede nem guarda certificado ou senha.'
              : 'A assinatura digital ainda não está disponível aqui. Por enquanto, imprima e assine à mão.'}
          </span>
        </div>
        <span className={signerReadiness.ready ? 'is-ready' : 'is-pending'}>
          {signerReadiness.ready ? 'Identidade profissional completa' : `Pendente: ${signerReadiness.missing.join(', ')}`}
        </span>
      </div>
      {/* Nunca prometer assinatura qualificada enquanto a integração não estiver
          habilitada e homologada. */}
      {!signatureEvidenceAvailable && <div className="clinical-document-access-note">Não conseguimos checar o status da assinatura agora. Você ainda pode imprimir e assinar à mão.</div>}
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
            const eligible = isClinicalSignatureEligible(record)
            const canArchive = record.created_by === viewerId || canPrescribe
            const primaryActionLabel = clinicalSignaturePrimaryActionLabel(signatureState)
            return <article key={record.id} data-testid={`clinical-document-${record.id}`}>
              <div className={`clinical-document-icon is-${record.document_type}`}>{record.document_type === SIMPLE_PRESCRIPTION ? 'Rx' : 'Ex'}</div>
              <div className="clinical-document-history__body">
                <span>{clinicalDocumentTypeLabel(record.document_type)} · {dateLabel(record.issue_date)}</span>
                <strong><DocumentSummary record={record} /></strong>
                <small>{record.author_name} · {professionalRegistration(record)}</small>
                <small className={`clinical-signature-status is-${signatureState.tone}`} data-testid="clinical-signature-status">{signatureState.label}</small>
                {signatureState.note && <small className="clinical-signature-note">{signatureState.note}</small>}

                {/* Esta ficha so mostra status: a assinatura em si (pedir, acompanhar,
                    atualizar ou encerrar) acontece so na central (Clinico -> Documentos),
                    pra nao ter dois lugares com botoes diferentes pra mesma coisa. */}
                {primaryActionLabel && (
                  <div className="clinical-signature-actions">
                    <Btn variant="ghost" onClick={() => onOpenSignatureCenter?.(record)}>{primaryActionLabel}</Btn>
                  </div>
                )}
              </div>
              {/* A via manual permanece sempre disponível, separada da digital. */}
              <Btn variant="ghost" onClick={() => print(record)}>{eligible && attempt?.evidenceComplete ? 'Imprimir via manual' : 'Imprimir / salvar PDF'}</Btn>
              {canArchive && (confirmArchiveFor === record.id ? (
                <div className="clinical-signature-confirm" role="group" aria-label="Arquivar documento">
                  <span>O documento sai da lista, mas <strong>permanece no banco</strong> — documento de prontuário não é apagado. Fica registrado quem arquivou e quando.</span>
                  <input
                    type="text"
                    aria-label="Motivo do arquivamento"
                    placeholder="Motivo (opcional)"
                    value={archiveReason}
                    maxLength={300}
                    onChange={event => setArchiveReason(event.target.value)}
                  />
                  <div>
                    <Btn variant="ghost" disabled={archiving} onClick={() => { setConfirmArchiveFor(''); setArchiveReason('') }}>Cancelar</Btn>
                    <Btn variant="danger" disabled={archiving} onClick={() => archiveDocument(record)}>{archiving ? 'Arquivando…' : 'Arquivar'}</Btn>
                  </div>
                </div>
              ) : (
                <Btn variant="ghost" disabled={archiving} onClick={() => { setConfirmArchiveFor(record.id); setArchiveReason('') }}>Arquivar</Btn>
              ))}
            </article>
          })}
        </div>
      )}
    </div>
  )
}
