// api/_lib/whatsapp.js
// Funções puras (sem I/O) da integração de WhatsApp — testáveis em unidade.
// A lógica crítica de fidedignidade vive aqui: normalização de telefone,
// parse do webhook do provider e matching estrito telefone→paciente.

// Mantém só os dígitos do telefone (ex.: "(11) 98888-7777" → "11988887777").
export function normalizePhone(raw) {
  if (raw == null) return ''
  return String(raw).replace(/\D/g, '')
}

const SECRET_WEBHOOK_KEYS = new Set([
  'apikey', 'api_key', 'token', 'authorization', 'secret', 'password', 'clienttoken', 'client_token',
])

// O payload bruto ajuda na auditoria/reprocessamento, mas nunca deve transformar
// credenciais enviadas pelo provider em dado persistente.
export function redactWebhookPayload(value, depth = 0) {
  if (depth > 20 || value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => redactWebhookPayload(item, depth + 1))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SECRET_WEBHOOK_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactWebhookPayload(item, depth + 1),
  ]))
}

export function clinicWhatsAppMediaPath(raw, ownerId, bucket = 'wa-media') {
  const prefix = `storage://${bucket}/`
  const value = String(raw || '')
  if (!value.startsWith(prefix)) return null
  const path = value.slice(prefix.length)
  const ownerPrefix = `${String(ownerId || '')}/`
  if (!path.startsWith(ownerPrefix) || path.length <= ownerPrefix.length || path.includes('..')) return null
  return path
}

// O WhatsApp pode ocultar o telefone e entregar apenas um Linked ID (`@lid`).
// Ele não é um número telefônico e nunca pode participar do matching por
// últimos dígitos, mas é o identificador mais estável da conversa individual.
export function normalizeWhatsAppLid(raw) {
  const value = String(raw || '').trim()
  if (!/@lid$/i.test(value)) return ''
  const digits = value.replace(/@lid$/i, '').replace(/\D/g, '')
  return digits ? `${digits}@lid` : ''
}

export function isWhatsAppLid(raw) {
  return Boolean(normalizeWhatsAppLid(raw))
}

// Mantém o endereço de conversa exigido pela Z-API. Contatos usam apenas
// dígitos; grupos precisam conservar `-group` (ou o hífen do formato legado).
export function normalizeWhatsAppAddress(raw, groupHint = false) {
  const value = String(raw || '').trim()
  const suffixGroup = /(?:-group|@g\.us)$/i.test(value)
  const lid = normalizeWhatsAppLid(value)
  if (!groupHint && lid) return lid
  if (!groupHint && !suffixGroup) return normalizePhone(value)
  const digitParts = value.replace(/@g\.us$/i, '').replace(/-group$/i, '').match(/\d+/g) || []
  if (!digitParts.length) return ''
  if (suffixGroup || digitParts.length === 1) return `${digitParts.join('')}-group`
  return digitParts.join('-')
}

// Núcleo comparável do número: os últimos 8 dígitos (ignora país/DDI, DDD e o 9º dígito,
// que variam entre formatos). Ex.: "5511988887777" e "11988887777" → "88887777".
export function phoneCore(raw) {
  if (isWhatsAppLid(raw)) return ''
  const digits = normalizePhone(raw)
  return digits.slice(-8)
}

// Extrai mídia do payload recebido (cobre os formatos da Z-API). Retorna
// { msgType, mediaUrl, mediaMime, caption } ou null quando não há mídia.
function parseMedia(body) {
  const kinds = [
    { type: 'image',    obj: body.image,    url: o => o.imageUrl || o.url },
    { type: 'audio',    obj: body.audio,    url: o => o.audioUrl || o.url },
    { type: 'video',    obj: body.video,    url: o => o.videoUrl || o.url },
    { type: 'document', obj: body.document, url: o => o.documentUrl || o.url },
  ]
  for (const k of kinds) {
    const o = k.obj
    if (o && typeof o === 'object') {
      const mediaUrl = k.url(o)
      if (!mediaUrl) continue
      // Legenda: a própria caption; no documento, cai para o nome do arquivo.
      const caption = o.caption || (k.type === 'document' ? (o.fileName || o.title || '') : '')
      return { msgType: k.type, mediaUrl: String(mediaUrl), mediaMime: o.mimeType || o.mime || null, caption: String(caption || '') }
    }
  }
  return null
}

