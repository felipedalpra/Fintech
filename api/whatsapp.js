// api/whatsapp.js — endpoint consolidado de WhatsApp (1 função serverless, limite Hobby da Vercel).
// Roteado por ?action=message (enviar, autenticado) | ?action=webhook (receber do provider).
// Os rewrites no vercel.json mantêm URLs limpas: /api/whatsapp/message e /api/whatsapp/webhook.
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppText } from './_lib/whatsappClient.js'
import { parseIncomingMessage, matchPatientId, normalizePhone } from './_lib/whatsapp.js'

function adminSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// Resolve o user_id do DONO dos dados (clínica) a partir do usuário autenticado.
// Dono → ele mesmo. Membro → owner da clínica. Mensagens pertencem ao dono.
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
  const action = req.query.action
  if (action === 'webhook') return handleWebhook(req, res)
  if (action === 'message') return handleSend(req, res)
  return res.status(400).json({ error: 'Ação inválida. Use ?action=message ou ?action=webhook.' })
}

// ---- Enviar (autenticado pelo app) ----
async function handleSend(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing auth' })

  const supabase = adminSupabase()
  const { data: { user } = {}, error: authErr } = await supabase.auth.getUser(authHeader.slice(7))
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { patientId, phone: rawPhone, text } = req.body || {}
  const phone = normalizePhone(rawPhone)
  if (!phone || !text) return res.status(400).json({ error: 'phone e text são obrigatórios' })

  const ownerId = await resolveOwnerId(supabase, user.id)

  let providerId = null
  try {
    providerId = await sendWhatsAppText(phone, text)
  } catch (err) {
    await supabase.from('whatsapp_messages').insert({
      user_id: ownerId, patient_id: patientId ?? null, phone, direction: 'outbound', body: text, status: 'failed',
    })
    return res.status(502).json({ error: err.message })
  }

  const { data: msg } = await supabase.from('whatsapp_messages').insert({
    user_id: ownerId, patient_id: patientId ?? null, phone, direction: 'outbound', body: text,
    status: 'sent', provider_message_id: providerId,
  }).select('id').single()

  return res.status(200).json({ ok: true, messageId: msg?.id })
}

// ---- Receber (webhook do provider) ----
async function handleWebhook(req, res) {
  // Verificação (Meta/Evolution) — inofensivo para Z-API.
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge']
    if (challenge) return res.status(200).send(challenge)
    return res.status(200).json({ ok: true })
  }
  if (req.method !== 'POST') return res.status(405).end()

  // Token do webhook (configurado no provider).
  const token = req.headers['x-webhook-token'] || req.query.token
  if (process.env.WHATSAPP_WEBHOOK_TOKEN && token !== process.env.WHATSAPP_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: 'Invalid webhook token' })
  }

  const parsed = parseIncomingMessage(req.body)
  if (!parsed) return res.status(200).json({ ok: true }) // ignora echo/status/sem conteúdo

  // Clínica dona da linha (deploy single-tenant): user_id da Dra. em env.
  const ownerUserId = process.env.WHATSAPP_OWNER_USER_ID
  if (!ownerUserId) return res.status(200).json({ ok: true })

  const supabase = adminSupabase()

  // Casa o telefone a um paciente da clínica (estrito: ambíguo → não atribui).
  const { data: patients } = await supabase.from('patients').select('id, phone').eq('user_id', ownerUserId)
  const patientId = matchPatientId(patients || [], parsed.phone)

  const { error } = await supabase.from('whatsapp_messages').insert({
    user_id: ownerUserId, patient_id: patientId, phone: parsed.phone, direction: 'inbound',
    body: parsed.text, status: 'read', provider_message_id: parsed.providerMessageId,
  })

  // 23505 = violação de índice único (mensagem duplicada) → idempotente, ignora.
  if (error && error.code !== '23505') {
    // Não devolve erro ao provider (evita tempestade de retries); apenas registra no log.
    console.error('whatsapp webhook insert error:', error.message)
  }

  return res.status(200).json({ ok: true })
}
