// src/lib/opportunitySuggestion.js
// Ações compartilhadas (pipeline + inbox) para a sugestão de estágio da IA.
// A IA só propõe ('pending'); aqui o humano confirma (move, auditado) ou descarta.
import { supabase } from './supabase.js'

// Confirma a sugestão: move a oportunidade (RPC auditado) e marca a sugestão como confirmada.
export async function confirmSuggestion(opp) {
  if (!opp?.id || !opp?.suggested_stage) return { error: 'Sugestão inválida' }
  const { error: moveErr } = await supabase.rpc('move_opportunity', {
    opp_id: opp.id, new_stage: opp.suggested_stage, move_source: 'manual',
  })
  if (moveErr) return { error: moveErr.message }
  const { error: updErr } = await supabase
    .from('opportunities')
    .update({ suggestion_status: 'confirmed' })
    .eq('id', opp.id)
  if (updErr) return { error: updErr.message }
  return { stage: opp.suggested_stage }
}

// Descarta a sugestão: nenhum movimento, só marca como dispensada.
export async function dismissSuggestion(opp) {
  if (!opp?.id) return { error: 'Oportunidade inválida' }
  const { error } = await supabase
    .from('opportunities')
    .update({ suggestion_status: 'dismissed' })
    .eq('id', opp.id)
  if (error) return { error: error.message }
  return { ok: true }
}
