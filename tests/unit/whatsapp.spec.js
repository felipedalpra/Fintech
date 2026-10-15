import { expect, test } from '@playwright/test'
import { normalizePhone, normalizeWhatsAppAddress, normalizeWhatsAppLid, phoneCore, parseIncomingMessage, parseMessageStatus, matchPatientId } from '../../api/_lib/whatsapp.js'

test('normalizePhone mantém só dígitos', () => {
  expect(normalizePhone('(11) 98888-7777')).toBe('11988887777')
  expect(normalizePhone('+55 11 98888 7777')).toBe('5511988887777')
  expect(normalizePhone(null)).toBe('')
  expect(normalizePhone(undefined)).toBe('')
})

test('normalizeWhatsAppAddress preserva o endereço necessário para grupos', () => {
  expect(normalizeWhatsAppAddress('120363019502650977-group')).toBe('120363019502650977-group')
  expect(normalizeWhatsAppAddress('120363019502650977@g.us')).toBe('120363019502650977-group')
  expect(normalizeWhatsAppAddress('5511999999999-1623281429', true)).toBe('5511999999999-1623281429')
  expect(normalizeWhatsAppAddress('+55 (11) 98888-7777')).toBe('5511988887777')
  expect(normalizeWhatsAppAddress('22093462769770@lid')).toBe('22093462769770@lid')
  expect(normalizeWhatsAppLid('22093462769770@LID')).toBe('22093462769770@lid')
})

test('phoneCore usa os últimos 8 dígitos (ignora DDI/DDD/9º dígito)', () => {
  expect(phoneCore('5511988887777')).toBe('88887777')
  expect(phoneCore('11988887777')).toBe('88887777')
  expect(phoneCore('(11) 98888-7777')).toBe('88887777')
  expect(phoneCore('22093462769770@lid')).toBe('')
})

test('parseIncomingMessage: imagem recebida vira msgType image com url, mime e legenda', () => {
  const r = parseIncomingMessage({ phone: '5511988887777', image: { imageUrl: 'https://z/i.jpg', caption: 'minha foto', mimeType: 'image/jpeg' } })
  expect(r).toMatchObject({ phone: '5511988887777', msgType: 'image', mediaUrl: 'https://z/i.jpg', mediaMime: 'image/jpeg', text: 'minha foto' })
})

test('parseIncomingMessage: áudio recebido vira msgType audio (sem texto)', () => {
  const r = parseIncomingMessage({ phone: '5511988887777', audio: { audioUrl: 'https://z/a.ogg', mimeType: 'audio/ogg' } })
  expect(r).toMatchObject({ msgType: 'audio', mediaUrl: 'https://z/a.ogg', mediaMime: 'audio/ogg', text: '' })
})

test('parseIncomingMessage: documento usa o nome do arquivo quando não há legenda', () => {
  const r = parseIncomingMessage({ phone: '5511988887777', document: { documentUrl: 'https://z/d.pdf', fileName: 'exames.pdf', mimeType: 'application/pdf' } })
  expect(r).toMatchObject({ msgType: 'document', mediaUrl: 'https://z/d.pdf', text: 'exames.pdf' })
})

test('parseIncomingMessage: texto continua msgType text sem mídia', () => {
  const r = parseIncomingMessage({ phone: '5511988887777', text: { message: 'oi' } })
  expect(r).toMatchObject({ msgType: 'text', text: 'oi', mediaUrl: null, mediaMime: null })
})

test('parseIncomingMessage: sem texto e sem mídia retorna null', () => {
  expect(parseIncomingMessage({ phone: '5511988887777' })).toBe(null)
})

test('parseIncomingMessage: mensagem recebida do Z-API', () => {
  const r = parseIncomingMessage({ phone: '5511988887777', text: { message: 'Olá, doutora' }, messageId: 'ABC123' })
  expect(r).toMatchObject({ phone: '5511988887777', text: 'Olá, doutora', providerMessageId: 'ABC123' })
})

