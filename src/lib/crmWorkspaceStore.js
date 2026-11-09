// src/lib/crmWorkspaceStore.js
// I/O do workspace de CRM (Supabase). Leituras toleram a migração ainda não aplicada
// (supabase/crm_workspace_phase1.sql): o workspace funciona com os campos atuais e só desliga
// o que depende das tabelas/colunas novas — nunca mostra erro genérico nem inventa dado.
import { supabase } from './supabase.js'
import { isCrmContactSchemaMissing } from './crmContact.js'
import { patchOpportunity } from './opportunityActions.js'
import { withCustomValue } from './crmWorkspace.js'

const BASE_FIELDS = 'id, title, stage, status, value, source, tags, lost_reason, stage_entered_at, created_at, updated_at, first_response_at, patient_id, responsible_user_id, suggested_stage, suggested_reason, suggested_confidence, suggestion_status'
const WORKSPACE_FIELDS = 'procedure_id, probability, next_action, next_action_due, expected_surgery_date, custom_values'
const PERSON_FIELDS = 'patients(full_name, phone)'
const CONTACT_FIELDS = 'contact_id, crm_contacts(full_name, phone, status)'

// Tabela/coluna/função inexistente (migração não aplicada) — distinto de erro de rede/permissão.
export function isSchemaMissing(error) {
  return ['42P01', '42703', '42883', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error?.code)
}

async function fetchAll(makeQuery) {
  const PAGE = 1000
  let from = 0
  let all = []
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    all = all.concat(data || [])
    if (!data || data.length < PAGE) return { data: all, error: null }
    from += PAGE
  }
}

function selectOpps(ownerId, fields) {
  return () => supabase.from('opportunities').select(fields)
    .eq('user_id', ownerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
}

// Todas as oportunidades da clínica (abertas, ganhas e perdidas).
// Retorna { opps, schemaReady, contactsReady, error }.
export async function loadOpportunities(ownerId) {
  const attempts = [
    { fields: `${BASE_FIELDS}, ${WORKSPACE_FIELDS}, ${PERSON_FIELDS}, ${CONTACT_FIELDS}`, schemaReady: true, contactsReady: true },
    { fields: `${BASE_FIELDS}, ${PERSON_FIELDS}, ${CONTACT_FIELDS}`, schemaReady: false, contactsReady: true },
    { fields: `${BASE_FIELDS}, ${PERSON_FIELDS}`, schemaReady: false, contactsReady: false },
  ]
  let lastError = null
  for (const a of attempts) {
    const { data, error } = await fetchAll(selectOpps(ownerId, a.fields))
    if (!error) {
      const opps = (data || []).map(o => ({
        ...o,
        tags: Array.isArray(o.tags) ? o.tags : [],
        custom_values: o.custom_values && typeof o.custom_values === 'object' ? o.custom_values : {},
      }))
      return { opps, schemaReady: a.schemaReady, contactsReady: a.contactsReady, error: null }
    }
    lastError = error
    if (!isSchemaMissing(error) && !isCrmContactSchemaMissing(error)) break
  }
  return { opps: [], schemaReady: false, contactsReady: false, error: lastError?.message || 'Erro ao carregar oportunidades' }
}

// Configuração do workspace. Cada parte é opcional: { data, available }.
export async function loadWorkspaceMeta(ownerId) {
  const [team, stages, fields, views, procedures] = await Promise.all([
    supabase.rpc('clinic_team'),
    supabase.from('crm_stage_settings').select('stage_key, label, color, position, probability').eq('user_id', ownerId),
    supabase.from('crm_custom_fields').select('id, label, field_type, options, position, width, archived_at, created_at')
      .eq('user_id', ownerId).is('archived_at', null).order('position', { ascending: true }).order('created_at', { ascending: true }),
    supabase.from('crm_views').select('id, owner_id, name, scope, view_type, config, position, created_at, updated_at')
      .eq('user_id', ownerId).order('position', { ascending: true }).order('created_at', { ascending: true }),
    // Catálogo de procedimentos (só o necessário para a coluna). Não depende do carregamento do
    // financeiro, que é mais pesado e varia por perfil.
    supabase.from('procedures').select('id, name, color').eq('user_id', ownerId).order('name', { ascending: true }),
  ])
  const part = (res) => ({ data: res.error ? [] : (res.data || []), available: !res.error, error: res.error && !isSchemaMissing(res.error) ? res.error.message : null })
  return {
    members: (team.data || []).filter(m => m.user_id),
    stageSettings: part(stages),
    customFields: part(fields),
    views: part(views),
    procedures: part(procedures),
  }
}

// Último contato DERIVADO (RPC crm_last_contact). { map: {oppId: {at, source}}, available }.
export async function loadLastContact(oppIds) {
  const map = {}
  const ids = [...new Set(oppIds || [])]
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data, error } = await supabase.rpc('crm_last_contact', { p_opportunity_ids: chunk })
    if (error) return { map: {}, available: false }
    for (const r of data || []) map[r.opportunity_id] = { at: r.last_contact_at, source: r.last_contact_source }
  }
  return { map, available: true }
}

