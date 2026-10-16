import { expect, test } from '@playwright/test'
import {
  asaasBaseUrl,
  asaasRequest,
  buildAsaasPaymentPayload,
  billingProviderCatalog,
  canonicalChargeStatus,
  getBillingProvider,
  normalizeAsaasPayment,
  normalizeAsaasWebhook,
} from '../../api/_lib/billingProvider.js'
import { decryptBillingSecret, encryptBillingSecret } from '../../api/_lib/billing.js'

test('Asaas usa hosts oficiais por ambiente e envia chave só no header', async () => {
  let captured
  const fetchImpl = async (url, init) => {
    captured = { url, init }
    return { ok:true, status:200, text:async () => JSON.stringify({ data:[] }) }
  }
  await asaasRequest({ environment:'sandbox', apiKey:'secret-key', path:'/customers?limit=1', fetchImpl })
  expect(asaasBaseUrl('production')).toBe('https://api.asaas.com/v3')
  expect(captured.url).toBe('https://api-sandbox.asaas.com/v3/customers?limit=1')
  expect(captured.init.headers.access_token).toBe('secret-key')
  expect(captured.url).not.toContain('secret-key')
})

test('payload preserva valor e vencimento determinados pelo razão', () => {
  expect(buildAsaasPaymentPayload({ customerId:'cus_1', billingType:'PIX', amount:123.456, dueDate:'2026-10-30', description:'Consulta', externalReference:'ref_1' }))
    .toEqual({ customer:'cus_1', billingType:'PIX', value:123.46, dueDate:'2026-10-30', description:'Consulta', externalReference:'ref_1' })
})

test('webhook normaliza recebimento e ignora estorno parcial', () => {
  const received = normalizeAsaasWebhook({
    id:'evt_1', event:'PAYMENT_RECEIVED',
    payment:{ id:'pay_1', status:'RECEIVED', paymentDate:'2026-10-16', value:100, netValue:97.5, billingType:'PIX' },
  })
  expect(received).toMatchObject({ eventId:'evt_1', providerChargeId:'pay_1', status:'received', grossAmount:100, netAmount:97.5, paymentMethod:'pix' })
  expect(received.paidAt).toBe('2026-10-16T12:00:00-03:00')
  expect(canonicalChargeStatus('PAYMENT_PARTIALLY_REFUNDED', 'PARTIALLY_REFUNDED')).toBeNull()
  expect(canonicalChargeStatus('PAYMENT_REFUNDED', 'REFUNDED')).toBe('refunded')
})

test('consulta do provedor usa a mesma normalização financeira do webhook', () => {
  expect(normalizeAsaasPayment({
    id:'pay_sync', status:'RECEIVED', paymentDate:'2026-10-16', value:150, netValue:148.25, billingType:'BOLETO',
  })).toMatchObject({
    eventType:'PAYMENT_STATUS_SYNCED', providerChargeId:'pay_sync', status:'received',
    grossAmount:150, netAmount:148.25, paymentMethod:'boleto',
  })
})

test('credencial do provedor fica cifrada e recupera somente com a chave do servidor', () => {
  const previous = process.env.BILLING_DATA_ENCRYPTION_KEY
  process.env.BILLING_DATA_ENCRYPTION_KEY = 'billing-test-key-with-more-than-24-characters'
  try {
    const encrypted = encryptBillingSecret('$aact_secret_123')
    expect(encrypted).not.toContain('$aact_secret_123')
    expect(decryptBillingSecret(encrypted)).toBe('$aact_secret_123')
  } finally {
    if (previous == null) delete process.env.BILLING_DATA_ENCRYPTION_KEY
    else process.env.BILLING_DATA_ENCRYPTION_KEY = previous
  }
})

test('catálogo expõe capacidades sem fingir que um banco ainda está homologado', () => {
  const catalog = billingProviderCatalog()
  expect(catalog.find(item => item.id === 'asaas')).toMatchObject({ available:true, capabilities:{ create:true, statusQuery:true, webhook:true } })
  expect(catalog.find(item => item.id === 'direct_bank')).toMatchObject({ available:false, capabilities:{ statementSync:true } })
  expect(() => getBillingProvider('direct_bank')).toThrow(/Selecione o banco/)
})
