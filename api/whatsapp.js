// api/whatsapp.js — endpoint consolidado de WhatsApp (1 função serverless, limite Hobby da Vercel).
// Multi-número: cada número (whatsapp_numbers) tem suas credenciais Z-API, lidas no servidor.
// Roteado por ?action=message (enviar, autenticado) | ?action=webhook (receber do provider).
//   webhook por número: /api/whatsapp?action=webhook&number=<id>&token=<webhook_secret>
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  configureProviderWebhook,
  connectEvolutionInstance,
  createEvolutionInstance,
  downloadProviderMedia,
  listProviderChats,
  providerReady,
  resolveProviderPhoneLids,
  sendProviderMedia,
  sendProviderText,
  testProviderConnection,
  whatsappProvider,
} from './_lib/whatsappProvider.js'
import { evolutionConfig } from './_lib/evolutionClient.js'
import {
  matchPatientId,
  normalizePhone,
  normalizeWhatsAppAddress,
  normalizeWhatsAppLid,
  parseProviderIncomingMessage,
  parseProviderMessageStatus,
  providerWebhookMetadata,
} from './_lib/whatsapp.js'
import { shouldRunAI, buildSuggestionInput, parseSuggestionResult } from './_lib/stageSuggest.js'
import { classifyStageWithAI } from './_lib/stageSuggestClient.js'
import { runWhatsAppAutomations } from './_lib/whatsappAutomations.js'
import { parseLeadgenWebhook, verifyWebhookSignature, mapLeadFields, fetchLeadData } from './_lib/meta.js'
import { syncMetaInsights } from './_lib/metaInsights.js'

export const config = {
  api: {
    // A assinatura da Meta é calculada sobre os bytes exatos recebidos.
    // Como este endpoint também atende WhatsApp, o corpo é lido e convertido abaixo para todos os POSTs.
    bodyParser: false,
  },
}

const MAX_BODY_BYTES = 1_000_000
const MAX_WHATSAPP_MEDIA_BYTES = 16 * 1024 * 1024
const DEFAULT_WHATSAPP_WEBHOOK_BASE = 'https://www.surgimetrics.com.br/api/whatsapp?action=webhook'
const NUMBER_PROVIDER_FIELDS = 'id, user_id, label, phone, active, assigned_user_id, instance_url, api_token, webhook_secret, provider, provider_instance_name, connection_state, connected_at, last_health_at, last_webhook_at, last_webhook_event, webhook_verified_at'
const MESSAGE_IDENTITY_FIELDS = ['is_group', 'chat_name', 'chat_photo', 'sender_name', 'sender_phone', 'sender_lid', 'sender_photo', 'chat_lid', 'contact_phone']
const PREVIOUS_MESSAGE_IDENTITY_FIELDS = MESSAGE_IDENTITY_FIELDS.filter(field => field !== 'sender_lid')

function withoutContactId(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'contact_id'))
}

function withoutMessageIdentity(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !MESSAGE_IDENTITY_FIELDS.includes(key)))
}

function withoutSenderLid(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'sender_lid'))
}

function withoutProvider(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'provider'))
}

function missingMessageIdentitySchema(error) {
  return ['PGRST204', '42703'].includes(error?.code) && MESSAGE_IDENTITY_FIELDS.some(field => String(error.message || '').includes(field))
}

function missingMessageFields(error, fields) {
  return ['PGRST204', '42703'].includes(error?.code) && fields.some(field => String(error.message || '').includes(field))
}

function whatsappWebhookBase() {
  return String(process.env.WHATSAPP_WEBHOOK_BASE_URL || DEFAULT_WHATSAPP_WEBHOOK_BASE).trim()
}

function webhookUrlFor(number) {
  const url = new URL(whatsappWebhookBase())
  url.searchParams.set('action', 'webhook')
  url.searchParams.set('number', number.id)
  // Z-API não suporta header customizado; Evolution recebe o segredo no header.
  if (whatsappProvider(number) === 'zapi' && number.webhook_secret) url.searchParams.set('token', number.webhook_secret)
  return url.toString()
}

function providerColumnsMissing(error) {
  return ['PGRST204', '42703'].includes(error?.code)
    && ['provider', 'provider_instance_name', 'connection_state'].some(field => String(error.message || '').includes(field))
}

function withLegacyProvider(number) {
  return number ? { provider: 'zapi', provider_instance_name: null, connection_state: 'unknown', ...number } : number
}

async function getWhatsAppNumber(supabase, id) {
  let result = await supabase.from('whatsapp_numbers').select(NUMBER_PROVIDER_FIELDS).eq('id', id).maybeSingle()
  if (providerColumnsMissing(result.error)) {
    result = await supabase.from('whatsapp_numbers')
      .select('id, user_id, label, phone, active, assigned_user_id, instance_url, api_token, webhook_secret')
      .eq('id', id)
      .maybeSingle()
  }
  return { ...result, data: withLegacyProvider(result.data) }
}

async function listWhatsAppNumbers(supabase, ownerId, { activeOnly = false } = {}) {
  let query = supabase.from('whatsapp_numbers').select(NUMBER_PROVIDER_FIELDS).eq('user_id', ownerId)
  if (activeOnly) query = query.eq('active', true)
  let result = await query
  if (providerColumnsMissing(result.error)) {
    query = supabase.from('whatsapp_numbers')
      .select('id, user_id, label, phone, active, assigned_user_id, instance_url, api_token, webhook_secret')
      .eq('user_id', ownerId)
    if (activeOnly) query = query.eq('active', true)
    result = await query
  }
  return { ...result, data: (result.data || []).map(withLegacyProvider) }
}

async function resolveClinicAdmin(supabase, user, ownerId) {
  if (user.id === ownerId) return true
  const { data: clinic } = await supabase.from('clinics').select('id').eq('owner_id', ownerId).maybeSingle()
  if (!clinic) return false
  const { data: adminMember } = await supabase.from('clinic_members')
    .select('id').eq('user_id', user.id).eq('clinic_id', clinic.id).eq('role', 'admin').maybeSingle()
  return Boolean(adminMember)
}

function evolutionInstanceName(ownerId) {
  const ownerPrefix = String(ownerId || '').replace(/-/g, '').slice(0, 10)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  return `surgimetrics_${ownerPrefix}_${suffix}`
}

function secureWebhookSecret() {
  return randomBytes(32).toString('hex')
}

