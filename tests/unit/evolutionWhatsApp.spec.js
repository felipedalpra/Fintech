import { expect, test } from '@playwright/test'
import {
  buildEvolutionMediaRequest,
  configureEvolutionWebhook,
  createEvolutionInstance,
  downloadEvolutionMedia,
  evolutionInstanceMissing,
  evolutionRecipient,
  normalizeEvolutionBaseUrl,
  sendEvolutionText,
} from '../../api/_lib/evolutionClient.js'
import {
  clinicWhatsAppMediaPath,
  parseEvolutionIncomingMessage,
  parseEvolutionMessageStatus,
  parseEvolutionMessageStatuses,
  providerWebhookMetadata,
  redactWebhookPayload,
} from '../../api/_lib/whatsapp.js'

const originalFetch = globalThis.fetch
const originalBaseUrl = process.env.EVOLUTION_API_BASE_URL
const originalApiKey = process.env.EVOLUTION_API_KEY

test.beforeEach(() => {
  process.env.EVOLUTION_API_BASE_URL = 'https://evolution.surgimetrics.com.br/'
  process.env.EVOLUTION_API_KEY = 'server-secret'
})

test.afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalBaseUrl === undefined) delete process.env.EVOLUTION_API_BASE_URL
  else process.env.EVOLUTION_API_BASE_URL = originalBaseUrl
  if (originalApiKey === undefined) delete process.env.EVOLUTION_API_KEY
  else process.env.EVOLUTION_API_KEY = originalApiKey
})

test('normaliza a URL da Evolution e bloqueia HTTP externo', () => {
  expect(normalizeEvolutionBaseUrl('https://evolution.surgimetrics.com.br///')).toBe('https://evolution.surgimetrics.com.br')
  expect(() => normalizeEvolutionBaseUrl('http://evolution.example.com')).toThrow(/HTTPS/i)
  expect(normalizeEvolutionBaseUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080')
})

test('converte destinatários canônicos para o formato da Evolution', () => {
  expect(evolutionRecipient('+55 (51) 99999-0000')).toBe('5551999990000')
  expect(evolutionRecipient('120363001234-group')).toBe('120363001234@g.us')
  expect(evolutionRecipient('22093462769770@lid')).toBe('22093462769770@lid')
})

test('envia texto com apikey somente no backend e confirma key.id', async () => {
  let request
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return new Response(JSON.stringify({ key: { id: 'EV-1' } }), { status: 201 })
  }
  await expect(sendEvolutionText('surgimetrics_teste', '5551999', 'Olá')).resolves.toBe('EV-1')
  expect(request.url).toBe('https://evolution.surgimetrics.com.br/message/sendText/surgimetrics_teste')
  expect(request.options.headers.apikey).toBe('server-secret')
  expect(JSON.parse(request.options.body)).toEqual({ number: '5551999', text: 'Olá' })
})

test('cria instância Baileys sem histórico completo e com webhook autenticado', async () => {
  let payload
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body)
    return new Response(JSON.stringify({ instance: { state: 'connecting' }, qrcode: { base64: 'abc' } }), { status: 201 })
  }
  const result = await createEvolutionInstance('surgimetrics_teste', {
    webhookUrl: 'https://www.surgimetrics.com.br/api/whatsapp?action=webhook&number=N1',
    webhookSecret: 'hook-secret',
  })
  expect(result.base64).toBe('abc')
  expect(payload.integration).toBe('WHATSAPP-BAILEYS')
  expect(payload.syncFullHistory).toBe(false)
  expect(payload.webhook.headers['x-webhook-token']).toBe('hook-secret')
  expect(payload.webhook.base64).toBe(false)
  expect(payload.webhook.events).toContain('MESSAGES_UPSERT')
  expect(payload.webhook.events).toContain('MESSAGES_UPDATE')
})

test('configuração do webhook é conferida depois da escrita', async () => {
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    if (options.method === 'POST') return new Response(JSON.stringify({ ok: true }), { status: 201 })
    return new Response(JSON.stringify({
      enabled: true,
      url: 'https://www.surgimetrics.com.br/api/whatsapp?action=webhook&number=N1',
      headers: { 'X-Webhook-Token':'secret' },
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'SEND_MESSAGE', 'CONNECTION_UPDATE'],
    }), { status: 200 })
  }
  await expect(configureEvolutionWebhook(
    'surgimetrics_teste',
    'https://www.surgimetrics.com.br/api/whatsapp?action=webhook&number=N1',
    'secret',
  )).resolves.toMatchObject({ enabled: true })
  expect(requests.map(item => item.url)).toEqual([
    'https://evolution.surgimetrics.com.br/webhook/set/surgimetrics_teste',
    'https://evolution.surgimetrics.com.br/webhook/find/surgimetrics_teste',
  ])
})

