import { expect, test } from '@playwright/test'
import { canIssueClinicalPrescription, canRoleAccess } from '../../src/lib/roleAccess.js'

test('admin e gestão acessam finanças e configurações', () => {
  expect(canRoleAccess('admin', 'finance')).toBe(true)
  expect(canRoleAccess('gestao', 'finance')).toBe(true)
  expect(canRoleAccess('admin', 'fiscal-documents')).toBe(true)
  expect(canRoleAccess('gestao', 'fiscal-documents')).toBe(true)
  expect(canRoleAccess('admin', 'settings')).toBe(true)
  expect(canRoleAccess('gestao', 'settings')).toBe(true)
})

test('concierge e equipe não acessam dados financeiros ou IA financeira', () => {
  for (const role of ['concierge', 'equipe']) {
    expect(canRoleAccess(role, 'finance')).toBe(false)
    expect(canRoleAccess(role, 'fiscal-documents')).toBe(false)
    expect(canRoleAccess(role, 'data-quality')).toBe(false)
    expect(canRoleAccess(role, 'ai')).toBe(false)
  }
})

test('financeiro operacional acessa as rotinas financeiras, mas não a camada gerencial', () => {
  for (const section of ['meu-dia', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'inbox', 'tarefas', 'esteiras']) {
    expect(canRoleAccess('financeiro', section)).toBe(true)
  }
  for (const section of ['finance', 'bank-reconciliation', 'settings']) {
    expect(canRoleAccess('financeiro', section)).toBe(true)
  }
  for (const section of ['dashboard', 'goals', 'reports', 'ledger-check', 'data-quality', 'chart-of-accounts', 'ai']) {
    expect(canRoleAccess('financeiro', section)).toBe(false)
  }
})

test('perfis operacionais preservam agenda, pacientes, WhatsApp e tarefas', () => {
  for (const role of ['concierge', 'equipe']) {
    for (const page of ['meu-dia', 'calendar', 'patients', 'inbox', 'tarefas']) {
      expect(canRoleAccess(role, page)).toBe(true)
    }
    expect(canRoleAccess(role, 'settings')).toBe(true)
  }
})

// Pedido da Dra. Vitória (2026-11-12): toda a equipe agenda cirurgia/consulta e lança o valor do
// procedimento, não só o concierge — 'equipe' ganha 'sales' (Cirurgias) e 'plans' (Procedimentos,
// com os valores de cada um), igual ao concierge. O financeiro completo continua fora dos dois.
test('equipe agenda cirurgias e consultas e vê o catálogo de procedimentos, igual ao concierge', () => {
  for (const role of ['concierge', 'equipe']) {
    expect(canRoleAccess(role, 'sales')).toBe(true)
    expect(canRoleAccess(role, 'plans')).toBe(true)
    expect(canRoleAccess(role, 'consultations')).toBe(true)
  }
})

test('acesso clínico é independente do cargo administrativo', () => {
  expect(canRoleAccess('admin', 'clinical-records')).toBe(false)
  expect(canRoleAccess('admin', 'clinical-records', { clinicalAccess:true })).toBe(true)
  expect(canRoleAccess('equipe', 'clinical-pending', { clinicalAccess:true })).toBe(true)
  expect(canRoleAccess('gestao', 'clinical-documents', { clinicalAccess:false })).toBe(false)
  expect(canRoleAccess('gestao', 'clinical-records')).toBe(false)
  expect(canRoleAccess('gestao', 'clinical-records', { clinicalAccess:true })).toBe(true)
  expect(canRoleAccess('equipe', 'clinical-records', { clinicalAccess:true })).toBe(true)
  expect(canRoleAccess('concierge', 'clinical-records')).toBe(false)
})

test('somente admin com acesso clínico pode prescrever', () => {
  expect(canIssueClinicalPrescription('admin', { clinicalAccess:true })).toBe(true)
  expect(canIssueClinicalPrescription('admin', { clinicalAccess:false })).toBe(false)
  expect(canIssueClinicalPrescription('gestao', { clinicalAccess:true })).toBe(false)
  expect(canIssueClinicalPrescription('equipe', { clinicalAccess:true })).toBe(false)
  expect(canIssueClinicalPrescription('concierge', { clinicalAccess:true })).toBe(false)
})
