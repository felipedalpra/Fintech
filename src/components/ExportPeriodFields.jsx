import { C, base } from '../theme.js'
import {
  EXPORT_PERIOD_OPTIONS,
  defaultExportPeriodForPreset,
  resolveExportPeriod,
} from '../lib/exportPeriod.js'

export function ExportPeriodFields({ value, onChange, disabled = false, compact = false }) {
  const period = value || { preset:'all', start:'', end:'' }
  const selectPeriod = preset => {
    onChange(defaultExportPeriodForPreset(preset))
  }

  let preview = ''
  try { preview = resolveExportPeriod(period).label } catch { preview = 'Complete as duas datas para continuar.' }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:compact ? 8 : 10, minWidth:compact ? 210 : 260 }}>
      <label style={{ ...base.label, marginBottom:0 }} htmlFor="export-period-preset">Período dos dados</label>
      <select
        id="export-period-preset"
        value={period.preset}
        disabled={disabled}
        onChange={event => selectPeriod(event.target.value)}
        style={{ ...base.input, appearance:'none', cursor:disabled ? 'not-allowed' : 'pointer' }}
      >
        {EXPORT_PERIOD_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>

      {period.preset === 'month' ? (
        <DateField label="Escolha o mês" type="month" value={period.month} disabled={disabled} onChange={month => onChange({ ...period, month })} />
      ) : null}

      {period.preset === 'quarter' ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:10 }}>
          <DateField label="Ano" type="number" min="1900" max="9999" value={period.year} disabled={disabled} onChange={year => onChange({ ...period, year })} />
          <label style={{ display:'flex', flexDirection:'column', gap:5, color:C.textSub, fontSize:11, fontWeight:700 }}>
            Trimestre
            <select value={period.quarter || '1'} disabled={disabled} onChange={event => onChange({ ...period, quarter:event.target.value })} style={{ ...base.input, appearance:'none' }}>
              <option value="1">1º trimestre</option>
              <option value="2">2º trimestre</option>
              <option value="3">3º trimestre</option>
              <option value="4">4º trimestre</option>
            </select>
          </label>
        </div>
      ) : null}

      {period.preset === 'year' ? (
        <DateField label="Escolha o ano" type="number" min="1900" max="9999" value={period.year} disabled={disabled} onChange={year => onChange({ ...period, year })} />
      ) : null}

      {period.preset === 'custom' ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:10 }}>
          <DateField label="De" type="date" value={period.start} disabled={disabled} onChange={start => onChange({ ...period, start })} />
          <DateField label="Até" type="date" value={period.end} disabled={disabled} onChange={end => onChange({ ...period, end })} />
        </div>
      ) : null}

      <span style={{ color:C.textDim, fontSize:12, lineHeight:1.45 }}>{preview}</span>
    </div>
  )
}

function DateField({ label, value, onChange, disabled, type, min, max }) {
  return (
    <label style={{ display:'flex', flexDirection:'column', gap:5, color:C.textSub, fontSize:11, fontWeight:700 }}>
      {label}
      <input
        type={type}
        min={min}
        max={max}
        value={value || ''}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        style={{ ...base.input, minWidth:0, padding:'9px 10px' }}
      />
    </label>
  )
}
