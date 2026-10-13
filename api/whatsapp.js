// api/whatsapp.js — endpoint consolidado de WhatsApp (1 função serverless, limite Hobby da Vercel).
// Multi-número: cada número (whatsapp_numbers) tem suas credenciais Z-API, lidas no servidor.
// Roteado por ?action=message (enviar, autenticado) | ?action=webhook (receber do provider).
//   webhook por número: /api/whatsapp?action=webhook&number=<id>&token=<webhook_secret>
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppText, sendWhatsAppMedia } from './_lib/whatsappClient.js'
import { parseIncomingMessage, matchPatientId, normalizePhone } from './_lib/whatsapp.js'
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
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
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
  if (action === 'dispatch') return handleDispatch(req, res)
  if (action === 'meta-webhook') return handleMetaWebhook(req, res)
  if (action === 'meta-sync') return handleMetaSync(req, res)
  return res.status(400).json({ error: 'Ação inválida. Use ?action=message, ?action=webhook, ?action=dispatch, ?action=meta-webhook ou ?action=meta-sync.' })
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

  const { patientId, phone: rawPhone, text, whatsappNumberId, type, mediaUrl, mediaMime, caption, fileName } = req.body || {}
  const phone = normalizePhone(rawPhone)
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

  const bodyText = isMedia ? (caption || '') : text
  const msgType = isMedia ? type : 'text'
  const insertBase = {
    user_id: ownerId, patient_id: patientId ?? null, phone, direction: 'outbound', body: bodyText,
    whatsapp_number_id: num.id, msg_type: msgType, media_url: mediaUrl ?? null, media_mime: mediaMime ?? null,
  }

  let providerId = null
  try {
    providerId = isMedia
      ? await sendWhatsAppMedia(num.instance_url, num.api_token, type, { to: phone, mediaUrl, caption: caption || '', fileName: fileName || '' })
      : await sendWhatsAppText(num.instance_url, num.api_token, phone, text)
  } catch (err) {
    await supabase.from('whatsapp_messages').insert({ ...insertBase, status: 'failed' })
    return res.status(502).json({ error: err.message })
  }

  const { data: msg } = await supabase.from('whatsapp_messages')
    .insert({ ...insertBase, status: 'sent', provider_message_id: providerId })
    .select('id').single()

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

  const parsed = parseIncomingMessage(req.body)
  if (!parsed) return res.status(200).json({ ok: true })

  const ownerUserId = num.user_id

  // Casa o telefone a um paciente da clínica (estrito: ambíguo → não casa pelo match).
  const { data: patients } = await supabase.from('patients').select('id, phone').eq('user_id', ownerUserId)
  let patientId = matchPatientId(patients || [], parsed.phone)

  // Número novo → cria o lead automaticamente (paciente + oportunidade em "primeiro_contato").
  if (!patientId) {
    const { data: leadId } = await supabase.rpc('ensure_whatsapp_lead', {
      p_owner: ownerUserId, p_phone: parsed.phone, p_name: parsed.senderName || '',
    })
    if (leadId) patientId = leadId
  }

  const { error } = await supabase.from('whatsapp_messages').insert({
    user_id: ownerUserId, patient_id: patientId, phone: parsed.phone, direction: 'inbound',
    body: parsed.text, status: 'read', provider_message_id: parsed.providerMessageId,
    whatsapp_number_id: num.id,
    msg_type: parsed.msgType || 'text', media_url: parsed.mediaUrl || null, media_mime: parsed.mediaMime || null,
  })

  // 23505 = índice único (mensagem duplicada) → idempotente, ignora.
  if (error && error.code !== '23505') {
    console.error('whatsapp webhook insert error:', error.message)
  }

  // IA sugere avanço de estágio (sugere e confirma). Nunca derruba o recebimento.
  if (patientId) {
    try {
      await maybeSuggestStage(supabase, ownerUserId, patientId, parsed)
    } catch (e) {
      console.error('stage suggestion error:', e?.message)
    }
  }

  return res.status(200).json({ ok: true })
}

// Analisa a conversa e, se houver avanço claro, grava uma SUGESTÃO (pending) na oportunidade.
// A IA nunca move o funil — só o humano confirma. Barato: pré-filtro + cooldown antes de chamar a IA.
async function maybeSuggestStage(supabase, ownerUserId, patientId, parsed) {
  const { data: opp } = await supabase
    .from('opportunities')
    .select('id, stage, suggestion_status, suggested_at')
    .eq('user_id', ownerUserId)
    .eq('patient_id', patientId)
    .eq('status', 'aberto')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
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
  const { data: recent } = await supabase
    .from('whatsapp_messages')
    .select('direction, body, created_at')
    .eq('user_id', ownerUserId)
    .eq('phone', parsed.phone)
    .order('created_at', { ascending: false })
    .limit(12)
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