// Compatibilidade de deploy: se o código chegar antes da migração aditiva, a
// mensagem ainda é persistida no formato antigo em vez de ser perdida.
async function insertWhatsAppMessage(supabase, row, { selectId = false } = {}) {
  const run = payload => {
    let query = supabase.from('whatsapp_messages').insert(payload)
    if (selectId) query = query.select('id').single()
    return query
  }
  let payload = row
  let result = await run(payload)
  if (missingMessageFields(result.error, ['provider'])) {
    payload = withoutProvider(payload)
    result = await run(payload)
  }
  // Deploy tolerante à ordem: se só a coluna nova ainda não existe, preserva
  // todos os demais metadados de conversa/remetente já suportados pelo banco.
  if (missingMessageFields(result.error, ['contact_id'])) {
    payload = withoutContactId(payload)
    result = await run(payload)
  }
  if (missingMessageFields(result.error, ['sender_lid'])) {
    payload = withoutSenderLid(payload)
    result = await run(payload)
  }
  if (missingMessageFields(result.error, PREVIOUS_MESSAGE_IDENTITY_FIELDS)) {
    payload = withoutMessageIdentity(payload)
    result = await run(payload)
  }
  return result
}

function webhookDedupKey(provider, eventType, rawBody, body) {
  const source = rawBody?.length ? rawBody : Buffer.from(JSON.stringify(body || {}))
  return createHash('sha256').update(provider).update('\n').update(eventType).update('\n').update(source).digest('hex')
}

function webhookEventTableMissing(error) {
  return ['42P01', 'PGRST204', 'PGRST205'].includes(error?.code)
    && String(error?.message || '').includes('whatsapp_webhook_events')
}

async function beginWebhookEvent(supabase, number, metadata, req) {
  const provider = whatsappProvider(number)
  const dedupKey = webhookDedupKey(provider, metadata.eventType, req.rawBody, req.body)
  const result = await supabase.from('whatsapp_webhook_events').insert({
    user_id: number.user_id,
    whatsapp_number_id: number.id,
    provider,
    provider_instance: metadata.instanceName,
    event_type: metadata.eventType,
    dedup_key: dedupKey,
    payload: req.body || {},
  }).select('id').single()
  if (result.error?.code === '23505') {
    const existingResult = await supabase.from('whatsapp_webhook_events')
      .select('id, processing_status, attempts, received_at')
      .eq('whatsapp_number_id', number.id)
      .eq('dedup_key', dedupKey)
      .maybeSingle()
    if (existingResult.error) throw existingResult.error
    const existing = existingResult.data
    if (!existing) return { duplicate: true, id: null }

    // Falhas explícitas sempre podem ser reprocessadas. Um evento que ficou em
    // `received` por mais de um minuto é retomado depois de provável interrupção
    // da função; entregas concorrentes recentes continuam idempotentes.
    const staleReceived = existing.processing_status === 'received'
      && Date.now() - Date.parse(existing.received_at) > 60_000
    if (existing.processing_status === 'failed' || staleReceived) {
      const retryResult = await supabase.from('whatsapp_webhook_events').update({
        processing_status: 'received',
        attempts: Number(existing.attempts || 1) + 1,
        error_message: null,
        processed_at: null,
      })
        .eq('id', existing.id)
        .in('processing_status', existing.processing_status === 'failed' ? ['failed'] : ['received'])
        .select('id')
        .maybeSingle()
      if (retryResult.error) throw retryResult.error
      if (retryResult.data?.id) return { duplicate: false, id: retryResult.data.id, retry: true }
    }
    return { duplicate: true, id: null }
  }
  if (webhookEventTableMissing(result.error)) return { duplicate: false, id: null }
  if (result.error) throw result.error
  return { duplicate: false, id: result.data?.id || null }
}

async function finishWebhookEvent(supabase, id, status, errorMessage = null) {
  if (!id) return
  await supabase.from('whatsapp_webhook_events').update({
    processing_status: status,
    processed_at: status === 'processed' || status === 'ignored' ? new Date().toISOString() : null,
    error_message: errorMessage ? String(errorMessage).slice(0, 1000) : null,
  }).eq('id', id)
}

function inboundMediaExtension(mimetype, fileName) {
  const supplied = String(fileName || '').split('.').pop()?.toLowerCase()
  if (/^[a-z0-9]{1,8}$/.test(supplied || '')) return supplied
  const byMime = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm',
    'video/mp4': 'mp4', 'application/pdf': 'pdf',
  }
  return byMime[String(mimetype || '').split(';')[0].toLowerCase()] || 'bin'
}

async function persistEvolutionInboundMedia(supabase, number, parsed) {
  if (whatsappProvider(number) !== 'evolution' || !parsed.providerMediaMessage) return null
  const media = await downloadProviderMedia(number, parsed.providerMediaMessage)
  const encoded = String(media.base64).replace(/^data:[^;]+;base64,/, '')
  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length) throw new Error('A mídia recebida está vazia.')
  if (bytes.length > MAX_WHATSAPP_MEDIA_BYTES) throw new Error('A mídia recebida excede 16 MB.')
  const mimetype = String(media.mimetype || parsed.mediaMime || 'application/octet-stream').split(';')[0]
  const stableId = String(parsed.providerMessageId || webhookDedupKey('evolution', 'media', null, parsed.providerMediaMessage))
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 120)
  const extension = inboundMediaExtension(mimetype, media.fileName)
  const path = `${number.user_id}/incoming/${number.id}/${stableId || randomUUID()}.${extension}`
  const upload = await supabase.storage.from('wa-media').upload(path, bytes, {
    contentType: mimetype,
    upsert: true,
  })
  if (upload.error) throw new Error(`Não foi possível preservar a mídia recebida: ${upload.error.message}`)
  const { data } = supabase.storage.from('wa-media').getPublicUrl(path)
  if (!data?.publicUrl) throw new Error('O Storage não confirmou a URL da mídia recebida.')
  return { mediaUrl: data.publicUrl, mediaMime: mimetype }
}

