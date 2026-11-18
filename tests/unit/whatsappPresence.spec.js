import { expect, test } from '@playwright/test'
import { normalizeWhatsAppPresence, whatsappPresenceLabel } from '../../src/lib/whatsappPresence.js'

test('presença do WhatsApp ignora o usuário atual e remove duplicidades', () => {
  const result = normalizeWhatsAppPresence({
    vitoria: [
      { user_id:'vitoria', conversation_key:'n1:5511999', display_name:'Vitória' },
      { user_id:'vitoria', conversation_key:'n1:5511999', display_name:'Vitória' },
    ],
    augusto: [{ user_id:'augusto', conversation_key:'n1:5511999', display_name:'Augusto' }],
    self: [{ user_id:'felipe', conversation_key:'n1:5511999', display_name:'Felipe' }],
  }, 'felipe')

  expect(result).toEqual([
    { userId:'vitoria', conversationKey:'n1:5511999', name:'Vitória' },
    { userId:'augusto', conversationKey:'n1:5511999', name:'Augusto' },
  ])
})

test('presença gera aviso curto para um ou mais atendentes', () => {
  expect(whatsappPresenceLabel([{ name:'Vitória' }])).toBe('Vitória está nesta conversa')
  expect(whatsappPresenceLabel([{ name:'Vitória' }, { name:'Augusto' }])).toBe('Vitória e Augusto estão nesta conversa')
})
