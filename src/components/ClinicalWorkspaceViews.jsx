import { useEffect, useMemo, useRef, useState } from 'react'
import { Btn } from './UI.jsx'
import { uid } from '../utils.js'
import { supabase } from '../lib/supabase.js'
import {
  abandonClinicalSignature,
  fetchClinicalSignatureLink,
  fetchClinicalSignatureQueue,
  openClinicalSignatureArtifact,
  reconcileClinicalSignature,
  requestClinicalSignature,
} from '../lib/clinicalSignatureBryClient.js'
import { clinicalPendingLabel, clinicalTimelineLabel } from '../lib/clinicalWorkspaceIndex.js'
import { clinicalSignatureEvidenceGapNote } from '../lib/clinicalSignature.js'

// Traduz a resposta de uma acao de assinatura (request/reconcile) numa frase
// so, sem termo tecnico: por que falhou, ou o que falta pra confirmar.
function signatureOutcomeNotice(attempt) {
  if (!attempt) return ''
  if (attempt.evidenceGapCode) return clinicalSignatureEvidenceGapNote(attempt.evidenceGapCode)
  if (['failed', 'cancelled'].includes(attempt.status)) return attempt.failureMessage || ''
  return ''
}

const SIGNATURE_STATUS_LABEL = {
  manual:'Ainda não assinado', pending:'Assinatura em andamento', signed:'Assinado',
  failed:'A assinatura não deu certo', cancelled:'Assinatura cancelada',
}

// Atualiza so a bolha de assinatura dentro do dialogo aberto, sem esperar o
// proximo carregamento completo do index (que pode nao refletir ainda a
// resposta que acabamos de receber do servidor).
function withUpdatedSignature(document, attempt) {
  if (!document || !attempt) return document
  return {
    ...document,
    signature:{ status:attempt.status, label:SIGNATURE_STATUS_LABEL[attempt.status] || document.signature.label, attemptId:attempt.id || document.signature.attemptId },
  }
}
import { WhatsAppGlyph } from './WhatsAppGlyph.jsx'
import { ClinicalIcon } from './ClinicalIcons.jsx'

const MAIL_PATH = 'M2 5.5A1.5 1.5 0 0 1 3.5 4h17A1.5 1.5 0 0 1 22 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18.5v-13Zm2.2.5 7.4 6.1a.6.6 0 0 0 .8 0L19.8 6H4.2ZM4 7.4V18h16V7.4l-7.1 5.85a2.6 2.6 0 0 1-3.4 0L4 7.4Z'

function MailGlyph({ size = 15, title = 'E-mail' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" role="img" aria-label={title}>
      <title>{title}</title>
      <path d={MAIL_PATH} />
    </svg>
  )
}

const dateLabel = (value, withTime = false) => {
  if (!value) return 'Não informado'
  const parsed = new Date(String(value).length === 10 ? `${value}T12:00:00` : value)
  if (Number.isNaN(parsed.getTime())) return 'Não informado'
  return parsed.toLocaleDateString('pt-BR', withTime ? { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' } : { day:'2-digit', month:'short', year:'numeric' })
}

const includesText = (values, query) => values.some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query))

const documentTypeLabel = type => ({
  simple_prescription:'Receita simples',
  attached_pdf:'PDF anexado',
  exam_request:'Pedido de exames',
})[type] || 'Documento clínico'

const signatureQueueCategory = (document, viewerId = '') => {
  if (document.signature.status === 'signed') return 'signed'
  if (['failed', 'cancelled'].includes(document.signature.status)) return 'attention'
  if (document.signature.status === 'pending') return 'pending'
  return viewerId && document.created_by === viewerId ? 'action' : 'pending'
}

const signatureNextAction = (document, canStartSignature) => {
  if (document.signature.status === 'signed') return 'Documento confirmado e pronto para uso.'
  if (document.signature.status === 'pending') return 'Abra a página segura ou atualize o status da assinatura.'
  if (['failed', 'cancelled'].includes(document.signature.status)) {
    return canStartSignature ? 'Revise o motivo e inicie uma nova tentativa.' : 'Aguarde o profissional que emitiu o documento.'
  }
  return canStartSignature ? 'Inicie a assinatura na página segura da BRy.' : 'A assinatura depende do profissional que emitiu o documento.'
}

const normalizeWhatsappPhone = value => {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.startsWith('55') ? digits : `55${digits}`
}

function openWhatsappForDocument({ patient, clinicName, document }) {
  const phone = normalizeWhatsappPhone(patient?.phone)
  if (!phone) return false
  const firstName = String(patient?.full_name || 'Olá').trim().split(/\s+/)[0]
  const purpose = document.signature.status === 'pending' ? 'para continuidade da assinatura' : 'para visualização'
  const message = `Olá, ${firstName}. Tudo bem? Aqui é da ${clinicName || 'clínica'}. Estamos entrando em contato sobre seu documento ${purpose}. Qualquer dúvida, estamos à disposição.`
  const popup = window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  if (popup) popup.opener = null
  return Boolean(popup)
}

function openEmailForDocument({ patient, clinicName, document }) {
  const email = String(patient?.email || '').trim()
  if (!email) return false
  const firstName = String(patient?.full_name || 'Olá').trim().split(/\s+/)[0]
  const purpose = document.signature.status === 'pending' ? 'para continuidade da assinatura' : 'para visualização'
  const subject = `${clinicName || 'Clínica'} - documento de ${patient?.full_name || 'paciente'}`
  const body = `Olá, ${firstName}. Tudo bem? Aqui é da ${clinicName || 'clínica'}. Estamos entrando em contato sobre seu documento ${purpose}. Qualquer dúvida, estamos à disposição.`
  window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  return true
}

