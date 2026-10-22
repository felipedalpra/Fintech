import { expect, test } from '@playwright/test'
import {
  clinicalIntakeRequestStatus,
  clinicalIntakeToSoapDraft,
  normalizeClinicalIntakeDefinition,
  publicClinicalIntakeUrl,
  validateClinicalIntakeAnswers,
  validateClinicalIntakeDefinition,
} from '../../src/lib/clinicalIntake.js'

test('normaliza campos personalizados sem identificadores repetidos', () => {
  const definition = normalizeClinicalIntakeDefinition([
    { label:'Alergias?', type:'textarea', required:true, soap_field:'personal_history' },
    { label:'Alergias?', type:'select', options:'Nenhuma\nDipirona\nDipirona' },
  ])

  expect(definition.fields).toHaveLength(2)
  expect(definition.fields[0].id).not.toBe(definition.fields[1].id)
  expect(definition.fields[1].options).toEqual(['Nenhuma', 'Dipirona'])
  expect(validateClinicalIntakeDefinition(definition)).toBe('')
})

test('bloqueia resposta obrigatória e consentimento ausentes', () => {
  const definition = { fields:[{ id:'queixa', label:'Queixa', type:'textarea', required:true }] }
  const consents = [{ id:'term-1', title:'TCLE', required:true }]

  expect(validateClinicalIntakeAnswers(definition, {}, [], consents)).toBe('Preencha “Queixa”.')
  expect(validateClinicalIntakeAnswers(definition, { queixa:'Dor' }, [], consents)).toBe('É necessário aceitar “TCLE”.')
  expect(validateClinicalIntakeAnswers(definition, { queixa:'Dor' }, ['term-1'], consents)).toBe('')
})

test('leva somente campos explicitamente mapeados ao rascunho SOAP', () => {
  const submission = {
    template_snapshot:{ definition:{ fields:[
      { id:'motivo', label:'Motivo', soap_field:'chief_complaint' },
      { id:'alergias', label:'Alergias', soap_field:'personal_history' },
      { id:'medicamentos', label:'Medicamentos', soap_field:'personal_history' },
      { id:'administrativo', label:'Administrativo' },
    ] } },
    answers:{ motivo:'Avaliação', alergias:'Dipirona', medicamentos:['A', 'B'], administrativo:'não copiar' },
  }

  expect(clinicalIntakeToSoapDraft(submission)).toEqual({
    chief_complaint:'Avaliação',
    personal_history:'Alergias: Dipirona\nMedicamentos: A, B',
  })
})

test('gera URL opaca e distingue expiração do estado persistido', () => {
  expect(publicClinicalIntakeUrl('abc123', 'https://surgimetrics.com.br/')).toBe('https://surgimetrics.com.br/anamnese/abc123')
  expect(clinicalIntakeRequestStatus({ status:'pending', expires_at:'2026-10-20T00:00:00Z' }, new Date('2026-10-21T00:00:00Z')).label).toBe('Expirado')
  expect(clinicalIntakeRequestStatus({ status:'submitted' }, new Date()).label).toBe('Respondido')
})
