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
  clinicalSignerReadiness,
  clinicalSignaturePresentation,
  latestClinicalSignatureByDocument,
} from '../lib/clinicalSignature.js'
import { Btn } from './UI.jsx'

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

async function fetchDocumentBundle(patientId, ownerId) {
  const documents = await fetchDocuments(patientId, ownerId)
  const signatures = await fetchSignatureEvidence(documents, ownerId)
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

export function ClinicalDocuments({ patient, ownerId, author, profile, profileLoading = false, clinicName, canPrescribe = false }) {
  const [records, setRecords] = useState([])
  const [signatureByDocument, setSignatureByDocument] = useState({})
  const [signatureEvidenceAvailable, setSignatureEvidenceAvailable] = useState(true)
  const [status, setStatus] = useState('loading')
  const [editingType, setEditingType] = useState('')
  const [requestId, setRequestId] = useState('')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setStatus('loading')
    setRecords([])
    setError('')
    fetchDocumentBundle(patient.id, ownerId)
      .then(({ documents, signatures }) => {
        if (!active) return
        setRecords(documents)
        setSignatureByDocument(latestClinicalSignatureByDocument(signatures.rows))
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
      setSignatureByDocument(latestClinicalSignatureByDocument(fresh.signatures.rows))
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
      setSignatureByDocument(latestClinicalSignatureByDocument(fresh.signatures.rows))
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
      <div className="clinical-document-editor">
        <header className="clinical-document-editor__header">
          <div><span>Novo documento</span><h3>{clinicalDocumentTypeLabel(editingType)}</h3></div>
          <label>Data de emissão<input type="date" value={form.issue_date} readOnly aria-readonly="true" /></label>
        </header>

        {error && <div className="clinical-form-error" role="alert">{error}</div>}

        <div className="clinical-document-legal-note">
          Esta etapa prepara o documento para impressão e assinatura manual. Ela ainda não realiza assinatura eletrônica qualificada.
        </div>

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
      <div className="clinical-signature-readiness">
        <div>
          <strong>Assinatura clínica ICP-Brasil preparada</strong>
          <span>O documento original permanece imutável; assinatura, hash e certificado serão registrados como evidências separadas quando o provedor for conectado.</span>
        </div>
        <span className={signerReadiness.ready ? 'is-ready' : 'is-pending'}>
          {signerReadiness.ready ? 'Identidade profissional completa' : `Pendente: ${signerReadiness.missing.join(', ')}`}
        </span>
      </div>
      <div className="clinical-document-legal-note">Enquanto o provedor não estiver conectado, os PDFs continuam disponíveis para impressão e assinatura manual. Não envie certificado A1 ou senha por esta tela.</div>
      {!signatureEvidenceAvailable && <div className="clinical-document-access-note">O histórico clínico está disponível, mas o status de assinatura digital não pôde ser consultado. A via manual não foi afetada.</div>}
      {!canPrescribe && <div className="clinical-document-access-note">Receitas podem ser emitidas somente por usuários com perfil administrador. Você ainda pode consultar o histórico e emitir pedidos de exames.</div>}

      {records.length === 0 ? (
        <div className="clinical-empty-panel"><strong>Nenhum documento emitido</strong><p>Crie pedidos de exames ou receitas simples sem sair da ficha do paciente.</p></div>
      ) : (
        <div className="clinical-document-history">
          {records.map(record => {
            const signature = signatureByDocument[record.id]
            const signatureState = clinicalSignaturePresentation(signature, { evidenceAvailable:signatureEvidenceAvailable })
            return <article key={record.id}>
              <div className={`clinical-document-icon is-${record.document_type}`}>{record.document_type === SIMPLE_PRESCRIPTION ? 'Rx' : 'Ex'}</div>
              <div className="clinical-document-history__body">
                <span>{clinicalDocumentTypeLabel(record.document_type)} · {dateLabel(record.issue_date)}</span>
                <strong><DocumentSummary record={record} /></strong>
                <small>{record.author_name} · {professionalRegistration(record)}</small>
                <small className={`clinical-signature-status is-${signatureState.tone}`}>{signatureState.label}</small>
              </div>
              <Btn variant="ghost" onClick={() => print(record)}>{signature?.status === 'signed' ? 'Imprimir via manual' : 'Imprimir / salvar PDF'}</Btn>
            </article>
          })}
        </div>
      )}
    </div>
  )
}
