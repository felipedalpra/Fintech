export const TREATMENT_SESSION_TYPES = [
  { value:'procedure', label:'Procedimento' },
  { value:'consultation', label:'Consulta' },
  { value:'return', label:'Retorno' },
  { value:'exam', label:'Revisão de exames' },
  { value:'other', label:'Outro' },
]

export const TREATMENT_STATUS_LABELS = {
  active:'Em andamento', completed:'Concluído', cancelled:'Cancelado', planned:'Planejada',
  scheduled:'Agendada', rescheduled:'Reagendada', no_show:'Não compareceu',
}

export function latestTimelineEvent(events = []) {
  return [...events].sort((a, b) => {
    const time = new Date(b.recorded_at || 0).getTime() - new Date(a.recorded_at || 0).getTime()
    return time || String(b.id || '').localeCompare(String(a.id || ''))
  })[0] || null
}

export function validateTreatmentDraft(draft) {
  const missing = []
  if (!String(draft?.title || '').trim()) missing.push('título')
  if (!String(draft?.indication || '').trim()) missing.push('indicação clínica')
  if (!String(draft?.objectives || '').trim()) missing.push('objetivos')
  if (!String(draft?.plannedTreatment || '').trim()) missing.push('tratamento proposto')
  if (!String(draft?.guidance || '').trim()) missing.push('orientações e decisão compartilhada')
  if (draft?.expectedStartOn && draft?.reviewOn && draft.reviewOn < draft.expectedStartOn) {
    return { valid:false, message:'A data de revisão não pode ser anterior ao início previsto.' }
  }
  return missing.length
    ? { valid:false, message:`Preencha: ${missing.join(', ')}.` }
    : { valid:true, message:'' }
}

export function buildTreatmentConsultation({ id, patient, session, event }) {
  if (!id || !patient?.id || !session?.id || !event?.scheduled_start) {
    throw new Error('Paciente, sessão e data/hora são obrigatórios para enviar à agenda.')
  }
  const scheduled = new Date(event.scheduled_start)
  if (Number.isNaN(scheduled.getTime())) throw new Error('Data e hora da sessão são inválidas.')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).formatToParts(scheduled).reduce((result, part) => ({ ...result, [part.type]:part.value }), {})
  const type = session.session_type === 'return' ? 'retorno' : 'avaliacao'
  return {
    id,
    patient:patient.full_name,
    patientId:patient.id,
    date:`${parts.year}-${parts.month}-${parts.day}`,
    competenceDate:`${parts.year}-${parts.month}-${parts.day}`,
    dueDate:`${parts.year}-${parts.month}-${parts.day}`,
    startTime:`${parts.hour}:${parts.minute}`,
    durationMinutes:Number(event.duration_minutes) || 30,
    consultationType:type,
    value:0,
    paymentType:'particular',
    paymentMethod:null,
    paymentStatus:'pendente',
    forecastPaymentDate:`${parts.year}-${parts.month}-${parts.day}`,
    invoiceIssuancePercent:0,
    costSettlements:{},
    receiptSettlements:{},
  }
}

export function buildTreatmentWorkspace({ plans = [], versions = [], statuses = [], sessions = [], events = [] }) {
  return [...plans]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(plan => {
      const planVersions = versions.filter(item => item.plan_id === plan.id).sort((a, b) => b.version_number - a.version_number)
      const planStatuses = statuses.filter(item => item.plan_id === plan.id)
      return {
        ...plan,
        versions:planVersions,
        currentVersion:planVersions[0] || null,
        statusEvents:planStatuses,
        currentStatus:latestTimelineEvent(planStatuses)?.status || 'active',
        sessions:sessions.filter(item => item.plan_id === plan.id).sort((a, b) => a.sequence_number - b.sequence_number).map(session => {
          const timeline = events.filter(item => item.session_id === session.id)
          return { ...session, timeline, currentEvent:latestTimelineEvent(timeline) }
        }),
      }
    })
}

export function newRequestId() {
  return globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000000'
}
