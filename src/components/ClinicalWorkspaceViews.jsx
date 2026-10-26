import { useMemo, useState } from 'react'
import { Btn } from './UI.jsx'
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
  const urgent = index.pendingItems.filter(item => item.tone === 'danger').length
  const reviews = index.pendingItems.filter(item => item.kind === 'intake_review').length
  const returns = index.pendingItems.filter(item => item.kind === 'return').length
  return (
    <section className="clinical-today-insights" aria-label="Pulso clínico">
      <WorkspaceState loading={loading} unavailableSources={unavailableSources} onRefresh={onRefresh} />
      <header><div><span>Continuidade do cuidado</span><strong>O que pede atenção além da agenda</strong></div><button type="button" onClick={() => onNavigate('pending')}>Ver todas as pendências →</button></header>
      <div className="clinical-insight-grid">
        <button type="button" onClick={() => onNavigate('pending')}><span>Críticas</span><strong>{urgent}</strong><small>retornos ou sessões vencidas</small></button>
        <button type="button" onClick={() => onNavigate('pending')}><span>Para revisar</span><strong>{reviews}</strong><small>pré-anamneses recebidas</small></button>
        <button type="button" onClick={() => onNavigate('pending')}><span>Retornos</span><strong>{returns}</strong><small>sem novo atendimento vinculado</small></button>
        <button type="button" onClick={() => onNavigate('documents')}><span>Documentos</span><strong>{index.documents.length}</strong><small>pedidos e receitas no histórico</small></button>
      </div>
    </section>
  )
}

export function ClinicalPatientsView({ index, loading, unavailableSources, onOpenPatient, onRefresh }) {
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
              <span><small>Último contato</small><strong>{dateLabel(patient.lastCareAt)}</strong></span>
              <span><small>Próximo</small><strong>{patient.nextAppointment ? dateLabel(patient.nextAppointment.occurredAt, true) : 'Sem agenda'}</strong></span>
              <span className="clinical-patient-index__counts"><i>{patient.activePlanCount} plano{patient.activePlanCount === 1 ? '' : 's'}</i><i>{patient.documentCount} doc.</i><i>{patient.assetCount} arquivo{patient.assetCount === 1 ? '' : 's'}</i></span>
              <span className={patient.pendingCount ? 'clinical-count-badge is-warn' : 'clinical-count-badge'}>{patient.pendingCount ? `${patient.pendingCount} pend.` : 'Em dia'}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function ClinicalPendingView({ index, loading, unavailableSources, onOpenPatient, onRefresh }) {
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
        <div className="clinical-index-total"><strong>{index.pendingItems.length}</strong><span>abertas</span></div>
      </header>
      <WorkspaceState loading={loading} unavailableSources={unavailableSources} onRefresh={onRefresh} />
      <div className="clinical-filter-row" aria-label="Filtrar pendências">{filters.map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>
      {!loading && rows.length === 0 ? <div className="clinical-empty-panel"><strong>Nenhuma pendência nesta categoria</strong><p>A fila é atualizada a partir de anamnese, agenda, planos e assinaturas.</p></div> : (
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

export function ClinicalDocumentsCenter({ index, loading, unavailableSources, onOpenPatient, onRefresh }) {
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
      <div className="clinical-filter-row" aria-label="Filtrar documentos">
        {[['all','Todos'],['signed','Assinados'],['pending','Pendentes'],['failed','Com falha'],['manual','Via manual']].map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
      {!loading && rows.length === 0 ? <div className="clinical-empty-panel">Nenhum documento encontrado.</div> : (
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

export function ClinicalPatientSummary({ patient, profile, patientIndex, timeline, onOpenTab }) {
  const recent = (timeline || []).slice(0, 5)
  const alerts = [
    profile?.allergies ? ['Alergias', profile.allergies, 'danger'] : null,
    profile?.current_medications ? ['Medicamentos em uso', profile.current_medications, 'warn'] : null,
  ].filter(Boolean)
  return (
    <div className="clinical-patient-summary" data-testid="clinical-patient-summary">
      <div className="clinical-summary-kpis">
        <div><span>Último contato</span><strong>{dateLabel(patientIndex?.lastCareAt)}</strong></div>
        <div><span>Próximo compromisso</span><strong>{patientIndex?.nextAppointment ? dateLabel(patientIndex.nextAppointment.occurredAt, true) : 'Sem agenda'}</strong></div>
        <div><span>Plano ativo</span><strong>{patientIndex?.activePlanCount || 0}</strong></div>
        <div className={patientIndex?.pendingCount ? 'is-warn' : 'is-ok'}><span>Pendências</span><strong>{patientIndex?.pendingCount || 0}</strong></div>
      </div>
      <div className="clinical-summary-columns">
        <section>
          <header><div><span>Segurança</span><strong>Alertas clínicos</strong></div><button type="button" onClick={() => onOpenTab('summary')}>Abrir anamnese →</button></header>
          {alerts.length ? alerts.map(([label, value, tone]) => <div key={label} className={`clinical-summary-alert is-${tone}`}><strong>{label}</strong><p>{value}</p></div>) : <div className="clinical-summary-empty">Nenhum alerta registrado no perfil clínico.</div>}
        </section>
        <section>
          <header><div><span>Histórico</span><strong>Atividade recente</strong></div><button type="button" onClick={() => onOpenTab('timeline')}>Ver linha do tempo →</button></header>
          {recent.length ? recent.map(event => <div key={event.id} className="clinical-summary-event"><span>{clinicalTimelineLabel(event.type)}</span><strong>{event.title}</strong><small>{dateLabel(event.occurredAt, true)}</small></div>) : <div className="clinical-summary-empty">Ainda não há atividade clínica registrada.</div>}
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

export function ClinicalPatientTimeline({ timeline, onRefresh, loading }) {
  return (
    <div className="clinical-patient-timeline" data-testid="clinical-patient-timeline">
      <header><div><span>Histórico consolidado</span><strong>Linha do tempo do paciente</strong><p>Eventos de diferentes módulos permanecem em suas fontes originais.</p></div><Btn variant="ghost" disabled={loading} onClick={onRefresh}>{loading ? 'Atualizando…' : 'Atualizar'}</Btn></header>
      {!timeline?.length ? <div className="clinical-empty-panel">Ainda não há eventos clínicos para este paciente.</div> : <div className="clinical-timeline-list">
        {timeline.map(event => <article key={event.id}><span className={`clinical-timeline-dot is-${event.type}`} /><time>{dateLabel(event.occurredAt, true)}</time><div><small>{clinicalTimelineLabel(event.type)}</small><strong>{event.title}</strong><p>{event.detail}</p></div></article>)}
      </div>}
    </div>
  )
}
