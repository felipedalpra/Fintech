export const ROLE_ACCESS = {
  admin: [
    'dashboard', 'meu-dia', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'crm-painel', 'inbox', 'ads', 'tarefas', 'esteiras',
    'finance', 'financial-import', 'fiscal-documents', 'bank-reconciliation', 'goals', 'recurrences', 'reports', 'ledger-check', 'data-quality', 'chart-of-accounts', 'ai', 'billing', 'settings',
  ],
  gestao: [
    'dashboard', 'meu-dia', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'crm-painel', 'inbox', 'ads', 'tarefas', 'esteiras',
    'finance', 'financial-import', 'fiscal-documents', 'bank-reconciliation', 'goals', 'recurrences', 'reports', 'ledger-check', 'data-quality', 'chart-of-accounts', 'ai',
  ],
  concierge: [
    'meu-dia', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'inbox', 'tarefas', 'esteiras',
  ],
  // 'equipe' tinha ficado sem 'sales' (Cirurgias) e 'plans' (Procedimentos, com os valores de
  // cada um) — só o concierge tinha. Pedido da Dra. Vitória (2026-11-12): toda a equipe agenda
  // cirurgia e consulta e lança o valor do procedimento, então 'equipe' ganha a mesma lista do
  // concierge. O financeiro completo ('finance' etc.) continua fora dos dois.
  equipe: [
    'meu-dia', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'inbox', 'tarefas', 'esteiras',
  ],
}

export const CLINICAL_SECTIONS = new Set([
  'clinical-records',
  'clinical-patients',
  'clinical-pending',
  'clinical-protocols',
  'clinical-documents',
])

export function canRoleAccess(role, sectionId, { clinicalAccess = false } = {}) {
  if (CLINICAL_SECTIONS.has(sectionId)) {
    return clinicalAccess === true
  }
  return Boolean(role && (ROLE_ACCESS[role] || []).includes(sectionId))
}

export function canIssueClinicalPrescription(role, { clinicalAccess = false } = {}) {
  return role === 'admin' && clinicalAccess === true
}
