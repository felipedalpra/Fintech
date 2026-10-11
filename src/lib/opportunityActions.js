// src/lib/opportunityActions.js
// Ações de dados do pipeline (criar/editar/fechar). Mover de estágio NÃO fica aqui:
// é sempre pela RPC move_opportunity (auditada), chamada no componente.
import { supabase } from './supabase.js'

// Normaliza os campos editáveis vindos do form.
function cleanFields(f) {
  const tags = Array.isArray(f.tags) ? f.tags.map(t => String(t).trim()).filter(Boolean) : []
  const value = f.value === '' || f.value == null ? null : Number(f.value)
  return {
    title: (f.title || '').trim() || 'Oportunidade',
    value: Number.isFinite(value) ? value : null,
    source: (f.source || '').trim() || null,
    responsible_user_id: f.responsible_user_id || null,
    tags,
  }
}

// Cria uma oportunidade nova (status aberto). ownerId = dono/clínica (RLS).
export async function createOpportunity(ownerId, f) {
  if (!ownerId) return { error: 'Sessão inválida' }
  if (!f.patient_id) return { error: 'Selecione um paciente' }
  const row = {
    user_id: ownerId,
    patient_id: f.patient_id,
    stage: f.stage || 'primeiro_contato',
    status: 'aberto',
    stage_entered_at: new Date().toISOString(),
    ...cleanFields(f),
  }
  const { data, error } = await supabase.from('opportunities').insert(row)
    .select('id, title, stage, status, value, source, tags, responsible_user_id, stage_entered_at, patient_id, suggested_stage, suggested_reason, suggested_confidence, suggestion_status, patients(full_name, phone)')
    .single()
  if (error) return { error: error.message }
  return { opp: data }
}

// Atualiza campos editáveis (não mexe em estágio nem status).
export async function updateOpportunity(oppId, f) {
  if (!oppId) return { error: 'Oportunidade inválida' }
  const { error } = await supabase.from('opportunities').update(cleanFields(f)).eq('id', oppId)
  if (error) return { error: error.message }
  return { ok: true }
}

// Fecha a oportunidade como ganho/perdido (sai do board de abertas).
export async function setOpportunityOutcome(oppId, status, lostReason) {
  if (!oppId || !['ganho', 'perdido'].includes(status)) return { error: 'Status inválido' }
  const patch = { status, lost_reason: status === 'perdido' ? (lostReason || '').trim() || null : null }
  const { error } = await supabase.from('opportunities').update(patch).eq('id', oppId)
  if (error) return { error: error.message }
  return { ok: true }
}
