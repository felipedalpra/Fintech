const EXAM_REQUEST = 'exam_request'
const SIMPLE_PRESCRIPTION = 'simple_prescription'

export const CLINICAL_DOCUMENT_TYPES = {
  EXAM_REQUEST,
  SIMPLE_PRESCRIPTION,
}

export function clinicalDocumentTypeLabel(type) {
  return type === SIMPLE_PRESCRIPTION ? 'Receituário simples' : 'Pedido de exames'
}

function compact(values) {
  return values.map(value => String(value || '').trim()).filter(Boolean)
}

export function patientResidentialAddress(patient = {}) {
  const street = compact([patient.address_street, patient.address_number]).join(', ')
  const cityState = [patient.address_city, patient.address_state].filter(Boolean).join(' / ')
  return compact([
    street,
    patient.address_complement,
    patient.address_district,
    cityState,
    patient.address_zip ? `CEP ${patient.address_zip}` : '',
  ]).join(' · ')
}

export function clinicalDocumentDefaults({ type, issueDate, profile = {}, clinicName = '' }) {
  const safeProfile = profile || {}
  const clinic = safeProfile.clinic || {}
  const doctor = safeProfile.doctor || {}
  const address = compact([
    clinic.addressLine,
    [clinic.city, clinic.state].filter(Boolean).join(' / '),
  ]).join(' · ')
  const contact = compact([
    doctor.phone || clinic.phone,
    doctor.email || clinic.email,
  ]).join(' · ')

  return {
    document_type:type,
    issue_date:issueDate,
    issuer_contact:contact,
    issuer_address:address,
    clinic_name:String(clinic.tradeName || clinic.legalName || clinicName || '').trim(),
    clinical_indication:'',
    instructions:'',
    exams_text:'',
    simple_prescription_confirmed:false,
    items:[{ medication:'', presentation:'', quantity:'', directions:'' }],
  }
}

function examLines(value) {
  return String(value || '')
    .split('\n')
    .map(line => line.replace(/^[-•\d.)\s]+/, '').trim())
    .filter(Boolean)
}

function normalizedPrescriptionItems(items = []) {
  return items.map(item => ({
    medication:String(item?.medication || '').trim(),
    presentation:String(item?.presentation || '').trim(),
    quantity:String(item?.quantity || '').trim(),
    directions:String(item?.directions || '').trim(),
  })).filter(item => Object.values(item).some(Boolean))
}

export function validateClinicalDocument({ type, form, patient, author }) {
  if (![EXAM_REQUEST, SIMPLE_PRESCRIPTION].includes(type)) return 'Selecione um tipo de documento válido.'
  if (!form?.issue_date) return 'Informe a data de emissão.'
  if (!patient?.full_name?.trim()) return 'Paciente não identificado.'
  if (!author?.name?.trim() || !author?.registration?.trim()) {
    return 'Cadastre o nome e o registro profissional antes de emitir o documento.'
  }
  if (!String(form.issuer_contact || '').trim()) return 'Informe um telefone ou e-mail profissional.'
  if (!String(form.issuer_address || '').trim()) return 'Informe o endereço profissional.'

  if (type === EXAM_REQUEST) {
    const exams = examLines(form.exams_text)
    if (exams.length === 0) return 'Informe ao menos um exame.'
    if (exams.length > 30) return 'Inclua no máximo 30 exames por pedido.'
    if (exams.some(exam => exam.length > 200)) return 'Cada exame deve ter no máximo 200 caracteres.'
  }

  if (type === SIMPLE_PRESCRIPTION) {
    if (!patientResidentialAddress(patient)) return 'Cadastre o endereço residencial do paciente antes de emitir a receita.'
    if (!form.simple_prescription_confirmed) {
      return 'Confirme que o receituário não contém medicamento controlado nem sujeito à retenção.'
    }
    const items = normalizedPrescriptionItems(form.items)
    if (items.length === 0) return 'Inclua ao menos um medicamento.'
    if (items.length > 20) return 'Inclua no máximo 20 medicamentos por receita.'
    if (items.some(item => !item.medication || !item.directions)) {
      return 'Informe o medicamento e o modo de usar em todos os itens.'
    }
  }
  return ''
}