async function ensureWhatsAppContact(supabase, {
  ownerId, whatsappNumberId, identityKey, phone = null, chatLid = null,
  name = null, photo = null, patientId = null,
}) {
  if (!ownerId || !whatsappNumberId || !identityKey) return null
  const { data, error } = await supabase.rpc('ensure_crm_whatsapp_contact', {
    p_owner: ownerId,
    p_whatsapp_number: whatsappNumberId,
    p_identity_key: identityKey,
    p_phone: phone,
    p_chat_lid: chatLid,
    p_name: name,
    p_photo: photo,
    p_patient: patientId,
  })
  // Durante a janela entre deploy e migração, a mensagem continua sendo salva
  // pelo fallback de schema. O contato será materializado pelo backfill depois.
  if (error && !['PGRST202', '42883'].includes(error.code)) {
    console.error('whatsapp contact upsert error:', error.message)
  }
  return error ? null : data
}

async function hydrateRequestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return

  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large')
      error.statusCode = 413
      throw error
    }
    chunks.push(buffer)
  }

  const rawBody = Buffer.concat(chunks)
  req.rawBody = rawBody
  if (!rawBody.length) {
    req.body = {}
    return
  }

  try {
    req.body = JSON.parse(rawBody.toString('utf8'))
  } catch {
    const error = new Error('Invalid JSON body')
    error.statusCode = 400
    throw error
  }
}

function adminSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  return createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// Resolve o user_id do DONO dos dados (clínica) a partir do usuário autenticado.
async function resolveOwnerId(supabase, userId) {
  const { data: owned } = await supabase.from('clinics').select('owner_id').eq('owner_id', userId).maybeSingle()
  if (owned) return userId
  const { data: mem } = await supabase.from('clinic_members').select('clinic_id').eq('user_id', userId).maybeSingle()
  if (mem?.clinic_id) {
    const { data: c } = await supabase.from('clinics').select('owner_id').eq('id', mem.clinic_id).maybeSingle()
    if (c?.owner_id) return c.owner_id
  }
  return userId
}

async function authenticatedAdmin(req) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return { error: { status: 401, message: 'Missing auth' } }
  const supabase = adminSupabase()
  const { data: { user } = {}, error: authError } = await supabase.auth.getUser(authHeader.slice(7))
  if (authError || !user) return { error: { status: 401, message: 'Unauthorized' } }
  const ownerId = await resolveOwnerId(supabase, user.id)
  if (!await resolveClinicAdmin(supabase, user, ownerId)) {
    return { error: { status: 403, message: 'Somente administradores podem gerenciar a conexão.' } }
  }
  return { supabase, user, ownerId }
}

export default async function handler(req, res) {
  try {
    await hydrateRequestBody(req)
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message })
  }

  const action = req.query.action
  if (action === 'webhook') return handleWebhook(req, res)
  if (action === 'message') return handleSend(req, res)
  if (action === 'test-connection') return handleTestConnection(req, res)
  if (action === 'provision-number') return handleProvisionNumber(req, res)
  if (action === 'connect-instance') return handleConnectInstance(req, res)
  if (action === 'sync-chat-identities') return handleSyncChatIdentities(req, res)
  if (action === 'dispatch') return handleDispatch(req, res)
  if (action === 'meta-webhook') return handleMetaWebhook(req, res)
  if (action === 'meta-sync') return handleMetaSync(req, res)
  return res.status(400).json({ error: 'Ação inválida.' })
}

// ---- Provisionar número na Evolution sem expor a chave global ao navegador ----
async function handleProvisionNumber(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await authenticatedAdmin(req)
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message })

  const { supabase, ownerId } = auth
  const label = String(req.body?.label || '').trim()
  const phone = normalizePhone(req.body?.phone) || null
  if (label.length < 2 || label.length > 80) return res.status(400).json({ error: 'Informe um nome de 2 a 80 caracteres.' })

  try { evolutionConfig() } catch (error) {
    return res.status(503).json({ error: `Evolution ainda não configurada no servidor: ${error.message}` })
  }

  const { count, error: countError } = await supabase.from('whatsapp_numbers')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', ownerId)
  if (countError) return res.status(500).json({ error: 'Não foi possível conferir os números cadastrados.' })
  if ((count || 0) >= 3) return res.status(409).json({ error: 'A clínica já possui o limite de 3 números.' })

  const instanceName = evolutionInstanceName(ownerId)
  const webhookSecret = secureWebhookSecret()
  const { data: number, error: insertError } = await supabase.from('whatsapp_numbers').insert({
    user_id: ownerId,
    label,
    phone,
    active: true,
    provider: 'evolution',
    provider_instance_name: instanceName,
    webhook_secret: webhookSecret,
    connection_state: 'connecting',
  }).select('id, label, phone, active, assigned_user_id, provider, provider_instance_name, connection_state').single()
  if (insertError) {
    if (providerColumnsMissing(insertError)) return res.status(409).json({ error: 'Aplique primeiro whatsapp_evolution_provider_schema.sql.' })
    return res.status(500).json({ error: 'Não foi possível criar o número no SurgiMetrics.' })
  }

  const providerNumber = { ...number, user_id: ownerId, webhook_secret: webhookSecret }
  try {
    const result = await createEvolutionInstance(instanceName, {
      webhookUrl: webhookUrlFor(providerNumber),
      webhookSecret,
    })
    // A configuração enviada na criação varia entre releases da Evolution.
    // Grava como verificada somente depois de reler e comparar URL/eventos.
    await configureProviderWebhook(providerNumber, webhookUrlFor(providerNumber))
    await supabase.from('whatsapp_numbers').update({
      connection_state: result.state || 'connecting',
      last_health_at: new Date().toISOString(),
      webhook_verified_at: new Date().toISOString(),
    }).eq('id', number.id)
    return res.status(201).json({ ok: true, number: { ...number, connection_state: result.state || 'connecting' }, qrcode: { base64: result.base64, code: result.code, pairingCode: result.pairingCode } })
  } catch (error) {
    await supabase.from('whatsapp_numbers').update({ connection_state: 'error', last_health_at: new Date().toISOString() }).eq('id', number.id)
    return res.status(502).json({
      error: `Número salvo, mas a instância ou o webhook não puderam ser confirmados: ${error.message}`,
      numberId: number.id,
      retryable: true,
    })
  }
}