test('rejeita webhook quando a Evolution não preserva o segredo', async () => {
  globalThis.fetch = async (_url, options = {}) => options.method === 'POST'
    ? new Response('{}', { status:201 })
    : new Response(JSON.stringify({ enabled:true, url:'https://www.surgimetrics.com.br/hook', events:['MESSAGES_UPSERT','MESSAGES_UPDATE','MESSAGES_DELETE','SEND_MESSAGE','CONNECTION_UPDATE'] }), { status:200 })
  await expect(configureEvolutionWebhook('surgimetrics_teste', 'https://www.surgimetrics.com.br/hook', 'secret'))
    .rejects.toThrow(/não manteve/i)
})

test('mídia usa endpoint dedicado para áudio e sendMedia para documento', () => {
  expect(buildEvolutionMediaRequest('audio', { to: '5551', mediaUrl: 'https://files/audio.ogg' }))
    .toEqual({ path: 'sendWhatsAppAudio', body: { number: '5551', audio: 'https://files/audio.ogg' } })
  expect(buildEvolutionMediaRequest('document', {
    to: '5551', mediaUrl: 'https://files/exame.pdf', fileName: 'exame.pdf', mediaMime: 'application/pdf', caption: 'Exame',
  })).toEqual({
    path: 'sendMedia',
    body: { number: '5551', mediatype: 'document', media: 'https://files/exame.pdf', caption: 'Exame', fileName: 'exame.pdf', mimetype: 'application/pdf' },
  })
})

test('baixa mídia recebida pelo endpoint de decriptação da Evolution', async () => {
  let request
  globalThis.fetch = async (url, options) => {
    request = { url:String(url), body:JSON.parse(options.body) }
    return new Response(JSON.stringify({ base64:'Zm90bw==', mimetype:'image/jpeg', fileName:'foto.jpg' }), { status:201 })
  }
  const message = {
    key:{ id:'EV-MEDIA', remoteJid:'5551999@s.whatsapp.net', fromMe:false },
    message:{ imageMessage:{ mimetype:'image/jpeg', directPath:'/encrypted' } },
  }
  await expect(downloadEvolutionMedia('surgimetrics_teste', message)).resolves.toEqual({
    base64:'Zm90bw==', mimetype:'image/jpeg', fileName:'foto.jpg',
  })
  expect(request.url).toBe('https://evolution.surgimetrics.com.br/chat/getBase64FromMediaMessage/surgimetrics_teste')
  expect(request.body).toEqual({ message, convertToMp4:false })
})

test('mensagem enviada direto pelo celular conectado não rotula a conversa com o nome do dono do número', () => {
  // No webhook da Evolution, pushName é o perfil de quem MANDOU a mensagem.
  // Em fromMe=true (enviada pelo celular, fora do app), quem mandou é a
  // própria clínica — usar isso como nome do contato troca "Gabrielle" por
  // "Felipe Dalpra" na conversa.
  const parsed = parseEvolutionIncomingMessage({
    event: 'messages.upsert',
    data: {
      key: { id: 'EV-SELF', fromMe: true, remoteJid: '5551988887777@s.whatsapp.net' },
      pushName: 'Felipe Dalpra',
      message: { conversation: 'rapudo' },
    },
  })
  expect(parsed).toMatchObject({ direction: 'outbound', chatName: '', senderName: '' })
})

test('em grupo, pushName de uma mensagem enviada pelo celular ainda identifica o integrante da equipe', () => {
  const parsed = parseEvolutionIncomingMessage({
    event: 'messages.upsert',
    data: {
      key: { id: 'EV-SELF-GROUP', fromMe: true, remoteJid: '120363019502650977@g.us' },
      pushName: 'Felipe Dalpra',
      message: { conversation: 'oi equipe' },
    },
  })
  expect(parsed).toMatchObject({ isGroup: true, direction: 'outbound', senderName: 'Felipe Dalpra' })
})

