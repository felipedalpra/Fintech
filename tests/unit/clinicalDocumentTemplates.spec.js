import { test, expect } from '@playwright/test'
import {
  buildClinicalDocumentTemplate,
  defaultClinicalDocumentTemplateName,
} from '../../src/lib/clinicalDocumentTemplates.js'

test('monta modelo de pedido de exames com kit e orientações', () => {
  const template = buildClinicalDocumentTemplate({
    type:'exam_request',
    name:'Pré-operatório',
    form:{ exams_text:'Hemograma\n- Coagulograma', clinical_indication:'Avaliação prévia', instructions:'Jejum' },
  })
  expect(template.name).toBe('Pré-operatório')
  expect(template.examKit).toEqual(['Hemograma', 'Coagulograma'])
  expect(template.medicationFavorites).toEqual([])
  expect(template.guidance).toBe('Jejum')
})

test('monta modelo de receita preservando os campos revisáveis', () => {
  const template = buildClinicalDocumentTemplate({
    type:'simple_prescription',
    name:'Dor pós-operatória',
    form:{ items:[{ medication:'Dipirona', presentation:'500 mg', quantity:'1 caixa', directions:'1 comprimido a cada 8 horas' }] },
  })
  expect(template.medicationFavorites).toEqual([{ medication:'Dipirona', presentation:'500 mg', quantity:'1 caixa', directions:'1 comprimido a cada 8 horas' }])
  expect(template.examKit).toEqual([])
})

test('recusa modelo sem conteúdo e oferece nome padrão por tipo', () => {
  expect(() => buildClinicalDocumentTemplate({ type:'exam_request', name:'Vazio', form:{} })).toThrow('Inclua ao menos um exame')
  expect(() => buildClinicalDocumentTemplate({ type:'simple_prescription', name:'Vazio', form:{ items:[] } })).toThrow('Inclua ao menos um medicamento')
  expect(defaultClinicalDocumentTemplateName('exam_request')).toBe('Modelo de pedido de exames')
  expect(defaultClinicalDocumentTemplateName('simple_prescription')).toBe('Modelo de receita')
})
