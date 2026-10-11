// api/whatsapp.js — endpoint consolidado de WhatsApp (1 função serverless, limite Hobby da Vercel).
// Multi-número: cada número (whatsapp_numbers) tem suas credenciais Z-API, lidas no servidor.
// Roteado por ?action=message (enviar, autenticado) | ?action=webhook (receber do provider).
//   webhook por número: /api/whatsapp?action=webhook&number=<id>&token=<webhook_secret>
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppText } from './_lib/whatsappClient.js'
import { parseIncomingMessage, matchPatientId, normalizePhone } from './_lib/whatsapp.js'

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
  const action = req.query.action
  if (action === 'webhook') return handleWebhook(req, res)
  if (action === 'message') return handleSend(req, res)
  return res.status(400).json({ error: 'Ação inválida. Use ?action=message ou ?action=webhook.' })
}

// ---- Enviar (autenticado pelo app, por número escolhido) ----
async function handleSend(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing auth' })

  const supabase = adminSupabase()
  const { data: { user } = {}, error: authErr } = await supabase.auth.getUser(authHeader.slice(7))
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { patientId, phone: rawPhone, text, whatsappNumberId } = req.body || {}
  const phone = normalizePhone(rawPhone)
  if (!phone || !text) return res.status(400).json({ error: 'phone e text são obrigatórios' })
  if (!whatsappNumberId) return res.status(400).json({ error: 'whatsappNumberId é obrigatório' })

  const ownerId = await resolveOwnerId(supabase, user.id)

  // Credenciais do número escolhido (deve pertencer à clínica).
  const { data: num } = await supabase
    .from('whatsapp_numbers')
    .select('id, user_id, instance_url, api_token')
    .eq('id', whatsappNumberId)
    .maybeSingle()
  if (!num || num.user_id !== ownerId) return res.status(400).json({ error: 'Número inválido para esta clínica' })
  if (!num.instance_url || !num.api_token) return res.status(502).json({ error: 'Número sem credenciais Z-API configuradas' })

  let providerId = null
  try {
    providerId = await sendWhatsAppText(num.instance_url, num.api_token, phone, text)
  } catch (err) {
    await supabase.from('whatsapp_messages').insert({
      user_id: ownerId, patient_id: patientId ?? null, phone, direction: 'outbound', body: text,
      status: 'failed', whatsapp_number_id: num.id,
    })
    return res.status(502).json({ error: err.message })
  }

  const { data: msg } = await supabase.from('whatsapp_messages').insert({
    user_id: ownerId, patient_id: patientId ?? null, phone, direction: 'outbound', body: text,
    status: 'sent', provider_message_id: providerId, whatsapp_number_id: num.id,
  }).select('id').single()

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

  // Casa o telefone a um paciente da clínica (estrito: ambíguo/novo → não atribui).
  const { data: patients } = await supabase.from('patients').select('id, phone').eq('user_id', ownerUserId)
  const patientId = matchPatientId(patients || [], parsed.phone)

  const { error } = await supabase.from('whatsapp_messages').insert({
    user_id: ownerUserId, patient_id: patientId, phone: parsed.phone, direction: 'inbound',
    body: parsed.text, status: 'read', provider_message_id: parsed.providerMessageId,
    whatsapp_number_id: num.id,
  })

  // 23505 = índice único (mensagem duplicada) → idempotente, ignora.
  if (error && error.code !== '23505') {
    console.error('whatsapp webhook insert error:', error.message)
  }

  return res.status(200).json({ ok: true })
}
