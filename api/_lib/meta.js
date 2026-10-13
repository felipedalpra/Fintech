// api/_lib/meta.js — Integração Meta Ads (Lead Ads realtime). Partes PURAS testáveis + fetch do lead.
// O webhook é servido por api/whatsapp.js?action=meta-webhook (limite de 12 funções no Vercel Hobby).
import crypto from 'crypto'

// Extrai as notificações de leadgen do payload do webhook do Meta.
// Payload: { object:'page', entry:[{ id:pageId, changes:[{ field:'leadgen', value:{ leadgen_id, page_id, form_id, ad_id, campaign_id, created_time } }] }] }
export function parseLeadgenWebhook(body) {
  const out = []
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      if (change?.field !== 'leadgen') continue
      const v = change.value || {}
      out.push({
        leadgenId: v.leadgen_id,
        pageId: v.page_id || entry.id,
        formId: v.form_id || null,
        adId: v.ad_id || null,
        campaignId: v.campaign_id || null,
        createdTime: v.created_time || null,
      })
    }
  }
  return out.filter(l => l.leadgenId)
}

// Valida a assinatura X-Hub-Signature-256 (HMAC SHA256 do corpo cru com o App Secret).
export function verifyWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody || '', 'utf8').digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected))
  } catch {
    return false
  }
}

// Mapeia os field_data do Lead Ad (nomes variam por formulário) para { name, phone, email }.
const FIELD_ALIASES = {
  name: ['full_name', 'name', 'nome', 'nome_completo', 'seu_nome'],
  phone: ['phone_number', 'phone', 'telefone', 'celular', 'whatsapp'],
  email: ['email', 'e-mail', 'e_mail'],
}
export function mapLeadFields(fieldData) {
  const map = {}
  for (const f of fieldData || []) {
    const key = String(f?.name || '').toLowerCase()
    if (!key) continue
    map[key] = Array.isArray(f.values) ? f.values[0] : f.values
  }
  const pick = aliases => {
    for (const a of aliases) if (map[a]) return String(map[a])
    return ''
  }
  return { name: pick(FIELD_ALIASES.name), phone: pick(FIELD_ALIASES.phone), email: pick(FIELD_ALIASES.email) }
}

// Busca o lead completo na Graph API a partir do leadgen_id (o webhook só manda o id).
export async function fetchLeadData(leadgenId, accessToken, apiVersion) {
  if (!leadgenId || !accessToken || !/^v\d+\.\d+$/.test(apiVersion || '')) {
    throw new Error('Meta lead fetch configuration is incomplete')
  }
  const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(leadgenId)}`
    + '?fields=field_data,created_time,ad_id,form_id,campaign_id'
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const err = await res.text().catch(() => String(res.status))
    throw new Error(`Meta lead fetch error: ${err}`)
  }
  return res.json()
}
