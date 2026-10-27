import { useEffect, useMemo, useRef, useState } from 'react'
import { Btn } from './UI.jsx'
import { supabase } from '../lib/supabase.js'
import {
  TREATMENT_SESSION_TYPES,
  TREATMENT_STATUS_LABELS,
  buildTreatmentConsultation,
  clinicDateTimeToIso,
  clinicIsoToDateTime,
  newRequestId,
  validateTreatmentDraft,
} from '../lib/clinicalTreatment.js'
import { loadTreatmentWorkspace } from '../lib/clinicalTreatmentClient.js'
import { loadClinicalProtocols } from '../lib/clinicalProtocolClient.js'
import { applyProtocolToTreatment } from '../lib/clinicalProtocols.js'

const EMPTY_PLAN = {
  title:'', indication:'', diagnosticSummary:'', objectives:'', plannedTreatment:'', guidance:'',
  expectedStartOn:'', reviewOn:'',
}

const EMPTY_SESSION = { sessionType:'procedure', title:'', instructions:'', scheduledStart:'', durationMinutes:30 }
const createSessionDraft = () => ({ ...EMPTY_SESSION, requestId:newRequestId() })

export function ClinicalTreatmentPlan({ patient, ownerId, data, setData, initialProtocolApplication, onProtocolApplicationConsumed }) {
  const [plans, setPlans] = useState([])
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editor, setEditor] = useState(null)
  const [sessionEditor, setSessionEditor] = useState(false)
  const [protocols, setProtocols] = useState([])
  const calendarRequestIds = useRef(new Map())
  const closeRequestIds = useRef(new Map())

  async function reload(preferredPlanId = '') {
    setLoading(true)
    setError('')
    try {
      const workspace = await loadTreatmentWorkspace(ownerId, patient.id)
      setPlans(workspace)
      setSelectedPlanId(current => preferredPlanId || current || workspace[0]?.id || '')
    } catch (loadError) {
      setError(loadError.message || 'Não foi possível carregar os planos terapêuticos.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [ownerId, patient.id])
  useEffect(() => {
    let active = true
    loadClinicalProtocols(ownerId, { activeOnly:true }).then(rows => { if (active) setProtocols(rows) }).catch(() => { if (active) setProtocols([]) })
    return () => { active = false }
  }, [ownerId])
  useEffect(() => {
    if (!initialProtocolApplication) return
    const applied = applyProtocolToTreatment(initialProtocolApplication.version, { ...EMPTY_PLAN }, '')
    setEditor({
      mode:'create',
      requestId:newRequestId(),
      values:applied.values,
      sessions:applied.sessions.length ? applied.sessions.map(item => ({ ...item, requestId:newRequestId() })) : [createSessionDraft()],
    })
    setError('')
    onProtocolApplicationConsumed?.()
  }, [initialProtocolApplication?.id, patient.id])

  const selectedPlan = useMemo(
    () => plans.find(plan => plan.id === selectedPlanId) || plans[0] || null,
    [plans, selectedPlanId],
  )

  function openNewPlan() {
    setEditor({ mode:'create', requestId:newRequestId(), values:{ ...EMPTY_PLAN }, sessions:[createSessionDraft()] })
    setError('')
  }

  function openRevision() {
    const version = selectedPlan?.currentVersion
    if (!version) return
    setEditor({
      mode:'revise',
      requestId:newRequestId(),
      values:{
        title:version.title || '', indication:version.indication || '', diagnosticSummary:version.diagnostic_summary || '',
        objectives:version.objectives || '', plannedTreatment:version.planned_treatment || '', guidance:version.guidance || '',
        expectedStartOn:version.expected_start_on || '', reviewOn:version.review_on || '',
      },
      sessions:[],
    })
  }

  async function savePlan() {
    const validation = validateTreatmentDraft(editor.values)
    if (!validation.valid) { setError(validation.message); return }
    setBusy('plan')
    setError('')
    setNotice('')
    const values = editor.values
    const requestId = editor.requestId
    const params = {
      p_request_id:requestId,
      p_title:values.title,
      p_indication:values.indication,
      p_diagnostic_summary:values.diagnosticSummary || null,
      p_objectives:values.objectives,
      p_planned_treatment:values.plannedTreatment,
      p_guidance:values.guidance,
      p_expected_start_on:values.expectedStartOn || null,
      p_review_on:values.reviewOn || null,
    }
    try {
      let result
      if (editor.mode === 'create') {
        result = await supabase.rpc('create_clinical_treatment_plan', {
          ...params,
          p_patient_id:patient.id,
          p_sessions:editor.sessions.filter(item => item.title.trim()).map(item => ({
            request_id:item.requestId, session_type:item.sessionType, title:item.title, instructions:item.instructions || null,
            scheduled_start:item.scheduledStart ? clinicDateTimeToIso(item.scheduledStart) : null,
            duration_minutes:Number(item.durationMinutes) || 30,
          })),
        })
      } else {
        result = await supabase.rpc('revise_clinical_treatment_plan', { ...params, p_plan_id:selectedPlan.id })
      }
      if (result.error) throw result.error
      const planId = editor.mode === 'create' ? result.data : selectedPlan.id
      setEditor(null)
      setNotice(editor.mode === 'create' ? 'Plano registrado com histórico imutável.' : 'Nova versão registrada sem substituir as anteriores.')
      await reload(planId)
    } catch (saveError) {
      setError(saveError.message || 'Não foi possível registrar o plano.')
    } finally {
      setBusy('')
    }
  }

  async function addSession(values) {
    setBusy('session')
    setError('')
    try {
      const { error:rpcError } = await supabase.rpc('add_clinical_treatment_session', {
        p_plan_id:selectedPlan.id,
        p_request_id:values.requestId,
        p_session_type:values.sessionType,
        p_title:values.title,
        p_instructions:values.instructions || null,
        p_scheduled_start:values.scheduledStart ? clinicDateTimeToIso(values.scheduledStart) : null,
        p_duration_minutes:Number(values.durationMinutes) || 30,
      })
      if (rpcError) throw rpcError
      setSessionEditor(false)
      setNotice('Etapa adicionada ao plano.')
      await reload(selectedPlan.id)
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível adicionar a etapa.')
    } finally { setBusy('') }
  }

  async function recordSessionEvent(session, payload) {
    setBusy(session.id)
    setError('')
    try {
      const linkedConsultationId = session.timeline.find(item => item.consultation_id)?.consultation_id
      const scheduledIso = payload.scheduledStart ? clinicDateTimeToIso(payload.scheduledStart) : null
      const { error:rpcError } = await supabase.rpc('sync_clinical_treatment_session_schedule', {
        p_session_id:session.id,
        p_request_id:payload.requestId || newRequestId(),
        p_status:payload.status,
        p_scheduled_start:scheduledIso,
        p_duration_minutes:Number(payload.durationMinutes) || null,
        p_reason:payload.reason || null,
        p_sync_consultation:Boolean(linkedConsultationId),
      })
      if (rpcError) throw rpcError
      if (linkedConsultationId && setData) {
        setData(current => ({ ...current, consultations:(current.consultations || []).map(item => {
          if (item.id !== linkedConsultationId) return item
          if (['cancelled', 'no_show'].includes(payload.status)) return { ...item, paymentStatus:'cancelado' }
          const schedule = buildTreatmentConsultation({ id:linkedConsultationId, patient, session, event:{ scheduled_start:scheduledIso, duration_minutes:payload.durationMinutes } })
          return { ...item, date:schedule.date, startTime:schedule.startTime, durationMinutes:schedule.durationMinutes, paymentStatus:item.paymentStatus === 'cancelado' ? 'pendente' : item.paymentStatus }
        }) }))
      }
      setNotice('Histórico da sessão atualizado.')
      await reload(selectedPlan.id)
      return true
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível atualizar a sessão.')
      return false
    } finally { setBusy('') }
  }

  async function sendToCalendar(session) {
    const event = session.currentEvent
    if (!event?.scheduled_start || event.consultation_id) return
    setBusy(session.id)
    setError('')
    // O UUID da sessão também identifica a consulta gerada. Se o vínculo RPC falhar depois
    // da Agenda salvar, a tentativa seguinte reaproveita a mesma consulta em vez de duplicá-la.
    const consultationId = session.id
    const requestKey = `${session.id}:calendar`
    const requestId = calendarRequestIds.current.get(requestKey) || newRequestId()
    calendarRequestIds.current.set(requestKey, requestId)
    try {
      const consultation = buildTreatmentConsultation({ id:consultationId, patient, session, event })
      const { error:rpcError } = await supabase.rpc('sync_clinical_treatment_session_schedule', {
        p_session_id:session.id, p_request_id:requestId, p_status:'scheduled',
        p_scheduled_start:event.scheduled_start, p_duration_minutes:event.duration_minutes || 30,
        p_reason:'Vinculada à agenda da clínica.', p_sync_consultation:true,
      })
      if (rpcError) throw rpcError
      if (setData && !data?.consultations?.some(item => item.id === consultationId)) {
        setData(current => ({ ...current, consultations:[...(current.consultations || []), consultation] }))
      }
      setNotice('Retorno salvo na Agenda. As informações financeiras continuam opcionais e podem ser preenchidas lá.')
      calendarRequestIds.current.delete(requestKey)
      await reload(selectedPlan.id)
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível enviar a sessão para a agenda.')
    } finally { setBusy('') }
  }

  async function completeSession(session, values) {
    setBusy(session.id)
    setError('')
    try {
      const { error:rpcError } = await supabase.rpc('complete_clinical_treatment_session', {
        p_session_id:session.id,
        p_request_id:values.requestId || newRequestId(),
        p_care_occurred_at:clinicDateTimeToIso(values.occurredAt),
        p_evolution_notes:values.evolution,
        p_procedures_applied:values.procedure,
        p_next_appointment_date:values.nextDate || null,
      })
      if (rpcError) throw rpcError
      setNotice('Sessão concluída e evolução registrada no prontuário canônico.')
      await reload(selectedPlan.id)
      return true
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível concluir a sessão.')
      return false
    } finally { setBusy('') }
  }

  async function closePlan(status) {
    const reason = window.prompt(status === 'completed' ? 'Registre o desfecho do plano:' : 'Informe o motivo do cancelamento:')
    if (!reason?.trim()) return
    const requestKey = `${selectedPlan.id}:${status}`
    const previousRequest = closeRequestIds.current.get(requestKey)
    const requestId = previousRequest?.reason === reason.trim() ? previousRequest.requestId : newRequestId()
    closeRequestIds.current.set(requestKey, { requestId, reason:reason.trim() })
    setBusy('close')
    setError('')
    try {
      const { error:rpcError } = await supabase.rpc('close_clinical_treatment_plan', {
        p_plan_id:selectedPlan.id, p_request_id:requestId, p_status:status, p_reason:reason,
      })
      if (rpcError) throw rpcError
      setNotice(status === 'completed' ? 'Plano concluído.' : 'Plano cancelado com justificativa preservada.')
      closeRequestIds.current.delete(requestKey)
      await reload(selectedPlan.id)
    } catch (nextError) { setError(nextError.message || 'Não foi possível encerrar o plano.') }
    finally { setBusy('') }
  }

  if (loading) return <div className="clinical-loading">Carregando planos e retornos…</div>

  return (
    <section className="treatment-workspace" data-testid="clinical-treatment-plan">
      <header className="treatment-hero">
        <div><span>Planejamento longitudinal</span><h3>Plano terapêutico e retornos</h3><p>Condutas versionadas, etapas rastreáveis e evoluções no prontuário.</p></div>
        <Btn onClick={openNewPlan}>+ Novo plano</Btn>
      </header>
      <div className="treatment-compliance-note">
        <strong>Registro clínico protegido</strong>
        <span>Versões e eventos não são sobrescritos. A autoria eletrônica fica registrada; assinatura ICP-Brasil será indicada somente após a integração com o provedor.</span>
      </div>
      {error && <div className="clinical-alert" role="alert">{error}</div>}
      {notice && <div className="treatment-notice" role="status">{notice}</div>}

      {editor && <PlanEditor editor={editor} setEditor={setEditor} protocols={protocols} busy={busy === 'plan'} onSave={savePlan} onCancel={() => setEditor(null)} />}

      {!editor && plans.length === 0 && (
        <div className="treatment-empty"><span>⌁</span><h4>Nenhum plano registrado</h4><p>Crie o plano, defina os objetivos e organize os próximos atendimentos sem misturar o registro clínico com o financeiro.</p><Btn onClick={openNewPlan}>Criar primeiro plano</Btn></div>
      )}

      {!editor && plans.length > 0 && (
        <div className="treatment-layout">
          <aside className="treatment-plan-list" aria-label="Planos do paciente">
            {plans.map(plan => <button key={plan.id} type="button" className={selectedPlan?.id === plan.id ? 'is-active' : ''} onClick={() => setSelectedPlanId(plan.id)}><strong>{plan.currentVersion?.title || 'Plano sem título'}</strong><span>{TREATMENT_STATUS_LABELS[plan.currentStatus]} · v{plan.currentVersion?.version_number || 1}</span></button>)}
          </aside>
          {selectedPlan && <PlanDetail
            plan={selectedPlan} busy={busy} onRevise={openRevision} onAddSession={() => setSessionEditor(true)}
            onEvent={recordSessionEvent} onCalendar={sendToCalendar} onComplete={completeSession}
            onClose={closePlan} sessionEditor={sessionEditor} setSessionEditor={setSessionEditor} addSession={addSession}
          />}
        </div>
      )}
    </section>
  )
}

function PlanEditor({ editor, setEditor, protocols, busy, onSave, onCancel }) {
  const update = (key, value) => setEditor(current => ({ ...current, values:{ ...current.values, [key]:value } }))
  const updateSession = (index, key, value) => setEditor(current => ({ ...current, sessions:current.sessions.map((item, itemIndex) => itemIndex === index ? { ...item, [key]:value } : item) }))
  const applyProtocol = versionId => {
    const version = protocols.map(item => item.currentVersion).find(item => item?.id === versionId)
    if (!version) return
    setEditor(current => {
      const applied = applyProtocolToTreatment(version, current.values, current.values.expectedStartOn)
      return { ...current, values:applied.values, sessions:applied.sessions.length ? applied.sessions.map(item => ({ ...item, requestId:newRequestId() })) : current.sessions }
    })
  }
  return (
    <div className="treatment-editor">
      <header><div><span>{editor.mode === 'create' ? 'Novo plano' : 'Nova versão'}</span><h4>{editor.mode === 'create' ? 'Planejar tratamento' : 'Revisar sem apagar o histórico'}</h4></div><button type="button" onClick={onCancel} aria-label="Fechar editor">×</button></header>
      <div className="treatment-fields">
        {editor.mode === 'create' && protocols.length > 0 && <label className="is-area treatment-protocol-picker"><span>Começar por um protocolo</span><select value={editor.values.protocolVersionId || ''} onChange={event => applyProtocol(event.target.value)}><option value="">Preencher manualmente</option>{protocols.map(item => <option key={item.currentVersion.id} value={item.currentVersion.id}>{item.currentVersion.name} · v{item.currentVersion.version_number}</option>)}</select><small>O protocolo somente preenche o rascunho. Revise tudo antes de registrar.</small></label>}
        <Field label="Título do plano" value={editor.values.title} onChange={value => update('title', value)} required />
        <Field label="Indicação clínica" value={editor.values.indication} onChange={value => update('indication', value)} area required />
        <Field label="Hipótese/diagnóstico relacionado" value={editor.values.diagnosticSummary} onChange={value => update('diagnosticSummary', value)} area />
        <Field label="Objetivos terapêuticos" value={editor.values.objectives} onChange={value => update('objectives', value)} area required />
        <Field label="Tratamento proposto" value={editor.values.plannedTreatment} onChange={value => update('plannedTreatment', value)} area required />
        <Field label="Orientações, riscos discutidos e decisão compartilhada" value={editor.values.guidance} onChange={value => update('guidance', value)} area required />
        <Field label="Início previsto" type="date" value={editor.values.expectedStartOn} onChange={value => update('expectedStartOn', value)} />
        <Field label="Revisão prevista" type="date" value={editor.values.reviewOn} onChange={value => update('reviewOn', value)} />
      </div>
      {editor.mode === 'create' && <div className="treatment-initial-sessions"><div className="treatment-section-heading"><div><strong>Etapas iniciais</strong><span>Você também pode adicioná-las depois.</span></div><Btn variant="ghost" onClick={() => setEditor(current => ({ ...current, sessions:[...current.sessions, createSessionDraft()] }))}>+ Etapa</Btn></div>{editor.sessions.map((session, index) => <SessionFields key={session.requestId || index} values={session} onChange={(key, value) => updateSession(index, key, value)} />)}</div>}
      <footer><Btn variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Btn><Btn onClick={onSave} disabled={busy}>{busy ? 'Registrando…' : editor.mode === 'create' ? 'Registrar plano' : 'Registrar nova versão'}</Btn></footer>
    </div>
  )
}

function PlanDetail({ plan, busy, onRevise, onAddSession, onEvent, onCalendar, onComplete, onClose, sessionEditor, setSessionEditor, addSession }) {
  const version = plan.currentVersion
  const active = plan.currentStatus === 'active'
  return (
    <article className="treatment-plan-detail">
      <header><div><span className={`treatment-status is-${plan.currentStatus}`}>{TREATMENT_STATUS_LABELS[plan.currentStatus]}</span><h4>{version.title}</h4><p>Versão {version.version_number} · registrada por {version.author_name} · {version.author_council} {version.author_registration}</p></div>{active && <div><Btn variant="ghost" onClick={onRevise}>Nova versão</Btn><Btn variant="ghost" onClick={onAddSession}>+ Etapa</Btn></div>}</header>
      <div className="treatment-summary-grid">
        <Summary label="Indicação" value={version.indication} /><Summary label="Objetivos" value={version.objectives} />
        <Summary label="Tratamento proposto" value={version.planned_treatment} /><Summary label="Orientações e decisão compartilhada" value={version.guidance} />
        {version.diagnostic_summary && <Summary label="Hipótese/diagnóstico relacionado" value={version.diagnostic_summary} />}
      </div>
      {sessionEditor && <InlineSessionEditor busy={busy === 'session'} onSave={addSession} onCancel={() => setSessionEditor(false)} />}
      <div className="treatment-section-heading"><div><strong>Sessões e retornos</strong><span>{plan.sessions.length} etapa{plan.sessions.length === 1 ? '' : 's'} no plano</span></div></div>
      <div className="treatment-sessions">
        {plan.sessions.length === 0 && <div className="treatment-empty is-compact">Nenhuma etapa adicionada.</div>}
        {plan.sessions.map(session => <SessionCard key={session.id} session={session} active={active} busy={busy === session.id} onEvent={onEvent} onCalendar={onCalendar} onComplete={onComplete} />)}
      </div>
      {active && <footer className="treatment-close-actions"><span>Encerrar o plano preserva todas as versões e eventos.</span><div><Btn variant="danger" onClick={() => onClose('cancelled')} disabled={busy === 'close'}>Cancelar plano</Btn><Btn variant="success" onClick={() => onClose('completed')} disabled={busy === 'close'}>Concluir plano</Btn></div></footer>}
    </article>
  )
}

function SessionCard({ session, active, busy, onEvent, onCalendar, onComplete }) {
  const [mode, setMode] = useState('')
  const event = session.currentEvent || {}
  const lastScheduledEvent = [...session.timeline]
    .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))
    .find(item => item.scheduled_start) || event
  const linkedConsultationId = session.timeline.find(item => item.consultation_id)?.consultation_id
  const scheduled = lastScheduledEvent.scheduled_start ? new Date(lastScheduledEvent.scheduled_start).toLocaleString('pt-BR', {
    dateStyle:'short', timeStyle:'short', timeZone:'America/Sao_Paulo',
  }) : ''
  const done = event.status === 'completed'
  return <article className={`treatment-session is-${event.status || 'planned'}`}>
    <div className="treatment-session__number">{String(session.sequence_number).padStart(2, '0')}</div>
    <div className="treatment-session__body"><div><strong>{session.title}</strong><span>{TREATMENT_STATUS_LABELS[event.status] || 'Planejada'}{scheduled ? ` · ${scheduled}` : ''}</span></div>{session.instructions && <p>{session.instructions}</p>}{event.reason && <small>Registro: {event.reason}</small>}</div>
    <div className="treatment-session__actions">
      {linkedConsultationId && <span className="treatment-calendar-linked">✓ Na Agenda</span>}
      {active && !done && <><button type="button" onClick={() => setMode('schedule')}>{scheduled ? 'Reagendar' : 'Agendar'}</button>{scheduled && !linkedConsultationId && <button type="button" onClick={() => onCalendar(session)}>Enviar à Agenda</button>}<button type="button" onClick={() => setMode('complete')}>Concluir</button><button type="button" onClick={() => setMode('cancel')}>Ocorrência</button></>}
    </div>
    {mode === 'schedule' && <ScheduleEditor event={lastScheduledEvent} busy={busy} onCancel={() => setMode('')} onSave={values => onEvent(session, { ...values, status:scheduled ? 'rescheduled' : 'scheduled' }).then(success => { if (success) setMode('') })} />}
    {mode === 'complete' && <CompletionEditor busy={busy} onCancel={() => setMode('')} onSave={values => onComplete(session, values).then(success => { if (success) setMode('') })} />}
    {mode === 'cancel' && <OccurrenceEditor busy={busy} onCancel={() => setMode('')} onSave={values => onEvent(session, values).then(success => { if (success) setMode('') })} />}
  </article>
}

