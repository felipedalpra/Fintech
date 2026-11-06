import { expect, test } from '@playwright/test'
import { canRoleAccess, ROLE_ACCESS } from '../../src/lib/roleAccess.js'

test('toda a equipe da clínica alcança as Esteiras', () => {
  // Decisão do Felipe (05/11/2026): a esteira é do time todo, não só do administrador —
  // quem executa o acompanhamento é a secretária e o concierge.
  for (const role of ['admin', 'gestao', 'concierge', 'equipe']) {
    expect(canRoleAccess(role, 'esteiras')).toBe(true)
  }
})

test('perfil desconhecido ou ausente continua sem acesso', () => {
  for (const role of ['', null, undefined, 'visitante']) {
    expect(canRoleAccess(role, 'esteiras')).toBe(false)
  }
})

test('abrir as Esteiras não abriu o financeiro para quem não tinha', () => {
  // Regressão: mexer na lista de um perfil já vazou permissão em outro projeto.
  expect(canRoleAccess('equipe', 'finance')).toBe(false)
  expect(canRoleAccess('concierge', 'finance')).toBe(false)
  expect(canRoleAccess('equipe', 'settings')).toBe(false)
  expect(canRoleAccess('gestao', 'settings')).toBe(false)
  expect(ROLE_ACCESS.equipe).not.toContain('crm-painel')
})
