import { expect, test } from '@playwright/test'
import { buildMediaSendRequest, normalizeZApiInstanceUrl, sendWhatsAppText, testWhatsAppConnection } from '../../api/_lib/whatsappClient.js'

const realFetch = globalThis.fetch
test.afterEach(() => { globalThis.fetch = realFetch })

test('normalizeZApiInstanceUrl preserva a base e remove /send-text duplicado', () => {
  const base = 'https://api.z-api.io/instances/INSTANCIA/token/TOKEN'
  expect(normalizeZApiInstanceUrl(base)).toBe(base)
  expect(normalizeZApiInstanceUrl(`${base}/send-text`)).toBe(base)
  expect(normalizeZApiInstanceUrl(`${base}/send-text/`)).toBe(base)
})

test('normalizeZApiInstanceUrl rejeita host externo e formato incompleto', () => {
  expect(() => normalizeZApiInstanceUrl('https://example.com/instances/A/token/B')).toThrow(/oficial da Z-API/i)
  expect(() => normalizeZApiInstanceUrl('https://api.z-api.io/instances/A')).toThrow(/formato/i)
})

test('sendWhatsAppText não duplica /send-text e exige confirmação do provider', async () => {
  let requestedUrl = ''
  globalThis.fetch = async (url) => {
    requestedUrl = String(url)
    return new Response(JSON.stringify({ messageId: 'MSG-1', zaapId: 'Z-1' }), { status: 200 })
  }
  const id = await sendWhatsAppText('https://api.z-api.io/instances/A/token/B/send-text', 'client-token', '5511999', 'oi')
  expect(requestedUrl).toBe('https://api.z-api.io/instances/A/token/B/send-text')
  expect(id).toBe('MSG-1')
})

test('sendWhatsAppText trata erro em resposta HTTP 200 como falha', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'your client-token is not configured' }), { status: 200 })
  await expect(sendWhatsAppText('https://api.z-api.io/instances/A/token/B', 'invalido', '5511999', 'oi'))
    .rejects.toThrow(/client-token is not configured/i)
})

test('sendWhatsAppText rejeita sucesso sem messageId', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  await expect(sendWhatsAppText('https://api.z-api.io/instances/A/token/B', 'client-token', '5511999', 'oi'))
    .rejects.toThrow(/não confirmou o envio/i)
})

test('testWhatsAppConnection exige instância conectada', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ connected: false }), { status: 200 })
  await expect(testWhatsAppConnection('https://api.z-api.io/instances/A/token/B', 'client-token'))
    .rejects.toThrow(/desconectada/i)
})

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
