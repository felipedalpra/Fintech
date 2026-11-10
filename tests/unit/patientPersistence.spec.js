import { expect, test } from '@playwright/test'
import {
  buildPatientClinicalPayload,
  buildPatientPayload,
  buildPatientSaveRpcArgs,
  confirmedPatientSave,
  PATIENT_CLINICAL_FIELDS,
  PATIENT_FIELDS,
} from '../../src/lib/patientPersistence.js'

const completeForm = Object.fromEntries([
  ...PATIENT_FIELDS,
  ...PATIENT_CLINICAL_FIELDS,
].map(field => [field, ` valor de ${field} `]))

Object.assign(completeForm, {
  full_name:' Paciente Completa ',
  date_of_birth:'1990-02-03',
  start_date:'2026-11-10',
  consent_signed:true,
  consent_date:'2026-11-10',
})

test('mapeia todos os campos cadastrais e clínicos sem omissões', () => {
  const patient = buildPatientPayload(completeForm)
  const clinical = buildPatientClinicalPayload(completeForm)

  expect(Object.keys(patient)).toEqual(PATIENT_FIELDS)
  expect(Object.keys(clinical)).toEqual([...PATIENT_CLINICAL_FIELDS, 'consent_signed', 'consent_date'])
  expect(patient.full_name).toBe('Paciente Completa')
  expect(patient.cpf).toBe('valor de cpf')
  expect(clinical.current_medications).toBe('valor de current_medications')
  expect(clinical.consent_date).toBe('2026-11-10')
})

test('envia cadastro e perfil clínico em uma única chamada atômica', () => {
  const args = buildPatientSaveRpcArgs({ patientId:'patient-1', form:completeForm, includeClinical:true })
  expect(args).toMatchObject({
    p_patient_id:'patient-1',
    p_patient:{ full_name:'Paciente Completa' },
    p_clinical:{ allergies:'valor de allergies', consent_signed:true },
  })
})

test('confirma o retorno integral antes de considerar o paciente salvo', () => {
  const args = buildPatientSaveRpcArgs({ form:completeForm, includeClinical:true })
  const patient = { id:'patient-1', ...args.p_patient }
  const clinical_profile = { patient_id:'patient-1', ...args.p_clinical }

  expect(confirmedPatientSave({ patient, clinical_profile }, args)).toMatchObject({
    id:'patient-1',
    full_name:'Paciente Completa',
    current_medications:'valor de current_medications',
  })
  expect(() => confirmedPatientSave({ patient, clinical_profile:{ ...clinical_profile, allergies:'outro valor' } }, args))
    .toThrow(/não confirmou integralmente os dados clínicos/i)
})

test('não envia consentimento datado quando o termo não está assinado', () => {
  expect(buildPatientClinicalPayload({ consent_signed:false, consent_date:'2026-11-10' })).toMatchObject({
    consent_signed:false,
    consent_date:null,
  })
})