test('parseIncomingMessage: extrai o nome do contato (para nomear o lead)', () => {
  expect(parseIncomingMessage({ phone: '5511988887777', senderName: 'Maria Lead', text: { message: 'oi' } }).senderName).toBe('Maria Lead')
  expect(parseIncomingMessage({ phone: '5511988887777', chatName: 'João', text: { message: 'oi' } }).senderName).toBe('João')
  expect(parseIncomingMessage({ phone: '5511988887777', text: { message: 'oi' } }).senderName).toBe('')
})

test('parseIncomingMessage: separa grupo, conversa e participante com suas fotos', () => {
  expect(parseIncomingMessage({
    isGroup: true,
    phone: '120363019502650977-group',
    chatName: 'Equipe da clínica',
    senderName: 'Maria Souza',
    participantPhone: '5511988887777',
    participantLid: '22093462769770@lid',
    senderPhoto: 'https://cdn.z-api.io/group.jpg',
    photo: 'https://cdn.z-api.io/maria.jpg',
    text: { message: 'Bom dia, pessoal' },
    messageId: 'GROUP-1',
  })).toMatchObject({
    phone: '120363019502650977-group',
    isGroup: true,
    chatName: 'Equipe da clínica',
    chatPhoto: 'https://cdn.z-api.io/group.jpg',
    senderName: 'Maria Souza',
    senderPhone: '5511988887777',
    senderLid: '22093462769770@lid',
    senderPhoto: 'https://cdn.z-api.io/maria.jpg',
    direction: 'inbound',
  })
})

test('parseIncomingMessage: preserva participantLid sem inventar telefone', () => {
  expect(parseIncomingMessage({
    isGroup: true,
    phone: '120363019502650977-group',
    participantLid: '184305754083376@lid',
    text: { message: 'Mensagem privada no grupo' },
  })).toMatchObject({
    senderName: '',
    senderPhone: '',
    senderLid: '184305754083376@lid',
  })
})

test('parseIncomingMessage: mensagem enviada no WhatsApp vira saída com data e origem', () => {
  expect(parseIncomingMessage({
    phone: '5511988887777',
    text: { message: 'Enviei pelo celular' },
    fromMe: true,
    fromApi: false,
    status: 'SENT',
    momment: 1791993600000,
    messageId: 'PHONE-1',
  })).toMatchObject({
    phone: '5511988887777',
    direction: 'outbound',
    status: 'sent',
    text: 'Enviei pelo celular',
    providerMessageId: 'PHONE-1',
    fromApi: false,
    createdAt: '2026-10-14T16:00:00.000Z',
  })
})

test('parseIncomingMessage: usa chatLid como conversa canônica sem confundir com telefone', () => {
  expect(parseIncomingMessage({
    phone: '555182452361',
    chatLid: '22093462769770@lid',
    text: { message: 'Resposta recebida' },
    fromMe: false,
  })).toMatchObject({
    phone: '22093462769770@lid',
    chatLid: '22093462769770@lid',
    contactPhone: '555182452361',
    direction: 'inbound',
  })

  expect(parseIncomingMessage({
    phone: '22093462769770@lid',
    chatLid: '22093462769770@lid',
    participantPhone: '555182452361',
    connectedPhone: '555199999999',
    text: { message: 'Enviada pelo celular' },
    fromMe: true,
  })).toMatchObject({
    phone: '22093462769770@lid',
    chatLid: '22093462769770@lid',
    contactPhone: '555182452361',
    direction: 'outbound',
  })
})

test('parseIncomingMessage: LID sem telefone não cria um telefone fictício', () => {
  expect(parseIncomingMessage({
    phone: '184305754083376@lid',
    chatLid: '184305754083376@lid',
    connectedPhone: '555199999999',
    text: { message: 'Somente identidade privada' },
    fromMe: true,
  })).toMatchObject({
    phone: '184305754083376@lid',
    chatLid: '184305754083376@lid',
    contactPhone: null,
    direction: 'outbound',
  })
})

