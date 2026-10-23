import { expect, test } from '@playwright/test'
import {
  buildTreatmentConsultation,
  buildTreatmentWorkspace,
  clinicDateTimeToIso,
  clinicIsoToDateTime,
  latestTimelineEvent,
  validateTreatmentDraft,
} from '../../src/lib/clinicalTreatment.js'

test('interpreta datetime-local no fuso da clínica, independente do navegador', () => {
  expect(clinicDateTimeToIso('2026-10-23T14:30')).toBe('2026-10-23T17:30:00.000Z')
  expect(clinicIsoToDateTime('2026-10-23T17:30:00.000Z')).toBe('2026-10-23T14:30')
})

test('valida os campos clínicos obrigatórios e a ordem das datas', () => {
  expect(validateTreatmentDraft({})).toMatchObject({ valid:false })
  expect(validateTreatmentDraft({
    title:'Pós-operatório', indication:'Acompanhamento', objectives:'Recuperação segura',
    plannedTreatment:'Consultas e curativos', guidance:'Riscos e alternativas discutidos',
    expectedStartOn:'2026-10-23', reviewOn:'2026-10-22',
  })).toEqual({ valid:false, message:'A data de revisão não pode ser anterior ao início previsto.' })
  expect(validateTreatmentDraft({
    title:'Pós-operatório', indication:'Acompanhamento', objectives:'Recuperação segura',
    plannedTreatment:'Consultas e curativos', guidance:'Riscos e alternativas discutidos',
  }).valid).toBe(true)
})

test('deriva estado atual sem apagar a linha do tempo', () => {
  const events = [
    { id:'1', status:'planned', recorded_at:'2026-10-23T10:00:00Z' },
    { id:'2', status:'scheduled', recorded_at:'2026-10-23T11:00:00Z' },
    { id:'3', status:'rescheduled', recorded_at:'2026-10-23T12:00:00Z' },
  ]
  expect(latestTimelineEvent(events)?.status).toBe('rescheduled')
  expect(events).toHaveLength(3)
})

test('monta planos, versões e sessões a partir dos registros append-only', () => {
  const workspace = buildTreatmentWorkspace({
    plans:[{ id:'p1', created_at:'2026-10-23T10:00:00Z' }],
    versions:[
      { id:'v1', plan_id:'p1', version_number:1, title:'Inicial' },
      { id:'v2', plan_id:'p1', version_number:2, title:'Revisado' },
    ],
    statuses:[{ id:'st1', plan_id:'p1', status:'active', recorded_at:'2026-10-23T10:00:00Z' }],
    sessions:[{ id:'s1', plan_id:'p1', sequence_number:1 }],
    events:[
      { id:'e1', session_id:'s1', status:'planned', recorded_at:'2026-10-23T10:00:00Z' },
      { id:'e2', session_id:'s1', status:'completed', recorded_at:'2026-10-23T12:00:00Z' },
    ],
  })
  expect(workspace[0].currentVersion.title).toBe('Revisado')
  expect(workspace[0].versions).toHaveLength(2)
  expect(workspace[0].sessions[0].currentEvent.status).toBe('completed')
  expect(workspace[0].sessions[0].timeline).toHaveLength(2)
})

test('cria consulta canônica sem valor financeiro e no fuso da clínica', () => {
  const consultation = buildTreatmentConsultation({
    id:'consultation-1',
    patient:{ id:'patient-1', full_name:'Ana Clínica' },
    session:{ id:'session-1', session_type:'return' },
    event:{ scheduled_start:'2026-10-23T17:30:00Z', duration_minutes:45 },
  })
  expect(consultation).toMatchObject({
    id:'consultation-1', patient:'Ana Clínica', patientId:'patient-1', date:'2026-10-23',
    startTime:'14:30', durationMinutes:45, consultationType:'retorno', value:0,
  })
})
