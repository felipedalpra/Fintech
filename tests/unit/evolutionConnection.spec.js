// tests/unit/evolutionConnection.spec.js
import { expect, test } from '@playwright/test'
import {
  buildConnectionHealthPatch,
  parseEvolutionConnectionState,
  shouldProcessWebhookPayload,
} from '../../api/_lib/evolutionConnection.js'

test('parseEvolutionConnectionState lê data.state, data.status ou state, nessa ordem de preferência', () => {
  expect(parseEvolutionConnectionState({ data: { state: 'open' } })).toBe('open')
  expect(parseEvolutionConnectionState({ data: { status: 'close' } })).toBe('close')
  expect(parseEvolutionConnectionState({ state: 'connecting' })).toBe('connecting')
  expect(parseEvolutionConnectionState({ data: { state: 'OPEN' } })).toBe('open')
  expect(parseEvolutionConnectionState({})).toBe('unknown')
})

test('connection.update com estado "open" em número inativo: reativa quando há vaga (menos de 3 ativos)', () => {
  const now = '2026-10-22T18:30:00.000Z'
  const patch = buildConnectionHealthPatch('open', { now, wasActive: false, canActivate: true })
  expect(patch).toEqual({ connection_state: 'open', last_health_at: now, connected_at: now, active: true })
})

test('connection.update com estado "open" em número inativo: NÃO reativa se a clínica já tem 3 números ativos', () => {
  const now = '2026-10-22T18:30:00.000Z'
  const patch = buildConnectionHealthPatch('open', { now, wasActive: false, canActivate: false })
  expect(patch).toEqual({ connection_state: 'open', last_health_at: now, connected_at: now })
  expect(patch).not.toHaveProperty('active')
})

test('connection.update com estado "connecting"/"close" nunca ativa, só atualiza o estado — mesmo número inativo', () => {
  const now = '2026-10-22T18:30:00.000Z'
  expect(buildConnectionHealthPatch('connecting', { now, wasActive: false, canActivate: true }))
    .toEqual({ connection_state: 'connecting', last_health_at: now })
  expect(buildConnectionHealthPatch('close', { now, wasActive: false, canActivate: true }))
    .toEqual({ connection_state: 'close', last_health_at: now })
})

test('connection.update com estado "open" em número JÁ ativo: não mexe em active, só confirma connected_at', () => {
  const now = '2026-10-22T18:30:00.000Z'
  const patch = buildConnectionHealthPatch('open', { now, wasActive: true, canActivate: false })
  expect(patch).toEqual({ connection_state: 'open', last_health_at: now, connected_at: now })
  expect(patch).not.toHaveProperty('active')
})

test('shouldProcessWebhookPayload: mensagens comuns continuam bloqueadas enquanto o número está inativo', () => {
  expect(shouldProcessWebhookPayload({ wasActive: false, reactivated: false })).toBe(false)
  expect(shouldProcessWebhookPayload({ wasActive: true, reactivated: false })).toBe(true)
  expect(shouldProcessWebhookPayload({ wasActive: false, reactivated: true })).toBe(true)
})