function ClinicalDocumentJourney({ signatureStatus = 'manual' }) {
  const signed = signatureStatus === 'signed'
  const signing = signatureStatus === 'pending'
  const failed = ['failed', 'cancelled'].includes(signatureStatus)
  return (
    <div className="clinical-document-journey" aria-label="Etapas do documento">
      <div className="is-complete"><b>1</b><span><strong>Anexar ou emitir</strong><small>Arquivo no prontuário</small></span></div>
      <i aria-hidden="true" />
      <div className={signed ? 'is-complete' : failed ? 'is-error' : signing ? 'is-current' : ''}><b>2</b><span><strong>Assinar</strong><small>{signed ? 'Assinado' : failed ? 'Exige atenção' : signing ? 'Em andamento' : 'Quando necessário'}</small></span></div>
      <i aria-hidden="true" />
      <div className={signed ? 'is-current' : ''}><b>3</b><span><strong>Compartilhar</strong><small>WhatsApp ou e-mail, manual e seguro</small></span></div>
      <i aria-hidden="true" />
      <div><b>4</b><span><strong>Acompanhar</strong><small>Sem confirmação automática de leitura</small></span></div>
    </div>
  )
}

function ClinicalSignatureMiniJourney({ signatureStatus = 'manual' }) {
  const signed = signatureStatus === 'signed'
  const signing = signatureStatus === 'pending'
  const failed = ['failed', 'cancelled'].includes(signatureStatus)
  return (
    <div className="clinical-signature-mini-journey" aria-label="Progresso da assinatura">
      <span className="is-complete"><b>1</b><small>Documento</small></span>
      <i aria-hidden="true" />
      <span className={signed ? 'is-complete' : failed ? 'is-error' : signing || signatureStatus === 'manual' ? 'is-current' : ''}><b>2</b><small>Assinatura</small></span>
      <i aria-hidden="true" />
      <span className={signed ? 'is-current' : ''}><b>3</b><small>Pronto</small></span>
    </div>
  )
}

function ClinicalDocumentAttachDialog({ patients, onCancel, onContinue }) {
  const [query, setQuery] = useState('')
  const [patientId, setPatientId] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const visiblePatients = patients.filter(patient => !normalizedQuery || includesText([patient.full_name, patient.phone, patient.email, patient.cpf], normalizedQuery)).slice(0, 30)
  const selectedPatient = patients.find(patient => patient.id === patientId)
  return (
    <div className="clinical-document-create-modal" role="dialog" aria-modal="true" aria-labelledby="clinical-attach-title" onKeyDown={event => { if (event.key === 'Escape') onCancel() }}>
      <div className="clinical-attach-dialog">
        <header><div><span>Anexar ao prontuário</span><h3 id="clinical-attach-title">Selecione o paciente</h3><p>O upload privado será aberto diretamente em Fotos e documentos.</p></div><button type="button" onClick={onCancel} aria-label="Fechar">×</button></header>
        <div className="clinical-attach-dialog__body">
          <label><span>Buscar paciente</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome, telefone, e-mail ou CPF" /></label>
          <div className="clinical-document-patient-list">
            {visiblePatients.map(patient => <button key={patient.id} type="button" className={patient.id === patientId ? 'is-active' : ''} onClick={() => setPatientId(patient.id)}><strong>{patient.full_name}</strong><span>{patient.phone || patient.email || patient.cpf || 'Contato não informado'}</span></button>)}
            {!visiblePatients.length && <p>Nenhum paciente encontrado.</p>}
          </div>
        </div>
        <footer><Btn variant="ghost" onClick={onCancel}>Cancelar</Btn><Btn disabled={!selectedPatient} onClick={() => onContinue(selectedPatient)}>Continuar para o upload</Btn></footer>
      </div>
    </div>
  )
}

function ClinicalDocumentCreateDialog({ patients, canPrescribe, onCancel, onContinue, returnFocusRef }) {
  const [query, setQuery] = useState('')
  const [patientId, setPatientId] = useState('')
  const [documentType, setDocumentType] = useState('exam_request')
  const dialogRef = useRef(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const visiblePatients = useMemo(() => patients
    .filter(patient => !normalizedQuery || includesText([patient.full_name, patient.phone, patient.email, patient.cpf], normalizedQuery))
    .slice(0, 30), [patients, normalizedQuery])
  const selectedPatient = patients.find(patient => patient.id === patientId) || null

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const focusFrame = window.requestAnimationFrame(() => dialog.querySelector('input')?.focus())
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      dialog.removeEventListener('keydown', handleKeyDown)
      returnFocusRef?.current?.querySelector('button')?.focus()
    }
  }, [returnFocusRef])

  return (
    <div ref={dialogRef} className="clinical-document-create-modal" role="dialog" aria-modal="true" aria-labelledby="clinical-document-create-title">
      <div>
        <header>
          <div>
            <span>Novo documento clínico</span>
            <h3 id="clinical-document-create-title">Para quem você quer emitir?</h3>
            <p>Escolha o paciente e o tipo. O formulário será aberto na ficha clínica e o documento ficará no prontuário.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Fechar">×</button>
        </header>
        <div className="clinical-document-create-grid">
          <section>
            <label>
              <span>Buscar paciente</span>
              <input
                aria-label="Buscar paciente para o documento"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Nome, telefone, e-mail ou CPF"
                autoFocus
              />
            </label>
            <div className="clinical-document-patient-list">
              {visiblePatients.map(patient => (
                <button
                  key={patient.id}
                  type="button"
                  className={patient.id === patientId ? 'is-active' : ''}
                  onClick={() => setPatientId(patient.id)}
                >
                  <strong>{patient.full_name}</strong>
                  <span>{patient.phone || patient.email || patient.cpf || 'Contato não informado'}</span>
                </button>
              ))}
              {visiblePatients.length === 0 && <p>Nenhum paciente encontrado.</p>}
            </div>
          </section>
          <section>
            <span>Tipo de documento</span>
            <div className="clinical-document-type-list">
              <button type="button" className={documentType === 'exam_request' ? 'is-active' : ''} onClick={() => setDocumentType('exam_request')}>
                <strong>Pedido de exames</strong>
                <span>Solicitação de exames, indicação clínica e orientações.</span>
              </button>
              <button type="button" disabled={!canPrescribe} className={documentType === 'simple_prescription' ? 'is-active' : ''} onClick={() => setDocumentType('simple_prescription')}>
                <strong>Receita simples</strong>
                <span>{canPrescribe ? 'Medicamentos não controlados e modo de usar.' : 'Somente administradores clínicos podem emitir receitas.'}</span>
              </button>
            </div>
            {selectedPatient && (
              <div className="clinical-document-selected-patient">
                <span>Será salvo no prontuário de</span>
                <strong>{selectedPatient.full_name}</strong>
                <small>Você poderá revisar todas as informações antes de emitir.</small>
              </div>
            )}
          </section>
        </div>
        <footer>
          <Btn variant="ghost" onClick={onCancel}>Cancelar</Btn>
          <Btn disabled={!selectedPatient} onClick={() => onContinue(selectedPatient, documentType)}>Preencher documento</Btn>
        </footer>
      </div>
    </div>
  )
}