// Tarefas vinculadas a oportunidades (subitens). Fonte única para os subitens, o contador e as
// atrasadas (derivadas em crmWorkspace.overdueTaskCounts). { tasks, available }.
const SUBITEM_FIELDS = 'id, opportunity_id, patient_id, title, due_date, due_time, task_type, status, outcome, assigned_user_id, done_at, created_at'
export async function loadOpportunityTasks(ownerId) {
  const { data, error } = await fetchAll(() => supabase.from('tasks').select(SUBITEM_FIELDS)
    .eq('user_id', ownerId).not('opportunity_id', 'is', null)
    .order('created_at', { ascending: true }).order('id', { ascending: true }))
  if (error) return { tasks: [], available: false }
  return { tasks: data || [], available: true }
}

// Quantidade de observações (notas) por oportunidade: { oppId: quantidade }.
export async function loadNoteCounts(ownerId) {
  const { data, error } = await fetchAll(() => supabase.from('opportunity_notes').select('opportunity_id')
    .eq('user_id', ownerId).order('id', { ascending: true }))
  if (error) return {}
  const out = {}
  for (const n of data || []) out[n.opportunity_id] = (out[n.opportunity_id] || 0) + 1
  return out
}

// ---------------------------------------------------------------------------
// Atualizações (comentários) da oportunidade = opportunity_notes.
// ---------------------------------------------------------------------------
// { notes, threaded, error }. threaded=false: migração da Fase 3 ainda não aplicada (sem
// resposta/menção) — as atualizações continuam aparecendo e podem ser registradas.
export async function loadOpportunityUpdates(oppId) {
  const full = await supabase.from('opportunity_notes')
    .select('id, opportunity_id, body, author_id, parent_id, mentions, created_at')
    .eq('opportunity_id', oppId).order('created_at', { ascending: true }).order('id', { ascending: true })
  if (!full.error) return { notes: full.data || [], threaded: true, error: null }
  if (!isSchemaMissing(full.error)) return { notes: [], threaded: false, error: friendlyError(full.error) }
  const basic = await supabase.from('opportunity_notes')
    .select('id, opportunity_id, body, author_id, created_at')
    .eq('opportunity_id', oppId).order('created_at', { ascending: true }).order('id', { ascending: true })
  if (basic.error) return { notes: [], threaded: false, error: friendlyError(basic.error) }
  return { notes: basic.data || [], threaded: false, error: null }
}

// Menções ao usuário (sino do CRM). Sem a migração, não há menções: lista vazia.
export async function loadMentions(ownerId, userId, sinceIso) {
  if (!ownerId || !userId) return []
  const { data, error } = await supabase.from('opportunity_notes')
    .select('id, opportunity_id, body, author_id, mentions, created_at, opportunities(title, patients(full_name))')
    .eq('user_id', ownerId).contains('mentions', [userId]).gte('created_at', sinceIso)
    .order('created_at', { ascending: false }).limit(50)
  return error ? [] : (data || [])
}

// Cria as 3 visualizações iniciais da clínica (uma única vez — ver crm_workspace_phase3.sql).
// Retorna quantas foram criadas (0 quando já existiam ou a migração não foi aplicada).
export async function ensureDefaultViews() {
  const { data, error } = await supabase.rpc('crm_ensure_default_views')
  if (error) return 0
  return Number(data) || 0
}

