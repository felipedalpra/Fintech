const asDate = value => {
  if (!value) return null
  const parsed = new Date(String(value).length === 10 ? `${value}T12:00:00` : value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const timeValue = value => asDate(value)?.getTime() || 0

const latestBy = (rows, key) => [...rows].sort((left, right) => timeValue(right[key]) - timeValue(left[key]))[0] || null

const latestByGroup = (rows, groupKey, dateKey) => {
  const latest = new Map()
  for (const row of rows || []) {
    const key = row?.[groupKey]
    if (!key) continue
    const current = latest.get(key)
    if (!current || timeValue(row[dateKey]) > timeValue(current[dateKey])) latest.set(key, row)
  }
  return latest
}

const patientNameMap = patients => new Map((patients || []).map(patient => [patient.id, patient.full_name || 'Paciente']))

const operationalAppointments = data => [
  ...(data?.consultations || []).filter(item => item.paymentStatus !== 'cancelado').map(item => ({
    id:`consultation:${item.id}`,
    patientId:item.patientId || '',
    patientName:item.patient || 'Paciente não identificado',
    occurredAt:item.date ? `${item.date}T${String(item.startTime || '12:00').slice(0, 5)}:00` : '',
    kind:'consultation',
    label:'Consulta',
  })),
  ...(data?.surgeries || []).filter(item => item.paymentStatus !== 'cancelado').map(item => ({
    id:`surgery:${item.id}`,
    patientId:item.patientId || '',
    patientName:item.patient || 'Paciente não identificado',
    occurredAt:item.date ? `${item.date}T${String(item.startTime || '12:00').slice(0, 5)}:00` : '',
    kind:'surgery',
    label:'Cirurgia',
  })),
]

function documentSignatureState(document, latestSignatureByDocument) {
  const signature = latestSignatureByDocument.get(document.id)
  if (!signature) return { status:'manual', label:'Via manual' }
  if (signature.status === 'signed') return { status:'signed', label:'Assinado digitalmente' }
  if (signature.status === 'failed') return { status:'failed', label:'Falha na assinatura' }
  if (signature.status === 'cancelled') return { status:'cancelled', label:'Assinatura cancelada' }
  return { status:'pending', label:'Assinatura pendente' }
}

export function buildClinicalTimeline(bundle, patientId) {
  const events = []
  const push = event => {
    if (!event.patientId || event.patientId !== patientId || !event.occurredAt) return
    events.push(event)
  }

  for (const record of bundle.records || []) push({
    id:`record:${record.id}`, patientId:record.patient_id, type:'record', title:'Evolução clínica',
    detail:record.author_name || 'Autoria registrada', occurredAt:record.recorded_at || record.session_date,
  })
  for (const anamnesis of bundle.anamneses || []) push({
    id:`anamnesis:${anamnesis.id}`, patientId:anamnesis.patient_id, type:'anamnesis', title:'Anamnese assinada',
    detail:anamnesis.author_name || 'Autoria registrada', occurredAt:anamnesis.recorded_at || anamnesis.session_date,
  })
  for (const submission of bundle.intakeSubmissions || []) push({
    id:`intake:${submission.id}`, patientId:submission.patient_id, type:'intake', title:'Pré-anamnese recebida',
    detail:'Declaração enviada pelo paciente', occurredAt:submission.submitted_at,
  })
  for (const document of bundle.documents || []) push({
    id:`document:${document.id}`, patientId:document.patient_id, type:'document',
    title:document.document_type === 'simple_prescription' ? 'Receita simples emitida' : 'Pedido de exames emitido',
    detail:document.author_name || 'Documento clínico', occurredAt:document.created_at || document.issue_date,
  })
  for (const asset of bundle.assets || []) {
    if (!['available', 'archived'].includes(asset.status)) continue
    push({
      id:`asset:${asset.id}`, patientId:asset.patient_id, type:'asset',
      title:asset.asset_kind === 'document' ? 'Documento anexado' : `Foto clínica ${asset.stage === 'before' ? '— antes' : asset.stage === 'after' ? '— depois' : ''}`.trim(),
      detail:asset.file_name || asset.procedure_name || 'Arquivo clínico', occurredAt:asset.completed_at || asset.created_at || asset.captured_on,
    })
  }
  for (const version of bundle.planVersions || []) push({
    id:`plan:${version.id}`, patientId:version.patient_id, type:'plan', title:'Plano de tratamento registrado',
    detail:version.title || `Versão ${version.version_number}`, occurredAt:version.recorded_at,
  })
  for (const event of bundle.sessionEvents || []) push({
    id:`session:${event.id}`, patientId:event.patient_id, type:'session', title:'Etapa do plano atualizada',
    detail:event.status === 'completed' ? 'Sessão concluída' : event.status === 'scheduled' || event.status === 'rescheduled' ? 'Sessão agendada' : 'Situação atualizada',
    occurredAt:event.recorded_at || event.scheduled_start,
  })
  for (const appointment of operationalAppointments(bundle.data)) push({
    id:appointment.id, patientId:appointment.patientId, type:appointment.kind, title:appointment.label,
    detail:'Agenda clínica', occurredAt:appointment.occurredAt,
  })

  return events.sort((left, right) => timeValue(right.occurredAt) - timeValue(left.occurredAt))
}

export function buildClinicalWorkspaceIndex(bundle, referenceDate = new Date()) {
  const patients = bundle.patients || []
  const names = patientNameMap(patients)
  const appointments = operationalAppointments(bundle.data)
  const referenceTime = referenceDate.getTime()
  const referenceDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()).getTime()
  const latestSignatureByDocument = latestByGroup(bundle.signatures || [], 'document_id', 'created_at')
  const latestPlanStatus = latestByGroup(bundle.planStatuses || [], 'plan_id', 'recorded_at')
  const latestSessionEvent = latestByGroup(bundle.sessionEvents || [], 'session_id', 'recorded_at')
  const latestAnamnesisByPatient = latestByGroup(bundle.anamneses || [], 'patient_id', 'recorded_at')
  const latestIntakeSubmissionByPatient = latestByGroup(bundle.intakeSubmissions || [], 'patient_id', 'submitted_at')
  const documentsById = new Map((bundle.documents || []).map(document => [document.id, document]))
  const pendingItems = []

  for (const request of bundle.intakeRequests || []) {
    if (request.status !== 'pending' || timeValue(request.expires_at) < referenceTime) continue
    pendingItems.push({
      id:`intake-request:${request.id}`, patientId:request.patient_id, kind:'intake_waiting', tone:'neutral',
      title:'Pré-anamnese aguardando paciente', detail:'Link ativo ainda não respondido', dueAt:request.expires_at,
    })
  }

  for (const submission of latestIntakeSubmissionByPatient.values()) {
    const latestAnamnesis = latestAnamnesisByPatient.get(submission.patient_id)
    if (latestAnamnesis && timeValue(latestAnamnesis.recorded_at || latestAnamnesis.session_date) >= timeValue(submission.submitted_at)) continue
    pendingItems.push({
      id:`intake-review:${submission.id}`, patientId:submission.patient_id, kind:'intake_review', tone:'warn',
      title:'Pré-anamnese pronta para revisão', detail:'Revisar antes de levar as respostas para a SOAP', dueAt:submission.submitted_at,
    })
  }

  for (const signature of latestSignatureByDocument.values()) {
    if (!['pending', 'failed'].includes(signature.status)) continue
    const document = documentsById.get(signature.document_id)
    if (!document) continue
    pendingItems.push({
      id:`signature:${signature.id}`, patientId:document.patient_id, kind:'signature', tone:signature.status === 'failed' ? 'danger' : 'warn',
      title:signature.status === 'failed' ? 'Falha na assinatura digital' : 'Assinatura digital pendente',
      detail:document.document_type === 'simple_prescription' ? 'Receita simples' : 'Pedido de exames', dueAt:signature.updated_at || signature.created_at,
    })
  }

  const recordsByPatient = new Map()
  for (const record of bundle.records || []) {
    if (!record.patient_id) continue
    if (!recordsByPatient.has(record.patient_id)) recordsByPatient.set(record.patient_id, [])
    recordsByPatient.get(record.patient_id).push(record)
  }
  for (const [patientId, records] of recordsByPatient) {
    const latestReturn = records
      .filter(record => record.next_appointment_date && timeValue(record.next_appointment_date) < referenceDay)
      .sort((left, right) => timeValue(right.recorded_at || right.session_date) - timeValue(left.recorded_at || left.session_date))[0]
    const newestInstruction = records
      .filter(record => record.next_appointment_date)
      .sort((left, right) => timeValue(right.recorded_at || right.session_date) - timeValue(left.recorded_at || left.session_date))[0]
    if (!latestReturn || newestInstruction?.id !== latestReturn.id) continue
    const hasLaterAppointment = appointments.some(item => item.patientId === patientId && timeValue(item.occurredAt) >= timeValue(latestReturn.next_appointment_date))
    if (!hasLaterAppointment) pendingItems.push({
      id:`return:${patientId}:${latestReturn.id}`, patientId, kind:'return', tone:'danger', title:'Retorno vencido',
      detail:'Não há novo atendimento vinculado após a data indicada', dueAt:latestReturn.next_appointment_date,
    })
  }

  for (const version of bundle.planVersions || []) {
    if (!version.review_on || timeValue(version.review_on) >= referenceDay) continue
    const latestVersion = latestBy((bundle.planVersions || []).filter(item => item.plan_id === version.plan_id), 'recorded_at')
    if (latestVersion?.id !== version.id || latestPlanStatus.get(version.plan_id)?.status !== 'active') continue
    pendingItems.push({
      id:`plan-review:${version.id}`, patientId:version.patient_id, kind:'plan_review', tone:'warn', title:'Revisão do plano vencida',
      detail:version.title || 'Plano terapêutico ativo', dueAt:version.review_on,
    })
  }

  const sessionsById = new Map((bundle.sessions || []).map(session => [session.id, session]))
  for (const [sessionId, event] of latestSessionEvent) {
    if (!['scheduled', 'rescheduled'].includes(event.status) || timeValue(event.scheduled_start) >= referenceTime) continue
    const session = sessionsById.get(sessionId)
    pendingItems.push({
      id:`session-overdue:${event.id}`, patientId:event.patient_id, kind:'session_overdue', tone:'danger', title:'Sessão agendada sem conclusão',
      detail:session?.title || 'Etapa do plano terapêutico', dueAt:event.scheduled_start,
    })
  }

  const patientItems = patients.map(patient => {
    const patientAppointments = appointments.filter(item => item.patientId === patient.id)
    const patientRecords = (bundle.records || []).filter(item => item.patient_id === patient.id)
    const patientDocuments = (bundle.documents || []).filter(item => item.patient_id === patient.id)
    const patientAssets = (bundle.assets || []).filter(item => item.patient_id === patient.id && item.status === 'available')
    const patientPlans = (bundle.plans || []).filter(item => item.patient_id === patient.id)
    const careEvents = [
      ...patientAppointments.map(item => ({ occurredAt:item.occurredAt })),
      ...patientRecords.map(item => ({ occurredAt:item.recorded_at || item.session_date })),
      ...(bundle.anamneses || []).filter(item => item.patient_id === patient.id).map(item => ({ occurredAt:item.recorded_at || item.session_date })),
    ]
    const previousCare = careEvents.filter(item => timeValue(item.occurredAt) <= referenceTime).sort((a, b) => timeValue(b.occurredAt) - timeValue(a.occurredAt))[0]
    const nextAppointment = patientAppointments.filter(item => timeValue(item.occurredAt) >= referenceTime).sort((a, b) => timeValue(a.occurredAt) - timeValue(b.occurredAt))[0]
    const activePlans = patientPlans.filter(plan => latestPlanStatus.get(plan.id)?.status === 'active').length
    return {
      ...patient,
      lastCareAt:previousCare?.occurredAt || '',
      nextAppointment:nextAppointment || null,
      recordCount:patientRecords.length,
      documentCount:patientDocuments.length,
      assetCount:patientAssets.length,
      activePlanCount:activePlans,
      pendingCount:pendingItems.filter(item => item.patientId === patient.id).length,
    }
  }).sort((left, right) => {
    if (left.pendingCount !== right.pendingCount) return right.pendingCount - left.pendingCount
    return String(left.full_name || '').localeCompare(String(right.full_name || ''), 'pt-BR')
  })

  const documents = (bundle.documents || []).map(document => ({
    ...document,
    patientName:names.get(document.patient_id) || document.patient_name || 'Paciente não identificado',
    signature:documentSignatureState(document, latestSignatureByDocument),
  })).sort((left, right) => timeValue(right.created_at || right.issue_date) - timeValue(left.created_at || left.issue_date))

  return {
    patientItems,
    pendingItems:pendingItems.map(item => ({ ...item, patientName:names.get(item.patientId) || 'Paciente não identificado' }))
      .sort((left, right) => timeValue(left.dueAt) - timeValue(right.dueAt)),
    documents,
    timelineByPatient:new Map(patients.map(patient => [patient.id, buildClinicalTimeline(bundle, patient.id)])),
  }
}

export function clinicalPendingLabel(kind) {
  return ({
    intake_waiting:'Aguardando paciente', intake_review:'Revisão clínica', signature:'Assinatura', return:'Retorno',
    plan_review:'Plano de tratamento', session_overdue:'Sessão do plano',
  })[kind] || 'Pendência clínica'
}

export function clinicalTimelineLabel(type) {
  return ({
    record:'Prontuário', anamnesis:'Anamnese', intake:'Pré-anamnese', document:'Documento', asset:'Arquivo',
    plan:'Plano', session:'Plano', consultation:'Consulta', surgery:'Cirurgia',
  })[type] || 'Clínico'
}
