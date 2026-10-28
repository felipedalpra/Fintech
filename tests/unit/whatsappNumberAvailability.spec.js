import { expect, test } from '@playwright/test'
import { isWhatsAppNumberAvailable, latestAvailableWhatsAppNumberId } from '../../src/lib/whatsappNumberAvailability.js'

test('somente números ativos, não arquivados e conectados ficam disponíveis', () => {
  expect(isWhatsAppNumberAvailable({ active:true, provider:'evolution', connection_state:'open' })).toBe(true)
  expect(isWhatsAppNumberAvailable({ active:true, provider:'evolution', connection_state:'close' })).toBe(false)
  expect(isWhatsAppNumberAvailable({ active:false, provider:'evolution', connection_state:'open' })).toBe(false)
  expect(isWhatsAppNumberAvailable({ active:true, archived_at:'2026-10-27T20:00:00Z', provider:'evolution', connection_state:'open' })).toBe(false)
  expect(isWhatsAppNumberAvailable({ active:true, provider:'zapi' })).toBe(true)
  expect(isWhatsAppNumberAvailable({ active:true, provider:'zapi', connection_state:'error' })).toBe(false)
})

test('escolhe o número disponível da mensagem mais recente sem cair no primeiro cadastro', () => {
  const numbers = [
    { id:'n1', active:true, provider:'evolution', connection_state:'open' },
    { id:'n2', active:true, provider:'evolution', connection_state:'open' },
    { id:'n3', active:true, provider:'evolution', connection_state:'close' },
  ]
  const messages = [
    { id:'m1', whatsapp_number_id:'n1' },
    { id:'m2', whatsapp_number_id:'n2' },
  ]
  expect(latestAvailableWhatsAppNumberId(messages, numbers)).toBe('n2')
  expect(latestAvailableWhatsAppNumberId([{ whatsapp_number_id:'n3' }], numbers)).toBe('')
})
