// api/whatsapp.js — endpoint consolidado de WhatsApp (1 função serverless, limite Hobby da Vercel).
// Multi-número: cada número (whatsapp_numbers) tem suas credenciais Z-API, lidas no servidor.
// Roteado por ?action=message (enviar, autenticado) | ?action=webhook (receber do provider).
//   webhook por número: /api/whatsapp?action=webhook&number=<id>&token=<webhook_secret>
import { createClient } from '@supabase/supabase-js'
import { configureZApiReceiveWebhook, enableZApiSentByMe, listZApiChats, resolveZApiPhoneLids, sendWhatsAppText, sendWhatsAppMedia, testWhatsAppConnection } from './_lib/whatsappClient.js'
import { parseIncomingMessage, parseMessageStatus, matchPatientId, normalizePhone, normalizeWhatsAppAddress, normalizeWhatsAppLid } from './_lib/whatsapp.js'
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
const WHATSAPP_WEBHOOK_BASE = 'https://www.surgimetrics.com.br/api/whatsapp?action=webhook'
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

function missingMessageIdentitySchema(error) {
  return ['PGRST204', '42703'].includes(error?.code) && MESSAGE_IDENTITY_FIELDS.some(field => String(error.message || '').includes(field))
}

function missingMessageFields(error, fields) {
  return ['PGRST204', '42703'].includes(error?.code) && fields.some(field => String(error.message || '').includes(field))
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
  if (action === 'sync-chat-identities') return handleSyncChatIdentities(req, res)
  if (action === 'dispatch') return handleDispatch(req, res)
  if (action === 'meta-webhook') return handleMetaWebhook(req, res)
  if (action === 'meta-sync') return handleMetaSync(req, res)
  return res.status(400).json({ error: 'Ação inválida.' })
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
    supabase.from('whatsapp_numbers').select('id, instance_url, api_token').eq('user_id', ownerId).eq('active', true),
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
    if (!number.instance_url || !number.api_token) continue
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
    let aliases = []
    try { aliases = await resolveZApiPhoneLids(number.instance_url, number.api_token, actualPhones) } catch { /* metadados ainda podem ser sincronizados */ }

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

    let chats = []
    try { chats = await listZApiChats(number.instance_url, number.api_token) } catch { continue }
    const updates = []
    for (const chat of chats) {
      const digits = String(chat?.phone || '').replace(/\D/g, '')
      const isGroup = chat?.isGroup === true || /(?:-group|@g\.us)$/i.test(String(chat?.phone || '')) || digits.length > 15
      const matchingAlias = aliases.find(alias => alias.inputPhone === digits || alias.outputPhone === digits || alias.lid.replace(/\D/g, '') === digits)
      const variants = [...new Set(numberMessages.flatMap(message => {
        const messageDigits = String(message.phone || '').replace(/\D/g, '')
        const messageLid = String(message.chat_lid || '').replace(/\D/g, '')
        const aliasesMatch = matchingAlias && [matchingAlias.inputPhone, matchingAlias.outputPhone, matchingAlias.lid.replace(/\D/g, '')].includes(messageDigits)
        return messageDigits === digits || messageLid === digits || aliasesMatch ? [message.phone] : []
      }))]
      if (!variants.length) continue
      let photo = null
      try { const url = new URL(String(chat?.profileThumbnail || '')); if (url.protocol === 'https:') photo = url.toString() } catch { /* sem foto válida */ }
      const patch = {
        chat_name: chat?.name ? String(chat.name) : null,
        is_group: isGroup,
      }
      if (photo) patch.chat_photo = photo
      if (isGroup) {
        patch.phone = normalizeWhatsAppAddress(chat.phone, true)
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

// ---- Testar credenciais Z-API (autenticado e restrito a admin da clínica) ----
// Pode testar credenciais ainda não salvas ou as credenciais write-only de um número existente.
async function handleTestConnection(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing auth' })

  const supabase = adminSupabase()
  const { data: { user } = {}, error: authErr } = await supabase.auth.getUser(authHeader.slice(7))
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const ownerId = await resolveOwnerId(supabase, user.id)
  let isAdmin = user.id === ownerId
  if (!isAdmin) {
    const { data: clinic } = await supabase.from('clinics').select('id').eq('owner_id', ownerId).maybeSingle()
    if (clinic) {
      const { data: adminMem } = await supabase.from('clinic_members')
        .select('id').eq('user_id', user.id).eq('clinic_id', clinic.id).eq('role', 'admin').maybeSingle()
      isAdmin = !!adminMem
    }
  }
  if (!isAdmin) return res.status(403).json({ error: 'Somente administradores podem testar a conexão.' })

  const { whatsappNumberId, instanceUrl: suppliedUrl, apiToken: suppliedToken } = req.body || {}
  let instanceUrl = suppliedUrl
  let apiToken = suppliedToken
  let number = null
  if (whatsappNumberId) {
    const { data: storedNumber } = await supabase.from('whatsapp_numbers')
      .select('id, user_id, instance_url, api_token, webhook_secret').eq('id', whatsappNumberId).maybeSingle()
    number = storedNumber
    if (!number || number.user_id !== ownerId) return res.status(404).json({ error: 'Número não encontrado.' })
    instanceUrl ||= number.instance_url
    apiToken ||= number.api_token
  }

  try {
    const result = await testWhatsAppConnection(instanceUrl, apiToken)
    await enableZApiSentByMe(result.instanceUrl, apiToken)
    if (number) {
      const webhookUrl = `${WHATSAPP_WEBHOOK_BASE}&number=${number.id}&token=${number.webhook_secret || ''}`
      await configureZApiReceiveWebhook(result.instanceUrl, apiToken, webhookUrl)
    }
    return res.status(200).json({
      ok: true,
      connected: true,
      sentByMeEnabled: true,
      webhookConfigured: Boolean(number),
      instanceUrl: result.instanceUrl,
    })
  } catch (error) {
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
  const { data: num } = await supabase
    .from('whatsapp_numbers')
    .select('id, user_id, assigned_user_id, instance_url, api_token')
    .eq('id', whatsappNumberId)
    .maybeSingle()
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

  if (!num.instance_url || !num.api_token) return res.status(502).json({ error: 'Número sem credenciais Z-API configuradas' })

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
    whatsapp_number_id: num.id, msg_type: msgType, media_url: mediaUrl ?? null, media_mime: mediaMime ?? null,
  }

  let providerId = null
  try {
    providerId = isMedia
      ? await sendWhatsAppMedia(num.instance_url, num.api_token, type, { to: phone, mediaUrl, caption: caption || '', fileName: fileName || '' })
      : await sendWhatsAppText(num.instance_url, num.api_token, phone, text)
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
  const { data: num } = await supabase
    .from('whatsapp_numbers')
    .select('id, user_id, webhook_secret')
    .eq('id', numberId)
    .maybeSingle()
  if (!num) return res.status(200).json({ ok: true })

  // Valida o token do webhook deste número.
  const token = req.headers['x-webhook-token'] || req.query.token
  if (num.webhook_secret && token !== num.webhook_secret) {
    return res.status(401).json({ error: 'Invalid webhook token' })
  }

  // Atualiza o ciclo real da mensagem enviada (enviada → entregue → lida).
  // Nunca regride um status mais avançado se callbacks chegarem fora de ordem.
  const statusEvent = parseMessageStatus(req.body)
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
      .eq('direction', 'outbound')
      .in('provider_message_id', statusEvent.providerMessageIds)
      .in('status', priorStatuses)
    if (error) {
      console.error('whatsapp status update error:', error.message)
      return res.status(500).json({ error: 'Message status update failed' })
    }
    return res.status(200).json({ ok: true })
  }

  const parsed = parseIncomingMessage(req.body)
  if (!parsed) return res.status(200).json({ ok: true })

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
    whatsapp_number_id: num.id,
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
  }

  // IA sugere avanço de estágio (sugere e confirma). Nunca derruba o recebimento.
  if (!parsed.isGroup && (patientId || contactId) && parsed.direction === 'inbound') {
    try {
      await maybeSuggestStage(supabase, ownerUserId, { patientId, contactId }, parsed)
    } catch (e) {
      console.error('stage suggestion error:', e?.message)
    }
  }

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
