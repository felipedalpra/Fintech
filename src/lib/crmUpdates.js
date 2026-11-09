// src/lib/crmUpdates.js
// Núcleo PURO das Atualizações da oportunidade (comentários internos estilo Monday).
// Fonte: as notas da oportunidade (opportunity_notes) — mesma tabela da Timeline e da coluna
// Observações; supabase/crm_workspace_phase3.sql acrescentou resposta (parent_id) e menções.
// Sem I/O e sem tema — testável em unit test.

// "@nome" de uma pessoa da equipe: parte antes do @ do e-mail (a equipe só tem e-mail cadastrado).
export function memberHandle(member) {
  const email = String(member?.member_email || '').trim()
  const local = email.split('@')[0] || ''
  return local.toLowerCase().replace(/[^a-z0-9._-]/g, '')
}

// Nome curto para exibir o autor.
export function memberName(memberLabel, userId) {
  const label = memberLabel?.[userId]
  if (!label) return 'Pessoa da equipe'
  return String(label).split('@')[0] || label
}

// Pessoas mencionáveis: [{ userId, handle, label }], sem handle repetido.
export function mentionables(members) {
  const seen = new Set()
  const out = []
  for (const m of members || []) {
    const handle = memberHandle(m)
    if (!m?.user_id || !handle || seen.has(handle)) continue
    seen.add(handle)
    out.push({ userId: m.user_id, handle, label: m.member_email || handle })
  }
  return out.sort((a, b) => a.handle.localeCompare(b.handle, 'pt-BR'))
}

const MENTION_RE = /(^|[^\w@.])@([a-z0-9._-]+)/gi

// Ids mencionados no texto (só quem é da equipe; sem repetição; ordem de aparição).
// Um "@nome" que não corresponde a ninguém é só texto.
export function extractMentions(text, people) {
  const byHandle = new Map((people || []).map(p => [p.handle, p.userId]))
  const ids = []
  for (const m of String(text || '').matchAll(MENTION_RE)) {
    const handle = m[2].toLowerCase().replace(/[.]+$/, '')
    const id = byHandle.get(handle)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

// Divide o texto em pedaços para destacar as menções: [{ text, mention?: userId }].
export function splitMentions(text, people) {
  const byHandle = new Map((people || []).map(p => [p.handle, p.userId]))
  const out = []
  const s = String(text || '')
  let last = 0
  for (const m of s.matchAll(MENTION_RE)) {
    const handle = m[2].toLowerCase().replace(/[.]+$/, '')
    const id = byHandle.get(handle)
    if (!id) continue
    const start = m.index + m[1].length
    const end = start + 1 + handle.length
    if (start > last) out.push({ text: s.slice(last, start) })
    out.push({ text: s.slice(start, end), mention: id })
    last = end
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}

// Termo de busca do "@" que está sendo digitado na posição do cursor, ou null.
// Ex.: "Falar com @lu|" → { query: 'lu', start: 10 }.
export function mentionQueryAt(text, caret) {
  const before = String(text || '').slice(0, caret)
  const m = before.match(/(^|[^\w@.])@([a-z0-9._-]*)$/i)
  if (!m) return null
  return { query: m[2].toLowerCase(), start: before.length - m[2].length - 1 }
}

// Substitui o "@termo" em digitação pelo "@handle " escolhido. Retorna { text, caret }.
export function insertMention(text, caret, start, handle) {
  const s = String(text || '')
  const next = `${s.slice(0, start)}@${handle} ${s.slice(caret)}`
  return { text: next, caret: start + handle.length + 2 }
}

// Fios em ordem cronológica: atualizações (sem parent) da mais antiga para a mais nova, cada uma
// com as respostas também em ordem. Resposta cujo original não veio (ex.: sem permissão) vira fio.
export function buildThreads(notes) {
  const list = [...(notes || [])].filter(n => n?.id)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)))
  const ids = new Set(list.map(n => n.id))
  const roots = []
  const replies = new Map()
  for (const n of list) {
    if (n.parent_id && ids.has(n.parent_id)) {
      if (!replies.has(n.parent_id)) replies.set(n.parent_id, [])
      replies.get(n.parent_id).push(n)
    } else roots.push(n)
  }
  return roots.map(r => ({ ...r, replies: replies.get(r.id) || [] }))
}

// Menções ao usuário que viram alerta no sino do CRM: feitas por OUTRA pessoa, nos últimos
// `days` dias. Mais recentes primeiro.
export function mentionAlerts(notes, userId, { now = Date.now(), days = 30 } = {}) {
  if (!userId) return []
  const since = now - days * 86400000
  return (notes || [])
    .filter(n => Array.isArray(n?.mentions) && n.mentions.includes(userId) && n.author_id !== userId)
    .filter(n => { const t = new Date(n.created_at).getTime(); return Number.isFinite(t) && t >= since })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}