export function buildClinicalDocumentRpcArgs({ patientId, requestId, type, form, patient, author }) {
  if (!patientId) throw new Error('Paciente não identificado.')
  if (!requestId) throw new Error('Não foi possível identificar esta emissão.')
  const validationError = validateClinicalDocument({ type, form, patient, author })
  if (validationError) throw new Error(validationError)

  const documentData = type === EXAM_REQUEST
    ? {
        exams:examLines(form.exams_text),
        clinical_indication:String(form.clinical_indication || '').trim() || null,
        instructions:String(form.instructions || '').trim() || null,
      }
    : {
        items:normalizedPrescriptionItems(form.items),
        simple_prescription_confirmed:true,
      }

  return {
    p_patient_id:patientId,
    p_document_type:type,
    p_issue_date:form.issue_date,
    p_document_data:documentData,
    p_request_id:requestId,
    p_issuer_contact:String(form.issuer_contact).trim(),
    p_issuer_address:String(form.issuer_address).trim(),
    p_clinic_name:String(form.clinic_name || '').trim() || null,
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function displayDate(value) {
  if (!value) return ''
  return new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
}

export function professionalRegistration(record = {}) {
  const council = String(record.author_council || 'CRM').trim()
  const registration = String(record.author_registration || '').trim()
  if (!registration) return council
  return registration.toLocaleUpperCase('pt-BR').startsWith(council.toLocaleUpperCase('pt-BR'))
    ? registration
    : `${council} ${registration}`
}

function documentBody(record) {
  const data = record.document_data || {}
  if (record.document_type === SIMPLE_PRESCRIPTION) {
    const items = Array.isArray(data.items) ? data.items : []
    return `<ol class="prescription-list">${items.map(item => `
      <li>
        <div class="medication"><strong>${escapeHtml(item.medication)}</strong>${item.presentation ? ` — ${escapeHtml(item.presentation)}` : ''}${item.quantity ? `<span>${escapeHtml(item.quantity)}</span>` : ''}</div>
        <p><b>Modo de usar:</b> ${escapeHtml(item.directions)}</p>
      </li>`).join('')}</ol>`
  }

  const exams = Array.isArray(data.exams) ? data.exams : []
  return `
    ${data.clinical_indication ? `<section><h2>Indicação clínica</h2><p>${escapeHtml(data.clinical_indication)}</p></section>` : ''}
    <section><h2>Exames solicitados</h2><ul class="exam-list">${exams.map(exam => `<li>${escapeHtml(exam)}</li>`).join('')}</ul></section>
    ${data.instructions ? `<section><h2>Orientações</h2><p>${escapeHtml(data.instructions)}</p></section>` : ''}`
}

export function buildClinicalDocumentPrintHtml(record, { logoDataUrl = '' } = {}) {
  const safeLogo = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/i.test(logoDataUrl) ? logoDataUrl : ''
  const title = clinicalDocumentTypeLabel(record.document_type)
  const patientMeta = compact([
    record.patient_cpf ? `CPF ${record.patient_cpf}` : '',
    record.patient_address,
  ]).join(' · ')
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)} — ${escapeHtml(record.patient_name)}</title>
<style>
  @page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;color:#18202b;font:14px/1.5 Arial,sans-serif}.header{display:flex;align-items:center;gap:18px;padding-bottom:18px;border-bottom:2px solid #1d7a77}.logo{max-width:110px;max-height:62px;object-fit:contain}.clinic{flex:1}.clinic h1{margin:0 0 3px;font-size:19px}.clinic p,.patient p{margin:2px 0;color:#55606e}.document-title{margin:30px 0 24px;text-align:center;font-size:22px;text-transform:uppercase;letter-spacing:.06em}.patient{padding:14px 16px;border:1px solid #ccd4dd;border-radius:8px;background:#f8fafb}.patient strong{font-size:16px}section{margin-top:24px}section h2{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#38505a}section p{white-space:pre-wrap}.exam-list{margin:0;padding-left:24px}.exam-list li{margin:9px 0}.prescription-list{margin:24px 0 0;padding-left:25px}.prescription-list li{margin:0 0 25px;padding-left:8px}.medication{font-size:16px;border-bottom:1px solid #d6dce2;padding-bottom:6px}.medication span{float:right;font-size:13px;font-weight:700}.prescription-list p{margin:8px 0;white-space:pre-wrap}.signature{margin:68px auto 0;width:320px;border-top:1px solid #59636e;padding-top:8px;text-align:center}.signature strong{display:block;font-size:15px}.signature span{display:block;color:#55606e}.footer{position:fixed;left:0;right:0;bottom:0;border-top:1px solid #dfe4e8;padding-top:8px;color:#6a737d;font-size:10px;text-align:center}.notice{margin-top:26px;padding:10px 12px;border:1px solid #d8a83d;background:#fff9e9;color:#765b1d;font-size:11px}@media print{.notice{break-inside:avoid}}
</style></head><body>
  <header class="header">${safeLogo ? `<img class="logo" src="${escapeHtml(safeLogo)}" alt="">` : ''}<div class="clinic"><h1>${escapeHtml(record.clinic_name || record.author_name)}</h1><p>${escapeHtml(record.issuer_address)}</p><p>${escapeHtml(record.issuer_contact)}</p></div></header>
  <h1 class="document-title">${escapeHtml(title)}</h1>
  <div class="patient"><strong>${escapeHtml(record.patient_name)}</strong>${patientMeta ? `<p>${escapeHtml(patientMeta)}</p>` : ''}</div>
  ${documentBody(record)}
  <div class="signature"><strong>${escapeHtml(record.author_name)}</strong><span>${escapeHtml(professionalRegistration(record))}</span></div>
  <div class="notice">Documento preparado para impressão e assinatura manual. A versão eletrônica gerada por esta etapa não contém assinatura eletrônica qualificada.</div>
  <footer class="footer">Emitido em ${escapeHtml(displayDate(record.issue_date))} · Registro clínico ${escapeHtml(record.id || '')}</footer>
</body></html>`
}

export function openClinicalDocumentPrint(record, options = {}) {
  const popup = window.open('', '_blank')
  if (!popup) return false
  popup.addEventListener('load', () => {
    popup.focus()
    popup.print()
  }, { once:true })
  popup.document.open()
  popup.document.write(buildClinicalDocumentPrintHtml(record, options))
  popup.document.close()
  popup.opener = null
  return true
}
