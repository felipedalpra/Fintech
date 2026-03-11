import { useState } from 'react'
import { C } from '../theme.js'
import { fmt, getPeriodRange } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card } from './UI.jsx'

export function Reports({ data }) {
  const [period, setPeriod] = useState('month')
  const [customRange, setCustomRange] = useState({ start:'', end:'' })
  const range = getPeriodRange(period, customRange)
  const m = buildMetrics(data, { startDate:range.start, endDate:range.end, balanceDate:range.end })

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
        <select value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="day">Dia</option>
          <option value="week">Semana</option>
          <option value="month">Mês</option>
          <option value="quarter">Trimestre</option>
          <option value="year">Ano</option>
          <option value="custom">Personalizado</option>
        </select>
        {period === 'custom' && <><input type="date" value={customRange.start} onChange={e => setCustomRange(current => ({ ...current, start:e.target.value }))} /><input type="date" value={customRange.end} onChange={e => setCustomRange(current => ({ ...current, end:e.target.value }))} /></>}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <ReportList title="Procedimentos mais lucrativos" rows={m.byProcedure.map(item => `${item.name} · ${fmt(item.profit)} · ${item.count} cirurgia(s)`) || []} empty="Sem dados." />
        <ReportList title="Despesas por categoria" rows={Object.entries(m.expensesByCategory).sort(([, a], [, b]) => b - a).map(([category, value]) => `${category} · ${fmt(value)}`)} empty="Sem despesas." />
        <ReportList title="Cirurgias por mês" rows={Object.entries(m.surgeriesByMonth).map(([month, total]) => `${month} · ${total} cirurgia(s)`) } empty="Sem cirurgias." />
        <ReportList title="Consultas por convênio" rows={Object.entries(m.consultationsByInsurance).map(([insurance, total]) => `${insurance} · ${total} consulta(s)`) } empty="Sem consultas." />
      </div>
    </div>
  )
}

function ReportList({ title, rows, empty }) {
  return <Card><h3 style={{ margin:'0 0 18px', fontSize:13, fontWeight:700, color:C.textSub, textTransform:'uppercase', letterSpacing:'0.08em' }}>{title}</h3>{rows.length === 0 ? <p style={{ color:C.textDim, fontSize:13 }}>{empty}</p> : rows.map(row => <div key={row} style={{ padding:'11px 0', borderTop:`1px solid ${C.border}22`, color:C.textSub }}>{row}</div>)}</Card>
}
