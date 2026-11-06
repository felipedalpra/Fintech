// Leitura do array `actions` / `cost_per_action_type` que a Meta devolve em cada insight.
//
// Antes esse array era descartado: o parser extraía só o lead. Tudo aqui sai de dado que JÁ
// chegava da API — nenhuma requisição nova à Meta.
//
// Regra que atravessa o arquivo: métrica ausente é `null`, nunca 0. "Zero conversões" e "a Meta
// não informou esse tipo" são coisas diferentes, e exibir ausência como zero mente para quem
// decide onde colocar verba.

// Tipos de ação que representam RESULTADO de captação, em ordem de preferência. A Meta devolve
// o mesmo lead sob nomes diferentes conforme a origem; contar todos somaria em dobro.
export const LEAD_ACTION_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped']

// Engajamento: interações com o anúncio que não são conversão.
export const ENGAGEMENT_ACTION_TYPES = [
  'post_engagement', 'page_engagement', 'post_reaction', 'comment', 'post', 'onsite_conversion.post_save',
]

// Rótulos em português para os tipos que a clínica vê. Tipo desconhecido aparece cru, em vez de
// ser escondido: preferimos um nome feio a sumir com uma conversão real.
export const ACTION_LABELS = {
  lead: 'Leads',
  'onsite_conversion.lead_grouped': 'Leads (no site)',
  leadgen_grouped: 'Leads (formulário)',
  link_click: 'Cliques no link',
  landing_page_view: 'Visitas à página',
  post_engagement: 'Engajamento',
  page_engagement: 'Engajamento da página',
  post_reaction: 'Reações',
  comment: 'Comentários',
  video_view: 'Views de vídeo',
  'onsite_conversion.messaging_conversation_started_7d': 'Conversas iniciadas',
}

export function actionLabel(type) {
  return ACTION_LABELS[type] || String(type || '').replace(/_/g, ' ')
}

function toMap(list) {
  const map = new Map()
  for (const item of list || []) {
    const type = item?.action_type
    if (!type) continue
    const value = Number(item.value)
    if (!Number.isFinite(value)) continue
    map.set(type, (map.get(type) || 0) + value)
  }
  return map
}

// Soma os `actions` de várias linhas diárias num mapa único tipo → total.
export function sumActions(rows = []) {
  const total = new Map()
  for (const row of rows || []) {
    for (const [type, value] of toMap(row?.actions)) {
      total.set(type, (total.get(type) || 0) + value)
    }
  }
  return total
}

// O resultado principal: o primeiro tipo de lead presente, nunca a soma de todos.
export function leadsFromActions(actions) {
  const map = toMap(actions)
  for (const type of LEAD_ACTION_TYPES) {
    if (map.has(type)) return map.get(type)
  }
  return 0
}

export function engagementFromActions(actionsMap) {
  let total = null
  for (const type of ENGAGEMENT_ACTION_TYPES) {
    if (!actionsMap?.has(type)) continue
    total = (total || 0) + actionsMap.get(type)
  }
  return total
}

// Conversões por tipo, já rotuladas e ordenadas da maior para a menor. Tipos de engajamento
// ficam de fora: engajamento não é conversão e misturá-los inflaria o resultado.
export function conversionBreakdown(actionsMap, { exclude = ENGAGEMENT_ACTION_TYPES } = {}) {
  const excluded = new Set(exclude)
  return [...(actionsMap?.entries() || [])]
    .filter(([type, value]) => !excluded.has(type) && value > 0)
    .map(([type, value]) => ({ type, label: actionLabel(type), value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'pt-BR'))
}

// Custo por resultado. Preferimos CALCULAR gasto / resultados a usar o `cost_per_action_type` da
// Meta, porque o nosso denominador é o mesmo que a tela exibe — assim o número bate com a coluna
// ao lado. Sem resultado, devolve null (indefinido), não zero.
export function costPerResult(spend, results) {
  const count = Number(results)
  if (!Number.isFinite(count) || count <= 0) return null
  return Number(spend || 0) / count
}
