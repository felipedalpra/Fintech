// "Receita por origem" do painel de Entradas.
//
// Antes classificava pelo TIPO DE REGISTRO (surgery / consultation / product_sale / extra_revenue).
// Isso fazia uma receita de cirurgia lançada como "Outra receita" — o caso de tudo que veio da
// planilha e da conciliação — contar como Outras, mostrando "Cirurgias 0%" logo acima de uma
// tabela cheia de cirurgias, e divergindo do DRE, que já as classifica pelo plano de contas.
//
// Agora o critério é o PLANO DE CONTAS, igual ao DRE e à coluna Categoria ao lado. Lançamento sem
// conta contábil cai no rótulo do tipo de registro, para nunca sumir do painel.
//
// INVARIANTE: o conjunto classificado é exatamente o mesmo de antes, então a SOMA das barras
// continua sendo a receita bruta do período. Só a distribuição muda — nenhum total novo nasce aqui.

const SOURCE_FALLBACK_LABEL = {
  surgery:'Cirurgias',
  consultation:'Consultas',
  product_sale:'Venda de produtos',
  extra_revenue:'Outras receitas',
  recurrence:'Outras receitas',
}

// Sobe do lançamento até o grupo logo abaixo da raiz de receita: 4.01 Cirurgias, 4.03 Consultas…
// É o mesmo nível que o DRE usa para abrir a receita bruta.
export function revenueGroupLabel(entry, accountPathOf) {
  const path = entry?.chartAccountId ? (accountPathOf?.(entry.chartAccountId) || []) : []
  // path[0] é a raiz ("Receita bruta"); o grupo é o nível seguinte. Conta solta sem grupo usa
  // o próprio nome, que é melhor do que jogá-la num balaio genérico.
  const group = path.length > 2 ? path[1] : (path.length === 2 ? path[1] : path[0])
  const label = String(group?.name || '').trim()
  if (label) return label
  return SOURCE_FALLBACK_LABEL[entry?.sourceType] || 'Outras receitas'
}

export function buildRevenueOrigins(entries = [], accountPathOf = null) {
  const buckets = new Map()
  let total = 0
  for (const entry of entries || []) {
    const value = Number(entry?.value || 0)
    if (!Number.isFinite(value) || value === 0) continue
    const label = revenueGroupLabel(entry, accountPathOf)
    const current = buckets.get(label) || { label, value:0, entries:[] }
    current.value += value
    current.entries.push(entry)
    buckets.set(label, current)
    total += value
  }
  return [...buckets.values()]
    // Maior primeiro: o painel existe para responder "de onde vem o dinheiro".
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'pt-BR'))
    .map(bucket => ({ ...bucket, pct:total > 0 ? bucket.value / total * 100 : 0, total }))
}

// Ordem categórica fixa, validada pelo script do guia de dataviz contra as DUAS superfícies do
// app (escura #111827 e clara #F7FAFE): banda de luminosidade, piso de croma, separação para
// daltonismo e contraste. Nunca gerar uma 6ª cor — a cauda vira "Outros" em cinza.
// A separação protan do par âmbar/verde cai na faixa 6–8, o que só é permitido com codificação
// secundária: por isso cada segmento tem folga de 2px e a legenda traz nome e valor por extenso.
export const REVENUE_ORIGIN_COLORS = ['#3B82F6', '#D97706', '#059669', '#8B5CF6', '#0891B2']
export const REVENUE_ORIGIN_TAIL_COLOR = '#64748B'
export const REVENUE_ORIGIN_TAIL_LABEL = 'Outros'

// Mantém os maiores com cor própria e dobra o resto num bloco só. O total e a soma das partes
// não mudam: "Outros" carrega exatamente os lançamentos que saíram das barras nomeadas.
export function foldRevenueOriginTail(origins = [], maxSlices = REVENUE_ORIGIN_COLORS.length) {
  const list = (origins || []).filter(Boolean)
  if (list.length <= maxSlices) {
    return list.map((item, index) => ({ ...item, color:REVENUE_ORIGIN_COLORS[index], isTail:false }))
  }
  const head = list.slice(0, maxSlices).map((item, index) => ({ ...item, color:REVENUE_ORIGIN_COLORS[index], isTail:false }))
  const tail = list.slice(maxSlices)
  const tailValue = tail.reduce((acc, item) => acc + Number(item.value || 0), 0)
  const total = list[0]?.total || tail[0]?.total || 0
  return [...head, {
    label:REVENUE_ORIGIN_TAIL_LABEL,
    value:tailValue,
    entries:tail.flatMap(item => item.entries || []),
    pct:total > 0 ? tailValue / total * 100 : 0,
    total,
    color:REVENUE_ORIGIN_TAIL_COLOR,
    isTail:true,
    foldedLabels:tail.map(item => item.label),
  }]
}