async function handleConnectInstance(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await authenticatedAdmin(req)
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message })
  const { supabase, ownerId } = auth
  const { data: number, error } = await getWhatsAppNumber(supabase, req.body?.whatsappNumberId)
  if (error || !number || number.user_id !== ownerId) return res.status(404).json({ error: 'Número não encontrado.' })
  if (whatsappProvider(number) !== 'evolution') return res.status(400).json({ error: 'Este número não usa Evolution API.' })

  try {
    const result = await connectEvolutionInstance(number.provider_instance_name)
    await configureProviderWebhook(number, webhookUrlFor(number))
    let state = 'connecting'
    try {
      const connection = await testProviderConnection(number)
      state = connection.state || (connection.connected ? 'open' : 'connecting')
    } catch { /* QR ainda aguardando leitura */ }
    const now = new Date().toISOString()
    await supabase.from('whatsapp_numbers').update({
      connection_state: state,
      last_health_at: now,
      webhook_verified_at: now,
      ...(state === 'open' ? { connected_at: now } : {}),
    }).eq('id', number.id)
    return res.status(200).json({ ok: true, state, qrcode: { base64: result.base64, code: result.code, pairingCode: result.pairingCode } })
  } catch (connectError) {
    await supabase.from('whatsapp_numbers').update({ connection_state: 'error', last_health_at: new Date().toISOString() }).eq('id', number.id)
    return res.status(502).json({ error: connectError.message })
  }
}

// ---- Atualizar nomes/fotos de conversas existentes (sem nova função serverless) ----
async function handleSyncChatIdentities(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing auth' })

  const supabase = adminSupabase()
  const { data: { user } = {}, error: authErr } = await supabase.auth.getUser(authHeader.slice(7))
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })
  const ownerId = await resolveOwnerId(supabase, user.id)
  const [{ data: numbers, error: numberError }, storedResult, { data: patients, error: patientError }] = await Promise.all([
    listWhatsAppNumbers(supabase, ownerId, { activeOnly: true }),
    supabase.from('whatsapp_messages').select('phone, whatsapp_number_id, patient_id, is_group, chat_lid, contact_phone').eq('user_id', ownerId).order('created_at', { ascending:false }).limit(2000),
    supabase.from('patients').select('id, phone').eq('user_id', ownerId),
  ])
  if (numberError || patientError) return res.status(500).json({ error: 'Não foi possível carregar as conversas para sincronização.' })
  if (missingMessageIdentitySchema(storedResult.error)) {
    return res.status(200).json({ ok: true, schemaReady: false, updated: 0 })
  }
  if (storedResult.error) return res.status(500).json({ error: 'Não foi possível carregar as conversas para sincronização.' })
  const stored = storedResult.data || []

  const storedByNumber = new Map()
  for (const message of stored) {
    if (!message.phone || !message.whatsapp_number_id) continue
    if (!storedByNumber.has(message.whatsapp_number_id)) storedByNumber.set(message.whatsapp_number_id, [])
    storedByNumber.get(message.whatsapp_number_id).push(message)
  }

  let updated = 0
  for (const number of numbers || []) {
    if (!providerReady(number)) continue
    const numberMessages = storedByNumber.get(number.id) || []
    const actualPhones = numberMessages.flatMap(message => {
      if (message.is_group) return []
      const explicit = String(message.contact_phone || '').replace(/\D/g, '')
      if (explicit) return [explicit]
      const address = String(message.phone || '')
      const digits = address.replace(/\D/g, '')
      // O produto opera com telefones brasileiros (12/13 dígitos com DDI).
      // IDs numéricos maiores deixados pelo parser antigo são LIDs sem sufixo.
      return !/@lid$/i.test(address) && digits.length >= 10 && digits.length <= 13 ? [digits] : []
    })
    let chats = []
    try { chats = await listProviderChats(number) } catch { continue }
    let aliases = []
    try { aliases = await resolveProviderPhoneLids(number, actualPhones, { chats }) } catch { /* metadados ainda podem ser sincronizados */ }

    for (const alias of aliases) {
      const lidDigits = alias.lid.replace(/\D/g, '')
      const phoneVariants = [...new Set([alias.inputPhone, alias.outputPhone, alias.lid, lidDigits].filter(Boolean))]
      const patientId = matchPatientId(patients || [], alias.outputPhone)
      const patch = { chat_lid: alias.lid, contact_phone: alias.outputPhone }
      if (patientId) patch.patient_id = patientId
      const [byAddress, byLid] = await Promise.all([
        supabase.from('whatsapp_messages').update(patch)
          .eq('user_id', ownerId).eq('whatsapp_number_id', number.id).eq('is_group', false).in('phone', phoneVariants),
        supabase.from('whatsapp_messages').update(patch)
          .eq('user_id', ownerId).eq('whatsapp_number_id', number.id).eq('is_group', false).eq('chat_lid', alias.lid),
      ])
      if (byAddress.error || byLid.error) return res.status(500).json({ error: 'Não foi possível reconciliar os identificadores das conversas.' })
      updated += 1
    }

    const updates = []
    for (const chat of chats) {
      const chatAddress = chat?.phone || chat?.remoteJid || chat?.id || ''
      const digits = String(chatAddress).replace(/\D/g, '')
      const isGroup = chat?.isGroup === true || /(?:-group|@g\.us)$/i.test(String(chatAddress)) || (whatsappProvider(number) === 'zapi' && digits.length > 15)
      const matchingAlias = aliases.find(alias => alias.inputPhone === digits || alias.outputPhone === digits || alias.lid.replace(/\D/g, '') === digits)
      const variants = [...new Set(numberMessages.flatMap(message => {
        const messageDigits = String(message.phone || '').replace(/\D/g, '')
        const messageLid = String(message.chat_lid || '').replace(/\D/g, '')
        const aliasesMatch = matchingAlias && [matchingAlias.inputPhone, matchingAlias.outputPhone, matchingAlias.lid.replace(/\D/g, '')].includes(messageDigits)
        return messageDigits === digits || messageLid === digits || aliasesMatch ? [message.phone] : []
      }))]
      if (!variants.length) continue
      let photo = null
      try { const url = new URL(String(chat?.profileThumbnail || chat?.profilePicUrl || '')); if (url.protocol === 'https:') photo = url.toString() } catch { /* sem foto válida */ }
      const patch = {
        chat_name: chat?.name || chat?.pushName ? String(chat.name || chat.pushName) : null,
        is_group: isGroup,
      }
      if (photo) patch.chat_photo = photo
      if (isGroup) {
        patch.phone = normalizeWhatsAppAddress(chatAddress, true)
        patch.patient_id = null
      }
      updates.push(supabase.from('whatsapp_messages').update(patch)
        .eq('user_id', ownerId).eq('whatsapp_number_id', number.id).in('phone', variants))
    }
    const results = await Promise.all(updates)
    const schemaMissing = results.find(result => missingMessageIdentitySchema(result.error))
    if (schemaMissing) return res.status(200).json({ ok: true, schemaReady: false, updated: 0 })
    const failed = results.find(result => result.error)
    if (failed) return res.status(500).json({ error: 'Não foi possível atualizar os nomes e fotos das conversas.' })
    updated += results.length
  }
  return res.status(200).json({ ok: true, schemaReady: true, updated })
}

