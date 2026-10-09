import { useState } from 'react'
import { C } from '../theme.js'
import { fmt } from '../utils.js'

export function FinancialChart({ rows }) {
  const SERIES = [
    { key:'receita', label:'Receita', color:C.green },
    { key:'despesa', label:'Despesa', color:C.red },
    { key:'lucro',   label:'Lucro',   color:C.accent },
  ]

  const [tooltip, setTooltip] = useState(null)

  if (!rows.length) {
    return <div style={{ color:C.textDim, fontSize:13 }}>Sem dados para gerar gráfico no período.</div>
  }

  const width = 860
  const height = 280
  const padding = 28
  const values = rows.flatMap(row => SERIES.map(s => Number(row[s.key] || 0)))
  const minY = Math.min(0, ...values)
  const maxY = Math.max(...values, 1)
  const xStep = rows.length > 1 ? (width - padding * 2) / (rows.length - 1) : 0
  const yRange = Math.max(1, maxY - minY)

  const toXY = (index, value) => ({
    x: padding + xStep * index,
    y: height - padding - ((Number(value || 0) - minY) / yRange) * (height - padding * 2),
  })

  const toPoint = (index, value) => {
    const { x, y } = toXY(index, value)
    return `${x},${y}`
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
        {SERIES.map(s => (
          <div key={s.key} style={{ display:'inline-flex', alignItems:'center', gap:6, color:C.textSub, fontSize:12 }}>
            <span style={{ width:10, height:10, borderRadius:99, background:s.color }} />
            {s.label}
          </div>
        ))}
      </div>

      <div style={{ position:'relative' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height="280"
          role="img"
          aria-label="Evolução financeira"
          style={{ overflow:'visible' }}
          onMouseLeave={() => setTooltip(null)}
        >
          <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} stroke={C.border} strokeWidth="1" />

          {SERIES.map(s => (
            <polyline
              key={s.key}
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={rows.map((row, i) => toPoint(i, row[s.key])).join(' ')}
            />
          ))}

          {/* pontos interativos por coluna */}
          {rows.map((row, i) => {
            const cx = padding + xStep * i
            const isHovered = tooltip?.index === i
            return (
              <g key={row.periodo}>
                {/* área de hover invisível */}
                <rect
                  x={cx - (xStep / 2 || 20)}
                  y={0}
                  width={xStep || 40}
                  height={height}
                  fill="transparent"
                  style={{ cursor:'crosshair' }}
                  onMouseEnter={e => {
                    const rect = e.currentTarget.closest('svg').getBoundingClientRect()
                    setTooltip({ index:i, row, svgX:cx, clientX:e.clientX - rect.left, clientY:e.clientY - rect.top })
                  }}
                />
                {/* linha vertical no hover */}
                {isHovered && (
                  <line x1={cx} x2={cx} y1={padding / 2} y2={height - padding} stroke={C.border} strokeWidth="1" strokeDasharray="4 3" />
                )}
                {/* círculos dos pontos */}
                {SERIES.map(s => {
                  const { x, y } = toXY(i, row[s.key])
                  return (
                    <circle
                      key={s.key}
                      cx={x} cy={y} r={isHovered ? 5 : 3}
                      fill={s.color}
                      stroke={C.bg}
                      strokeWidth="1.5"
                      style={{ transition:'r 0.1s' }}
                    />
                  )
                })}
              </g>
            )
          })}
        </svg>

        {/* tooltip flutuante */}
        {tooltip && (() => {
          const pct = tooltip.clientX / (tooltip.clientX + (width - tooltip.clientX))
          const alignRight = pct > 0.6
          return (
            <div
              style={{
                position:'absolute',
                top: Math.max(4, tooltip.clientY - 80),
                left: alignRight ? undefined : tooltip.clientX + 12,
                right: alignRight ? `calc(100% - ${tooltip.clientX - 12}px)` : undefined,
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: '10px 14px',
                fontSize: 12,
                pointerEvents: 'none',
                zIndex: 10,
                minWidth: 160,
                boxShadow: '0 4px 20px #0004',
              }}
            >
              <div style={{ fontWeight:700, color:C.textSub, marginBottom:8, fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em' }}>{tooltip.row.periodo}</div>
              {SERIES.map(s => (
                <div key={s.key} style={{ display:'flex', justifyContent:'space-between', gap:16, marginBottom:4 }}>
                  <span style={{ color:C.textDim, display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{ width:8, height:8, borderRadius:99, background:s.color, display:'inline-block' }} />
                    {s.label}
                  </span>
                  <span style={{ fontWeight:700, color:s.color }}>{fmt(Number(tooltip.row[s.key] || 0))}</span>
                </div>
              ))}
              {tooltip.row.variacao_receita !== undefined && (
                <div style={{ borderTop:`1px solid ${C.border}`, marginTop:8, paddingTop:8, display:'flex', flexDirection:'column', gap:3 }}>
                  {[
                    { label:'Var. receita', val:tooltip.row.variacao_receita },
                    { label:'Var. despesa', val:tooltip.row.variacao_despesa },
                    { label:'Margem lucro', val:tooltip.row.lucro_percent },
                  ].map(({ label, val }) => (
                    <div key={label} style={{ display:'flex', justifyContent:'space-between', gap:16 }}>
                      <span style={{ color:C.textDim }}>{label}</span>
                      <span style={{ fontWeight:600, color: Number(val) >= 0 ? C.green : C.red }}>{Number(val).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:`repeat(${rows.length}, minmax(56px, 1fr))`, gap:8 }}>
        {rows.map(row => (
          <div key={row.periodo} style={{ textAlign:'center', color:C.textDim, fontSize:11 }}>{row.periodo}</div>
        ))}
      </div>
    </div>
  )
}
