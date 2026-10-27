import { expect, test } from '@playwright/test'
import { buildClinicalTimeline, buildClinicalWorkspaceIndex } from '../../src/lib/clinicalWorkspaceIndex.js'

const reference = new Date('2026-10-26T12:00:00-03:00')

function bundle(overrides = {}) {
  return {
    patients:[{ id:'patient-1', full_name:'Ana Clínica', phone:'51999990000' }],
    data:{ consultations:[], surgeries:[] },
    records:[], anamneses:[], intakeRequests:[], intakeSubmissions:[], documents:[], signatures:[], assets:[],
    plans:[], planVersions:[], planStatuses:[], sessions:[], sessionEvents:[],
    ...overrides,
  }
}

test('consolida pacientes sem expor conteúdo clínico e prioriza quem tem pendências', () => {
  const index = buildClinicalWorkspaceIndex(bundle({
    patients:[
      { id:'patient-1', full_name:'Ana Clínica', phone:'51999990000' },
      { id:'patient-2', full_name:'Beatriz Sem Pendência' },
    ],
    records:[{ id:'record-1', patient_id:'patient-1', session_date:'2026-10-20', recorded_at:'2026-10-20T15:00:00Z', next_appointment_date:'2026-10-22' }],
    documents:[{ id:'document-1', patient_id:'patient-1', patient_name:'Ana Clínica', document_type:'exam_request', issue_date:'2026-10-20', created_at:'2026-10-20T15:10:00Z' }],
  }), reference)

  expect(index.patientItems.map(item => item.id)).toEqual(['patient-1', 'patient-2'])
  expect(index.patientItems[0]).toMatchObject({ recordCount:1, documentCount:1, pendingCount:1 })
  expect(index.patientItems[0]).not.toHaveProperty('evolution_notes')
  expect(index.pendingItems[0]).toMatchObject({ kind:'return', patientName:'Ana Clínica' })
})

test('não cria pendência de retorno quando existe atendimento posterior vinculado', () => {
  const index = buildClinicalWorkspaceIndex(bundle({
    data:{ consultations:[{ id:'consultation-1', patientId:'patient-1', patient:'Ana Clínica', date:'2026-10-28', startTime:'09:30', paymentStatus:'pendente' }], surgeries:[] },
    records:[{ id:'record-1', patient_id:'patient-1', session_date:'2026-10-10', recorded_at:'2026-10-10T15:00:00Z', next_appointment_date:'2026-10-22' }],
  }), reference)

  expect(index.pendingItems.filter(item => item.kind === 'return')).toHaveLength(0)
  expect(index.patientItems[0].nextAppointment).toMatchObject({ id:'consultation:consultation-1' })
})

test('uma orientação de retorno futura mais recente substitui o retorno antigo vencido', () => {
  const index = buildClinicalWorkspaceIndex(bundle({
    records:[
      { id:'record-old', patient_id:'patient-1', session_date:'2026-10-10', recorded_at:'2026-10-10T15:00:00Z', next_appointment_date:'2026-10-20' },
      { id:'record-new', patient_id:'patient-1', session_date:'2026-10-24', recorded_at:'2026-10-24T15:00:00Z', next_appointment_date:'2026-11-20' },
    ],
  }), reference)

  expect(index.pendingItems.filter(item => item.kind === 'return')).toHaveLength(0)
})

test('considera apenas a tentativa de assinatura mais recente', () => {
  const index = buildClinicalWorkspaceIndex(bundle({
    documents:[{ id:'document-1', patient_id:'patient-1', patient_name:'Ana Clínica', document_type:'simple_prescription', issue_date:'2026-10-20', created_at:'2026-10-20T15:10:00Z' }],
    signatures:[
      { id:'signature-old', document_id:'document-1', status:'failed', created_at:'2026-10-20T15:20:00Z' },
      { id:'signature-new', document_id:'document-1', status:'signed', created_at:'2026-10-20T15:30:00Z', signed_at:'2026-10-20T15:30:00Z' },
    ],
  }), reference)

  expect(index.documents[0].signature).toEqual({ status:'signed', label:'Assinado digitalmente' })
  expect(index.pendingItems.filter(item => item.kind === 'signature')).toHaveLength(0)
})

test('pré-anamnese recebida deixa de aparecer para revisão depois de uma anamnese posterior', () => {
  const index = buildClinicalWorkspaceIndex(bundle({
    intakeSubmissions:[{ id:'submission-1', patient_id:'patient-1', submitted_at:'2026-10-20T10:00:00Z' }],
    anamneses:[{ id:'anamnesis-1', patient_id:'patient-1', session_date:'2026-10-21', recorded_at:'2026-10-21T10:00:00Z' }],
  }), reference)

  expect(index.pendingItems.filter(item => item.kind === 'intake_review')).toHaveLength(0)
})

test('linha do tempo reúne metadados das fontes sem copiar o conteúdo da evolução', () => {
  const timeline = buildClinicalTimeline(bundle({
    records:[{ id:'record-1', patient_id:'patient-1', evolution_notes:'conteúdo sensível', author_name:'Dra. Teste', recorded_at:'2026-10-20T10:00:00Z' }],
    assets:[{ id:'asset-1', patient_id:'patient-1', asset_kind:'document', status:'available', file_name:'termo.pdf', completed_at:'2026-10-21T10:00:00Z' }],
  }), 'patient-1')

  expect(timeline.map(event => event.type)).toEqual(['asset', 'record'])
  expect(JSON.stringify(timeline)).not.toContain('conteúdo sensível')
})
