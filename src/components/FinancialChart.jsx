import { C } from '../theme.js'

export function FinancialChart({ rows }) {
  const SERIES = [
    { key:'receita', label:'Receita', color:C.green },
    { key:'despesa', label:'Despesa', color:C.red },
    { key:'lucro', label:'Lucro', color:C.accent },
  ]

  if (!rows.length) {
    return <div style={{ color:C.textDim, fontSize:13 }}>Sem dados para gerar gráfico no período.</div>
  }

  const width = 860
  const height = 280
  const padding = 28
  const values = rows.flatMap(row => SERIES.map(series => Number(row[series.key] || 0)))
  const minY = Math.min(0, ...values)
  const maxY = Math.max(...values, 1)
  const xStep = rows.length > 1 ? (width - padding * 2) / (rows.length - 1) : 0
  const yRange = Math.max(1, maxY - minY)

  const toPoint = (index, value) => {
    const x = padding + (xStep * index)
    const y = height - padding - ((Number(value || 0) - minY) / yRange) * (height - padding * 2)
    return `${x},${y}`
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
        {SERIES.map(series => (
          <div key={series.key} style={{ display:'inline-flex', alignItems:'center', gap:6, color:C.textSub, fontSize:12 }}>
            <span style={{ width:10, height:10, borderRadius:99, background:series.color }} />
            {series.label}
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="280" role="img" aria-label="Evolução financeira">
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} stroke={C.border} strokeWidth="1" />
        {SERIES.map(series => (
          <polyline
            key={series.key}
            fill="none"
            stroke={series.color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={rows.map((row, index) => toPoint(index, row[series.key])).join(' ')}
          />
        ))}
      </svg>

      <div style={{ display:'grid', gridTemplateColumns:`repeat(${rows.length}, minmax(56px, 1fr))`, gap:8 }}>
        {rows.map(row => (
          <div key={row.periodo} style={{ textAlign:'center', color:C.textDim, fontSize:11 }}>{row.periodo}</div>
        ))}
      </div>
    </div>
  )
}
