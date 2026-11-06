// Séries diárias do painel de Anúncios, a partir do cache de insights.
//
// Preenche os dias sem dado com 0 de propósito: uma série de barras com buracos sugere que a
// campanha não existia naquele dia, quando o que houve foi ausência de gasto. O eixo precisa
// cobrir o período inteiro que a pessoa escolheu no filtro.

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function eachDay(startISO, endISO, max = 400) {
  const start = String(startISO).slice(0, 10)
  const end = String(endISO).slice(0, 10)
  if (!start || !end || end < start) return []
  const dias = []
  for (let day = start; day <= end && dias.length < max; day = addDays(day, 1)) dias.push(day)
  return dias
}

// Soma por dia as métricas aditivas. CPL NÃO é somado: é derivado do gasto e dos leads do dia.
export function dailySeries(rows = [], startISO, endISO) {
  const porDia = new Map()
  for (const row of rows || []) {
    const dia = String(row?.date || '').slice(0, 10)
    if (!dia) continue
    const atual = porDia.get(dia) || { spend: 0, clicks: 0, leads: 0, impressions: 0 }
    atual.spend += Number(row.spend || 0)
    atual.clicks += Number(row.clicks || 0)
    atual.leads += Number(row.leads || 0)
    atual.impressions += Number(row.impressions || 0)
    porDia.set(dia, atual)
  }
  return eachDay(startISO, endISO).map(date => {
    const dia = porDia.get(date) || { spend: 0, clicks: 0, leads: 0, impressions: 0 }
    return {
      date,
      ...dia,
      // Dia sem lead tem CPL indefinido, não zero: zero faria a linha despencar e parecer ótimo.
      cpl: dia.leads > 0 ? dia.spend / dia.leads : null,
    }
  })
}

// Escala de uma série para desenho. Devolve null quando não há o que desenhar, para a tela
// mostrar "sem dado no período" em vez de um gráfico achatado em zero.
export function seriesScale(points = [], key) {
  const valores = points.map(point => point?.[key]).filter(value => Number.isFinite(value))
  if (valores.length === 0) return null
  const max = Math.max(...valores, 0)
  return { max: max > 0 ? max : 1, hasData: max > 0 }
}
