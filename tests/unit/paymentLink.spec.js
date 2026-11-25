import { expect, test } from '@playwright/test'
import { buildPaymentWhatsAppMessage, buildWhatsAppPaymentHref, normalizePaymentLink, normalizeWhatsAppPhone } from '../../src/lib/paymentLink.js'

test('aceita apenas links HTTPS sem credenciais', () => {
  expect(normalizePaymentLink('https://pay.example/checkout?id=123').value).toBe('https://pay.example/checkout?id=123')
  expect(normalizePaymentLink('http://pay.example/checkout').error).toMatch(/HTTPS/)
  expect(normalizePaymentLink('javascript:alert(1)').error).toMatch(/URL válida|HTTPS/)
  expect(normalizePaymentLink('https://user:pass@pay.example/checkout').error).toMatch(/seguro/)
})

test('normaliza telefone brasileiro e codifica a mensagem do WhatsApp', () => {
  const message = buildPaymentWhatsAppMessage({ patientName:'Ana', amount:'R$ 350,00', dueDate:'30/10/2026', paymentLink:'https://pay.example/checkout' })
  expect(normalizeWhatsAppPhone('(51) 99189-7471')).toBe('5551991897471')
  expect(buildWhatsAppPaymentHref('(51) 99189-7471', message)).toBe(`https://wa.me/5551991897471?text=${encodeURIComponent(message)}`)
  expect(buildWhatsAppPaymentHref('123', message)).toBe('')
})
