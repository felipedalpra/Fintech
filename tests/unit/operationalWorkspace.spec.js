import { expect, test } from '@playwright/test'
import { applyConversationFilters, operationalConversationKey, unreadCountForConversation } from '../../src/lib/operationalWorkspacePure.js'

test('identidade operacional separa número, contato e grupo', () => {
  expect(operationalConversationKey({ whatsapp_number_id:'n1', phone:'55119999', chat_lid:'abc@lid' })).toBe('n1:contato:abc@lid')
  expect(operationalConversationKey({ whatsapp_number_id:'n1', phone:'120363001-group', is_group:true })).toBe('n1:grupo:120363001-group')
  expect(operationalConversationKey({ whatsapp_number_id:'n2', phone:'55119999' })).toBe('n2:contato:55119999')
})

test('não lidas respeitam leitura e marcação manual', () => {
  const messages = [
    { direction:'inbound', created_at:'2026-10-15T10:00:00Z' },
    { direction:'outbound', created_at:'2026-10-15T10:05:00Z' },
    { direction:'inbound', created_at:'2026-10-15T10:10:00Z' },
  ]
  expect(unreadCountForConversation(messages, { last_read_at:'2026-10-15T10:03:00Z' })).toBe(1)
  expect(unreadCountForConversation(messages, { marked_unread_at:'2026-10-15T09:00:00Z', last_read_at:'2026-10-15T11:00:00Z' })).toBe(2)
})

test('fila padrão exclui grupos e arquivadas sem apagar conversas', () => {
  const conversations = [
    { key:'a', kind:'contact', isGroup:false, archived:false, unreadCount:1 },
    { key:'b', kind:'lead', isGroup:false, archived:false, unreadCount:0 },
    { key:'c', kind:'contact', isGroup:true, archived:false, unreadCount:2 },
    { key:'d', kind:'patient', isGroup:false, archived:true, unreadCount:0 },
  ]
  expect(applyConversationFilters(conversations, 'service').map(item => item.key)).toEqual(['a', 'b'])
  expect(applyConversationFilters(conversations, 'groups').map(item => item.key)).toEqual(['c'])
  expect(applyConversationFilters(conversations, 'archived').map(item => item.key)).toEqual(['d'])
})
