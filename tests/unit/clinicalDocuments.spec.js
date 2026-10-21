import { expect, test } from '@playwright/test'
import {
  buildClinicalDocumentPrintHtml,
  buildClinicalDocumentRpcArgs,
  clinicalDocumentDefaults,
  CLINICAL_DOCUMENT_TYPES,
  hasCompletePatientAddress,
  patientResidentialAddress,
  professionalRegistration,
  validateClinicalDocument,
} from '../../src/lib/clinicalDocuments.js'

const { EXAM_REQUEST, SIMPLE_PRESCRIPTION } = CLINICAL_DOCUMENT_TYPES
const patient = {
  id:'patient-1',
  full_name:'Ana da Silva',
  cpf:'123.456.789-00',
  address_street:'Rua Clínica',
  address_number:'10',
  address_district:'Centro',
  address_city:'Porto Alegre',
  address_state:'RS',
  address_zip:'90000-000',
}
const author = { name:'Dra. Vitória', registration:'CRM-RS 12345', council:'CRM' }

test('monta o endereço residencial exigido no receituário', () => {
  expect(patientResidentialAddress(patient)).toBe('Rua Clínica, 10 · Centro · Porto Alegre / RS · CEP 90000-000')
  expect(hasCompletePatientAddress(patient)).toBe(true)
  expect(hasCompletePatientAddress({ ...patient, address_number:'' })).toBe(false)
})

test('normaliza pedido de exames sem confiar na autoria do navegador', () => {
  const form = {
    ...clinicalDocumentDefaults({ type:EXAM_REQUEST, issueDate:'2026-10-20' }),
    issuer_contact:'(51) 99999-0000',
    issuer_address:'Av. Profissional, 100 — Porto Alegre/RS',
    clinic_name:'Clínica Exemplo',
    exams_text:'- Hemograma completo\n2. Coagulograma\n\nEletrocardiograma',
    clinical_indication:'Avaliação pré-operatória',
  }
  const args = buildClinicalDocumentRpcArgs({ patientId:patient.id, requestId:'request-1', type:EXAM_REQUEST, form, patient, author })

  expect(args).toMatchObject({
    p_patient_id:'patient-1',
    p_document_type:'exam_request',
    p_issue_date:'2026-10-20',
    p_document_data:{ exams:['Hemograma completo', 'Coagulograma', 'Eletrocardiograma'], clinical_indication:'Avaliação pré-operatória' },
  })
  expect(args).not.toHaveProperty('p_author_name')
  expect(args).not.toHaveProperty('p_patient_name')
  expect(args).toHaveProperty('p_clinic_logo_data_url', null)
})

test('receita simples exige endereço, modo de usar e confirmação sanitária', () => {
  const form = {
    ...clinicalDocumentDefaults({ type:SIMPLE_PRESCRIPTION, issueDate:'2026-10-20' }),
    issuer_contact:'contato@clinica.com.br',
    issuer_address:'Av. Profissional, 100',
    items:[{ medication:'Dipirona', presentation:'500 mg', quantity:'1 caixa', directions:'' }],
  }

  expect(validateClinicalDocument({ type:SIMPLE_PRESCRIPTION, form, patient, author })).toContain('não contém medicamento controlado')
  form.simple_prescription_confirmed = true
  expect(validateClinicalDocument({ type:SIMPLE_PRESCRIPTION, form, patient, author })).toContain('modo de usar')
  form.items[0].directions = 'Tomar um comprimido por via oral a cada oito horas por três dias.'
  expect(validateClinicalDocument({
    type:SIMPLE_PRESCRIPTION,
    form,
    patient:{ id:patient.id, full_name:patient.full_name },
    author,
  })).toContain('endereço residencial')
  expect(validateClinicalDocument({ type:SIMPLE_PRESCRIPTION, form, patient, author })).toBe('')
})

test('gera impressão com identificação mínima e escapa conteúdo clínico', () => {
  const html = buildClinicalDocumentPrintHtml({
    id:'document-1',
    document_type:EXAM_REQUEST,
    issue_date:'2026-10-20',
    patient_name:'Ana <Paciente>',
    patient_cpf:'123.456.789-00',
    patient_address:'Rua Clínica, 10',
    author_name:'Dra. Vitória',
    author_registration:'CRM-RS 12345',
    author_council:'CRM',
    issuer_contact:'contato@clinica.com.br',
    issuer_address:'Av. Profissional, 100',
    clinic_name:'Clínica Exemplo',
    clinic_logo_data_url:'data:image/png;base64,stored-logo',
    document_data:{ exams:['Hemograma <completo>'], clinical_indication:'Pré-operatório' },
  })

  expect(html).toContain('Pedido de exames')
  expect(html).toContain('Ana &lt;Paciente&gt;')
  expect(html).toContain('Hemograma &lt;completo&gt;')
  expect(html).toContain('CRM-RS 12345')
  expect(html).toContain('assinatura manual')
  expect(html).toContain('data:image/png;base64,stored-logo')
  expect(html).not.toContain('position:fixed')
  expect(html).not.toContain('Ana <Paciente>')
})

test('não duplica o conselho quando o registro já contém CRM', () => {
  expect(professionalRegistration({ author_council:'CRM', author_registration:'CRM-SP 123' })).toBe('CRM-SP 123')
  expect(professionalRegistration({ author_council:'CRM', author_registration:'123' })).toBe('CRM 123')
})
