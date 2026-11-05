// Como a autoria de um registro clínico é apresentada a quem lê o prontuário.
//
// Desde 04/11/2026 a equipe autorizada no prontuário registra anamnese sem ter registro em
// conselho (evolução e receita continuam exigindo). Isso cria dois tipos de autoria, e a tela
// precisa distinguir os dois SEM ambiguidade: um prontuário é documento legal, e deixar um
// registro da secretária parecendo assinatura profissional é pior do que não exibir nada.
export function clinicalSignature(record) {
  if (!record?.author_name) return ''
  const registration = String(record.author_registration || '').trim()
  if (!registration) return `${record.author_name} · registro da equipe (sem assinatura profissional)`
  return `${record.author_name} · ${record.author_council || 'CRM'} ${registration}`
}

// true  → assinado por profissional com registro.
// false → registrado por membro autorizado da equipe.
export function isProfessionalAuthorship(record) {
  if (record?.author_is_professional === false) return false
  return String(record?.author_registration || '').trim().length > 0
}
