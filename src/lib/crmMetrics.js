// src/lib/crmMetrics.js
// Métricas PURAS do painel de CRM (sem I/O, testáveis). Derivadas só das oportunidades
// e do histórico de estágios — NÃO cruzam com o financeiro (conversão ≠ faturamento).

// Probabilidade de fechamento por etapa (para o pipeline ponderado). Ajustável no futuro.
export const STAGE_PROB = {
  primeiro_contato: 0.1,
  consulta_agendada: 0.25,
  consultado: 0.4,
  orcamento_enviado: 0.6,
  reserva_paga: 0.85,
  cirurgia_marcada: 0.95,
  cirurgia_feita: 1,
  follow_up: 1,
}

const DAY = 86400000

// Índice "máximo alcançado" de uma oportunidade na ordem do funil.
// Ganho → alcançou o fim; estágio fora da ordem (ex.: follow_up pós-venda) → também o fim
// (senão não entraria em nenhuma etapa e o funil não bateria com o total de leads).
function reachedIndex(opp, order) {
  if (opp.status === 'ganho') return order.length - 1
  const i = order.indexOf(opp.stage)
  return i === -1 ? order.length - 1 : i
}

// Alcance por etapa + taxa de conversão vs. etapa anterior.
export function funnelCounts(opps, order) {
  const reached = order.map(() => 0)
  for (const o of opps || []) {
    const idx = reachedIndex(o, order)
    for (let i = 0; i <= idx; i++) reached[i]++
  }
  return order.map((stage, i) => ({
    stage,
    reached: reached[i],
    conv: i === 0 ? null : (reached[i - 1] ? reached[i] / reached[i - 1] : null),
  }))
}

// Pipeline ponderado: Σ(valor × probabilidade) das oportunidades ABERTAS.
export function weightedPipeline(opps, prob = STAGE_PROB) {
  let total = 0
  let count = 0
  for (const o of opps || []) {
    if (o.status !== 'aberto') continue
    count++
    total += (Number(o.value) || 0) * (prob[o.stage] ?? 0)
  }
  return { total, count }
}

function groupConv(rows) {
  // rows: [{key, won}] → agrega total/won/conv por key.
  const map = new Map()
  for (const r of rows) {
    const g = map.get(r.key) || { total: 0, won: 0 }
    g.total++
    if (r.won) g.won++
    map.set(r.key, g)
  }
  return map
}

// Leads por origem (null → "sem origem"), com total/ganhos/conversão. Ordenado por total desc.
export function leadsBySource(opps) {
  const map = groupConv((opps || []).map(o => ({ key: (o.source || '').trim() || 'sem origem', won: o.status === 'ganho' })))
  return [...map.entries()]
    .map(([source, g]) => ({ source, total: g.total, won: g.won, conv: g.total ? g.won / g.total : 0 }))
    .sort((a, b) => b.total - a.total || a.source.localeCompare(b.source))
}

// Desempenho por responsável (null → "sem responsável").
export function byResponsible(opps) {
  const map = groupConv((opps || []).map(o => ({ key: o.responsible_user_id || 'none', won: o.status === 'ganho' })))
  return [...map.entries()]
    .map(([userId, g]) => ({ userId, total: g.total, won: g.won, conv: g.total ? g.won / g.total : 0 }))
    .sort((a, b) => b.won - a.won || b.total - a.total)
}

// Motivos de perda (só perdidas; null → "sem motivo"). Ordenado por contagem desc.
export function lossReasons(opps) {
  const map = new Map()
  for (const o of opps || []) {
    if (o.status !== 'perdido') continue
    const reason = (o.lost_reason || '').trim() || 'sem motivo'
    map.set(reason, (map.get(reason) || 0) + 1)
  }
  return [...map.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
}

// Tempo médio (dias) em cada etapa, a partir das transições do histórico.
// O tempo em from_stage = created_at da próxima transição − created_at desta.
export function avgDaysPerStage(history) {
  const byOpp = new Map()
  for (const h of history || []) {
    const arr = byOpp.get(h.opportunity_id) || []
    arr.push(h)
    byOpp.set(h.opportunity_id, arr)
  }
  const sums = {}
  const counts = {}
  for (const arr of byOpp.values()) {
    arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    for (let i = 0; i < arr.length - 1; i++) {
      const stage = arr[i].to_stage
      const days = (new Date(arr[i + 1].created_at) - new Date(arr[i].created_at)) / DAY
      if (!stage || !Number.isFinite(days) || days < 0) continue
      sums[stage] = (sums[stage] || 0) + days
      counts[stage] = (counts[stage] || 0) + 1
    }
  }
  const out = {}
  for (const stage of Object.keys(sums)) out[stage] = sums[stage] / counts[stage]
  return out
}

// KPIs de topo: leads (total), ganhos, perdidos, taxa de conversão (ganhos/leads), ticket médio (ganhos).
export function crmKpis(opps) {
  const list = opps || []
  const leads = list.length
  const won = list.filter(o => o.status === 'ganho')
  const lost = list.filter(o => o.status === 'perdido').length
  const ticketVals = won.map(o => Number(o.value) || 0).filter(v => v > 0)
  return {
    leads,
    won: won.length,
    lost,
    convRate: leads ? won.length / leads : 0,
    avgTicket: ticketVals.length ? ticketVals.reduce((a, b) => a + b, 0) / ticketVals.length : 0,
  }
}
