import { buildMetrics } from '../financialMetrics.js'

const DAY_MS = 24 * 60 * 60 * 1000

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function isoDate(date) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function minDate(left, right) {
  return left.getTime() <= right.getTime() ? left : right
}

function labelForBucket(start, granularity) {
  if (granularity === 'month') return start.toLocaleDateString('pt-BR', { month:'short' }).replace('.', '')
  if (granularity === 'week') return start.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }).replace('.', '')
  return start.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })
}

function fullLabel(start, end, granularity) {
  if (granularity === 'month') return start.toLocaleDateString('pt-BR', { month:'long', year:'numeric' })
  if (start.getTime() === end.getTime()) return start.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' })
  return `${start.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })} – ${end.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' })}`.replaceAll('.', '')
}

export function buildFinanceTrendBuckets(range) {
  const start = parseDate(range?.start)
  const end = parseDate(range?.end || range?.start)
  if (!start || !end || start > end) return []

  const totalDays = Math.round((end - start) / DAY_MS) + 1
  // Mantém o gráfico leve mesmo em clínicas com muito histórico: no máximo ~18 leituras
  // da fonte canônica, sem perder detalhe diário nos intervalos realmente curtos.
  const granularity = totalDays > 120 ? 'month' : totalDays > 21 ? 'week' : 'day'
  const buckets = []
  let cursor = new Date(start)

  while (cursor <= end) {
    const bucketStart = new Date(cursor)
    let naturalEnd
    if (granularity === 'month') naturalEnd = endOfMonth(bucketStart)
    else if (granularity === 'week') naturalEnd = new Date(bucketStart.getFullYear(), bucketStart.getMonth(), bucketStart.getDate() + 6)
    else naturalEnd = bucketStart
    const bucketEnd = minDate(naturalEnd, end)
    buckets.push({
      start:isoDate(bucketStart),
      end:isoDate(bucketEnd),
      label:labelForBucket(bucketStart, granularity),
      fullLabel:fullLabel(bucketStart, bucketEnd, granularity),
      granularity,
    })
    cursor = new Date(bucketEnd.getFullYear(), bucketEnd.getMonth(), bucketEnd.getDate() + 1)
  }
  return buckets
}

export function buildFinanceProfitTrend(data, range) {
  return buildFinanceTrendBuckets(range).map(bucket => {
    const metrics = buildMetrics(data, {
      startDate:bucket.start,
      endDate:bucket.end,
      balanceDate:bucket.end,
    })
    const netRevenue = Number(metrics.netRevenue || 0)
    const netProfit = Number(metrics.netProfit || 0)
    return {
      ...bucket,
      netRevenue,
      netProfit,
      margin:netRevenue ? (netProfit / netRevenue) * 100 : 0,
    }
  })
}

export function summarizeFinanceProfitTrend(points) {
  const netRevenue = points.reduce((sum, point) => sum + point.netRevenue, 0)
  const netProfit = points.reduce((sum, point) => sum + point.netProfit, 0)
  const best = points.reduce((current, point) => !current || point.netProfit > current.netProfit ? point : current, null)
  return {
    netRevenue,
    netProfit,
    margin:netRevenue ? (netProfit / netRevenue) * 100 : 0,
    best,
  }
}