function WorkspaceState({ loading, unavailableSources, onRefresh }) {
  if (loading) return <div className="clinical-index-state">Atualizando a visão clínica…</div>
  if (!unavailableSources?.length) return null
  return (
    <div className="clinical-index-warning" role="status">
      <span>Algumas fontes clínicas ainda não estão disponíveis neste ambiente. Os dados carregados continuam visíveis.</span>
      <Btn variant="ghost" onClick={onRefresh}>Tentar novamente</Btn>
    </div>
  )
}

export function ClinicalTodayInsights({ index, loading, unavailableSources, onNavigate, onRefresh }) {
  const incomplete = Boolean(unavailableSources?.length)
  const pending = loading || incomplete
  const urgent = index.pendingItems.filter(item => item.tone === 'danger').length
  const reviews = index.pendingItems.filter(item => item.kind === 'intake_review').length
  const returns = index.pendingItems.filter(item => item.kind === 'return').length
  return (
    <section className="clinical-today-insights clinical-cockpit" aria-label="Pulso clínico">
      <WorkspaceState loading={loading} unavailableSources={unavailableSources} onRefresh={onRefresh} />
      <header><div><span>Cockpit clínico</span><strong>Prioridades do dia</strong><small>Agenda, revisões e documentos em uma leitura rápida.</small></div><button type="button" onClick={() => onNavigate('pending')}>Abrir central de pendências →</button></header>
      <div className="clinical-insight-grid">
        <button type="button" onClick={() => onNavigate('pending')}><span>Críticas</span><strong>{pending ? '—' : urgent}</strong><small>{loading ? 'atualizando' : incomplete ? 'dados incompletos' : 'retornos ou sessões vencidas'}</small></button>
        <button type="button" onClick={() => onNavigate('pending')}><span>Para revisar</span><strong>{pending ? '—' : reviews}</strong><small>{loading ? 'atualizando' : incomplete ? 'dados incompletos' : 'pré-anamneses recebidas'}</small></button>
        <button type="button" onClick={() => onNavigate('pending')}><span>Retornos</span><strong>{pending ? '—' : returns}</strong><small>{loading ? 'atualizando' : incomplete ? 'dados incompletos' : 'sem novo atendimento vinculado'}</small></button>
        <button type="button" onClick={() => onNavigate('documents')}><span>Documentos</span><strong>{pending ? '—' : index.documentTotal}</strong><small>{loading ? 'atualizando' : incomplete ? 'dados incompletos' : 'emitidos e anexados ao prontuário'}</small></button>
      </div>
    </section>
  )
}

