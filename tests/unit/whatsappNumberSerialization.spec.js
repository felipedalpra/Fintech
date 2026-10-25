// tests/unit/whatsappNumberSerialization.spec.js
import { expect, test } from '@playwright/test'
import { serializeWhatsAppNumberForClient } from '../../api/whatsapp.js'

const BASE_NUMBER = {
  id:'number-1', user_id:'owner-1', label:'Jonas Concierge', phone:'5511999990000',
  active:false, assigned_user_id:null,
  instance_url:'https://api.z-api.io/instances/secret', api_token:'segredo-zapi',
  webhook_secret:'segredo-webhook',
  provider:'evolution', provider_instance_name:'surgimetrics_x',
  connection_state:'close', connected_at:null,
  last_health_at:'2026-10-23T02:08:00.000Z', last_webhook_at:'2026-10-23T02:08:00.000Z',
  last_webhook_event:'connection.update', webhook_verified_at:'2026-10-21T21:03:53.247Z',
  archived_at:'2026-10-23T02:08:55.656Z',
}

// Achado ao vivo em produção: a tela nunca via a remoção de um número porque
// archived_at ficava de fora do JSON que ?action=list-numbers manda — a chamada
// de arquivar respondia ok:true e gravava certo no banco, mas o filtro do
// frontend (que depende de ler archived_at de volta) nunca tinha como saber.
test('serializeWhatsAppNumberForClient inclui archived_at no payload', () => {
  const serialized = serializeWhatsAppNumberForClient(BASE_NUMBER)
  expect(serialized.archived_at).toBe('2026-10-23T02:08:55.656Z')
})

test('serializeWhatsAppNumberForClient nunca expõe segredos Z-API nem o user_id interno', () => {
  const serialized = serializeWhatsAppNumberForClient(BASE_NUMBER)
  expect(serialized).not.toHaveProperty('instance_url')
  expect(serialized).not.toHaveProperty('api_token')
  expect(serialized).not.toHaveProperty('user_id')
})

test('serializeWhatsAppNumberForClient só manda webhook_secret pra número Z-API (Evolution autentica no backend)', () => {
  const evolution = serializeWhatsAppNumberForClient({ ...BASE_NUMBER, provider:'evolution' })
  expect(evolution.webhook_secret).toBeNull()
  const zapi = serializeWhatsAppNumberForClient({ ...BASE_NUMBER, provider:'zapi' })
  expect(zapi.webhook_secret).toBe('segredo-webhook')
})

test('serializeWhatsAppNumberForClient preserva todos os campos de estado/saúde usados pela tela', () => {
  const serialized = serializeWhatsAppNumberForClient(BASE_NUMBER)
  expect(serialized).toMatchObject({
    id:'number-1', label:'Jonas Concierge', phone:'5511999990000', active:false,
    assigned_user_id:null, provider:'evolution', provider_instance_name:'surgimetrics_x',
    connection_state:'close', connected_at:null,
    last_health_at:'2026-10-23T02:08:00.000Z', last_webhook_at:'2026-10-23T02:08:00.000Z',
    last_webhook_event:'connection.update', webhook_verified_at:'2026-10-21T21:03:53.247Z',
  })
})