function InlineSessionEditor({ busy, onSave, onCancel }) {
  const [values, setValues] = useState(createSessionDraft)
  return <div className="treatment-inline-editor"><SessionFields values={values} onChange={(key, value) => setValues(current => ({ ...current, [key]:value }))} /><div><Btn variant="ghost" onClick={onCancel}>Cancelar</Btn><Btn disabled={busy || !values.title.trim()} onClick={() => onSave(values)}>{busy ? 'Salvando…' : 'Adicionar etapa'}</Btn></div></div>
}

function ScheduleEditor({ event, busy, onSave, onCancel }) {
  const [scheduledStart, setScheduledStart] = useState(event.scheduled_start ? clinicIsoToDateTime(event.scheduled_start) : '')
  const [requestId] = useState(newRequestId)
  const [durationMinutes, setDuration] = useState(event.duration_minutes || 30)
  return <div className="treatment-action-editor"><Field label="Data e hora" type="datetime-local" value={scheduledStart} onChange={setScheduledStart} required /><Field label="Duração (min)" type="number" value={durationMinutes} onChange={setDuration} /><div><Btn variant="ghost" onClick={onCancel}>Cancelar</Btn><Btn disabled={busy || !scheduledStart} onClick={() => onSave({ scheduledStart, durationMinutes, requestId })}>{busy ? 'Salvando…' : 'Confirmar agenda'}</Btn></div></div>
}

