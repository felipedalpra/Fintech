import { expect, test } from '@playwright/test'
import { statusFromResponse, statusFromFailure } from '../../src/lib/googleCalendarStatus.js'

test('resposta normal preenche o estado', () => {
  const s = statusFromResponse({ configured: true, connected: true, canManage: true, email: 'clinica@x.com' })
  expect(s).toMatchObject({ loading: false, configured: true, connected: true, canManage: true, statusError: '' })
})

test('API antiga sem canManage continua podendo gerenciar', () => {
  // Compatibilidade durante o deploy: a versão anterior não enviava o campo.
  expect(statusFromResponse({ configured: true }).canManage).toBe(true)
  expect(statusFromResponse({ configured: true, canManage: false }).canManage).toBe(false)
})

test('FALHA não pode virar "não configurado" — tem que virar erro visível', () => {
  // Era aqui que o botão sumia sem explicação: qualquer erro deixava configured=false,
  // que a tela interpreta como "esta clínica não tem a integração".
  const s = statusFromFailure(new Error('Falha ao carregar status (500)'))
  expect(s.loading).toBe(false)
  expect(s.configured).toBe(false)
  expect(s.statusError).toContain('500')
})

test('erro sem mensagem ainda produz um texto útil', () => {
  expect(statusFromFailure(new Error('')).statusError).toBeTruthy()
  expect(statusFromFailure(null).statusError).toBeTruthy()
})

test('"não configurado" de verdade não é erro', () => {
  // Clínica sem a integração: esconder é o certo, e não há nada a avisar.
  const s = statusFromResponse({ configured: false })
  expect(s.configured).toBe(false)
  expect(s.statusError).toBe('')
})
