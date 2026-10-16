import { expect, test } from '@playwright/test'
import {
  buildAddendumPayload,
  buildClinicalRecordPayload,
  groupAddendaByRecord,
  professionalSignature,
} from '../../src/lib/clinicalRecord.js'

const author = { name:'Dra. Vitória', registration:'123456-SP', council:'CRM' }

test('monta evolução com autoria autenticada sem permitir campos vazios', () => {
  const payload = buildClinicalRecordPayload({
    form:{ session_date:'2026-10-16', evolution_notes:'  Evolução estável.  ', procedures_applied:'Avaliação' },
    ownerId:'owner', patientId:'patient', actorId:'actor', author,
  })
  expect(payload).toMatchObject({
    user_id:'owner', patient_id:'patient', created_by:'actor',
    evolution_notes:'Evolução estável.', author_name:'Dra. Vitória',
    author_registration:'123456-SP', authorship_source:'authenticated_user',
  })
  expect(() => buildClinicalRecordPayload({ form:{ session_date:'2026-10-16', evolution_notes:'' }, ownerId:'owner', patientId:'patient', actorId:'actor', author })).toThrow('Data e evolução')
})

test('adendo preserva registro original e exige assinatura profissional', () => {
  expect(buildAddendumPayload({ text:'  Correção sem apagar o original. ', ownerId:'owner', recordId:'record', actorId:'actor', author })).toEqual({
    user_id:'owner', record_id:'record', created_by:'actor', addendum_text:'Correção sem apagar o original.',
    author_name:'Dra. Vitória', author_registration:'123456-SP', author_council:'CRM',
  })
  expect(() => buildAddendumPayload({ text:'x', ownerId:'owner', recordId:'record', actorId:'actor', author:{ name:'', registration:'' } })).toThrow('registro profissional')
})

test('agrupa adendos em ordem cronológica e identifica autoria legada', () => {
  const grouped = groupAddendaByRecord([
    { id:'b', record_id:'r1', created_at:'2026-10-16T11:00:00Z' },
    { id:'a', record_id:'r1', created_at:'2026-10-16T10:00:00Z' },
    { id:'x', record_id:null },
  ])
  expect(grouped.r1.map(item => item.id)).toEqual(['a', 'b'])
  expect(professionalSignature({ professional_name:'Legado' })).toBe('Legado · registro não informado')
})
