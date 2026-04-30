import { C } from '../theme.js'
import { fmt, fmtN } from '../utils.js'
import { maskFinancialValue, useFinancialPrivacy } from '../context/FinancialPrivacyContext.jsx'
import { Progress } from './UI.jsx'

export function InsuranceBreakdown({ consultationsByInsurance }) {
  const { financialPrivacyMode } = useFinancialPrivacy()
  const mask = v => maskFinancialValue(v, financialPrivacyMode, fmt)

  const entries = Object.entries(consultationsByInsurance || {})
    .map(([name, d]) => ({
      name,
      count: d.count,
      revenue: d.revenue,
      cost: d.cost,
      profit: d.revenue - d.cost,
      avgTicket: d.count > 0 ? d.revenue / d.count : 0,
      margin: d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const totalRevenue = entries.reduce((s, e) => s + e.revenue, 0)
  const totalConsultations = entries.reduce((s, e) => s + e.count, 0)

  if (entries.length === 0) {
    return (
      <p style={{ margin: 0, color: C.textDim, fontSize: 13 }}>
        Nenhuma consulta no período. Cadastre consultas com forma de pagamento para ver a análise por convênio.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 60px 90px 90px 90px 70px',
        gap: 8, padding: '0 4px 10px',
        borderBottom: `1px solid ${C.border}44`,
        marginBottom: 4,
      }}>
        {['Convênio / Pagamento', 'Cons.', 'Receita', 'Ticket médio', 'Lucro', 'Margem'].map(h => (
          <div key={h} style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</div>
        ))}
      </div>

      {entries.map(e => {
        const revShare = totalRevenue > 0 ? (e.revenue / totalRevenue) * 100 : 0
        const marginColor = e.margin >= 50 ? C.green : e.margin >= 25 ? C.yellow : C.red
        return (
          <div key={e.name} style={{ padding: '10px 4px', borderBottom: `1px solid ${C.border}18` }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 60px 90px 90px 90px 70px',
              gap: 8, alignItems: 'center', marginBottom: 6,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.name}
              </div>
              <div style={{ fontSize: 13, color: C.textSub, fontVariantNumeric: 'tabular-nums' }}>
                {fmtN(e.count)}
                <span style={{ fontSize: 10, color: C.textDim, marginLeft: 2 }}>
                  ({totalConsultations > 0 ? Math.round((e.count / totalConsultations) * 100) : 0}%)
                </span>
              </div>
              <div style={{ fontSize: 13, color: C.green, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {mask(e.revenue)}
              </div>
              <div style={{ fontSize: 13, color: C.textSub, fontVariantNumeric: 'tabular-nums' }}>
                {mask(e.avgTicket)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: e.profit >= 0 ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>
                {mask(e.profit)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: marginColor }}>
                {e.margin.toFixed(1)}%
              </div>
            </div>
            <Progress val={revShare} max={100} color={C.accent} h={4} />
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 3 }}>{revShare.toFixed(1)}% da receita de consultas</div>
          </div>
        )
      })}

      {/* Summary row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 60px 90px 90px 90px 70px',
        gap: 8, padding: '12px 4px 0',
        borderTop: `1px solid ${C.border}55`,
        marginTop: 4,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textSub }}>Total</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textSub }}>{fmtN(totalConsultations)}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>{mask(totalRevenue)}</div>
        <div style={{ fontSize: 12, color: C.textDim }}>{mask(totalConsultations > 0 ? totalRevenue / totalConsultations : 0)}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: entries.reduce((s, e) => s + e.profit, 0) >= 0 ? C.green : C.red }}>
          {mask(entries.reduce((s, e) => s + e.profit, 0))}
        </div>
        <div style={{ fontSize: 12, color: C.textDim }}>—</div>
      </div>
    </div>
  )
}
