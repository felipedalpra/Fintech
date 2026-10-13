import { expect, test } from '@playwright/test'
import { buildMediaSendRequest } from '../../api/_lib/whatsappClient.js'

test('buildMediaSendRequest: imagem → send-image com caption', () => {
  expect(buildMediaSendRequest('image', { to: '5511999', mediaUrl: 'https://s/i.jpg', caption: 'oi' }))
    .toEqual({ path: 'send-image', body: { phone: '5511999', image: 'https://s/i.jpg', caption: 'oi' } })
})

test('buildMediaSendRequest: documento → send-document/<ext> com fileName', () => {
  expect(buildMediaSendRequest('document', { to: '5511999', mediaUrl: 'https://s/exames.pdf', fileName: 'exames.pdf' }))
    .toEqual({ path: 'send-document/pdf', body: { phone: '5511999', document: 'https://s/exames.pdf', fileName: 'exames.pdf' } })
})

test('buildMediaSendRequest: áudio (voz) → send-ptt', () => {
  expect(buildMediaSendRequest('audio', { to: '5511999', mediaUrl: 'https://s/a.ogg' }))
    .toEqual({ path: 'send-ptt', body: { phone: '5511999', audio: 'https://s/a.ogg' } })
})

test('buildMediaSendRequest: tipo inválido lança erro', () => {
  expect(() => buildMediaSendRequest('sticker', { to: '1', mediaUrl: 'x' })).toThrow(/tipo de mídia/i)
})

test('buildMediaSendRequest: documento sem extensão no nome cai para "bin"', () => {
  const r = buildMediaSendRequest('document', { to: '1', mediaUrl: 'https://s/arquivo', fileName: 'arquivo' })
  expect(r.path).toBe('send-document/bin')
})
