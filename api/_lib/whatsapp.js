// api/_lib/whatsapp.js
// Funções puras (sem I/O) da integração de WhatsApp — testáveis em unidade.
// A lógica crítica de fidedignidade vive aqui: normalização de telefone,
// parse do webhook do provider e matching estrito telefone→paciente.

// Mantém só os dígitos do telefone (ex.: "(11) 98888-7777" → "11988887777").
export function normalizePhone(raw) {
  if (raw == null) return ''
  return String(raw).replace(/\D/g, '')
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

// Casa um telefone a um paciente pela lista de pacientes da clínica.
// Estrito: só retorna um id se houver EXATAMENTE um paciente com o mesmo núcleo
// (últimos 8 dígitos). Zero ou múltiplos (ambíguo) → null — nunca atribui ao paciente errado.
export function matchPatientId(patients, phone) {
  const core = phoneCore(phone)
  if (!core || core.length < 8 || !Array.isArray(patients)) return null

  const matches = patients.filter(p => p && phoneCore(p.phone) === core)
  return matches.length === 1 ? matches[0].id : null
}
