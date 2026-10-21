import { expect, test } from '@playwright/test'
import {
  existingSendRequestAction,
  normalizeWhatsAppRequestId,
  payloadCollisionAction,
  providerFailureIsDefinitive,
  whatsappSendRequestFingerprint,
} from '../../api/_lib/whatsappSendRequest.js'

const REQUEST_ID = '018f5e3b-7a21-7c4d-8a9b-1234567890ab'
const BASE = {
  ownerId:'clinic-1',
  whatsappNumberId:'number-1',
  patientId:'patient-1',
  phone:'5551999990000',
  isGroup:false,
  msgType:'text',
  bodyText:'Olá',
}

test('normaliza UUID e rejeita identificador de envio reaproveitável inválido', () => {
  expect(normalizeWhatsAppRequestId(REQUEST_ID.toUpperCase())).toBe(REQUEST_ID)
  expect(() => normalizeWhatsAppRequestId('mesmo-id')).toThrow(/idempotente/i)
})

test('somente rejeição HTTP inequívoca libera nova tentativa no provider', () => {
  expect(providerFailureIsDefinitive(400)).toBe(true)
  expect(providerFailureIsDefinitive(401)).toBe(true)
  expect(providerFailureIsDefinitive(422)).toBe(true)
  expect(providerFailureIsDefinitive(408)).toBe(false)
  expect(providerFailureIsDefinitive(409)).toBe(false)
  expect(providerFailureIsDefinitive(429)).toBe(false)
  expect(providerFailureIsDefinitive(500)).toBe(false)
  expect(providerFailureIsDefinitive(503)).toBe(false)
  expect(providerFailureIsDefinitive(undefined)).toBe(false)
})

test('fingerprint separa número, clínica e conteúdo da tentativa', () => {
  const original = whatsappSendRequestFingerprint(BASE)
  expect(whatsappSendRequestFingerprint({ ...BASE })).toBe(original)
  expect(whatsappSendRequestFingerprint({ ...BASE, whatsappNumberId:'number-2' })).not.toBe(original)
  expect(whatsappSendRequestFingerprint({ ...BASE, ownerId:'clinic-2' })).not.toBe(original)
  expect(whatsappSendRequestFingerprint({ ...BASE, bodyText:'Outro texto' })).not.toBe(original)
})

test('repetição nunca chama novamente o provider enquanto está pendente ou aceita', () => {
  const hash = whatsappSendRequestFingerprint(BASE)
  expect(existingSendRequestAction({ payload_hash:hash, status:'pending' }, hash)).toBe('wait')
  expect(existingSendRequestAction({ payload_hash:hash, status:'unknown' }, hash)).toBe('wait')
  expect(existingSendRequestAction({ payload_hash:hash, status:'accepted', provider_message_id:'provider-1' }, hash)).toBe('persist')
  expect(existingSendRequestAction({ payload_hash:hash, status:'persisted', whatsapp_message_id:'message-1' }, hash)).toBe('reuse')
  expect(existingSendRequestAction({ payload_hash:hash, status:'failed' }, hash)).toBe('retry')
  expect(existingSendRequestAction({ payload_hash:'outro', status:'pending' }, hash)).toBe('conflict')
})

test('duas abas com o mesmo texto esperam a reserva viva em vez de reenviar ao provider', () => {
  expect(payloadCollisionAction({ whatsapp_number_id:'number-1', status:'pending' }, 'number-1')).toBe('wait')
  expect(payloadCollisionAction({ whatsapp_number_id:'number-1', status:'accepted' }, 'number-1')).toBe('wait')
  expect(payloadCollisionAction({ whatsapp_number_id:'number-2', status:'pending' }, 'number-1')).toBe('conflict')
  expect(payloadCollisionAction(null, 'number-1')).toBe('conflict')
})