function CompletionEditor({ busy, onSave, onCancel }) {
  const localNow = clinicIsoToDateTime(new Date().toISOString())
  const [values, setValues] = useState({ occurredAt:localNow, evolution:'', procedure:'', nextDate:'', requestId:newRequestId() })
  const update = (key, value) => setValues(current => ({ ...current, [key]:value }))
  return <div className="treatment-action-editor is-completion"><Field label="Data e hora do atendimento" type="datetime-local" value={values.occurredAt} onChange={value => update('occurredAt', value)} required /><Field label="Evolução clínica" value={values.evolution} onChange={value => update('evolution', value)} area required /><Field label="Conduta/procedimento realizado" value={values.procedure} onChange={value => update('procedure', value)} area required /><Field label="Próximo retorno (opcional)" type="date" value={values.nextDate} onChange={value => update('nextDate', value)} /><div><Btn variant="ghost" onClick={onCancel}>Cancelar</Btn><Btn disabled={busy || !values.occurredAt || !values.evolution.trim() || !values.procedure.trim()} onClick={() => onSave(values)}>{busy ? 'Registrando…' : 'Concluir e registrar evolução'}</Btn></div></div>
}

function OccurrenceEditor({ busy, onSave, onCancel }) {
  const [status, setStatus] = useState('cancelled')
  const [reason, setReason] = useState('')
  const [requestId] = useState(newRequestId)
  return <div className="treatment-action-editor"><label><span>Ocorrência</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="cancelled">Cancelada</option><option value="no_show">Não compareceu</option></select></label><Field label="Motivo" value={reason} onChange={setReason} area required /><div><Btn variant="ghost" onClick={onCancel}>Voltar</Btn><Btn variant="danger" disabled={busy || !reason.trim()} onClick={() => onSave({ status, reason, requestId })}>Registrar ocorrência</Btn></div></div>
}

function SessionFields({ values, onChange }) {
  return <div className="treatment-session-fields"><label><span>Tipo</span><select value={values.sessionType} onChange={event => onChange('sessionType', event.target.value)}>{TREATMENT_SESSION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><Field label="Título da etapa" value={values.title} onChange={value => onChange('title', value)} required /><Field label="Orientações da etapa" value={values.instructions} onChange={value => onChange('instructions', value)} /><Field label="Data e hora (opcional)" type="datetime-local" value={values.scheduledStart} onChange={value => onChange('scheduledStart', value)} /><Field label="Duração (min)" type="number" value={values.durationMinutes} onChange={value => onChange('durationMinutes', value)} /></div>
}

function Field({ label, value, onChange, type = 'text', area = false, required = false }) {
  return <label className={area ? 'is-area' : ''}><span>{label}{required ? ' *' : ''}</span>{area ? <textarea value={value} onChange={event => onChange(event.target.value)} rows={3} /> : <input type={type} value={value} onChange={event => onChange(event.target.value)} />}</label>
}

function Summary({ label, value }) {
  return <div><span>{label}</span><p>{value}</p></div>
}
