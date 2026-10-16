import { expect, test } from '@playwright/test'
import { canRoleAccess } from '../../src/lib/roleAccess.js'

test('admin e gestão acessam finanças, mas somente admin acessa configurações', () => {
  expect(canRoleAccess('admin', 'finance')).toBe(true)
  expect(canRoleAccess('gestao', 'finance')).toBe(true)
  expect(canRoleAccess('admin', 'settings')).toBe(true)
  expect(canRoleAccess('gestao', 'settings')).toBe(false)
})

test('concierge e equipe não acessam dados financeiros ou IA financeira', () => {
  for (const role of ['concierge', 'equipe']) {
    expect(canRoleAccess(role, 'finance')).toBe(false)
    expect(canRoleAccess(role, 'data-quality')).toBe(false)
    expect(canRoleAccess(role, 'ai')).toBe(false)
  }
})

test('perfis operacionais preservam agenda, pacientes, WhatsApp e tarefas', () => {
  for (const role of ['concierge', 'equipe']) {
    for (const page of ['meu-dia', 'calendar', 'patients', 'inbox', 'tarefas']) {
      expect(canRoleAccess(role, page)).toBe(true)
    }
  }
  expect(canRoleAccess('concierge', 'sales')).toBe(true)
  expect(canRoleAccess('equipe', 'sales')).toBe(false)
})

test('acesso clínico é independente do cargo administrativo', () => {
  expect(canRoleAccess('admin', 'clinical-records')).toBe(false)
  expect(canRoleAccess('admin', 'clinical-records', { clinicalAccess:true })).toBe(true)
  expect(canRoleAccess('gestao', 'clinical-records')).toBe(false)
  expect(canRoleAccess('gestao', 'clinical-records', { clinicalAccess:true })).toBe(true)
  expect(canRoleAccess('equipe', 'clinical-records', { clinicalAccess:true })).toBe(true)
  expect(canRoleAccess('concierge', 'clinical-records')).toBe(false)
})
