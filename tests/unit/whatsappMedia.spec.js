import { expect, test } from '@playwright/test'
import { buildMediaSendRequest, configureZApiReceiveWebhook, enableZApiSentByMe, normalizeZApiInstanceUrl, sendWhatsAppText, testWhatsAppConnection } from '../../api/_lib/whatsappClient.js'

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

test('enableZApiSentByMe ativa o histórico de mensagens enviadas no celular', async () => {
  let request = null
  globalThis.fetch = async (url, options) => {
    request = { url:String(url), options }
    return new Response(JSON.stringify({ value:true }), { status:200 })
  }
  await expect(enableZApiSentByMe('https://api.z-api.io/instances/A/token/B', 'client-token'))
    .resolves.toEqual({ enabled:true, instanceUrl:'https://api.z-api.io/instances/A/token/B' })
  expect(request.url).toBe('https://api.z-api.io/instances/A/token/B/update-notify-sent-by-me')
  expect(request.options.method).toBe('PUT')
  expect(request.options.headers['Client-Token']).toBe('client-token')
  expect(JSON.parse(request.options.body)).toEqual({ notifySentByMe:true })
})

test('enableZApiSentByMe exige confirmação da Z-API', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ value:false }), { status:200 })
  await expect(enableZApiSentByMe('https://api.z-api.io/instances/A/token/B', 'client-token'))
    .rejects.toThrow(/não confirmou/i)
})

test('configureZApiReceiveWebhook usa o endpoint combinado e confirma o estado real', async () => {
  const requests = []
  const webhookUrl = 'https://www.surgimetrics.com.br/api/whatsapp?action=webhook&number=N1&token=S1'
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url:String(url), options })
    if (String(url).endsWith('/me')) {
      return new Response(JSON.stringify({
        connected:true,
        receiveCallbackSentByMe:true,
        receivedCallbackUrl:webhookUrl,
      }), { status:200 })
    }
    return new Response(JSON.stringify({ value:true }), { status:200 })
  }

  await expect(configureZApiReceiveWebhook('https://api.z-api.io/instances/A/token/B', 'client-token', webhookUrl))
    .resolves.toEqual({ enabled:true, instanceUrl:'https://api.z-api.io/instances/A/token/B', webhookUrl })
  expect(requests[0].url).toBe('https://api.z-api.io/instances/A/token/B/update-webhook-received-delivery')
  expect(requests[0].options.method).toBe('PUT')
  expect(JSON.parse(requests[0].options.body)).toEqual({ value:webhookUrl })
  expect(requests[1].url).toBe('https://api.z-api.io/instances/A/token/B/me')
})

test('configureZApiReceiveWebhook rejeita confirmação divergente da Z-API', async () => {
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    return call === 1
      ? new Response(JSON.stringify({ value:true }), { status:200 })
      : new Response(JSON.stringify({ receiveCallbackSentByMe:false, receivedCallbackUrl:'https://example.com' }), { status:200 })
  }
  await expect(configureZApiReceiveWebhook(
    'https://api.z-api.io/instances/A/token/B',
    'client-token',
    'https://www.surgimetrics.com.br/api/whatsapp?action=webhook&number=N1&token=S1',
  )).rejects.toThrow(/não manteve ativa/i)
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
