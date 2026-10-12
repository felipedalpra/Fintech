// src/lib/timeline.js
// Monta a timeline da oportunidade a partir das FONTES reais (sem tabela de evento paralela).
// Função PURA e testável — é a peça de fidedignidade: a timeline nunca inventa nem diverge.

const STAGE_LABELS = {
  primeiro_contato: 'Primeiro Contato',
  consulta_agendada: 'Consulta Agendada',
  consultado: 'Consultado',
  orcamento_enviado: 'Orçamento Enviado',
  reserva_paga: 'Reserva Paga',
  cirurgia_marcada: 'Cirurgia Marcada',
  cirurgia_feita: 'Cirurgia Feita',
  follow_up: 'Follow-up',
}
const stageLabel = k => STAGE_LABELS[k] || k || '—'

function ts(v) {
  const t = v ? new Date(v).getTime() : NaN
  return Number.isFinite(t) ? t : 0
}

// Recebe as fontes já carregadas e devolve eventos { at, kind, icon, text, meta } (desc por data).
export function buildTimeline({ opp, stageHistory = [], messages = [], tasks = [], notes = [] } = {}) {
  const events = []

  if (opp?.created_at) {
    events.push({ at: opp.created_at, kind: 'created', icon: '⭐', text: 'Oportunidade criada', meta: opp.source || null })
  }

  for (const h of stageHistory) {
    const via = h.source === 'automacao' ? ' (automação)' : ''
    const label = h.from_stage
      ? `Movida de ${stageLabel(h.from_stage)} → ${stageLabel(h.to_stage)}`
      : `Entrou em ${stageLabel(h.to_stage)}`
    events.push({ at: h.created_at, kind: 'stage', icon: '🟢', text: label + via, meta: null })
  }

  for (const m of messages) {
    const who = m.direction === 'outbound' ? 'Clínica' : 'Paciente'
    events.push({ at: m.created_at, kind: 'whatsapp', icon: '💬', text: `${who}: ${String(m.body || '').slice(0, 140)}`, meta: null })
  }

  for (const t of tasks) {
    events.push({ at: t.created_at, kind: 'task_created', icon: '📋', text: `Tarefa criada: ${t.title}`, meta: null })
    if (t.status === 'feita' && t.done_at) {
      events.push({ at: t.done_at, kind: 'task_done', icon: '✅', text: `Tarefa concluída: ${t.title}`, meta: null })
    }
  }

  for (const n of notes) {
    events.push({ at: n.created_at, kind: 'note', icon: '📝', text: n.body, meta: 'nota' })
  }

  if (opp?.status === 'ganho') {
    events.push({ at: opp.updated_at || opp.created_at, kind: 'won', icon: '🏆', text: 'Oportunidade ganha', meta: null })
  } else if (opp?.status === 'perdido') {
    events.push({ at: opp.updated_at || opp.created_at, kind: 'lost', icon: '🚫', text: 'Oportunidade perdida', meta: opp.lost_reason || null })
  }

  return events.sort((a, b) => ts(b.at) - ts(a.at))
}

export { stageLabel }
