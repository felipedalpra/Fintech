import { expect, test } from '@playwright/test'
import { chunkWhatsAppMessageIds, mergeWhatsAppMessageRows, reconcileWhatsAppMessageRows, reconcileWhatsAppMessageWindow, removeWhatsAppMessageRow, whatsappLoadIsCurrent, whatsappNumberScopeChanged, WHATSAPP_REALTIME_FALLBACK_POLL_MS } from '../../src/lib/whatsappInboxSync.js'

test('mescla atualizações pontuais sem descartar histórico nem joins já carregados', () => {
  const current = [
    { id:'old', created_at:'2026-10-10T10:00:00Z', body:'Preservada', patients:{ full_name:'Ana' } },
    { id:'changed', created_at:'2026-10-10T11:00:00Z', body:'Antes', status:'sent', patients:{ full_name:'Bia' } },
  ]
  const merged = mergeWhatsAppMessageRows(current, [
    { id:'changed', created_at:'2026-10-10T11:00:00Z', body:'Depois', status:'read' },
    { id:'new', created_at:'2026-10-10T12:00:00Z', body:'Nova' },
  ])

  expect(merged.map(row => row.id)).toEqual(['new', 'changed', 'old'])
  expect(merged.find(row => row.id === 'changed')).toMatchObject({ body:'Depois', status:'read', patients:{ full_name:'Bia' } })
})

test('remoção em tempo real afeta somente a linha informada', () => {
  expect(removeWhatsAppMessageRow([{ id:'one' }, { id:'two' }], 'one')).toEqual([{ id:'two' }])
})

test('revalidação completa usa intervalo lento', () => {
  expect(WHATSAPP_REALTIME_FALLBACK_POLL_MS).toBeGreaterThanOrEqual(60_000)
})

test('lotes de ids têm tamanho limitado e removem duplicatas', () => {
  const ids = [...Array.from({ length:85 }, (_, index) => `message-${index}`), 'message-0']
  const chunks = chunkWhatsAppMessageIds(ids, 80)
  expect(chunks).toHaveLength(2)
  expect(chunks[0]).toHaveLength(80)
  expect(chunks[1]).toHaveLength(5)
})

test('resposta vazia por RLS remove da memória somente os ids revalidados', () => {
  const current = [
    { id:'revoked', created_at:'2026-10-10T11:00:00Z' },
    { id:'untouched', created_at:'2026-10-10T10:00:00Z' },
  ]
  expect(reconcileWhatsAppMessageRows(current, ['revoked'], [])).toEqual([current[1]])
})

test('carga completa antiga não sobrescreve evento realtime recebido durante a consulta', () => {
  const staleWindow = [{ id:'message', created_at:'2026-10-10T10:00:00Z', status:'sent' }]
  const current = [
    { id:'new', created_at:'2026-10-10T11:00:00Z', status:'sent' },
    { id:'message', created_at:'2026-10-10T10:00:00Z', status:'read' },
  ]
  const versions = new Map([['new', 2], ['message', 3], ['revoked', 4]])
  const reconciled = reconcileWhatsAppMessageWindow(current, [...staleWindow, { id:'revoked', created_at:'2026-10-10T09:00:00Z' }], versions, 1)

  expect(reconciled.map(row => row.id)).toEqual(['new', 'message'])
  expect(reconciled.find(row => row.id === 'message')?.status).toBe('read')
})

test('saúde do número não recarrega histórico, mas reatribuição recarrega', () => {
  const previous = { id:'number', assigned_user_id:'member-a', last_webhook_event:'message.received' }
  expect(whatsappNumberScopeChanged(previous, {
    eventType:'UPDATE',
    new:{ ...previous, last_webhook_event:'message.status' },
  })).toBe(false)
  expect(whatsappNumberScopeChanged(previous, {
    eventType:'UPDATE',
    new:{ ...previous, assigned_user_id:'member-b' },
  })).toBe(true)
  expect(whatsappNumberScopeChanged(previous, { eventType:'DELETE', old:previous })).toBe(true)
})

test('resposta iniciada antes da revogação ou de carga mais nova é descartada', () => {
  const started = { ownerId:'clinic', scopeGeneration:4, requestId:10 }
  expect(whatsappLoadIsCurrent(started, { ownerId:'clinic', scopeGeneration:4, requestId:10 })).toBe(true)
  expect(whatsappLoadIsCurrent(started, { ownerId:'clinic', scopeGeneration:5, requestId:10 })).toBe(false)
  expect(whatsappLoadIsCurrent(started, { ownerId:'clinic', scopeGeneration:4, requestId:11 })).toBe(false)
  expect(whatsappLoadIsCurrent(started, { ownerId:'other-clinic', scopeGeneration:4, requestId:10 })).toBe(false)
})
