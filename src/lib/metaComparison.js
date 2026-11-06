// Comparação com o período anterior e leituras automáticas do desempenho.
//
// Duas regras atravessam o arquivo, e ambas existem para o painel não mentir:
//
// 1. Variação sem base anterior é `null`, não "+100%". Sair de 0 para 10 não é crescimento de
//    100% — é estreia, e rotular como percentual cria comparação inventada.
// 2. Em métrica de CUSTO (CPL, CPC, CPM) a queda é boa. Quem lê o painel precisa saber se a
//    seta verde significa "subiu" ou "melhorou", então a direção vem junto do número.

export const LOWER_IS_BETTER = new Set(['cpl', 'cpc', 'cpm', 'costPerResult'])

// Período imediatamente anterior, de mesma duração e sem sobrepor o atual.
export function previousPeriod(startISO, endISO) {
  const start = new Date(`${String(startISO).slice(0, 10)}T12:00:00Z`)
  const end = new Date(`${String(endISO).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null
  const dias = Math.round((end - start) / 86400000) + 1
  const prevEnd = new Date(start.getTime() - 86400000)
  const prevStart = new Date(prevEnd.getTime() - (dias - 1) * 86400000)
  return { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10), days: dias }
}

// { pct, direction: 'up'|'down'|'flat', good: boolean|null }
// `good` é null quando não dá para julgar (sem base anterior).
export function compareMetric(key, current, previous) {
  const atual = Number(current)
  const anterior = Number(previous)
  if (!Number.isFinite(atual) || !Number.isFinite(anterior) || anterior === 0) {
    return { pct: null, direction: 'flat', good: null }
  }
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100
  const direction = pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat'
  if (direction === 'flat') return { pct, direction, good: null }
  const menorMelhor = LOWER_IS_BETTER.has(key)
  return { pct, direction, good: direction === 'down' ? menorMelhor : !menorMelhor }
}

function metricOf(row, key) {
  const value = row?.[key]
  return Number.isFinite(Number(value)) ? Number(value) : null
}

// Leituras automáticas, por regra — sem IA. Cada achado traz o número que o sustenta, porque
// uma frase de análise sem o dado ao lado não é verificável por quem lê.
export function buildFindings({ current = [], previous = [], minSpend = 1 } = {}) {
  const achados = []
  const relevantes = current.filter(row => Number(row.spend || 0) >= minSpend)
  if (relevantes.length === 0) return achados

  const porAnterior = new Map(previous.map(row => [row.ref_id, row]))

  const melhorCPL = relevantes
    .filter(row => metricOf(row, 'cpl') != null && Number(row.leads || 0) > 0)
    .sort((a, b) => a.cpl - b.cpl)[0]
  if (melhorCPL) {
    achados.push({ kind: 'melhor_cpl', tone: 'good', ref_id: melhorCPL.ref_id, name: melhorCPL.name,
      metric: 'cpl', value: melhorCPL.cpl, text: 'Menor custo por lead do período' })
  }

  const melhorCTR = [...relevantes].sort((a, b) => Number(b.ctr || 0) - Number(a.ctr || 0))[0]
  if (melhorCTR && Number(melhorCTR.ctr || 0) > 0) {
    achados.push({ kind: 'melhor_ctr', tone: 'good', ref_id: melhorCTR.ref_id, name: melhorCTR.name,
      metric: 'ctr', value: melhorCTR.ctr, text: 'Maior taxa de cliques' })
  }

  // Custo subindo: só com base anterior real. Sem ela, não há "aumento" a declarar.
  for (const row of relevantes) {
    const anterior = porAnterior.get(row.ref_id)
    if (!anterior) continue
    const cmp = compareMetric('cpl', metricOf(row, 'cpl'), metricOf(anterior, 'cpl'))
    if (cmp.pct != null && cmp.pct >= 20) {
      achados.push({ kind: 'cpl_subindo', tone: 'bad', ref_id: row.ref_id, name: row.name,
        metric: 'cpl', value: row.cpl, pct: cmp.pct, text: 'Custo por lead subiu em relação ao período anterior' })
    }
  }

  // Gasto sem nenhum resultado é o achado mais acionável do painel.
  for (const row of relevantes) {
    if (Number(row.leads || 0) === 0 && Number(row.spend || 0) > 0) {
      achados.push({ kind: 'sem_resultado', tone: 'bad', ref_id: row.ref_id, name: row.name,
        metric: 'spend', value: row.spend, text: 'Investiu no período e não registrou nenhum lead' })
    }
  }

  return achados
}
