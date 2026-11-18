import { test, expect } from '@playwright/test'
import { buildWhatsAppNumberHealth, healthAgeLabel } from '../../src/lib/whatsappHealth.js'

test.describe('saúde dos números WhatsApp', () => {
  test('separa estado da conexão e última mensagem recebida por número', () => {
    const now = Date.parse('2026-11-18T15:00:00.000Z')
    const result = buildWhatsAppNumberHealth([
      { id:'jonas', label:'Jonas', active:true, connection_state:'open' },
      { id:'fechado', label:'Financeiro', active:true, connection_state:'close' },
      { id:'arquivado', label:'Antigo', active:true, archived_at:'2026-11-01' },
    ], [
      { whatsapp_number_id:'jonas', direction:'inbound', created_at:'2026-11-18T14:58:00.000Z' },
      { whatsapp_number_id:'jonas', direction:'outbound', created_at:'2026-11-18T14:59:00.000Z' },
      { whatsapp_number_id:'fechado', direction:'inbound', created_at:'2026-11-18T10:00:00.000Z' },
    ], now)

    expect(result).toHaveLength(2)
    expect(result[0].status).toBe('connected')
    expect(result[0].freshness).toBe('fresh')
    expect(result[0].ageMinutes).toBe(2)
    expect(result[1].status).toBe('disconnected')
    expect(result[1].freshness).toBe('offline')
  })

  test('não confunde mensagem enviada com mensagem recebida', () => {
    const result = buildWhatsAppNumberHealth(
      [{ id:'n1', active:true, connection_state:'open' }],
      [{ whatsapp_number_id:'n1', direction:'outbound', created_at:'2026-11-18T14:59:00.000Z' }],
      Date.parse('2026-11-18T15:00:00.000Z'),
    )
    expect(result[0].lastInbound).toBeNull()
    expect(result[0].freshness).toBe('unknown')
  })

  test('formata idade de forma curta', () => {
    expect(healthAgeLabel(null)).toBe('Nenhuma recebida no painel')
    expect(healthAgeLabel(0)).toBe('Agora')
    expect(healthAgeLabel(12)).toBe('Há 12 min')
    expect(healthAgeLabel(120)).toBe('Há 2 h')
  })
})