export function ClinicalPatientsView({ index, loading, unavailableSources, onOpenPatient, onRefresh }) {
  const incomplete = Boolean(unavailableSources?.length)
  const pending = loading || incomplete
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const rows = useMemo(() => index.patientItems.filter(item => !normalizedQuery || includesText([item.full_name, item.phone, item.email], normalizedQuery)), [index.patientItems, normalizedQuery])
  return (
    <section className="clinical-index-page" data-testid="clinical-patients-view">
      <header className="clinical-index-header">
        <div><span>Visão clínica</span><h2>Pacientes</h2><p>Continuidade do cuidado sem misturar cadastro administrativo com conteúdo clínico.</p></div>
        <label className="clinical-index-search"><span>Buscar</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome, telefone ou e-mail" /></label>
      </header>
      <WorkspaceState loading={loading} unavailableSources={unavailableSources} onRefresh={onRefresh} />
      {!loading && rows.length === 0 ? <div className="clinical-empty-panel">Nenhum paciente encontrado.</div> : (
        <div className="clinical-patient-index">
          {rows.map(patient => (
            <button key={patient.id} type="button" onClick={() => onOpenPatient(patient, 'overview')}>
              <span className="clinical-index-avatar" aria-hidden="true">{String(patient.full_name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span>
              <span className="clinical-patient-index__identity"><strong>{patient.full_name}</strong><small>{patient.phone || patient.email || 'Contato não informado'}</small></span>
              <span><small>Último contato</small><strong>{loading ? 'Atualizando…' : incomplete ? 'Dados incompletos' : dateLabel(patient.lastCareAt)}</strong></span>
              <span><small>Próximo</small><strong>{patient.nextAppointment ? dateLabel(patient.nextAppointment.occurredAt, true) : 'Sem agenda'}</strong></span>
              <span className="clinical-patient-index__counts">{pending ? <i>{loading ? 'Atualizando' : 'Dados incompletos'}</i> : <><i>{patient.activePlanCount} plano{patient.activePlanCount === 1 ? '' : 's'}</i><i>{patient.documentCount} doc.</i><i>{patient.assetCount} arquivo{patient.assetCount === 1 ? '' : 's'}</i></>}</span>
              <span className={patient.pendingCount && !pending ? 'clinical-count-badge is-warn' : 'clinical-count-badge'}>{pending ? '—' : patient.pendingCount ? `${patient.pendingCount} pend.` : 'Em dia'}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function ClinicalPendingView({ index, loading, unavailableSources, onOpenPatient, onRefresh }) {
  const incomplete = Boolean(unavailableSources?.length)
  const pending = loading || incomplete
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState('')
  const rows = index.pendingItems.filter(item => filter === 'all' || item.kind === filter)
  const selectedItem = index.pendingItems.find(item => item.id === selectedId)
  const filters = [
    ['all', 'Todas'], ['intake_review', 'Revisões'], ['intake_waiting', 'Aguardando paciente'], ['return', 'Retornos'],
    ['plan_review', 'Planos'], ['session_overdue', 'Sessões'], ['signature', 'Assinaturas'],
  ]
  return (
    <section className="clinical-index-page" data-testid="clinical-pending-view">
      <header className="clinical-index-header">
        <div><span>Fila de trabalho</span><h2>Pendências clínicas</h2><p>Somente situações derivadas de registros reais; nenhuma conduta é criada automaticamente.</p></div>
        <div className="clinical-index-total"><strong>{pending ? '—' : index.pendingItems.length}</strong><span>{loading ? 'atualizando' : incomplete ? 'dados incompletos' : 'abertas'}</span></div>
      </header>
      <WorkspaceState loading={loading} unavailableSources={unavailableSources} onRefresh={onRefresh} />
      <div className="clinical-filter-row" aria-label="Filtrar pendências">{filters.map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>
      {!loading && rows.length === 0 ? <div className="clinical-empty-panel"><strong>{incomplete ? 'Não foi possível confirmar as pendências' : 'Nenhuma pendência nesta categoria'}</strong><p>{incomplete ? 'Tente novamente depois que todas as fontes clínicas estiverem disponíveis.' : 'A fila é atualizada a partir de anamnese, agenda, planos e assinaturas.'}</p></div> : (
        <div className="clinical-work-queue">
          {rows.map(item => (
            <button key={item.id} type="button" onClick={() => setSelectedId(item.id)}>
              <span className={`clinical-queue-marker is-${item.tone}`} />
              <span><small>{clinicalPendingLabel(item.kind)}</small><strong>{item.title}</strong><em>{item.detail}</em></span>
              <span><strong>{item.patientName}</strong><small>{dateLabel(item.dueAt, true)}</small></span>
              <b>Revisar →</b>
            </button>
          ))}
        </div>
      )}
      {selectedItem && <aside className="clinical-pending-drawer" role="dialog" aria-modal="true" aria-label="Detalhes da pendência">
        <button type="button" className="clinical-pending-drawer__backdrop" aria-label="Fechar detalhes" onClick={() => setSelectedId('')} />
        <div><header><span>{clinicalPendingLabel(selectedItem.kind)}</span><button type="button" onClick={() => setSelectedId('')} aria-label="Fechar">×</button></header><h3>{selectedItem.title}</h3><p>{selectedItem.detail}</p><dl><div><dt>Paciente</dt><dd>{selectedItem.patientName}</dd></div><div><dt>Prazo ou registro</dt><dd>{dateLabel(selectedItem.dueAt, true)}</dd></div></dl><footer><Btn variant="ghost" onClick={() => setSelectedId('')}>Voltar</Btn><Btn onClick={() => {
              const patient = index.patientItems.find(row => row.id === selectedItem.patientId)
              if (patient) onOpenPatient(patient, selectedItem.kind.startsWith('intake') ? 'intake' : selectedItem.kind === 'signature' ? 'prescriptions' : selectedItem.kind.includes('plan') || selectedItem.kind.includes('session') ? 'treatment' : 'overview')
            }}>Resolver na ficha</Btn></footer></div>
      </aside>}
    </section>
  )
}

// Fila de assinatura em lote. A BRy cobra POR ENVELOPE e cada envelope aceita
// dez documentos: assinar de dez em dez custa um décimo de assinar um a um.
// O backend decide o que é assinável; esta tela só mostra e deixa escolher.
function ClinicalSignatureQueue() {
  const [state, setState] = useState({ status:'loading', documents:[], integration:null, maxPerEnvelope:10 })
  const [selected, setSelected] = useState([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  async function load() {
    try {
      const data = await fetchClinicalSignatureQueue()
      setState({ status:'ready', ...data })
    } catch {
      // Fila indisponível não pode esconder o resto da tela nem a via manual.
      setState({ status:'unavailable', documents:[], integration:null, maxPerEnvelope:10 })
    }
  }
  useEffect(() => { load() }, [])

  const max = state.maxPerEnvelope || 10
  const available = Boolean(state.integration?.available)
  function toggle(id) {
    setSelected(current => current.includes(id)
      ? current.filter(item => item !== id)
      : (current.length >= max ? current : [...current, id]))
  }

  async function sign() {
    if (busy || selected.length === 0) return
    setBusy(true); setConfirming(false); setNotice(''); setError('')
    try {
      const response = await requestClinicalSignature(selected, uid())
      setSelected([])
      await load()
      if (response.signingUrl) {
        const popup = window.open(response.signingUrl, '_blank', 'noopener,noreferrer')
        if (popup) popup.opener = null
        else setNotice('O navegador bloqueou a página de assinatura. Libere pop-ups e abra o documento de novo para continuar.')
      } else {
        setNotice('O pedido foi registrado, mas não recebemos a página de assinatura.')
      }
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível solicitar a assinatura.')
      await load().catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  if (state.status === 'loading') return null
  if (state.status === 'unavailable' || !available || state.documents.length === 0) return null

  return (
    <section className="clinical-sign-queue" data-testid="clinical-sign-queue">
      <header>
        <div>
          <strong>Assinar vários de uma vez</strong>
          <span>
            Você pode juntar até {max} documentos num pedido só de assinatura.
            Isso custa bem menos do que assinar um por um.
          </span>
        </div>
        <b data-testid="clinical-sign-queue-count">{selected.length} de {max} selecionados</b>
      </header>

      {error && <div className="clinical-form-error" role="alert">{error}</div>}
      {notice && <div className="clinical-document-access-note" role="status">{notice}</div>}

      <ul>
        {state.documents.map(document => {
          const checked = selected.includes(document.id)
          return (
            <li key={document.id}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy || (!checked && selected.length >= max)}
                  onChange={() => toggle(document.id)}
                />
                <span className={`clinical-document-center-icon is-${document.documentType}`}>
                  {document.documentType === 'simple_prescription' ? 'Rx' : 'Ex'}
                </span>
                <span>
                  <strong>{document.patientName}</strong>
                  <small>{document.documentType === 'simple_prescription' ? 'Receita simples' : 'Pedido de exames'} · {dateLabel(document.issueDate)}</small>
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      {confirming ? (
        <div className="clinical-signature-confirm" role="group" aria-label="Confirmar assinatura em lote">
          <span>
            Isso junta {selected.length} documento(s) num pedido só de assinatura. Tem um custo,
            mesmo que a assinatura não seja concluída. Uma página externa vai abrir em outra aba.
            Confirmar?
          </span>
          <div>
            <Btn variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</Btn>
            <Btn disabled={busy} onClick={sign}>{busy ? 'Solicitando…' : 'Confirmar e assinar'}</Btn>
          </div>
        </div>
      ) : (
        <footer>
          <Btn variant="ghost" disabled={busy || state.documents.length === 0} onClick={() => setSelected(state.documents.slice(0, max).map(item => item.id))}>
            Selecionar {Math.min(max, state.documents.length)}
          </Btn>
          <Btn disabled={busy || selected.length === 0} onClick={() => setConfirming(true)}>
            Assinar {selected.length > 0 ? `${selected.length} documento(s)` : 'documentos'}
          </Btn>
        </footer>
      )}
    </section>
  )
}

export function ClinicalDocumentsCenter({ index, patients = [], clinicName = '', viewerId = '', loading, unavailableSources, canPrescribe = false, onCreateDocument, onAttachDocument, onOpenPatient, onRefresh, autoOpenDocumentId = '', onAutoOpenDocumentConsumed }) {
  const incomplete = Boolean(unavailableSources?.length)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [creating, setCreating] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [signingDocument, setSigningDocument] = useState(null)
  const [signatureBusy, setSignatureBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const createButtonRef = useRef(null)

  // A ficha do paciente nao assina mais nada sozinha: ela so pede pra abrir
  // este documento aqui, direto na mesma janela que o resto da clinica usa.
  useEffect(() => {
    if (!autoOpenDocumentId || loading) return
    const match = index.documents.find(item => item.id === autoOpenDocumentId)
    if (match) setSigningDocument(match)
    onAutoOpenDocumentConsumed?.()
  }, [autoOpenDocumentId, loading])
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const rows = index.documents.filter(document => {
    const queueCategory = signatureQueueCategory(document, viewerId)
    if (filter === 'action' && queueCategory !== 'action') return false
    if (filter === 'attention' && !['failed', 'cancelled'].includes(document.signature.status)) return false
    if (!['all', 'attention', 'action'].includes(filter) && document.signature.status !== filter) return false
    return !normalizedQuery || includesText([document.patientName, document.author_name, document.document_type, document.file_name, document.procedure_name], normalizedQuery)
  })
  const counts = index.documents.reduce((totals, document) => {
    totals.all += 1
    if (document.signature.status === 'signed') totals.signed += 1
    else if (document.signature.status === 'pending') totals.pending += 1
    else if (['failed', 'cancelled'].includes(document.signature.status)) totals.attention += 1
    else if (signatureQueueCategory(document, viewerId) === 'action') totals.action += 1
    return totals
  }, { all:0, signed:0, pending:0, attention:0, action:0 })

  async function startDocumentSignature() {
    if (!signingDocument || signatureBusy) return
    setSignatureBusy(true)
    setNotice('')
    try {
      let documentId = signingDocument.sourceDocumentId || (signingDocument.document_type === 'attached_pdf' ? '' : signingDocument.id)
      if (!documentId && signingDocument.assetId) {
        const { data:preparedId, error:prepareError } = await supabase.rpc('prepare_clinical_asset_signature', { p_asset_id:signingDocument.assetId })
        if (prepareError || !preparedId) throw prepareError || new Error('Não foi possível preparar este arquivo para assinatura.')
        documentId = preparedId
      }
      if (!documentId) throw new Error('Este documento ainda não tem um registro pronto para assinatura.')
      const response = await requestClinicalSignature([documentId], uid())
      setSigningDocument(null)
      await onRefresh?.()
      if (response.signingUrl) {
        const popup = window.open(response.signingUrl, '_blank', 'noopener,noreferrer')
        if (popup) popup.opener = null
        else setNotice('O pedido foi criado, mas o navegador bloqueou a página de assinatura. Libere pop-ups e use "Acompanhar assinatura" para continuar.')
      } else {
        setNotice('O pedido foi criado. Use "Acompanhar assinatura" para abrir a página de assinatura ou atualizar o estado.')
      }
    } catch (error) {
      setNotice(error.message || 'Não foi possível iniciar a assinatura deste documento.')
    } finally {
      setSignatureBusy(false)
    }
  }

  async function openDocumentSignature(document) {
    if (signatureBusy || !document.signature.attemptId) return
    setSignatureBusy(true)
    setNotice('')
    try {
      const response = document.signature.status === 'signed'
        ? await openClinicalSignatureArtifact(document.signature.attemptId, 'signed')
        : await fetchClinicalSignatureLink(document.signature.attemptId)
      const url = document.signature.status === 'signed' ? response.url : response.signingUrl
      if (!url) throw new Error(document.signature.status === 'signed' ? 'O documento assinado ainda não está disponível.' : 'Não conseguimos abrir a página de assinatura agora. Tente "Atualizar status".')
      const popup = window.open(url, '_blank', 'noopener,noreferrer')
      if (popup) popup.opener = null
      else throw new Error('O navegador bloqueou a nova aba. Libere pop-ups e tente novamente.')
    } catch (error) {
      setNotice(error.message || 'Não foi possível abrir a assinatura deste documento.')
    } finally {
      setSignatureBusy(false)
    }
  }

  async function reconcileDocumentSignature() {
    if (!signingDocument?.signature?.attemptId || signatureBusy) return
    setSignatureBusy(true)
    setNotice('')
    try {
      const { attempt } = await reconcileClinicalSignature(signingDocument.signature.attemptId)
      setNotice(signatureOutcomeNotice(attempt))
      setSigningDocument(current => withUpdatedSignature(current, attempt))
      await onRefresh?.()
    } catch (error) {
      setNotice(error.message || 'Não foi possível atualizar o status desta assinatura.')
    } finally {
      setSignatureBusy(false)
    }
  }

  async function abandonDocumentSignature() {
    if (!signingDocument?.signature?.attemptId || signatureBusy) return
    setSignatureBusy(true)
    setNotice('')
    try {
      await abandonClinicalSignature(signingDocument.signature.attemptId)
      setSigningDocument(null)
      await onRefresh?.()
      setNotice('Essa tentativa foi encerrada. Você já pode pedir para assinar de novo.')
    } catch (error) {
      setNotice(error.message || 'Não foi possível encerrar esta tentativa.')
    } finally {
      setSignatureBusy(false)
    }
  }
  return (
    <section className="clinical-index-page" data-testid="clinical-documents-center">
      <header className="clinical-index-header">
        <div><span>Central clínica</span><h2>Documentos clínicos</h2><p>Gerencie arquivos, assinaturas e compartilhamentos com o paciente.</p></div>
        <div className="clinical-index-header-actions">
          <label className="clinical-index-search"><span>Buscar</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Paciente, profissional ou arquivo" /></label>
          <Btn variant="ghost" onClick={() => setAttaching(true)}>Anexar arquivo</Btn>
          <span ref={createButtonRef}><Btn onClick={() => setCreating(true)}>+ Novo documento</Btn></span>
        </div>
      </header>
      <WorkspaceState loading={loading} unavailableSources={unavailableSources} onRefresh={onRefresh} />
      {notice && <div className="clinical-document-access-note" role="status">{notice}</div>}
      <div className="clinical-document-metrics" aria-label="Resumo de documentos">
        <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}><span>Todos</span><strong>{loading ? '—' : counts.all}</strong><small>No prontuário</small></button>
        <button type="button" className={filter === 'action' ? 'is-active is-priority' : 'is-priority'} onClick={() => setFilter('action')}><span>Minha ação agora</span><strong>{loading ? '—' : counts.action}</strong><small>Assinar ou iniciar</small></button>
        <button type="button" className={filter === 'pending' ? 'is-active' : ''} onClick={() => setFilter('pending')}><span>Aguardando assinatura</span><strong>{loading ? '—' : counts.pending}</strong><small>Em andamento</small></button>
        <button type="button" className={filter === 'signed' ? 'is-active' : ''} onClick={() => setFilter('signed')}><span>Assinados</span><strong>{loading ? '—' : counts.signed}</strong><small>Confirmados</small></button>
        <button type="button" className={filter === 'attention' ? 'is-active is-danger' : 'is-danger'} onClick={() => setFilter('attention')}><span>Exigem atenção</span><strong>{loading ? '—' : counts.attention}</strong><small>Falha ou cancelamento</small></button>
      </div>
      <div className="clinical-signature-overview">
        <div><span>Fila de assinatura</span><strong>Comece pelo que pede uma decisão agora.</strong></div>
        <small>Acompanhe cada documento pela trilha abaixo; o botão colorido é sempre a próxima ação recomendada.</small>
      </div>
      <ClinicalDocumentJourney />
      <ClinicalSignatureQueue />
      <div className="clinical-filter-row" aria-label="Filtrar documentos">
        {[['all','Todos'],['action','Minha ação'],['signed','Assinados'],['pending','Pendentes'],['failed','Com falha'],['manual','Via manual']].map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
      {!loading && rows.length === 0 ? <div className="clinical-empty-panel">{incomplete ? 'Não foi possível confirmar os documentos desta clínica.' : 'Nenhum documento encontrado.'}</div> : (
        <div className="clinical-documents-center-list is-revamped">
          {rows.map(document => {
            const patient = index.patientItems.find(item => item.id === document.patient_id)
            const openDocument = () => patient && onOpenPatient(patient, document.destinationTab || 'prescriptions')
            const canWhatsapp = Boolean(normalizeWhatsappPhone(patient?.phone))
            const canEmail = Boolean(String(patient?.email || '').trim())
            const canStartSignature = Boolean(viewerId && document.created_by === viewerId)
            const queueCategory = signatureQueueCategory(document, viewerId)
            const signingLabel = document.signature.status === 'pending' ? 'Acompanhar assinatura' : document.signature.status === 'signed' ? 'Ver assinado' : !canStartSignature ? 'Ver assinatura' : document.signature.status === 'failed' ? 'Revisar falha' : 'Assinar'
            const handleSignature = () => {
              if (document.signature.status === 'signed' && document.signature.attemptId) {
                openDocumentSignature(document)
                return
              }
              if (document.signature.status === 'pending' && document.signature.attemptId) {
                // Fica tudo numa janela so: abrir a pagina, atualizar o status
                // ou encerrar a tentativa, sem espalhar botao por lugares diferentes.
                setSigningDocument(document)
                return
              }
              if (canStartSignature && ['manual', 'failed', 'cancelled'].includes(document.signature.status)) {
                setSigningDocument(document)
                return
              }
              setNotice('Somente quem anexou ou emitiu este documento pode cuidar da assinatura.')
            }
            return (
            <article key={document.id}>
              <span className={`clinical-document-center-icon is-${document.document_type}`}>{document.document_type === 'simple_prescription' ? 'Rx' : document.document_type === 'attached_pdf' ? 'PDF' : 'Ex'}</span>
              <span className="clinical-document-row__identity"><small>{documentTypeLabel(document.document_type)}</small><strong>{document.document_type === 'attached_pdf' ? document.file_name : document.patientName}</strong><em>{document.document_type === 'attached_pdf' ? document.patientName : document.author_name || 'Profissional registrado'}</em></span>
              <span className="clinical-document-row__status"><strong>{dateLabel(document.issue_date)}</strong><small className={`is-${document.signature.status}`}>{document.signature.label}</small><em className={`clinical-document-row__next-action is-${queueCategory}`}><b>Próxima ação</b>{signatureNextAction(document, canStartSignature)}</em></span>
              <ClinicalSignatureMiniJourney signatureStatus={document.signature.status} />
              <div className="clinical-document-row__actions">
                <button type="button" onClick={openDocument}>Visualizar</button>
                <button type="button" className="is-primary" disabled={signatureBusy} onClick={handleSignature}>{signingLabel}</button>
                <button type="button" className="is-icon is-whatsapp" aria-label="Enviar no WhatsApp" disabled={!canWhatsapp} title={canWhatsapp ? 'Abrir conversa no WhatsApp sem expor o arquivo clínico' : 'Paciente sem telefone cadastrado'} onClick={() => {
                  const opened = openWhatsappForDocument({ patient, clinicName, document })
                  setNotice(opened ? 'Conversa aberta no WhatsApp. O arquivo clínico não foi enviado automaticamente; anexe-o manualmente quando autorizado.' : 'Não foi possível abrir o WhatsApp. Confira o telefone do paciente e o bloqueio de pop-ups.')
                }}><WhatsAppGlyph size={15} /></button>
                <button type="button" className="is-icon is-email" aria-label="Enviar por e-mail" disabled={!canEmail} title={canEmail ? 'Abrir e-mail sem expor o arquivo clínico' : 'Paciente sem e-mail cadastrado'} onClick={() => {
                  const opened = openEmailForDocument({ patient, clinicName, document })
                  setNotice(opened ? 'E-mail aberto no seu cliente de correio. O arquivo clínico não foi enviado automaticamente; anexe-o manualmente quando autorizado.' : 'Não foi possível abrir o e-mail. Confira o e-mail cadastrado do paciente.')
                }}><MailGlyph size={15} /></button>
                <details><summary aria-label="Mais opções"><ClinicalIcon name="more" size={16} /></summary><div><button type="button" onClick={() => patient && onOpenPatient(patient, 'overview')}>Abrir ficha do paciente</button><button type="button" onClick={openDocument}>Ver detalhes do documento</button></div></details>
              </div>
            </article>
          )})}
        </div>
      )}
      {creating && (
        <ClinicalDocumentCreateDialog
          patients={patients}
          canPrescribe={canPrescribe}
          returnFocusRef={createButtonRef}
          onCancel={() => setCreating(false)}
          onContinue={(patient, documentType) => {
            setCreating(false)
            onCreateDocument?.(patient, documentType)
          }}
        />
      )}
      {attaching && <ClinicalDocumentAttachDialog patients={patients} onCancel={() => setAttaching(false)} onContinue={patient => { setAttaching(false); onAttachDocument?.(patient) }} />}
      {signingDocument && (() => {
        const pending = signingDocument.signature.status === 'pending'
        const signed = signingDocument.signature.status === 'signed'
        return (
        <div className="clinical-document-create-modal" role="dialog" aria-modal="true" aria-labelledby="clinical-sign-document-title">
          <div className="clinical-sign-document-dialog">
            <header>
              <div>
                <span>Assinatura digital</span>
                <h3 id="clinical-sign-document-title">{pending ? 'Acompanhar assinatura' : signed ? 'Documento assinado' : 'Assinar documento'}</h3>
                <p>{signed ? 'O documento já foi assinado.' : 'Uma página externa segura vai abrir para você assinar com o seu certificado digital.'}</p>
              </div>
              <button type="button" onClick={() => setSigningDocument(null)} aria-label="Fechar">×</button>
            </header>
            <div className="clinical-sign-document-dialog__body">
              <ClinicalDocumentJourney signatureStatus={signingDocument.signature.status} />
              <div><span>Documento</span><strong>{signingDocument.file_name || documentTypeLabel(signingDocument.document_type)}</strong><small>{signingDocument.patientName} · {dateLabel(signingDocument.issue_date)}</small></div>
              {!signed && <p>{pending ? 'Se você já concluiu na página que abriu, atualize o status aqui.' : 'Isso tem um custo, mesmo que a assinatura não seja concluída. O status só muda para "assinado" depois da confirmação real.'}</p>}
              {notice && <div className="clinical-document-access-note" role="status">{notice}</div>}
            </div>
            <footer>
              {pending ? (
                <>
                  <Btn variant="ghost" disabled={signatureBusy} onClick={abandonDocumentSignature}>Encerrar tentativa</Btn>
                  <Btn variant="ghost" disabled={signatureBusy} onClick={reconcileDocumentSignature}>{signatureBusy ? 'Atualizando…' : 'Atualizar status'}</Btn>
                  <Btn disabled={signatureBusy} onClick={() => openDocumentSignature(signingDocument)}>{signatureBusy ? 'Abrindo…' : 'Abrir página de assinatura'}</Btn>
                </>
              ) : signed ? (
                <Btn disabled={signatureBusy} onClick={() => openDocumentSignature(signingDocument)}>{signatureBusy ? 'Abrindo…' : 'Ver documento assinado'}</Btn>
              ) : (
                <>
                  <Btn variant="ghost" disabled={signatureBusy} onClick={() => setSigningDocument(null)}>Cancelar</Btn>
                  <Btn disabled={signatureBusy} onClick={startDocumentSignature}>{signatureBusy ? 'Abrindo…' : 'Confirmar e assinar'}</Btn>
                </>
              )}
            </footer>
          </div>
        </div>
        )
      })()}
    </section>
  )
}

export function ClinicalPatientSummary({ profile, profileStatus, patientIndex, timeline, workspaceLoading, unavailableSources, onOpenTab, onRefresh }) {
  const incomplete = Boolean(unavailableSources?.length)
  const pending = workspaceLoading || incomplete
  const recent = (timeline || []).slice(0, 5)
  const alerts = [
    profile?.allergies ? ['Alergias', profile.allergies, 'danger'] : null,
    profile?.current_medications ? ['Medicamentos em uso', profile.current_medications, 'warn'] : null,
  ].filter(Boolean)
  return (
    <div className="clinical-patient-summary" data-testid="clinical-patient-summary">
      <div className="clinical-summary-kpis">
        <div><span>Último contato</span><strong>{workspaceLoading ? 'Atualizando…' : incomplete ? 'Dados incompletos' : dateLabel(patientIndex?.lastCareAt)}</strong></div>
        <div><span>Próximo compromisso</span><strong>{patientIndex?.nextAppointment ? dateLabel(patientIndex.nextAppointment.occurredAt, true) : 'Sem agenda'}</strong></div>
        <div><span>Plano ativo</span><strong>{pending ? '—' : patientIndex?.activePlanCount || 0}</strong></div>
        <div className={patientIndex?.pendingCount && !pending ? 'is-warn' : 'is-ok'}><span>Pendências</span><strong>{pending ? '—' : patientIndex?.pendingCount || 0}</strong></div>
      </div>
      <WorkspaceState loading={workspaceLoading} unavailableSources={unavailableSources} onRefresh={onRefresh} />
      <div className="clinical-summary-columns">
        <section>
          <header><div><span>Segurança</span><strong>Alertas clínicos</strong></div><button type="button" onClick={() => onOpenTab('summary')}>Abrir anamnese →</button></header>
          {profileStatus === 'loading' && <div className="clinical-summary-empty">Verificando alertas clínicos…</div>}
          {profileStatus === 'error' && <div className="clinical-summary-empty">Alertas clínicos indisponíveis no momento.</div>}
          {profileStatus === 'ready' && (alerts.length ? alerts.map(([label, value, tone]) => <div key={label} className={`clinical-summary-alert is-${tone}`}><strong>{label}</strong><p>{value}</p></div>) : <div className="clinical-summary-empty">Nenhum alerta registrado no perfil clínico.</div>)}
        </section>
        <section>
          <header><div><span>Histórico</span><strong>Atividade recente</strong></div><button type="button" onClick={() => onOpenTab('timeline')}>Ver linha do tempo →</button></header>
          {recent.length ? recent.map(event => <div key={event.id} className="clinical-summary-event"><span>{clinicalTimelineLabel(event.type)}</span><strong>{event.title}</strong><small>{dateLabel(event.occurredAt, true)}</small></div>) : <div className="clinical-summary-empty">{workspaceLoading ? 'Atualizando atividade clínica…' : incomplete ? 'Não foi possível confirmar toda a atividade clínica.' : 'Ainda não há atividade clínica registrada.'}</div>}
        </section>
      </div>
      <section className="clinical-summary-actions"><span>Continuar atendimento</span><div>
        <button type="button" onClick={() => onOpenTab('record')}>Nova evolução</button>
        <button type="button" onClick={() => onOpenTab('prescriptions')}>Exames e receitas</button>
        <button type="button" onClick={() => onOpenTab('files')}>Fotos e documentos</button>
        <button type="button" onClick={() => onOpenTab('treatment')}>Plano e retorno</button>
      </div></section>
    </div>
  )
}

export function ClinicalPatientTimeline({ timeline, unavailableSources, onRefresh, loading }) {
  const incomplete = Boolean(unavailableSources?.length)
  return (
    <div className="clinical-patient-timeline" data-testid="clinical-patient-timeline">
      <header><div><span>Histórico consolidado</span><strong>Linha do tempo do paciente</strong><p>Eventos de diferentes módulos permanecem em suas fontes originais.</p></div><Btn variant="ghost" disabled={loading} onClick={onRefresh}>{loading ? 'Atualizando…' : 'Atualizar'}</Btn></header>
      <WorkspaceState loading={loading} unavailableSources={unavailableSources} onRefresh={onRefresh} />
      {!loading && !timeline?.length ? <div className="clinical-empty-panel">{incomplete ? 'Não foi possível confirmar todo o histórico deste paciente.' : 'Ainda não há eventos clínicos para este paciente.'}</div> : timeline?.length ? <div className="clinical-timeline-list">
        {timeline.map(event => <article key={event.id}><span className={`clinical-timeline-dot is-${event.type}`} /><time>{dateLabel(event.occurredAt, true)}</time><div><small>{clinicalTimelineLabel(event.type)}</small><strong>{event.title}</strong><p>{event.detail}</p></div></article>)}
      </div> : null}
    </div>
  )
}
