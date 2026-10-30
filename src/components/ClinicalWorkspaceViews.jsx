import { useEffect, useMemo, useState } from 'react'
import { Btn } from './UI.jsx'
import { uid } from '../utils.js'
import {
  fetchClinicalSignatureQueue,
  requestClinicalSignature,
} from '../lib/clinicalSignatureBryClient.js'
import { clinicalPendingLabel, clinicalTimelineLabel } from '../lib/clinicalWorkspaceIndex.js'

const dateLabel = (value, withTime = false) => {
  if (!value) return 'Não informado'
  const parsed = new Date(String(value).length === 10 ? `${value}T12:00:00` : value)
  if (Number.isNaN(parsed.getTime())) return 'Não informado'
  return parsed.toLocaleDateString('pt-BR', withTime ? { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' } : { day:'2-digit', month:'short', year:'numeric' })
}

const includesText = (values, query) => values.some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query))

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
    <section className="clinical-today-insights" aria-label="Pulso clínico">
      <WorkspaceState loading={loading} unavailableSources={unavailableSources} onRefresh={onRefresh} />
      <header><div><span>Continuidade do cuidado</span><strong>O que pede atenção além da agenda</strong></div><button type="button" onClick={() => onNavigate('pending')}>Ver todas as pendências →</button></header>
      <div className="clinical-insight-grid">
        <button type="button" onClick={() => onNavigate('pending')}><span>Críticas</span><strong>{pending ? '—' : urgent}</strong><small>{loading ? 'atualizando' : incomplete ? 'dados incompletos' : 'retornos ou sessões vencidas'}</small></button>
        <button type="button" onClick={() => onNavigate('pending')}><span>Para revisar</span><strong>{pending ? '—' : reviews}</strong><small>{loading ? 'atualizando' : incomplete ? 'dados incompletos' : 'pré-anamneses recebidas'}</small></button>
        <button type="button" onClick={() => onNavigate('pending')}><span>Retornos</span><strong>{pending ? '—' : returns}</strong><small>{loading ? 'atualizando' : incomplete ? 'dados incompletos' : 'sem novo atendimento vinculado'}</small></button>
        <button type="button" onClick={() => onNavigate('documents')}><span>Documentos</span><strong>{pending ? '—' : index.documents.length}</strong><small>{loading ? 'atualizando' : incomplete ? 'dados incompletos' : 'pedidos e receitas no histórico'}</small></button>
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
  const rows = index.pendingItems.filter(item => filter === 'all' || item.kind === filter)
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
            <button key={item.id} type="button" onClick={() => {
              const patient = index.patientItems.find(row => row.id === item.patientId)
              if (patient) onOpenPatient(patient, item.kind.startsWith('intake') ? 'intake' : item.kind === 'signature' ? 'prescriptions' : item.kind.includes('plan') || item.kind.includes('session') ? 'treatment' : 'overview')
            }}>
              <span className={`clinical-queue-marker is-${item.tone}`} />
              <span><small>{clinicalPendingLabel(item.kind)}</small><strong>{item.title}</strong><em>{item.detail}</em></span>
              <span><strong>{item.patientName}</strong><small>{dateLabel(item.dueAt, true)}</small></span>
              <b>Resolver →</b>
            </button>
          ))}
        </div>
      )}
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
        else setNotice('O navegador bloqueou a janela da BRy. Libere pop-ups e use "Atualizar status" na ficha do paciente.')
      } else {
        setNotice('A solicitação foi registrada, mas a BRy não devolveu a página de assinatura.')
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
          <strong>Assinar em lote</strong>
          <span>
            A BRy cobra por envelope, e cada envelope leva até {max} documentos.
            Assinar vários de uma vez custa o mesmo que assinar um.
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
            Isto cria <strong>um envelope</strong> na BRy com {selected.length} documento(s) e
            consome crédito, mesmo que você não conclua a assinatura. A página segura da BRy
            abrirá em outra aba. Confirmar?
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
            Assinar {selected.length > 0 ? `${selected.length} ` : ''}com BRy
          </Btn>
        </footer>
      )}
    </section>
  )
}

export function ClinicalDocumentsCenter({ index, loading, unavailableSources, onOpenPatient, onRefresh }) {
  const incomplete = Boolean(unavailableSources?.length)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const rows = index.documents.filter(document => {
    if (filter !== 'all' && document.signature.status !== filter) return false
    return !normalizedQuery || includesText([document.patientName, document.author_name, document.document_type], normalizedQuery)
  })
  return (
    <section className="clinical-index-page" data-testid="clinical-documents-center">
      <header className="clinical-index-header">
        <div><span>Central clínica</span><h2>Documentos</h2><p>Pedidos e receitas de todos os pacientes, com a situação real da assinatura.</p></div>
        <label className="clinical-index-search"><span>Buscar</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Paciente ou profissional" /></label>
      </header>
      <WorkspaceState loading={loading} unavailableSources={unavailableSources} onRefresh={onRefresh} />
      <ClinicalSignatureQueue />
      <div className="clinical-filter-row" aria-label="Filtrar documentos">
        {[['all','Todos'],['signed','Assinados'],['pending','Pendentes'],['failed','Com falha'],['manual','Via manual']].map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
      {!loading && rows.length === 0 ? <div className="clinical-empty-panel">{incomplete ? 'Não foi possível confirmar os documentos desta clínica.' : 'Nenhum documento encontrado.'}</div> : (
        <div className="clinical-documents-center-list">
          {rows.map(document => (
            <button key={document.id} type="button" onClick={() => {
              const patient = index.patientItems.find(item => item.id === document.patient_id)
              if (patient) onOpenPatient(patient, 'prescriptions')
            }}>
              <span className={`clinical-document-center-icon is-${document.document_type}`}>{document.document_type === 'simple_prescription' ? 'Rx' : 'Ex'}</span>
              <span><small>{document.document_type === 'simple_prescription' ? 'Receita simples' : 'Pedido de exames'}</small><strong>{document.patientName}</strong><em>{document.author_name || 'Profissional registrado'}</em></span>
              <span><strong>{dateLabel(document.issue_date)}</strong><small className={`is-${document.signature.status}`}>{document.signature.label}</small></span>
              <b>Abrir ficha →</b>
            </button>
          ))}
        </div>
      )}
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
