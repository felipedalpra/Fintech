// api/_lib/whatsappAutomations.js
// Motor das automações de saída de WhatsApp (lembrete + follow-up).
// Parte PURA (testável): addDays, formatBR, renderTemplate, planReminders, planFollowups.
// Parte orquestração: runWhatsAppAutomations(admin, { todayISO }) — lê fontes, agenda, envia.
// Idempotente: guard-log (índice único) antes de enviar. Fail-safe: nunca lança pra cima.
import { providerReady, sendProviderText, whatsappProvider } from './whatsappProvider.js'

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

// Formata número como moeda BRL de forma determinística: 1234.5 -> 'R$ 1.234,50'.
export function formatBRL(value) {
  const n = Number(value || 0)
  const [intPart, decPart] = Math.abs(n).toFixed(2).split('.')
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '-' : ''}R$ ${withThousands},${decPart}`
}

// Vencimento canônico de uma conta a receber (regime de VENCIMENTO, nunca competência/caixa).
// Replica exatamente o backfill de competence_date_migration.sql → robusto mesmo sem a migração.
export function receivableDueDate(row, source) {
  if (source === 'surgery') return row.due_date || row.date
  return row.due_date || row.forecast_payment_date || row.date
}

// Substitui {var} por valor; variáveis desconhecidas e faltantes viram ''.
export function renderTemplate(template, vars = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] == null ? '' : String(vars[key]),
  )
}

// Monta a lista de mensagens a enviar para uma data-alvo.
// events: [{ id, ref_type, patient_id, start_time, patients: { full_name, phone } }]
function planEvents({ events, template, targetDate, extraVars = {} }) {
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
        ...extraVars,
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

// Link de anamnese: como o lembrete, mas injeta {link} (base configurada pela clínica).
export function planAnamnese({ events, template, targetDate, link }) {
  return planEvents({ events, template, targetDate, extraVars: { link: link || '' } })
}

// Cobrança emitida cujo vencimento cai na data-alvo. Só cobranças ativas entram na consulta.
export function planPayments({ items, template, targetDueDate }) {
  const out = []
  for (const it of items || []) {
    if (it.due_date !== targetDueDate) continue
    const phone = it.patients?.phone
    if (!phone) continue
    out.push({
      ref_type: it.source,
      ref_id: it.id,
      patient_id: it.patient_id ?? null,
      phone,
      message: renderTemplate(template, {
        patient_name: firstName(it.patients?.full_name),
        value: formatBRL(it.value),
        date: formatBR(targetDueDate),
        payment_link:it.payment_link || '',
        pix_code:it.pix_payload || '',
        payment_type:it.billing_type === 'PIX' ? 'Pix' : 'boleto',
      }),
    })
  }
  return out
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

// Cobranças efetivamente emitidas e ainda ativas. Quando o webhook recebe/confirma, o status sai
// deste filtro e a régua para automaticamente, sem depender de leitura eventual do lançamento.
async function fetchReceivables(admin, userId) {
  const { data, error } = await admin.from('billing_charges')
    .select('id,billing_type,amount,due_date,invoice_url,bank_slip_url,pix_payload,patient_id,patients(full_name,phone)')
    .eq('user_id', userId)
    .in('status', ['pending','overdue'])
  if (error) throw error
  return (data || []).map(row => ({
    ...row,
    source:'billing_charge',
    value:Number(row.amount || 0),
    payment_link:row.bank_slip_url || row.invoice_url || '',
  }))
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
    const providerId = await sendProviderText(number, item.phone, item.message)
    const { error: messageError } = await admin.from('whatsapp_messages').insert({
      user_id: userId, patient_id: item.patient_id, phone: item.phone, direction: 'outbound',
      body: item.message, status: 'sent', provider_message_id: providerId, whatsapp_number_id: number.id,
      provider: whatsappProvider(number),
    })
    // Com notifySentByMe ativo, o webhook pode persistir a mesma mensagem antes
    // desta resposta de envio. A restrição única confirma que ela já está salva.
    if (messageError && messageError.code !== '23505') throw messageError
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
  let numberResult = await admin
    .from('whatsapp_numbers')
    .select('id, instance_url, api_token, provider, provider_instance_name')
    .eq('id', auto.whatsapp_number_id)
    .maybeSingle()
  if (['PGRST204', '42703'].includes(numberResult.error?.code)) {
    numberResult = await admin.from('whatsapp_numbers')
      .select('id, instance_url, api_token')
      .eq('id', auto.whatsapp_number_id)
      .maybeSingle()
  }
  const number = numberResult.data ? { provider: 'zapi', ...numberResult.data } : null
  if (!number || !providerReady(number)) return

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

  // LINK DE ANAMNESE: N dias antes da consulta, com o link configurado pela clínica.
  // Sem link configurado → pronto-pra-credencial: não envia (config fica salva).
  if (auto.anamnese_enabled && auto.anamnese_link) {
    const targetDate = addDays(todayISO, auto.anamnese_days_before)
    const events = await fetchEvents(admin, auto.user_id, targetDate, { consultations: true, surgeries: false })
    const planned = planAnamnese({ events, template: auto.anamnese_template, targetDate, link: auto.anamnese_link })
    for (const item of planned) {
      await dispatchOne(admin, { userId: auto.user_id, number, item, automationType: 'anamnese', targetDate }, summary)
    }
  }

  // COBRANÇA: contas a receber cujo VENCIMENTO cai em (hoje − offset). offset>0 = dias após o vencimento.
  if (auto.payment_enabled) {
    const targetDueDate = addDays(todayISO, -Number(auto.payment_offset_days || 0))
    const items = await fetchReceivables(admin, auto.user_id)
    const planned = planPayments({ items, template: auto.payment_template, targetDueDate })
    for (const item of planned) {
      await dispatchOne(admin, { userId: auto.user_id, number, item, automationType: 'payment', targetDate: targetDueDate }, summary)
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