// ---- Testar conexão do provedor (autenticado e restrito a admin da clínica) ----
// Z-API legado ainda pode testar credenciais antes de salvar. Evolution usa a
// instância server-side já criada, sem expor a chave global.
async function handleTestConnection(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await authenticatedAdmin(req)
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message })
  const { supabase, ownerId } = auth

  const { whatsappNumberId, instanceUrl: suppliedUrl, apiToken: suppliedToken } = req.body || {}
  let number = null
  if (whatsappNumberId) {
    const { data: storedNumber } = await getWhatsAppNumber(supabase, whatsappNumberId)
    number = storedNumber
    if (!number || number.user_id !== ownerId) return res.status(404).json({ error: 'Número não encontrado.' })
  } else {
    number = withLegacyProvider({ instance_url: suppliedUrl, api_token: suppliedToken })
  }

  try {
    const result = await testProviderConnection(number)
    if (number.id) {
      await configureProviderWebhook(number, webhookUrlFor(number))
      const now = new Date().toISOString()
      await supabase.from('whatsapp_numbers').update({
        connection_state: result.state || 'open',
        connected_at: now,
        last_health_at: now,
        webhook_verified_at: now,
      }).eq('id', number.id)
    }
    return res.status(200).json({
      ok: true,
      connected: true,
      provider: whatsappProvider(number),
      state: result.state || 'open',
      sentByMeEnabled: true,
      webhookConfigured: Boolean(number.id),
      ...(result.instanceUrl ? { instanceUrl: result.instanceUrl } : {}),
    })
  } catch (error) {
    if (number?.id) {
      await supabase.from('whatsapp_numbers').update({
        connection_state: 'close',
        last_health_at: new Date().toISOString(),
      }).eq('id', number.id)
    }
    return res.status(502).json({ error: error.message })
  }
}

// ---- Meta Ads: webhook de Lead Ads (leadgen) → cria oportunidade no pipeline ----
// Fica aqui (e não em api/meta.js) por causa do teto de 12 funções serverless do Vercel Hobby.
// App único da Zentri: verificação por META_VERIFY_TOKEN (env); roteia o lead à clínica pelo page_id.
async function handleMetaWebhook(req, res) {
  // 1) Verificação do webhook (handshake do Meta).
  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN) {
      return res.status(200).send(challenge)
    }
    return res.status(403).end()
  }
  if (req.method !== 'POST') return res.status(405).end()

  const appSecret = process.env.META_APP_SECRET
  const graphVersion = process.env.META_GRAPH_VERSION
  if (!appSecret || !graphVersion) {
    return res.status(503).json({ error: 'Meta integration is not configured' })
  }

  // 2) A assinatura é obrigatória e usa o corpo cru, antes de qualquer normalização do JSON.
  const signature = req.headers['x-hub-signature-256']
  if (!verifyWebhookSignature(req.rawBody, signature, appSecret)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const supabase = adminSupabase()
  const leads = parseLeadgenWebhook(req.body)
  const failedLeadIds = []
  for (const lead of leads) {
    try {
      // Descobre a clínica dona pela página do lead.
      const { data: conn, error: connectionError } = await supabase
        .from('meta_connections')
        .select('user_id, access_token')
        .eq('page_id', lead.pageId)
        .in('status', ['configurado', 'conectado'])
        .maybeSingle()
      if (connectionError) throw connectionError
      if (!conn?.access_token) {
        console.warn('meta lead ignored: page is not configured', lead.pageId)
        continue
      }

      const full = await fetchLeadData(lead.leadgenId, conn.access_token, graphVersion)
      const fields = mapLeadFields(full?.field_data)
      const { error: rpcError } = await supabase.rpc('ensure_meta_lead', {
        p_owner: conn.user_id,
        p_meta_lead_id: lead.leadgenId,
        p_name: fields.name,
        p_phone: fields.phone,
        p_email: fields.email,
        p_campaign_id: lead.campaignId || full?.campaign_id || null,
        p_ad_id: lead.adId || full?.ad_id || null,
        p_form_id: lead.formId || full?.form_id || null,
      })
      if (rpcError) throw rpcError
    } catch (e) {
      failedLeadIds.push(lead.leadgenId)
      console.error('meta lead ingest error:', lead.leadgenId, e?.message)
    }
  }

  // Um erro transitório precisa chegar à Meta para que a entrega seja tentada novamente.
  if (failedLeadIds.length) {
    return res.status(500).json({ error: 'Meta lead ingest failed', failed: failedLeadIds.length })
  }
  return res.status(200).json({ ok: true })
}

// ---- Disparo das automações de saída (gatilho manual/QA; o cron diário chama o motor direto) ----
// Autorizado por CRON_SECRET (header x-cron-secret ou Authorization: Bearer). O cron de alertas
// (api/alerts/process.js) roda o mesmo motor automaticamente às 08:00 BRT.
async function handleDispatch(req, res) {
  const secret = process.env.CRON_SECRET
  const headerSecret = req.headers['x-cron-secret'] || ''
  const bearer = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
  if (!secret || (headerSecret !== secret && bearer !== secret)) {
    return res.status(401).json({ error: 'Invalid cron secret' })
  }

  const supabase = adminSupabase()
  const todayISO = typeof req.query.date === 'string' && req.query.date ? req.query.date : undefined
  const ownerId = typeof req.query.owner === 'string' && req.query.owner ? req.query.owner : null
  const summary = await runWhatsAppAutomations(supabase, { todayISO, ownerId })
  return res.status(200).json({ ok: true, ...summary })
}

