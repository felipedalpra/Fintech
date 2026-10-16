export function groupAddendaByRecord(rows = []) {
  return rows.reduce((grouped, row) => {
    if (!row?.record_id) return grouped
    const current = grouped[row.record_id] || []
    grouped[row.record_id] = [...current, row].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    return grouped
  }, {})
}

export function buildClinicalRecordPayload({ form, ownerId, patientId, actorId, author }) {
  const evolution = String(form?.evolution_notes || '').trim()
  if (!ownerId || !patientId || !actorId) throw new Error('Clínica, paciente ou profissional não identificado.')
  if (!form?.session_date || !evolution) throw new Error('Data e evolução são obrigatórias.')
  if (!author?.name?.trim() || !author?.registration?.trim()) {
    throw new Error('Cadastre o nome e o registro profissional antes de assinar a evolução.')
  }

  return {
    user_id:ownerId,
    patient_id:patientId,
    created_by:actorId,
    session_date:form.session_date,
    evolution_notes:evolution,
    procedures_applied:String(form.procedures_applied || '').trim() || null,
    next_appointment_date:form.next_appointment_date || null,
    professional_name:author.name.trim(),
    author_name:author.name.trim(),
    author_registration:author.registration.trim(),
    author_council:String(author.council || 'CRM').trim() || 'CRM',
    authorship_source:'authenticated_user',
  }
}

export function buildAddendumPayload({ text, ownerId, recordId, actorId, author }) {
  const addendumText = String(text || '').trim()
  if (!ownerId || !recordId || !actorId) throw new Error('Registro ou profissional não identificado.')
  if (!addendumText) throw new Error('Escreva o conteúdo do adendo.')
  if (!author?.name?.trim() || !author?.registration?.trim()) {
    throw new Error('Cadastre o nome e o registro profissional antes de assinar o adendo.')
  }

  return {
    user_id:ownerId,
    record_id:recordId,
    created_by:actorId,
    addendum_text:addendumText,
    author_name:author.name.trim(),
    author_registration:author.registration.trim(),
    author_council:String(author.council || 'CRM').trim() || 'CRM',
  }
}

export function professionalSignature(record = {}) {
  const name = record.author_name || record.professional_name || 'Profissional não identificado'
  const registration = record.author_registration
    ? `${record.author_council || 'CRM'} ${record.author_registration}`
    : 'registro não informado'
  return `${name} · ${registration}`
}
