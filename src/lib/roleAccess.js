export const ROLE_ACCESS = {
  admin: [
    'dashboard', 'meu-dia', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'crm-painel', 'inbox', 'ads', 'tarefas',
    'finance', 'bank-reconciliation', 'goals', 'recurrences', 'reports', 'ledger-check', 'data-quality', 'chart-of-accounts', 'ai', 'billing', 'settings',
  ],
  gestao: [
    'dashboard', 'meu-dia', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'crm-painel', 'inbox', 'ads', 'tarefas',
    'finance', 'bank-reconciliation', 'goals', 'recurrences', 'reports', 'ledger-check', 'data-quality', 'chart-of-accounts', 'ai',
  ],
  concierge: [
    'meu-dia', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'inbox', 'tarefas',
  ],
  equipe: [
    'meu-dia', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'inbox', 'tarefas',
  ],
}

export function canRoleAccess(role, sectionId) {
  return Boolean(role && (ROLE_ACCESS[role] || []).includes(sectionId))
}
