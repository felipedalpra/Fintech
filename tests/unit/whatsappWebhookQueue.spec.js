import { expect, test } from '@playwright/test'
import {
  isReplayableWebhookEvent,
  WEBHOOK_REPLAY_MAX_AGE_MS,
  WEBHOOK_REPLAY_MAX_ATTEMPTS,
} from '../../api/_lib/whatsappWebhookQueue.js'

const NOW = Date.parse('2026-11-10T03:00:00.000Z')

function event(overrides = {}) {
  return {
    processing_status:'failed',
    attempts:1,
    error_message:'Evolution API: Application failed to respond',
    received_at:'2026-11-10T02:00:00.000Z',
    ...overrides,
  }
}

test('oferece reprocessamento somente para falha recente e ainda tentável', () => {
  expect(isReplayableWebhookEvent(event(), { now:NOW })).toBe(true)
  expect(isReplayableWebhookEvent(event({ processing_status:'received' }), { now:NOW })).toBe(true)
  expect(isReplayableWebhookEvent(event({ processing_status:'ignored' }), { now:NOW })).toBe(true)
  expect(isReplayableWebhookEvent(event({ processing_status:'processed' }), { now:NOW })).toBe(false)
})

test('histórico antigo ou com tentativas esgotadas não vira pendência eterna', () => {
  expect(isReplayableWebhookEvent(event({
    received_at:new Date(NOW - WEBHOOK_REPLAY_MAX_AGE_MS - 1).toISOString(),
  }), { now:NOW })).toBe(false)
  expect(isReplayableWebhookEvent(event({ attempts:WEBHOOK_REPLAY_MAX_ATTEMPTS }), { now:NOW })).toBe(false)
})

test('falha permanente de mídia e evento ignorado sem erro permanecem só na auditoria', () => {
  expect(isReplayableWebhookEvent(event({ error_message:'A mídia recebida excede 16 MB.' }), { now:NOW })).toBe(false)
  expect(isReplayableWebhookEvent(event({ processing_status:'ignored', error_message:null }), { now:NOW })).toBe(false)
})
