import { expect, test } from '@playwright/test'
import { conversationKind, isCrmContactSchemaMissing, opportunityPerson } from '../../src/lib/crmContact.js'

test('prioriza paciente confirmado na identidade da oportunidade', () => {
  expect(opportunityPerson({
    patient_id: 'p1',
    patients: { full_name: 'Ana Paciente', phone: '5511999990000' },
    crm_contacts: { full_name: 'Ana Lead', phone: '5511888880000' },
  })).toEqual({ name: 'Ana Paciente', phone: '5511999990000', isPatient: true })
})

test('lead sem paciente usa o contato CRM', () => {
  expect(opportunityPerson({
    patient_id: null,
    crm_contacts: { full_name: 'Maria Lead', phone: '5511888880000' },
  })).toEqual({ name: 'Maria Lead', phone: '5511888880000', isPatient: false })
})

test('classifica grupo, paciente, lead, ignorado e contato sem confundir identidades', () => {
  expect(conversationKind({ isGroup: true, patientId: 'p1', contactStatus: 'patient' })).toBe('group')
  expect(conversationKind({ patientId: 'p1', contactStatus: 'contact' })).toBe('patient')
  expect(conversationKind({ contactStatus: 'lead' })).toBe('lead')
  expect(conversationKind({ contactStatus: 'ignored' })).toBe('ignored')
  expect(conversationKind()).toBe('contact')
})

test('reconhece somente erros de schema usados no fallback de deploy', () => {
  expect(isCrmContactSchemaMissing({ code:'PGRST200' })).toBe(true)
  expect(isCrmContactSchemaMissing({ code:'PGRST204' })).toBe(true)
  expect(isCrmContactSchemaMissing({ code:'42703' })).toBe(true)
  expect(isCrmContactSchemaMissing({ code:'42501' })).toBe(false)
  expect(isCrmContactSchemaMissing(null)).toBe(false)
})