// Normaliza o payload de mensagem do provider (cobre Z-API), inclusive mensagens
// enviadas diretamente pelo WhatsApp conectado (`fromMe=true`).
// Retorna direção, conteúdo e metadados ou null para eventos sem mensagem.
export function parseIncomingMessage(body) {
  if (!body || typeof body !== 'object') return null

  const phoneRaw = body.phone || body.from || body?.sender?.phone || ''
  const isGroup = body.isGroup === true || /(?:-group|@g\.us)$/i.test(String(phoneRaw))
  const directLid = !isGroup
    ? (normalizeWhatsAppLid(body.chatLid) || normalizeWhatsAppLid(phoneRaw) || (body.fromMe !== true ? normalizeWhatsAppLid(body.senderLid) : ''))
    : ''
  const participantPhone = normalizePhone(body.participantPhone)
  const rawContactPhone = !isGroup && !isWhatsAppLid(phoneRaw)
    ? normalizePhone(phoneRaw)
    : (!isGroup && participantPhone && participantPhone !== normalizePhone(body.connectedPhone) ? participantPhone : '')
  const phone = isGroup ? normalizeWhatsAppAddress(phoneRaw, true) : (directLid || rawContactPhone)
  if (!phone) return null

  const textRaw = body?.text?.message || body?.message?.conversation || body?.body || ''
  const media = parseMedia(body)
  // Sem texto E sem mídia = nada a gravar (evento de status etc.).
  if (!textRaw && !media) return null

  const providerMessageId = body?.messageId || body?.id || null
  // Em callbacks `fromMe`, algumas versões da Z-API devolvem "eu" como
  // chatName. Não deixe esse rótulo substituir o nome real do contato.
  const rawChatName = body?.chatName || ''
  const chatName = body.fromMe === true && /^eu$/i.test(String(rawChatName).trim()) ? '' : rawChatName
  const senderName = body?.senderName || body?.pushname || body?.pushName || (!isGroup ? chatName : '')
  const senderPhone = isGroup
    ? normalizePhone(body?.participantPhone || (body.fromMe === true ? body?.connectedPhone : ''))
    : rawContactPhone
  // Em grupos, versões recentes do WhatsApp podem ocultar o telefone e enviar
  // apenas o Linked ID do participante. Ele não é convertido em telefone: o
  // valor é preservado como identidade privada para distinguir remetentes sem
  // inventar dados que o provider não forneceu.
  const senderLid = isGroup
    ? (normalizeWhatsAppLid(body?.participantLid) || normalizeWhatsAppLid(body?.senderLid) || null)
    : null
  const httpsPhoto = raw => {
    try { const url = new URL(String(raw || '')); return url.protocol === 'https:' ? url.toString() : null } catch { return null }
  }
  const chatPhoto = httpsPhoto(isGroup ? body?.senderPhoto : (body?.senderPhoto || body?.photo))
  const senderPhoto = httpsPhoto(isGroup ? body?.photo : (body?.photo || body?.senderPhoto))
  const direction = body.fromMe === true ? 'outbound' : 'inbound'
  const rawStatus = String(body.status || '').toUpperCase()
  const status = direction === 'inbound'
    ? 'read'
    : rawStatus === 'READ' || rawStatus === 'PLAYED'
      ? 'read'
      : rawStatus === 'RECEIVED' || rawStatus === 'DELIVERED'
        ? 'delivered'
        : 'sent'
  const rawMoment = Number(body.momment ?? body.moment)
  const momentMs = Number.isFinite(rawMoment) && rawMoment > 0 ? (rawMoment < 1e12 ? rawMoment * 1000 : rawMoment) : null
  const momentDate = momentMs ? new Date(momentMs) : null
  const createdAt = momentDate && Number.isFinite(momentDate.getTime()) ? momentDate.toISOString() : null
  // body (coluna NOT NULL) guarda o texto; para mídia, a legenda (ou nome do arquivo).
  const text = media ? media.caption : String(textRaw)

  return {
    phone,
    chatLid: directLid || null,
    contactPhone: rawContactPhone || null,
    isGroup,
    chatName: chatName ? String(chatName) : '',
    chatPhoto,
    senderName: senderName ? String(senderName) : '',
    senderPhone,
    senderLid,
    senderPhoto,
    direction,
    status,
    text,
    msgType: media ? media.msgType : 'text',
    mediaUrl: media ? media.mediaUrl : null,
    mediaMime: media ? media.mediaMime : null,
    providerMessageId: providerMessageId ? String(providerMessageId) : null,
    fromApi: body.fromApi === true,
    createdAt,
  }
}

