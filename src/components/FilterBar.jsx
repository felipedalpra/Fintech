import { C } from '../theme.js'

// Barra de filtros padrão da plataforma (CRM-like): busca + selects (status/período/ordenação) +
// contador + ações à direita. Reutilizável em todos os módulos de lista (pacientes, consultas,
// cirurgias, produtos, vendas…). Mantém o visual consistente e dark-mode safe (tokens C).
//
// Props:
//   search, onSearch, searchPlaceholder
//   selects: [{ label, value, onChange, options: [{ v, l }] }]
//   count, countLabel (ex.: 'paciente'), countPluralLabel (opcional)
//   onClear (opcional) — mostra "Limpar" quando há filtro ativo
//   right — nós à direita (ex.: botão "+ Novo")
//   isMobile
export function FilterBar({
  search, onSearch, searchPlaceholder = 'Buscar…',
  selects = [], count, countLabel, countPluralLabel,
  onClear, right, isMobile = false,
}) {
  const inputStyle = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text,
    padding: '8px 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none',
  }
  const selectStyle = { ...inputStyle, appearance: 'none', cursor: 'pointer', paddingRight: 26 }
  const labelStyle = { fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3, display: 'block' }

  const hasActiveFilter = !!search || selects.some(s => s.value && s.value !== (s.options?.[0]?.v ?? ''))
  const label = count === 1 ? countLabel : (countPluralLabel || `${countLabel}s`)

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div style={{ flex: isMobile ? '1 1 100%' : '0 0 auto' }}>
        <label style={labelStyle}>Buscar</label>
        <input
          placeholder={searchPlaceholder}
          value={search}
          onChange={e => onSearch(e.target.value)}
          style={{ ...inputStyle, width: isMobile ? '100%' : 260, boxSizing: 'border-box' }}
        />
      </div>

      {selects.map((s, i) => (
        <div key={i} style={{ flex: isMobile ? '1 1 45%' : '0 0 auto' }}>
          <label style={labelStyle}>{s.label}</label>
          <select value={s.value} onChange={e => s.onChange(e.target.value)}
            style={{ ...selectStyle, width: isMobile ? '100%' : 'auto', boxSizing: 'border-box' }}>
            {s.options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
      ))}

      {onClear && hasActiveFilter && (
        <button type="button" onClick={onClear}
          style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSub,
            padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          Limpar
        </button>
      )}

      <span style={{ marginLeft: isMobile ? 0 : 'auto', fontSize: 13, color: C.textDim, alignSelf: 'center' }}>
        {count} {label}
      </span>

      {right}
    </div>
  )
}
