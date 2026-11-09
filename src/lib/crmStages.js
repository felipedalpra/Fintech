// src/lib/crmStages.js
// Etapas do funil comercial — fonte ÚNICA de chave/rótulo/cor/probabilidade padrão no frontend.
// As CHAVES são as 8 da constraint opportunities_stage_check (não mudam aqui). Rótulo, cor, ordem e
// probabilidade podem ser personalizados por clínica em crm_stage_settings; sem configuração,
// valem os padrões abaixo. PURO: sem I/O, sem tema.
import { STAGE_PROB } from './crmMetrics.js'

export const DEFAULT_STAGES = [
  { key: 'primeiro_contato',  label: 'Primeiro Contato',  color: '#94a3b8' },
  { key: 'consulta_agendada', label: 'Consulta Agendada', color: '#6366f1' },
  { key: 'consultado',        label: 'Consultado',        color: '#0ea5e9' },
  { key: 'orcamento_enviado', label: 'Orçamento Enviado', color: '#f59e0b' },
  { key: 'reserva_paga',      label: 'Reserva Paga',      color: '#10b981' },
  { key: 'cirurgia_marcada',  label: 'Cirurgia Marcada',  color: '#14b8a6' },
  { key: 'cirurgia_feita',    label: 'Cirurgia Feita',    color: '#22c55e' },
  { key: 'follow_up',         label: 'Follow-up',         color: '#8b5cf6' },
]

export const STAGE_KEYS = DEFAULT_STAGES.map(s => s.key)

// Situação da oportunidade (opportunities.status). Ganho/perdido não são etapas — são desfechos.
export const OUTCOMES = {
  aberto:  { key: 'aberto',  label: 'Aberta',  color: '#3b82f6' },
  ganho:   { key: 'ganho',   label: 'Ganhos',  color: '#16a34a' },
  perdido: { key: 'perdido', label: 'Perdidos', color: '#ef4444' },
  // Arquivada (supabase/crm_workspace_phase2.sql): fora do quadro, das somas e das buscas de
  // "oportunidade aberta" do servidor; restaurar devolve o status anterior.
  arquivado: { key: 'arquivado', label: 'Arquivadas', color: '#64748b' },
}

function toPercent(fraction) {
  return Math.round(Number(fraction || 0) * 1000) / 10
}

// Junta os padrões com as personalizações da clínica. Linha ausente/campo nulo = padrão.
// Retorna as 8 etapas ordenadas, cada uma com { key, label, color, probability (0–100), position }.
export function resolveStages(settings = []) {
  const byKey = new Map((settings || []).filter(s => s && STAGE_KEYS.includes(s.stage_key)).map(s => [s.stage_key, s]))
  return DEFAULT_STAGES
    .map((stage, index) => {
      const custom = byKey.get(stage.key) || {}
      const label = typeof custom.label === 'string' && custom.label.trim() ? custom.label.trim() : stage.label
      const color = /^#[0-9a-f]{6}$/i.test(custom.color || '') ? custom.color : stage.color
      const probability = custom.probability != null && Number.isFinite(Number(custom.probability))
        ? Number(custom.probability)
        : toPercent(STAGE_PROB[stage.key])
      const position = Number.isFinite(Number(custom.position)) && custom.position != null ? Number(custom.position) : index
      return { key: stage.key, label, color, probability, position, defaultIndex: index }
    })
    .sort((a, b) => a.position - b.position || a.defaultIndex - b.defaultIndex)
}

export function stageMap(stages) {
  return Object.fromEntries((stages || []).map(s => [s.key, s]))
}

// Probabilidade efetiva (0–100) de uma oportunidade:
//   ganho → 100, perdido → 0; aberta → a definida na oportunidade ou, se nula, a da etapa.
export function effectiveProbability(opp, stagesByKey) {
  if (!opp) return null
  if (opp.status === 'ganho') return 100
  if (opp.status === 'perdido') return 0
  if (opp.probability != null && opp.probability !== '' && Number.isFinite(Number(opp.probability))) {
    return Number(opp.probability)
  }
  const stage = stagesByKey?.[opp.stage]
  if (stage) return stage.probability
  const fallback = STAGE_PROB[opp.stage]
  return fallback == null ? null : toPercent(fallback)
}

// Probabilidades por etapa no formato de crmMetrics (fração 0–1), a partir das etapas resolvidas.
export function stageProbFractions(stages) {
  return Object.fromEntries((stages || []).map(s => [s.key, Number(s.probability) / 100]))
}