// ---- Meta Ads: sync manual de insights (gatilho QA; o cron diário roda o mesmo motor) ----
// Autorizado por CRON_SECRET. O cron de alertas (api/alerts/process.js) chama syncMetaInsights às 08:00 BRT.
// ?owner=<id> limita a uma clínica; ?since=YYYY-MM-DD / ?days=N ajustam a janela.
async function handleMetaSync(req, res) {
  const secret = process.env.CRON_SECRET
  const headerSecret = req.headers['x-cron-secret'] || ''
  const bearer = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
  if (!secret || (headerSecret !== secret && bearer !== secret)) {
    return res.status(401).json({ error: 'Invalid cron secret' })
  }

  const supabase = adminSupabase()
  const owner = typeof req.query.owner === 'string' && req.query.owner ? req.query.owner : null
  let since
  if (typeof req.query.since === 'string' && req.query.since) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.since)) return res.status(400).json({ error: 'since inválido (use YYYY-MM-DD)' })
    since = req.query.since
  }
  let days
  if (typeof req.query.days === 'string' && req.query.days) {
    const n = Number(req.query.days)
    if (!Number.isInteger(n) || n < 1 || n > 90) return res.status(400).json({ error: 'days inválido (1 a 90)' })
    days = n
  }
  const summary = await syncMetaInsights(supabase, { owner, since, days })
  return res.status(200).json(summary)
}

// ---- Enviar (autenticado pelo app, por número escolhido) ----
async function handleSend(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing auth' })

  const supabase = adminSupabase()
  const { data: { user } = {}, error: authErr } = await supabase.auth.getUser(authHeader.slice(7))
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { patientId, phone: rawPhone, contactPhone: rawContactPhone, chatLid: rawChatLid, isGroup: groupHint, text, whatsappNumberId, type, mediaUrl, mediaMime, caption, fileName } = req.body || {}
  const isGroup = groupHint === true || /(?:-group|@g\.us)$/i.test(String(rawPhone || ''))
  const phone = normalizeWhatsAppAddress(rawPhone, isGroup)
  const chatLid = isGroup ? null : (normalizeWhatsAppLid(rawChatLid) || normalizeWhatsAppLid(phone) || null)
  const contactPhone = isGroup ? null : (normalizePhone(rawContactPhone) || (!chatLid ? normalizePhone(phone) : '') || null)
  const isMedia = ['image', 'audio', 'document'].includes(type)
  if (!phone) return res.status(400).json({ error: 'phone é obrigatório' })
  if (!whatsappNumberId) return res.status(400).json({ error: 'whatsappNumberId é obrigatório' })
  if (isMedia) {
    if (!mediaUrl) return res.status(400).json({ error: 'mediaUrl é obrigatório para mídia' })
  } else if (!text) {
    return res.status(400).json({ error: 'text é obrigatório' })
  }

  const ownerId = await resolveOwnerId(supabase, user.id)

  // Credenciais do número escolhido (deve pertencer à clínica).
  const { data: num } = await getWhatsAppNumber(supabase, whatsappNumberId)
  if (!num || num.user_id !== ownerId) return res.status(400).json({ error: 'Número inválido para esta clínica' })

  // Nunca confia no patientId vindo do navegador: o vínculo só é aceito se o
  // paciente pertencer à mesma clínica autenticada.
  let verifiedPatientId = null
  if (!isGroup && patientId) {
    const { data: patient } = await supabase.from('patients')
      .select('id')
      .eq('id', patientId)
      .eq('user_id', ownerId)
      .maybeSingle()
    if (!patient) return res.status(400).json({ error: 'Paciente inválido para esta clínica' })
    verifiedPatientId = patient.id
  }

  // Admin escopado À CLÍNICA (owner ou role='admin' nela). Não admin só envia pelos números dele.
  let isAdmin = user.id === ownerId
  if (!isAdmin) {
    const { data: clinic } = await supabase.from('clinics').select('id').eq('owner_id', ownerId).maybeSingle()
    if (clinic) {
      const { data: adminMem } = await supabase.from('clinic_members')
        .select('id').eq('user_id', user.id).eq('clinic_id', clinic.id).eq('role', 'admin').maybeSingle()
      isAdmin = !!adminMem
    }
  }
  if (!isAdmin && num.assigned_user_id !== user.id) {
    return res.status(403).json({ error: 'Este número não está atribuído a você.' })
  }

  if (!providerReady(num)) return res.status(502).json({ error: 'Número sem conexão de WhatsApp configurada' })

  // Mídia só pode apontar para o Storage da PRÓPRIA clínica (fecha URL externa/javascript: e cross-clínica).
  if (isMedia && !String(mediaUrl).includes(`/storage/v1/object/public/wa-media/${ownerId}/`)) {
    return res.status(400).json({ error: 'mediaUrl inválida (fora do storage da clínica).' })
  }

  const bodyText = isMedia ? (caption || '') : text
  const msgType = isMedia ? type : 'text'
  const contactId = isGroup ? null : await ensureWhatsAppContact(supabase, {
    ownerId,
    whatsappNumberId: num.id,
    identityKey: chatLid || contactPhone || phone,
    phone: contactPhone,
    chatLid,
    patientId: verifiedPatientId,
  })
  const insertBase = {
    user_id: ownerId, patient_id: verifiedPatientId, contact_id: contactId, phone, direction: 'outbound', body: bodyText,
    chat_lid: chatLid, contact_phone: contactPhone,
    is_group: isGroup,
    whatsapp_number_id: num.id, provider: whatsappProvider(num), msg_type: msgType, media_url: mediaUrl ?? null, media_mime: mediaMime ?? null,
  }

  let providerId = null
  try {
    providerId = isMedia
      ? await sendProviderMedia(num, type, { to: phone, mediaUrl, caption: caption || '', fileName: fileName || '', mediaMime: mediaMime || '' })
      : await sendProviderText(num, phone, text)
  } catch (err) {
    await insertWhatsAppMessage(supabase, { ...insertBase, status: 'failed' })
    return res.status(502).json({ error: err.message })
  }

  const { data: msg, error: insertError } = await insertWhatsAppMessage(
    supabase,
    { ...insertBase, status: 'sent', provider_message_id: providerId },
    { selectId: true },
  )

  if (insertError?.code === '23505') {
    const { data: existing, error: existingError } = await supabase.from('whatsapp_messages')
      .select('id')
      .eq('user_id', ownerId)
      .eq('whatsapp_number_id', num.id)
      .eq('provider', whatsappProvider(num))
      .eq('provider_message_id', providerId)
      .maybeSingle()
    if (existingError || !existing) return res.status(500).json({ error: 'Mensagem enviada, mas o histórico não pôde ser confirmado.' })
    return res.status(200).json({ ok: true, messageId: existing.id })
  }
  if (insertError) return res.status(500).json({ error: 'Mensagem enviada, mas não foi possível salvá-la no histórico.' })

  return res.status(200).json({ ok: true, messageId: msg?.id })
}