// Grava UM campo personalizado sem sobrescrever os demais: relê o objeto atual do banco,
// aplica só esta chave e grava. Reduz a janela de corrida entre duas pessoas editando campos
// diferentes da mesma oportunidade. Retorna { custom_values } ou { error }.
export async function saveCustomValue(oppId, fieldId, value) {
  const { data, error } = await supabase.from('opportunities').select('custom_values').eq('id', oppId).maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Oportunidade não encontrada.' }
  const next = withCustomValue(data.custom_values, fieldId, value)
  const res = await patchOpportunity(oppId, { custom_values: next })
  if (res.error) return { error: res.error }
  return { custom_values: next }
}

// ---------------------------------------------------------------------------
// Campos personalizados (definição)
// ---------------------------------------------------------------------------
export async function createCustomField(ownerId, field, position) {
  const { data, error } = await supabase.from('crm_custom_fields')
    .insert({ user_id: ownerId, label: field.label, field_type: field.field_type, options: field.options || [], position })
    .select('id, label, field_type, options, position, width, archived_at, created_at')
    .single()
  if (error) return { error: friendlyError(error) }
  return { field: data }
}

export async function updateCustomField(fieldId, patch) {
  const allowed = {}
  for (const k of ['label', 'field_type', 'options', 'position', 'width']) if (k in patch) allowed[k] = patch[k]
  const { data, error } = await supabase.from('crm_custom_fields').update(allowed).eq('id', fieldId)
    .select('id, label, field_type, options, position, width, archived_at, created_at')
  if (error) return { error: friendlyError(error) }
  if (!data?.length) return { error: 'Sem permissão para alterar esta coluna.' }
  return { field: data[0] }
}

// Arquivar (nunca apagar): a coluna some, os valores já gravados permanecem nas oportunidades.
export async function archiveCustomField(fieldId) {
  const { data, error } = await supabase.from('crm_custom_fields')
    .update({ archived_at: new Date().toISOString() }).eq('id', fieldId).select('id')
  if (error) return { error: friendlyError(error) }
  if (!data?.length) return { error: 'Sem permissão para remover esta coluna.' }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Visualizações salvas
// ---------------------------------------------------------------------------
const VIEW_FIELDS = 'id, owner_id, name, scope, view_type, config, position, created_at, updated_at'

export async function createView(ownerId, { name, scope, config, position }) {
  const { data, error } = await supabase.from('crm_views')
    .insert({ user_id: ownerId, name, scope, view_type: 'table', config, position })
    .select(VIEW_FIELDS).single()
  if (error) return { error: friendlyError(error) }
  return { view: data }
}

export async function updateView(viewId, patch) {
  const allowed = {}
  // scope/owner_id: tornar pessoal ↔ compartilhada (a RLS de crm_views decide quem pode).
  for (const k of ['name', 'config', 'position', 'scope', 'owner_id']) if (k in patch) allowed[k] = patch[k]
  const { data, error } = await supabase.from('crm_views').update(allowed).eq('id', viewId).select(VIEW_FIELDS)
  if (error) return { error: friendlyError(error) }
  if (!data?.length) return { error: 'Sem permissão para alterar esta visualização.' }
  return { view: data[0] }
}

export async function deleteView(viewId) {
  const { data, error } = await supabase.from('crm_views').delete().eq('id', viewId).select('id')
  if (error) return { error: friendlyError(error) }
  if (!data?.length) return { error: 'Sem permissão para excluir esta visualização.' }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Etapas (rótulo/cor/ordem/probabilidade por clínica)
// ---------------------------------------------------------------------------
export async function saveStageSettings(ownerId, stages) {
  const rows = stages.map((s, i) => ({
    user_id: ownerId,
    stage_key: s.key,
    label: s.label,
    color: s.color,
    position: i,
    probability: s.probability,
    updated_at: new Date().toISOString(),
  }))
  const { data, error } = await supabase.from('crm_stage_settings')
    .upsert(rows, { onConflict: 'user_id,stage_key' })
    .select('stage_key, label, color, position, probability')
  if (error) return { error: friendlyError(error) }
  if ((data || []).length !== rows.length) return { error: 'Sem permissão para configurar as etapas.' }
  return { settings: data }
}

function friendlyError(error) {
  if (error?.code === '42501') return 'Sem permissão para esta ação.'
  if (isSchemaMissing(error)) return 'Recurso indisponível: a atualização do banco do CRM ainda não foi aplicada.'
  return error?.message || 'Erro ao salvar.'
}
