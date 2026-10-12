import { expect, test } from '@playwright/test'
import crypto from 'crypto'
import { parseLeadgenWebhook, verifyWebhookSignature, mapLeadFields } from '../../api/_lib/meta.js'

test('parseLeadgenWebhook: extrai leadgen, ignora outros campos e sem id', () => {
  const body = {
    object: 'page',
    entry: [
      {
        id: 'PAGE1',
        changes: [
          { field: 'leadgen', value: { leadgen_id: 'L1', form_id: 'F1', ad_id: 'A1', campaign_id: 'C1', created_time: 1 } },
          { field: 'feed', value: { foo: 'bar' } },                 // ignora
          { field: 'leadgen', value: { page_id: 'PAGE1' } },         // sem leadgen_id → ignora
        ],
      },
    ],
  }
  const leads = parseLeadgenWebhook(body)
  expect(leads).toHaveLength(1)
  expect(leads[0]).toMatchObject({ leadgenId: 'L1', pageId: 'PAGE1', formId: 'F1', adId: 'A1', campaignId: 'C1' })
  expect(parseLeadgenWebhook({})).toEqual([])
})

test('mapLeadFields: mapeia aliases (EN e PT) para name/phone/email', () => {
  expect(mapLeadFields([
    { name: 'full_name', values: ['Ana Souza'] },
    { name: 'phone_number', values: ['+5511999998888'] },
    { name: 'email', values: ['ana@ex.com'] },
  ])).toEqual({ name: 'Ana Souza', phone: '+5511999998888', email: 'ana@ex.com' })

  expect(mapLeadFields([
    { name: 'nome_completo', values: ['Bia'] },
    { name: 'telefone', values: ['11988887777'] },
  ])).toEqual({ name: 'Bia', phone: '11988887777', email: '' })

  expect(mapLeadFields([])).toEqual({ name: '', phone: '', email: '' })
})

test('verifyWebhookSignature: HMAC correto passa, adulterado falha', () => {
  const secret = 'app-secret-123'
  const body = JSON.stringify({ object: 'page', entry: [] })
  const good = 'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  expect(verifyWebhookSignature(body, good, secret)).toBe(true)
  expect(verifyWebhookSignature(body, good, 'outro-secret')).toBe(false)
  expect(verifyWebhookSignature(body + 'x', good, secret)).toBe(false)
  expect(verifyWebhookSignature(body, null, secret)).toBe(false)
})
