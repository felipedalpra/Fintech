import { useMemo, useState } from 'react'
import { C } from '../theme.js'
import { summarizeFinanceProfitTrend } from '../lib/financeProfitTrend.js'
import './FinanceProfitTrend.css'

const CHART = { width:1000, height:300, left:72, right:26, top:22, bottom:42 }

function compactMoney(value) {
  return new Intl.NumberFormat('pt-BR', { notation:'compact', style:'currency', currency:'BRL', maximumFractionDigits:1 }).format(value || 0)
}

function linePath(points, key, xAt, yAt) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${xAt(index)} ${yAt(point[key])}`).join(' ')
}

export function FinanceProfitTrend({ points, formatMoney, privacyMode = false }) {
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const summary = useMemo(() => summarizeFinanceProfitTrend(points), [points])
  const values = points.flatMap(point => [point.netRevenue, point.netProfit, 0])
  const rawMin = Math.min(...values, 0)
  const rawMax = Math.max(...values, 0)
  const rawSpan = rawMax - rawMin
  const padding = rawSpan ? rawSpan * 0.12 : Math.max(Math.abs(rawMax) * 0.15, 1)
  const min = rawMin - padding
  const max = rawMax + padding
  const plotWidth = CHART.width - CHART.left - CHART.right
  const plotHeight = CHART.height - CHART.top - CHART.bottom
  const xAt = index => CHART.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth)
  const yAt = value => CHART.top + ((max - value) / (max - min || 1)) * plotHeight
  const profitPath = linePath(points, 'netProfit', xAt, yAt)
  const revenuePath = linePath(points, 'netRevenue', xAt, yAt)
  const zeroY = yAt(0)
  const hovered = hoveredIndex == null ? null : points[hoveredIndex]
  const tickValues = [max - padding, (max + min) / 2, min + padding]
  const visibleLabels = new Set(points.map((_, index) => index).filter(index => {
    if (points.length <= 8) return true
    const step = Math.ceil(points.length / 7)
    return index === 0 || index === points.length - 1 || index % step === 0
  }))

  const handlePointerMove = event => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const localX = ((event.clientX - bounds.left) / bounds.width) * CHART.width
    const normalized = Math.max(0, Math.min(1, (localX - CHART.left) / plotWidth))
    setHoveredIndex(Math.round(normalized * Math.max(0, points.length - 1)))
  }

  if (!points.length) return null

  return (
    <section className="finance-trend" aria-label="Evolução da rentabilidade">
      <div className="finance-trend__header">
        <div>
          <div className="finance-trend__eyebrow">Desempenho no período</div>
          <h3>Evolução da rentabilidade</h3>
          <p>Receita líquida versus lucro líquido. A distância entre as linhas evidencia o peso dos custos e despesas.</p>
        </div>
        <div className="finance-trend__legend" aria-label="Legenda do gráfico">
          <span><i style={{ background:C.accentLight }} /> Receita líquida</span>
          <span><i style={{ background:C.green }} /> Lucro líquido</span>
        </div>
      </div>

      <div className="finance-trend__insights">
        <div><span>Margem líquida</span><strong className={summary.margin < 0 ? 'is-negative' : ''}>{summary.margin.toLocaleString('pt-BR', { maximumFractionDigits:1 })}%</strong></div>
        <div><span>Lucro no período</span><strong className={summary.netProfit < 0 ? 'is-negative' : ''}>{formatMoney(summary.netProfit)}</strong></div>
        <div><span>Melhor resultado</span><strong>{summary.best ? `${summary.best.label} · ${formatMoney(summary.best.netProfit)}` : '—'}</strong></div>
      </div>

      <div className="finance-trend__chart-wrap">
        <svg
          className="finance-trend__chart"
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          role="img"
          aria-label="Gráfico em linhas da receita líquida e do lucro líquido"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id="finance-profit-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.green} stopOpacity="0.22" />
              <stop offset="100%" stopColor={C.green} stopOpacity="0" />
            </linearGradient>
          </defs>
          {tickValues.map((tick, index) => {
            const y = yAt(tick)
            return <g key={index}>
              <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y} y2={y} className="finance-trend__grid" />
              <text x={CHART.left - 12} y={y + 4} textAnchor="end" className="finance-trend__axis-value">{privacyMode ? '••••' : compactMoney(tick)}</text>
            </g>
          })}
          <line x1={CHART.left} x2={CHART.width - CHART.right} y1={zeroY} y2={zeroY} className="finance-trend__zero" />
          <path d={`${profitPath} L ${xAt(points.length - 1)} ${zeroY} L ${xAt(0)} ${zeroY} Z`} fill="url(#finance-profit-area)" />
          <path d={revenuePath} className="finance-trend__line finance-trend__line--revenue" />
          <path d={profitPath} className="finance-trend__line finance-trend__line--profit" />
          {points.map((point, index) => (
            <g key={point.start}>
              {visibleLabels.has(index) && <text x={xAt(index)} y={CHART.height - 12} textAnchor="middle" className="finance-trend__axis-label">{point.label}</text>}
              <circle cx={xAt(index)} cy={yAt(point.netProfit)} r={point.netProfit < 0 ? 4.5 : 3.5} fill={point.netProfit < 0 ? C.red : C.green} className="finance-trend__point" />
            </g>
          ))}
          {hovered && <g className="finance-trend__focus">
            <line x1={xAt(hoveredIndex)} x2={xAt(hoveredIndex)} y1={CHART.top} y2={CHART.height - CHART.bottom} />
            <circle cx={xAt(hoveredIndex)} cy={yAt(hovered.netRevenue)} r="6" fill={C.accentLight} />
            <circle cx={xAt(hoveredIndex)} cy={yAt(hovered.netProfit)} r="6" fill={hovered.netProfit < 0 ? C.red : C.green} />
          </g>}
        </svg>

        {hovered && (
          <div className={`finance-trend__tooltip ${hoveredIndex > points.length / 2 ? 'is-left' : ''}`} style={{ left:`${(xAt(hoveredIndex) / CHART.width) * 100}%` }}>
            <strong>{hovered.fullLabel}</strong>
            <span><i style={{ background:C.accentLight }} /> Receita líquida <b>{formatMoney(hovered.netRevenue)}</b></span>
            <span><i style={{ background:hovered.netProfit < 0 ? C.red : C.green }} /> Lucro líquido <b>{formatMoney(hovered.netProfit)}</b></span>
            <span className="finance-trend__tooltip-margin">Margem líquida <b>{hovered.margin.toLocaleString('pt-BR', { maximumFractionDigits:1 })}%</b></span>
          </div>
        )}
      </div>
    </section>
  )
}
