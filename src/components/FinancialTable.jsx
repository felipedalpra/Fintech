import { C } from '../theme.js'
import { fmt } from '../utils.js'

export function FinancialTable({ rows }) {
  if (!rows.length) {
    return <div style={{ color:C.textDim, fontSize:13 }}>Nenhum dado para exibir na tabela.</div>
  }

  const thStyle = {
    textAlign:'left',
    padding:'10px 12px',
    color:C.textSub,
    fontSize:11,
    letterSpacing:'0.08em',
    textTransform:'uppercase',
  }

  const tdStyle = {
    padding:'10px 12px',
    color:C.text,
    fontSize:13,
    whiteSpace:'nowrap',
  }

  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', minWidth:900 }}>
        <thead>
          <tr>
            {['Período', 'Receita', 'Despesa', 'Lucro', 'Variação Receita', 'Variação Despesa', 'Variação Lucro', 'Despesa %', 'Lucro %'].map(label => (
              <th key={label} style={thStyle}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.periodo} style={{ borderTop:`1px solid ${C.border}55` }}>
              <td style={tdStyle}>{row.periodo}</td>
              <td style={tdStyle}>{fmt(row.receita || 0)}</td>
              <td style={tdStyle}>{fmt(row.despesa || 0)}</td>
              <td style={{ ...tdStyle, color:Number(row.lucro || 0) >= 0 ? C.green : C.red, fontWeight:700 }}>{fmt(row.lucro || 0)}</td>
              <td style={tdStyle}>{renderVariation(row.variacao_receita)}</td>
              <td style={tdStyle}>{renderVariation(row.variacao_despesa)}</td>
              <td style={tdStyle}>{renderVariation(row.variacao_lucro)}</td>
              <td style={tdStyle}>{formatPercent(row.despesa_percent)}</td>
              <td style={{ ...tdStyle, color:Number(row.lucro_percent || 0) >= 0 ? C.green : C.red }}>{formatPercent(row.lucro_percent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderVariation(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return <span style={{ color:C.textDim }}>-</span>
  }

  const numeric = Number(value)
  const positive = numeric >= 0
  return (
    <span style={{ color:positive ? C.green : C.red, fontWeight:700 }}>
      {positive ? '↑' : '↓'} {Math.abs(numeric).toFixed(2)}%
    </span>
  )
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  return `${Number(value).toFixed(2)}%`
}

