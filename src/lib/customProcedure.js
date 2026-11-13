// Spec: docs/superpowers/plans/2026-11-13-procedimento-personalizado-cirurgia.md
// Procedimento combinado/personalizado na cirurgia — compartilhado entre Sales.jsx (tela de
// Cirurgias) e Calendar.jsx (Agenda), os dois pontos onde o procedimento é escolhido. PURO.

// Valor sentinela do select de procedimento para "outro/combinado (digitar)". Nunca é salvo
// como procedureId — vira null + customProcedureName no registro final.
export const CUSTOM_PROCEDURE_VALUE = '__custom__'

// Nome exibido do procedimento: catálogo > texto livre do procedimento personalizado > fallback.
export function procedureDisplayName(item, procedures, fallback) {
  const procedure = (procedures || []).find(p => p.id === item.procedureId)
  if (procedure) return procedure.name
  if (item.customProcedureName) return item.customProcedureName
  return fallback
}

// Resolve os dois campos finais a partir do que está no formulário: ou procedureId do catálogo,
// ou customProcedureName (texto livre) — nunca os dois ao mesmo tempo.
export function resolveCustomProcedureFields(procedureId, customProcedureName) {
  const isCustom = procedureId === CUSTOM_PROCEDURE_VALUE
  return {
    procedureId: isCustom ? null : (procedureId || null),
    customProcedureName: isCustom ? String(customProcedureName || '').trim() : null,
  }
}