// ---- Receber (webhook do provider, por número) ----
async function handleWebhook(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge']
    if (challenge) return res.status(200).send(challenge)
    return res.status(200).json({ ok: true })
  }
  if (req.method !== 'POST') return res.status(405).end()

  const numberId = req.query.number
  if (!numberId) return res.status(200).json({ ok: true })

  const supabase = adminSupabase()
  const { data: num } = await getWhatsAppNumber(supabase, numberId)
  if (!num) return res.status(200).json({ ok: true })

  // Valida o token do webhook deste número.
  const token = req.headers['x-webhook-token'] || req.query.token
  if (num.webhook_secret && token !== num.webhook_secret) {
    return res.status(401).json({ error: 'Invalid webhook token' })
  }

  const provider = whatsappProvider(num)
  const metadata = providerWebhookMetadata(provider, req.body)
  if (provider === 'evolution' && metadata.instanceName && metadata.instanceName !== num.provider_instance_name) {
    return res.status(401).json({ error: 'Webhook instance mismatch' })
  }

  let audit
  try {
    audit = await beginWebhookEvent(supabase, num, metadata, req)
  } catch (error) {
    console.error('whatsapp webhook audit error:', error.message)
    return res.status(500).json({ error: 'Webhook could not be durably recorded' })
  }
  if (audit.duplicate) return res.status(200).json({ ok: true, duplicate: true })

  const receivedAt = new Date().toISOString()
  const healthPatch = { last_webhook_at: receivedAt, last_webhook_event: metadata.eventType }
  if (provider === 'evolution' && metadata.eventType === 'connection.update') {
    const state = String(req.body?.data?.state || req.body?.data?.status || req.body?.state || 'unknown').toLowerCase()
    healthPatch.connection_state = state
    healthPatch.last_health_at = receivedAt
    if (state === 'open') healthPatch.connected_at = receivedAt
  }
  await supabase.from('whatsapp_numbers').update(healthPatch).eq('id', num.id)

  // Atualiza o ciclo real da mensagem enviada (enviada → entregue → lida).
  // Nunca regride um status mais avançado se callbacks chegarem fora de ordem.
  const statusEvent = parseProviderMessageStatus(provider, req.body)
  if (statusEvent) {
    const priorStatuses = {
      sent: ['sent'],
      delivered: ['sent'],
      read: ['sent', 'delivered'],
      failed: ['sent'],
    }[statusEvent.status]
    const { error } = await supabase.from('whatsapp_messages')
      .update({ status: statusEvent.status })
      .eq('user_id', num.user_id)
      .eq('whatsapp_number_id', num.id)
      .eq('provider', provider)
      .eq('direction', 'outbound')
      .in('provider_message_id', statusEvent.providerMessageIds)
      .in('status', priorStatuses)
    if (error) {
      console.error('whatsapp status update error:', error.message)
      await finishWebhookEvent(supabase, audit.id, 'failed', error.message)
      return res.status(500).json({ error: 'Message status update failed' })
    }
    await finishWebhookEvent(supabase, audit.id, 'processed')
    return res.status(200).json({ ok: true })
  }

  const parsed = parseProviderIncomingMessage(provider, req.body)
  if (!parsed) {
    await finishWebhookEvent(supabase, audit.id, 'ignored')
    return res.status(200).json({ ok: true })
  }

  // URLs do WhatsApp/Baileys normalmente apontam para conteúdo criptografado e
  // expiram. Para não depender delas, a mídia é baixada pela própria Evolution
  // e copiada para o Storage antes de confirmar o webhook.
  let mediaHydrationError = null
  if (provider === 'evolution' && parsed.providerMediaMessage) {
    try {
      const persistedMedia = await persistEvolutionInboundMedia(supabase, num, parsed)
      if (persistedMedia) {
        parsed.mediaUrl = persistedMedia.mediaUrl
        parsed.mediaMime = persistedMedia.mediaMime
      }
    } catch (error) {
      mediaHydrationError = error
      console.error('whatsapp evolution media persistence error:', error.message)
    }
  }

  const ownerUserId = num.user_id

  // Se o callback veio apenas com `@lid`, reutiliza o vínculo reconciliado por
  // uma sincronização anterior. A consulta é exata por clínica, número e LID;
  // nunca tenta adivinhar pelo nome exibido ou pelos últimos dígitos do LID.
  let historicalIdentity = null
  if (!parsed.isGroup && parsed.chatLid) {
    let identityResult = await supabase.from('whatsapp_messages')
      .select('patient_id, contact_id, contact_phone, chat_name, chat_photo')
      .eq('user_id', ownerUserId)
      .eq('whatsapp_number_id', num.id)
      .eq('chat_lid', parsed.chatLid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (missingMessageFields(identityResult.error, ['contact_id'])) {
      identityResult = await supabase.from('whatsapp_messages')
        .select('patient_id, contact_phone, chat_name, chat_photo')
        .eq('user_id', ownerUserId)
        .eq('whatsapp_number_id', num.id)
        .eq('chat_lid', parsed.chatLid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    }
    if (!missingMessageIdentitySchema(identityResult.error)) historicalIdentity = identityResult.data
  }
  const contactPhone = parsed.contactPhone || historicalIdentity?.contact_phone || null

  // Grupo nunca é paciente. Para conversa individual, o casamento permanece
  // estrito: ambiguidade de telefone não atribui a pessoa errada.
  let patientId = historicalIdentity?.patient_id || null
  if (!parsed.isGroup && !patientId && contactPhone) {
    const { data: patients } = await supabase.from('patients').select('id, phone').eq('user_id', ownerUserId)
    patientId = matchPatientId(patients || [], contactPhone)
  }

  // Toda conversa individual ganha um contato CRM. Isso é apenas identidade e
  // classificação: não cria paciente nem oportunidade automaticamente.
  const contactId = parsed.isGroup ? null : (historicalIdentity?.contact_id || await ensureWhatsAppContact(supabase, {
    ownerId: ownerUserId,
    whatsappNumberId: num.id,
    identityKey: parsed.chatLid || contactPhone || parsed.phone,
    phone: contactPhone,
    chatLid: parsed.chatLid,
    name: parsed.senderName || parsed.chatName || null,
    photo: parsed.chatPhoto || parsed.senderPhoto || null,
    patientId,
  }))

  // Um mesmo participante pode chegar ora com nome/telefone, ora somente com
  // participantLid. Reutiliza exclusivamente o vínculo exato já observado no
  // mesmo grupo e número da clínica; nunca tenta converter LID em telefone.
  let historicalSender = null
  if (parsed.isGroup && parsed.senderLid && (!parsed.senderName || !parsed.senderPhone)) {
    const { data, error } = await supabase.from('whatsapp_messages')
      .select('sender_name, sender_phone, sender_photo')
      .eq('user_id', ownerUserId)
      .eq('whatsapp_number_id', num.id)
      .eq('phone', parsed.phone)
      .eq('sender_lid', parsed.senderLid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!missingMessageIdentitySchema(error)) historicalSender = data
  }

  const row = {
    user_id: ownerUserId, patient_id: patientId, contact_id: contactId, phone: parsed.phone, direction: parsed.direction,
    body: parsed.text, status: parsed.status, provider_message_id: parsed.providerMessageId,
    whatsapp_number_id: num.id, provider,
    chat_lid: parsed.chatLid,
    contact_phone: contactPhone,
    is_group: parsed.isGroup,
    chat_name: parsed.chatName || historicalIdentity?.chat_name || null,
    chat_photo: parsed.chatPhoto || historicalIdentity?.chat_photo || null,
    sender_name: parsed.senderName || historicalSender?.sender_name || null,
    sender_phone: parsed.senderPhone || historicalSender?.sender_phone || null,
    sender_lid: parsed.senderLid || null,
    sender_photo: parsed.senderPhoto || historicalSender?.sender_photo || null,
    msg_type: parsed.msgType || 'text', media_url: parsed.mediaUrl || null, media_mime: parsed.mediaMime || null,
  }
  if (parsed.createdAt) row.created_at = parsed.createdAt
  const { error } = await insertWhatsAppMessage(supabase, row)

  // 23505 = índice único (mensagem duplicada) → idempotente, ignora.
  if (error && error.code !== '23505') {
    console.error('whatsapp webhook insert error:', error.message)
    await finishWebhookEvent(supabase, audit.id, 'failed', error.message)
    return res.status(500).json({ error: 'Message persistence failed' })
  }
  if (error?.code === '23505') {
    if (!mediaHydrationError && parsed.mediaUrl && parsed.providerMessageId) {
      const { error: mediaUpdateError } = await supabase.from('whatsapp_messages').update({
        media_url: parsed.mediaUrl,
        media_mime: parsed.mediaMime || null,
      })
        .eq('user_id', ownerUserId)
        .eq('whatsapp_number_id', num.id)
        .eq('provider', provider)
        .eq('provider_message_id', parsed.providerMessageId)
      if (mediaUpdateError) {
        await finishWebhookEvent(supabase, audit.id, 'failed', mediaUpdateError.message)
        return res.status(500).json({ error: 'Stored media could not be linked to the message' })
      }
    }
    if (mediaHydrationError) {
      await finishWebhookEvent(supabase, audit.id, 'failed', mediaHydrationError.message)
      return res.status(500).json({ error: 'Media persistence failed' })
    }
    await finishWebhookEvent(supabase, audit.id, 'ignored')
    return res.status(200).json({ ok: true, duplicate: true })
  }

  if (mediaHydrationError) {
    await finishWebhookEvent(supabase, audit.id, 'failed', mediaHydrationError.message)
    return res.status(500).json({ error: 'Message saved, but media persistence failed' })
  }

  // IA sugere avanço de estágio (sugere e confirma). Nunca derruba o recebimento.
  if (!parsed.isGroup && (patientId || contactId) && parsed.direction === 'inbound') {
    try {
      await maybeSuggestStage(supabase, ownerUserId, { patientId, contactId }, parsed)
    } catch (e) {
      console.error('stage suggestion error:', e?.message)
    }
  }

  await finishWebhookEvent(supabase, audit.id, 'processed')
  return res.status(200).json({ ok: true })
}

// Analisa a conversa e, se houver avanço claro, grava uma SUGESTÃO (pending) na oportunidade.
// A IA nunca move o funil — só o humano confirma. Barato: pré-filtro + cooldown antes de chamar a IA.
async function maybeSuggestStage(supabase, ownerUserId, { patientId, contactId }, parsed) {
  let oppQuery = supabase
    .from('opportunities')
    .select('id, stage, suggestion_status, suggested_at')
    .eq('user_id', ownerUserId)
    .eq('status', 'aberto')
    .order('created_at', { ascending: false })
    .limit(1)
  oppQuery = contactId ? oppQuery.eq('contact_id', contactId) : oppQuery.eq('patient_id', patientId)
  const { data: opp } = await oppQuery.maybeSingle()
  if (!opp) return

  // Cooldown: não re-sugere se já há sugestão pendente recente (evita spam e custo).
  const cooldownMin = Number(process.env.AI_SUGGEST_COOLDOWN_MIN || 10)
  if (opp.suggestion_status === 'pending' && opp.suggested_at) {
    const ageMin = (Date.now() - new Date(opp.suggested_at).getTime()) / 60000
    if (ageMin < cooldownMin) return
  }

  // Pré-filtro grátis: só chama a IA se a mensagem sinalizar um estágio à frente.
  if (!shouldRunAI(parsed.text, opp.stage)) return

  // Últimas mensagens da conversa (cronológicas) para a classificação.
  let recentQuery = supabase
    .from('whatsapp_messages')
    .select('direction, body, created_at')
    .eq('user_id', ownerUserId)
    .order('created_at', { ascending: false })
    .limit(12)
  recentQuery = contactId ? recentQuery.eq('contact_id', contactId) : recentQuery.eq('phone', parsed.phone)
  const { data: recent } = await recentQuery
  const messages = (recent || []).slice().reverse()

  const raw = await classifyStageWithAI(buildSuggestionInput(messages, opp.stage))
  const minConfidence = Number(process.env.AI_SUGGEST_MIN_CONFIDENCE || 0.7)
  const result = parseSuggestionResult(raw, { currentStage: opp.stage, minConfidence })
  if (!result) return

  await supabase
    .from('opportunities')
    .update({
      suggested_stage: result.stage,
      suggested_reason: result.reason,
      suggested_confidence: result.confidence,
      suggested_at: new Date().toISOString(),
      suggestion_status: 'pending',
    })
    .eq('id', opp.id)
}