test('normaliza mensagem Evolution com LID e telefone alternativo sem inventar identidade', () => {
  const parsed = parseEvolutionIncomingMessage({
    event: 'messages.upsert',
    instance: 'surgimetrics_teste',
    data: {
      key: { id: 'EV-2', fromMe: false, remoteJid: '22093462769770@lid', remoteJidAlt: '555182452361@s.whatsapp.net' },
      pushName: 'Maria',
      messageTimestamp: 1792166400,
      message: { conversation: 'Quero agendar' },
    },
  })
  expect(parsed).toMatchObject({
    phone: '22093462769770@lid',
    chatLid: '22093462769770@lid',
    contactPhone: '555182452361',
    direction: 'inbound',
    providerMessageId: 'EV-2',
    text: 'Quero agendar',
  })
})

test('preserva evento de mídia mesmo quando a Evolution não fornece URL pública', () => {
  const parsed = parseEvolutionIncomingMessage({
    event: 'messages.upsert',
    data: {
      key: { id: 'EV-3', fromMe: false, remoteJid: '5551999@s.whatsapp.net' },
      message: { imageMessage: { mimetype: 'image/jpeg', caption: 'foto' } },
    },
  })
  expect(parsed).toMatchObject({ msgType: 'image', mediaUrl: null, mediaMime: 'image/jpeg', text: 'foto' })
})

test('normaliza confirmação numérica de entrega da Evolution', () => {
  expect(parseEvolutionMessageStatus({
    event: 'messages.update',
    data: { key: { id: 'EV-4' }, update: { status: 3 } },
  })).toEqual({ status: 'delivered', providerMessageIds: ['EV-4'] })
  expect(parseEvolutionMessageStatus({
    event: 'messages.update',
    data: { keyId:'EV-REAL', status:4 },
  })).toEqual({ status:'read', providerMessageIds:['EV-REAL'] })
  expect(providerWebhookMetadata('evolution', { event: 'MESSAGES_UPSERT', instance: 'inst-1' }))
    .toEqual({ eventType: 'messages.upsert', instanceName: 'inst-1' })
})

test('preserva todos os grupos de status em um callback Evolution misto', () => {
  expect(parseEvolutionMessageStatuses({ event:'messages.update', data:[
    { keyId:'READ-1', status:4 },
    { keyId:'DELIVERED-1', status:3 },
    { keyId:'DELIVERED-2', status:3 },
    { keyId:'FAILED-1', status:0 },
  ] })).toEqual([
    { status:'read', providerMessageIds:['READ-1'] },
    { status:'delivered', providerMessageIds:['DELIVERED-1', 'DELIVERED-2'] },
    { status:'failed', providerMessageIds:['FAILED-1'] },
  ])
})

test('desembrulha texto efêmero e mídia view-once sem perder o envelope de download', () => {
  const ephemeral = parseEvolutionIncomingMessage({ event:'messages.upsert', data:{
    key:{ id:'EV-EPH', fromMe:false, remoteJid:'5551999@s.whatsapp.net' },
    message:{ ephemeralMessage:{ message:{ conversation:'temporária' } } },
  } })
  expect(ephemeral).toMatchObject({ text:'temporária', providerMessageId:'EV-EPH' })

  const viewOnce = parseEvolutionIncomingMessage({ event:'messages.upsert', data:{
    key:{ id:'EV-VIEW', fromMe:false, remoteJid:'5551999@s.whatsapp.net' },
    message:{ viewOnceMessageV2:{ message:{ videoMessage:{ mimetype:'video/mp4', caption:'vídeo' } } } },
  } })
  expect(viewOnce).toMatchObject({ msgType:'video', text:'vídeo' })
  expect(viewOnce.providerMediaMessage.message.viewOnceMessageV2).toBeTruthy()
})

test('redige segredos do evento e valida referência privada pela clínica exata', () => {
  expect(redactWebhookPayload({ apikey:'secret', nested:{ Authorization:'Bearer x', safe:'ok' } })).toEqual({
    apikey:'[REDACTED]', nested:{ Authorization:'[REDACTED]', safe:'ok' },
  })
  expect(clinicWhatsAppMediaPath('storage://wa-media/owner-1/file.mp4', 'owner-1')).toBe('owner-1/file.mp4')
  expect(clinicWhatsAppMediaPath('storage://wa-media/owner-2/file.mp4', 'owner-1')).toBeNull()
  expect(clinicWhatsAppMediaPath('https://evil.test/storage://wa-media/owner-1/file.mp4', 'owner-1')).toBeNull()
})

test('reconhece instância ausente sem confundir outros erros', () => {
  expect(evolutionInstanceMissing({ statusCode:404, message:'not found' })).toBe(true)
  expect(evolutionInstanceMissing(new Error('Instance does not exist'))).toBe(true)
  expect(evolutionInstanceMissing(new Error('timeout'))).toBe(false)
})
