import { C } from '../theme.js'

export function FinancialPeriodFilter({ periodPreset, onPeriodPresetChange, customRange, onCustomRangeChange, granularity, onGranularityChange }) {
  return (
    <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'end' }}>
      <div style={{ display:'flex', flexDirection:'column', minWidth:160 }}>
        <label style={labelStyle}>Período</label>
        <select value={periodPreset} onChange={event => onPeriodPresetChange(event.target.value)} style={inputStyle}>
          <option value="month">Mês atual</option>
          <option value="quarter">Trimestre atual</option>
          <option value="year">Ano atual</option>
          <option value="custom">Personalizado</option>
        </select>
      </div>

      {periodPreset === 'custom' && (
        <>
          <div style={{ display:'flex', flexDirection:'column' }}>
            <label style={labelStyle}>Início</label>
            <input
              type="date"
              value={customRange.start}
              onChange={event => onCustomRangeChange({ ...customRange, start:event.target.value })}
              style={inputStyle}
            />
          </div>
          <div style={{ display:'flex', flexDirection:'column' }}>
            <label style={labelStyle}>Fim</label>
            <input
              type="date"
              value={customRange.end}
              onChange={event => onCustomRangeChange({ ...customRange, end:event.target.value })}
              style={inputStyle}
            />
          </div>
        </>
      )}

      <div style={{ display:'flex', flexDirection:'column', minWidth:170 }}>
        <label style={labelStyle}>Agrupamento</label>
        <select value={granularity} onChange={event => onGranularityChange(event.target.value)} style={inputStyle}>
          <option value="month">Mensal</option>
          <option value="quarter">Trimestral</option>
          <option value="year">Anual</option>
        </select>
      </div>
    </div>
  )
}

const labelStyle = {
  fontSize:11,
  fontWeight:700,
  color:C.textSub,
  letterSpacing:'0.08em',
  textTransform:'uppercase',
  marginBottom:6,
}

const inputStyle = {
  background:C.surface,
  border:`1px solid ${C.border}`,
  borderRadius:10,
  padding:'9px 12px',
  color:C.text,
  fontFamily:'inherit',
  fontSize:13,
}
