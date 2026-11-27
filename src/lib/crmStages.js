// src/lib/crmStages.js
// Etapas do funil comercial — fonte ÚNICA de chave/rótulo/cor/probabilidade padrão no frontend.
// As chaves padrão são estáveis para preservar histórico e automações. Além delas, cada clínica
// pode ter etapas próprias em crm_stage_settings. PURO: sem I/O, sem tema.
import { STAGE_PROB } from './crmMetrics.js'

export const DEFAULT_STAGES = [
  { key: 'primeiro_contato',  label: 'Primeiro Contato',  color: '#94a3b8' },
  { key: 'consulta_agendada', label: 'Consulta Agendada', color: '#6366f1' },
  { key: 'consultado',        label: 'Consultado',        color: '#0ea5e9' },
  { key: 'encaminhado_nutrologia', label: 'Encaminhado para Nutrologia', color: '#06b6d4' },
  { key: 'exames_prontos',    label: 'Exames Prontos',     color: '#84cc16' },
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
// Etapas arquivadas não aparecem no quadro. Etapas que não são padrão são customizadas.
export function resolveStages(settings = []) {
  const valid = (settings || []).filter(s => s && s.stage_key && !s.archived_at)
  const byKey = new Map(valid.map(s => [s.stage_key, s]))
  const archived = new Set((settings || []).filter(s => s && s.stage_key && s.archived_at).map(s => s.stage_key))
  const defaults = DEFAULT_STAGES
    .filter(stage => !archived.has(stage.key))
    .map((stage, index) => {
      const custom = byKey.get(stage.key) || {}
      const label = typeof custom.label === 'string' && custom.label.trim() ? custom.label.trim() : stage.label
      const color = /^#[0-9a-f]{6}$/i.test(custom.color || '') ? custom.color : stage.color
      const probability = custom.probability != null && Number.isFinite(Number(custom.probability))
        ? Number(custom.probability)
        : toPercent(STAGE_PROB[stage.key])
      const position = Number.isFinite(Number(custom.position)) && custom.position != null ? Number(custom.position) : index
      return { key: stage.key, label, color, probability, position, defaultIndex: index, system: true }
    })
  const custom = valid
    .filter(s => !STAGE_KEYS.includes(s.stage_key))
    .map((s, index) => ({
      key: s.stage_key,
      label: typeof s.label === 'string' && s.label.trim() ? s.label.trim() : s.stage_key,
      color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#64748b',
      probability: s.probability != null && Number.isFinite(Number(s.probability)) ? Number(s.probability) : 0,
      position: Number.isFinite(Number(s.position)) ? Number(s.position) : DEFAULT_STAGES.length + index,
      defaultIndex: DEFAULT_STAGES.length + index,
      system: false,
    }))
  return [...defaults, ...custom]
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