test('parseIncomingMessage: saída entregue ou lida preserva o status mais avançado', () => {
  expect(parseIncomingMessage({ phone: '5511988887777', body: 'oi', fromMe: true, status: 'RECEIVED' }).status).toBe('delivered')
  expect(parseIncomingMessage({ phone: '5511988887777', body: 'oi', fromMe: true, status: 'READ' }).status).toBe('read')
  expect(parseIncomingMessage({ phone: '5511988887777', body: 'oi', fromMe: true, status: 'PLAYED' }).status).toBe('read')
})

test('parseIncomingMessage: ignora payload sem texto ou sem telefone', () => {
  expect(parseIncomingMessage({ phone: '5511988887777' })).toBeNull()
  expect(parseIncomingMessage({ text: { message: 'oi' } })).toBeNull()
  expect(parseIncomingMessage(null)).toBeNull()
})

test('parseIncomingMessage: aceita formatos alternativos de campo', () => {
  expect(parseIncomingMessage({ from: '5511988887777', message: { conversation: 'oi' }, id: 'X1' }))
    .toMatchObject({ phone: '5511988887777', direction: 'inbound', text: 'oi', providerMessageId: 'X1' })
  expect(parseIncomingMessage({ sender: { phone: '5511988887777' }, body: 'oi' }))
    .toMatchObject({ phone: '5511988887777', text: 'oi', providerMessageId: null })
})

test('parseMessageStatus traduz enviado, entregue e lido da Z-API', () => {
  expect(parseMessageStatus({ type: 'MessageStatusCallback', status: 'SENT', ids: ['M1'] }))
    .toEqual({ status: 'sent', providerMessageIds: ['M1'] })
  expect(parseMessageStatus({ type: 'MessageStatusCallback', status: 'RECEIVED', ids: ['M1'] }))
    .toEqual({ status: 'delivered', providerMessageIds: ['M1'] })
  expect(parseMessageStatus({ type: 'MessageStatusCallback', status: 'READ', ids: ['M1', 'M1', 'M2'] }))
    .toEqual({ status: 'read', providerMessageIds: ['M1', 'M2'] })
})

test('parseMessageStatus ignora payload comum e status desconhecido', () => {
  expect(parseMessageStatus({ phone: '5511999', status: 'READ', text: { message: 'oi' } })).toBeNull()
  expect(parseMessageStatus({ type: 'MessageStatusCallback', status: 'QUEUED', ids: ['M1'] })).toBeNull()
  expect(parseMessageStatus({ type: 'MessageStatusCallback', status: 'READ', ids: [] })).toBeNull()
})

const PATIENTS = [
  { id: 'p1', phone: '(11) 98888-7777' },
  { id: 'p2', phone: '11 97777-6666' },
]

test('matchPatientId: casa exatamente um paciente pelo núcleo do telefone', () => {
  expect(matchPatientId(PATIENTS, '5511988887777')).toBe('p1')
  expect(matchPatientId(PATIENTS, '+55 (11) 97777-6666')).toBe('p2')
})

test('matchPatientId: sem correspondência → null (não atribui)', () => {
  expect(matchPatientId(PATIENTS, '5511955554444')).toBeNull()
})

test('matchPatientId: ambíguo (dois pacientes, mesmo núcleo) → null (nunca chuta)', () => {
  const dup = [{ id: 'a', phone: '11988887777' }, { id: 'b', phone: '21988887777' }]
  expect(matchPatientId(dup, '5511988887777')).toBeNull()
})

test('matchPatientId: entrada inválida → null', () => {
  expect(matchPatientId(PATIENTS, '')).toBeNull()
  expect(matchPatientId(null, '5511988887777')).toBeNull()
})
