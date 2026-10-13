// src/lib/metaMetrics.js — derivação e agregação (puras) para a tela de Anúncios (Meta Ads).
// Só agrega métricas ADITIVAS (gasto, impressões, cliques, leads); CTR/CPC/CPM/CPL são ratios
// dessas somas. Alcance/frequência NÃO são aditivos por dia — ficam fora da agregação.

// Divisão segura: denominador 0/ausente → 0 (nunca NaN/Infinity).
function div(a, b) {
  const d = Number(b)
  return d ? Number(a) / d : 0
}

// Agrupa linhas de meta_insights por ref_id, somando as métricas aditivas.
export function aggregateInsights(rows) {
  const map = new Map()
  for (const r of rows || []) {
    const cur = map.get(r.ref_id) || { ref_id: r.ref_id, campaign_id: r.campaign_id ?? null, spend: 0, impressions: 0, clicks: 0, leads: 0 }
    cur.spend += Number(r.spend || 0)
    cur.impressions += Number(r.impressions || 0)
    cur.clicks += Number(r.clicks || 0)
    cur.leads += Number(r.leads || 0)
    map.set(r.ref_id, cur)
  }
  return [...map.values()]
}

// Métricas derivadas a partir das somas aditivas.
export function deriveMetrics({ spend = 0, impressions = 0, clicks = 0, leads = 0 } = {}) {
  return {
    ctr: div(clicks, impressions) * 100,
    cpc: div(spend, clicks),
    cpm: div(spend, impressions) * 1000,
    cpl: div(spend, leads),
  }
}

// ---- Formatação pt-BR (determinística) ----
export function fmtBRL(v) {
  if (v == null) return '—' // null = métrica indefinida (ex.: CPL sem leads). 0 continua "R$ 0,00".
  const n = Number(v || 0)
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '-' : ''}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}
export function fmtInt(v) {
  return Math.round(Number(v || 0)).toLocaleString('pt-BR')
}
export function fmtPct(v) {
  return `${Number(v || 0).toFixed(2).replace('.', ',')}%`
}
