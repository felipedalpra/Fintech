// api/_lib/whatsappAutomations.js
// Motor das automações de saída de WhatsApp (lembrete + follow-up).
// Parte PURA (testável): addDays, formatBR, renderTemplate, planReminders, planFollowups.
// Parte orquestração: runWhatsAppAutomations(admin, { todayISO }) — lê fontes, agenda, envia.
// Idempotente: guard-log (índice único) antes de enviar. Fail-safe: nunca lança pra cima.
import { sendWhatsAppText } from './whatsappClient.js'

// ---------- Puro ----------

// Soma n dias a uma data 'YYYY-MM-DD' sem drift de fuso (parse em UTC ao meio-dia).
export function addDays(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  dt.setUTCDate(dt.getUTCDate() + Number(n || 0))
  return dt.toISOString().slice(0, 10)
}

// 'YYYY-MM-DD' -> 'DD/MM/YYYY'.
export function formatBR(iso) {
  const [y, m, d] = String(iso).split('-')
  if (!y || !m || !d) return String(iso)
  return `${d}/${m}/${y}`
}

// Data de hoje em America/Sao_Paulo como 'YYYY-MM-DD'.
export function todayInBRT(now = new Date()) {
  // en-CA formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

function firstName(full) {
  return String(full || '').trim().split(/\s+/)[0] || 'tudo bem'
}

// Substitui {var} por valor; variáveis desconhecidas e faltantes viram ''.
export function renderTemplate(template, vars = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] == null ? '' : String(vars[key]),
  )
}

// Monta a lista de mensagens a enviar para uma data-alvo.
// events: [{ id, ref_type, patient_id, start_time, patients: { full_name, phone } }]
function planEvents({ events, template, targetDate }) {
  const out = []
  for (const e of events || []) {
    const phone = e.patients?.phone
    if (!phone) continue // sem telefone válido = não envia
    out.push({
      ref_type: e.ref_type,
      ref_id: e.id,
      patient_id: e.patient_id ?? null,
      phone,
      message: renderTemplate(template, {
        patient_name: firstName(e.patients?.full_name),
        date: formatBR(targetDate),
        time: e.start_time ? String(e.start_time).slice(0, 5) : '',
      }),
    })
  }
  return out
}

export function planReminders({ events, template, targetDate }) {
  return planEvents({ events, template, targetDate })
}

export function planFollowups({ events, template, targetDate }) {
  return planEvents({ events, template, targetDate })
}

// ---------- Orquestração ----------

const EVENT_SELECT = 'id, date, start_time, patient_id, patients(full_name, phone)'

async function fetchEvents(admin, userId, targetDate, { consultations = true, surgeries = true } = {}) {
  const jobs = []
  if (consultations) jobs.push(admin.from('consultations').select(EVENT_SELECT).eq('user_id', userId).eq('date', targetDate).not('patient_id', 'is', null))
  else jobs.push(Promise.resolve({ data: [] }))
  if (surgeries) jobs.push(admin.from('surgeries').select(EVENT_SELECT).eq('user_id', userId).eq('date', targetDate).not('patient_id', 'is', null))
  else jobs.push(Promise.resolve({ data: [] }))

  const [cRes, sRes] = await Promise.all(jobs)
  return [
    ...((cRes.data || []).map(e => ({ ...e, ref_type: 'consultation' }))),
    ...((sRes.data || []).map(e => ({ ...e, ref_type: 'surgery' }))),
  ]
}

// Guard-log + envio de uma mensagem. Idempotente (índice único (user_id, type, ref_id, target_date)).
async function dispatchOne(admin, { userId, number, item, automationType, targetDate }, summary) {
  const match = { user_id: userId, automation_type: automationType, ref_id: item.ref_id, target_date: targetDate }

  // 1) Guarda o log ANTES de enviar. Se já existe (23505) → já tratado, pula.
  const { error: logErr } = await admin.from('whatsapp_automation_log').insert({
    ...match, ref_type: item.ref_type, phone: item.phone, status: 'pending',
  })
  if (logErr) {
    if (logErr.code === '23505') { summary.skipped += 1; return }
    throw logErr
  }

  // 2) Envia.
  try {
    const providerId = await sendWhatsAppText(number.instance_url, number.api_token, item.phone, item.message)
    await admin.from('whatsapp_messages').insert({
      user_id: userId, patient_id: item.patient_id, phone: item.phone, direction: 'outbound',
      body: item.message, status: 'sent', provider_message_id: providerId, whatsapp_number_id: number.id,
    })
    await admin.from('whatsapp_automation_log').update({ status: 'sent' }).match(match)
    summary.sent += 1
  } catch (err) {
    await admin.from('whatsapp_automation_log').update({ status: 'failed' }).match(match)
    summary.failed += 1
  }
}

async function runForOwner(admin, auto, todayISO, summary) {
  // Sem número de envio configurado → pronto-pra-credencial: não envia nada (skip silencioso).
  if (!auto.whatsapp_number_id) return
  const { data: number } = await admin
    .from('whatsapp_numbers')
    .select('id, instance_url, api_token')
    .eq('id', auto.whatsapp_number_id)
    .maybeSingle()
  if (!number || !number.instance_url || !number.api_token) return

  // LEMBRETE: eventos de (hoje + days_before).
  if (auto.reminder_enabled) {
    const targetDate = addDays(todayISO, auto.reminder_days_before)
    const events = await fetchEvents(admin, auto.user_id, targetDate)
    const planned = planReminders({ events, template: auto.reminder_template, targetDate })
    for (const item of planned) {
      await dispatchOne(admin, { userId: auto.user_id, number, item, automationType: 'reminder', targetDate }, summary)
    }
  }

  // FOLLOW-UP: consultas de (hoje − days_after).
  if (auto.followup_enabled) {
    const targetDate = addDays(todayISO, -auto.followup_days_after)
    const events = await fetchEvents(admin, auto.user_id, targetDate, { consultations: true, surgeries: false })
    const planned = planFollowups({ events, template: auto.followup_template, targetDate })
    for (const item of planned) {
      await dispatchOne(admin, { userId: auto.user_id, number, item, automationType: 'followup', targetDate }, summary)
    }
  }
}

// Ponto de entrada do cron/dispatch. Nunca lança: erro de um dono não afeta os outros nem o cron.
export async function runWhatsAppAutomations(admin, { todayISO, ownerId = null } = {}) {
  const today = todayISO || todayInBRT()
  const summary = { owners: 0, sent: 0, skipped: 0, failed: 0 }

  let query = admin.from('whatsapp_automations').select('*')
  if (ownerId) query = query.eq('user_id', ownerId)
  const { data: autos, error } = await query
  if (error) { console.error('whatsapp automations load error:', error.message); return summary }

  for (const auto of autos || []) {
    summary.owners += 1
    try {
      await runForOwner(admin, auto, today, summary)
    } catch (e) {
      console.error('whatsapp automation owner error', auto.user_id, e?.message)
    }
  }
  return summary
}
