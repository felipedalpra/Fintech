import { expect, test } from '@playwright/test'
import {
  buildClinicalAnamnesisRpcArgs,
  calculateClinicalBmi,
  clinicalAnamnesisFromLegacy,
  emptyClinicalAnamnesis,
  hasLegacyClinicalAnamnesis,
  validateClinicalAnamnesis,
} from '../../src/lib/clinicalAnamnesis.js'

const author = { name:'Dra. Vitória', registration:'12345', council:'CRM' }

test('converte a anamnese legada sem perder antecedentes', () => {
  const form = clinicalAnamnesisFromLegacy({
    chief_complaint:'Avaliação pré-operatória',
    hda:'Queixa há seis meses',
    chronic_diseases:'Hipertensão',
    previous_surgeries:'Apendicectomia',
    family_history:'Mãe diabética',
    clinical_notes:'Solicitar exames',
  }, '2026-10-17')

  expect(form).toMatchObject({
    session_date:'2026-10-17',
    chief_complaint:'Avaliação pré-operatória',
    history_present_illness:'Queixa há seis meses',
    family_history:'Mãe diabética',
    therapeutic_plan:'Solicitar exames',
  })
  expect(form.personal_history).toContain('Doenças crônicas: Hipertensão')
  expect(form.personal_history).toContain('Cirurgias anteriores: Apendicectomia')
})

test('preserva perfil legado que contém somente alertas clínicos ou TCLE', () => {
  expect(hasLegacyClinicalAnamnesis({ allergies:'Dipirona' })).toBe(true)
  expect(hasLegacyClinicalAnamnesis({ current_medications:'Losartana' })).toBe(true)
  expect(hasLegacyClinicalAnamnesis({ consent_signed:true })).toBe(true)
  expect(hasLegacyClinicalAnamnesis({ consent_date:'2026-10-17' })).toBe(true)
  expect(hasLegacyClinicalAnamnesis({ consent_signed:false })).toBe(true)
  expect(hasLegacyClinicalAnamnesis(null)).toBe(false)
})

test('exige o conteúdo clínico mínimo e a identidade profissional', () => {
  const form = emptyClinicalAnamnesis('2026-10-17')
  expect(validateClinicalAnamnesis(form, author)).toBe('Queixa principal é obrigatório.')

  Object.assign(form, {
    chief_complaint:'Avaliação',
    history_present_illness:'Sem intercorrências',
    physical_exam:'Bom estado geral',
    diagnostic_hypotheses:'Paciente saudável',
    therapeutic_plan:'Orientações gerais',
  })
  expect(validateClinicalAnamnesis(form, {})).toContain('registro profissional')
  expect(validateClinicalAnamnesis(form, author)).toBe('')
})

test('monta payload SOAP sem confiar na autoria enviada pelo navegador', () => {
  const form = {
    ...emptyClinicalAnamnesis('2026-10-17'),
    chief_complaint:'  Avaliação  ',
    history_present_illness:'História atual',
    physical_exam:'Exame normal',
    diagnostic_hypotheses:'Sem alterações',
    therapeutic_plan:'Retorno anual',
    systolic_bp:'120',
    diastolic_bp:'80',
    weight_kg:'60,5',
    height_cm:'165',
  }
  const args = buildClinicalAnamnesisRpcArgs({ patientId:'patient-1', requestId:'request-1', form, author })

  expect(args).toEqual({
    p_patient_id:'patient-1',
    p_session_date:'2026-10-17',
    p_request_id:'request-1',
    p_anamnesis:expect.objectContaining({
      chief_complaint:'Avaliação',
      systolic_bp:120,
      diastolic_bp:80,
      weight_kg:60.5,
      height_cm:165,
    }),
  })
  expect(args).not.toHaveProperty('p_author_name')
  expect(args.p_anamnesis).not.toHaveProperty('author_name')
})

test('exige identificador idempotente antes da assinatura', () => {
  const form = {
    ...emptyClinicalAnamnesis('2026-10-17'),
    chief_complaint:'Avaliação',
    history_present_illness:'História atual',
    physical_exam:'Exame normal',
    diagnostic_hypotheses:'Sem alterações',
    therapeutic_plan:'Retorno anual',
  }
  expect(() => buildClinicalAnamnesisRpcArgs({ patientId:'patient-1', requestId:'', form, author }))
    .toThrow('tentativa de assinatura')
})

test('calcula IMC somente quando peso e altura são válidos', () => {
  expect(calculateClinicalBmi(60.5, 165)).toBe(22.2)
  expect(calculateClinicalBmi('', 165)).toBeNull()
  expect(calculateClinicalBmi(60, 0)).toBeNull()
})