function evolutionEvent(body) {
  return String(body?.event || body?.type || '').trim().toLowerCase().replace(/_/g, '.')
}

function evolutionTimestamp(raw) {
  let value = raw
  if (value && typeof value === 'object') value = value.low ?? value.seconds ?? value.value
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function evolutionStatus(raw, direction = 'outbound') {
  const numeric = Number(raw)
  if (Number.isFinite(numeric) && String(raw).trim() !== '') {
    if (numeric >= 4) return 'read'
    if (numeric === 3) return 'delivered'
    if (numeric === 0) return 'failed'
    return direction === 'inbound' ? 'read' : 'sent'
  }
  const value = String(raw || '').toUpperCase()
  if (['READ', 'READ_BY_ME', 'PLAYED'].includes(value)) return 'read'
  if (['DELIVERY_ACK', 'DELIVERED', 'RECEIVED'].includes(value)) return 'delivered'
  if (['ERROR', 'FAILED'].includes(value)) return 'failed'
  return direction === 'inbound' ? 'read' : 'sent'
}

function evolutionMedia(message) {
  const kinds = [
    { key: 'imageMessage', type: 'image', placeholder: '[Imagem]' },
    { key: 'audioMessage', type: 'audio', placeholder: '[Áudio]' },
    { key: 'videoMessage', type: 'video', placeholder: '[Vídeo]' },
    { key: 'documentMessage', type: 'document', placeholder: '[Documento]' },
    { key: 'documentWithCaptionMessage', type: 'document', placeholder: '[Documento]' },
  ]
  for (const kind of kinds) {
    let value = message?.[kind.key]
    if (kind.key === 'documentWithCaptionMessage') value = value?.message?.documentMessage || value?.documentMessage || value
    if (!value || typeof value !== 'object') continue
    const candidate = value.url || value.mediaUrl || value.directPath || null
    let mediaUrl = null
    try {
      const url = new URL(String(candidate || ''))
      if (url.protocol === 'https:') mediaUrl = url.toString()
    } catch { /* mídia sem URL pública: o evento bruto permite reconciliação posterior */ }
    const caption = value.caption || value.fileName || value.title || kind.placeholder
    return {
      msgType: kind.type,
      mediaUrl,
      mediaMime: value.mimetype || value.mimeType || null,
      caption: String(caption),
    }
  }
  return null
}

function unwrapEvolutionMessage(message) {
  let current = message && typeof message === 'object' ? message : {}
  for (let depth = 0; depth < 8; depth += 1) {
    const next = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.viewOnceMessageV2Extension?.message
      || current.documentWithCaptionMessage?.message
      || current.editedMessage?.message
    if (!next || typeof next !== 'object' || next === current) break
    current = next
  }
  return current
}

// Normaliza o envelope v2 da Evolution API/Baileys para o contrato canônico
// usado pelo restante do produto. Mensagens de mídia sem URL pública ainda são
// persistidas com tipo/legenda; o payload bruto fica no inbox de eventos para
// recuperação posterior, em vez de a mensagem desaparecer.
export function parseEvolutionIncomingMessage(body) {
  if (!body || typeof body !== 'object') return null
  const event = evolutionEvent(body)
  if (event && !['messages.upsert', 'send.message'].includes(event)) return null

  const data = body.data?.message && body.data?.key ? body.data : (body.data || body)
  const key = data?.key || data?.message?.key || {}
  const rawMessage = data?.message?.message && data?.message?.key ? data.message.message : (data?.message || {})
  const message = unwrapEvolutionMessage(rawMessage)
  const remoteJid = String(key.remoteJid || data.remoteJid || '')
  const remoteJidAlt = String(key.remoteJidAlt || data.remoteJidAlt || '')
  const isGroup = /@g\.us$/i.test(remoteJid) || /@g\.us$/i.test(remoteJidAlt)
  const direction = key.fromMe === true || data.fromMe === true ? 'outbound' : 'inbound'
  const directLid = isGroup ? '' : (normalizeWhatsAppLid(remoteJid) || normalizeWhatsAppLid(remoteJidAlt))
  const directPhoneJid = [remoteJid, remoteJidAlt].find(value => /@s\.whatsapp\.net$/i.test(value)) || ''
  const directPhone = isGroup ? '' : normalizePhone(directPhoneJid || (!directLid ? remoteJid : ''))
  const phone = isGroup ? normalizeWhatsAppAddress(remoteJid || remoteJidAlt, true) : (directLid || directPhone)
  if (!phone) return null

  const textRaw = message.conversation
    || message.extendedTextMessage?.text
    || message.buttonsResponseMessage?.selectedDisplayText
    || message.listResponseMessage?.title
    || message.templateButtonReplyMessage?.selectedDisplayText
    || data.body
    || ''
  const media = evolutionMedia(message)
  if (!textRaw && !media) return null

  const participant = String(key.participant || data.participant || '')
  const participantAlt = String(key.participantAlt || data.participantAlt || '')
  const participantPhoneJid = [participant, participantAlt].find(value => /@s\.whatsapp\.net$/i.test(value)) || ''
  const participantLid = [participant, participantAlt].find(value => /@lid$/i.test(value)) || ''
  // No webhook da Evolution (Baileys), pushName é sempre o nome de perfil de
  // quem MANDOU a mensagem. Em fromMe=true (enviada direto pelo celular
  // conectado), quem mandou é a própria clínica — usar isso como nome da
  // conversa rotularia o contato com o nome do dono do número. Em grupo o
  // valor continua correto (identifica o integrante da equipe que enviou).
  const chatName = direction === 'outbound' ? '' : String(data.chatName || data.pushName || data.pushname || '')
  const senderName = isGroup
    ? String(data.pushName || data.pushname || data.senderName || '')
    : (direction === 'outbound' ? '' : String(data.pushName || data.pushname || data.senderName || chatName))
  const rawStatus = data.status ?? data.update?.status ?? data.messageStatus

  return {
    phone,
    chatLid: directLid || null,
    contactPhone: directPhone || null,
    isGroup,
    chatName,
    chatPhoto: null,
    senderName,
    senderPhone: isGroup ? normalizePhone(participantPhoneJid) : directPhone,
    senderLid: isGroup ? (normalizeWhatsAppLid(participantLid) || null) : null,
    senderPhoto: null,
    direction,
    status: evolutionStatus(rawStatus, direction),
    text: media ? media.caption : String(textRaw),
    msgType: media ? media.msgType : 'text',
    mediaUrl: media?.mediaUrl || null,
    mediaMime: media?.mediaMime || null,
    providerMessageId: key.id ? String(key.id) : (data.id ? String(data.id) : null),
    providerMediaMessage: media ? data : null,
    fromApi: event === 'send.message',
    createdAt: evolutionTimestamp(data.messageTimestamp || data.message?.messageTimestamp || body.date_time),
  }
}

const MESSAGE_STATUS = {
  SENT: 'sent',
  RECEIVED: 'delivered',
  DELIVERED: 'delivered',
  READ: 'read',
  READ_BY_ME: 'read',
  PLAYED: 'read',
  FAILED: 'failed',
  ERROR: 'failed',
}

// Normaliza o webhook de status da Z-API. Exige a assinatura estrutural do
// callback (`type` ou `ids[]`) para não confundir mensagens recebidas com status.
export function parseMessageStatus(body) {
  if (!body || typeof body !== 'object') return null
  const isStatusCallback = body.type === 'MessageStatusCallback' || Array.isArray(body.ids)
  if (!isStatusCallback) return null
  const status = MESSAGE_STATUS[String(body.status || '').toUpperCase()]
  if (!status) return null
  const rawIds = Array.isArray(body.ids) ? body.ids : [body.messageId || body.id]
  const providerMessageIds = [...new Set(rawIds.filter(Boolean).map(String))]
  if (!providerMessageIds.length) return null
  return { status, providerMessageIds }
}

export function parseEvolutionMessageStatuses(body) {
  if (!body || typeof body !== 'object') return null
  const event = evolutionEvent(body)
  if (!['messages.update', 'send.message.update'].includes(event)) return null
  const rows = Array.isArray(body.data) ? body.data : [body.data || body]
  const grouped = new Map()
  for (const row of rows) {
    const id = row?.key?.id || row?.keyId || row?.id || row?.messageId
    if (!id) continue
    const status = evolutionStatus(row?.update?.status ?? row?.status ?? row?.messageStatus)
    if (!grouped.has(status)) grouped.set(status, [])
    grouped.get(status).push(String(id))
  }
  if (!grouped.size) return null
  return ['read', 'delivered', 'failed', 'sent']
    .filter(status => grouped.has(status))
    .map(status => ({ status, providerMessageIds: [...new Set(grouped.get(status))] }))
}

export function parseEvolutionMessageStatus(body) {
  return parseEvolutionMessageStatuses(body)?.[0] || null
}

export function parseProviderIncomingMessage(provider, body) {
  return provider === 'evolution' ? parseEvolutionIncomingMessage(body) : parseIncomingMessage(body)
}

export function parseProviderMessageStatus(provider, body) {
  return provider === 'evolution' ? parseEvolutionMessageStatus(body) : parseMessageStatus(body)
}

export function parseProviderMessageStatuses(provider, body) {
  if (provider === 'evolution') return parseEvolutionMessageStatuses(body) || []
  const status = parseMessageStatus(body)
  return status ? [status] : []
}

export function providerWebhookMetadata(provider, body) {
  if (provider !== 'evolution') {
    return { eventType: String(body?.type || (Array.isArray(body?.ids) ? 'message.status' : 'message.received')), instanceName: null }
  }
  return {
    eventType: evolutionEvent(body) || 'unknown',
    instanceName: String(body?.instance || body?.instanceName || body?.data?.instance || '').trim() || null,
  }
}

// Casa um telefone a um paciente pela lista de pacientes da clínica.
// Estrito: só retorna um id se houver EXATAMENTE um paciente com o mesmo núcleo
// (últimos 8 dígitos). Zero ou múltiplos (ambíguo) → null — nunca atribui ao paciente errado.
export function matchPatientId(patients, phone) {
  const core = phoneCore(phone)
  if (!core || core.length < 8 || !Array.isArray(patients)) return null

  const matches = patients.filter(p => p && phoneCore(p.phone) === core)
  return matches.length === 1 ? matches[0].id : null
}
