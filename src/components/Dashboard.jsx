import { C } from '../theme.js'
import { fmt, fmtN, getPeriodRange } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Progress } from './UI.jsx'

export function Dashboard({ data }) {
  const monthRange = getPeriodRange('month')
  const m = buildMetrics(data, { startDate:monthRange.start, endDate:monthRange.end, balanceDate:monthRange.end })
  const monthKeys = Object.keys({ ...m.revenueByMonth, ...m.expenseByMonth }).sort().slice(-6)
  const maxBar = Math.max(...monthKeys.map(key => Math.max(m.revenueByMonth[key] || 0, m.expenseByMonth[key] || 0)), 1)

  const kpis = [
    { label:'Receita do mês', value:fmt(m.grossRevenue), sub:`Lucro líquido: ${fmt(m.netProfit)}`, color:C.green, glow:C.green+'22', icon:'💰' },
    { label:'Cirurgias realizadas', value:fmtN(m.surgeriesCompleted), sub:`Ticket médio: ${fmt(m.averageTicket)}`, color:C.accent, glow:C.accent+'28', icon:'🩺' },
    { label:'Consultas realizadas', value:fmtN(m.consultationsCompleted), sub:`Entradas de consulta: ${fmt(m.consultationRevenue)}`, color:C.cyan, glow:C.cyan+'22', icon:'🗓️' },
    { label:'Fluxo de caixa', value:fmt(m.cashBalance), sub:`Previsão: ${fmt(m.prediction)}`, color:m.cashBalance >= 0 ? C.green : C.red, glow:(m.cashBalance >= 0 ? C.green : C.red)+'22', icon:'🏦' },
    { label:'Contas a receber', value:fmt(m.receivablesOpenTotal), sub:`Contas a pagar: ${fmt(m.payablesOpenTotal)}`, color:C.yellow, glow:C.yellow+'22', icon:'📥' },
    { label:'Procedimento mais lucrativo', value:m.byProcedure[0]?.name || 'Sem dados', sub:m.byProcedure[0] ? fmt(m.byProcedure[0].profit) : 'Cadastre cirurgias', color:C.purple, glow:C.purple+'22', icon:'📈' },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:16 }}>
        {kpis.map((kpi, index) => (
          <Card key={index} glow={kpi.glow} style={{ padding:20 }}>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:8 }}>{kpi.icon} {kpi.label}</div>
            <div style={{ fontSize:26, fontWeight:800, color:kpi.color, letterSpacing:'-0.02em' }}>{kpi.value}</div>
            <div style={{ fontSize:12, color:C.textDim, marginTop:4 }}>{kpi.sub}</div>
          </Card>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr', gap:16 }}>
        <Card>
          <h3 style={{ margin:'0 0 20px', fontSize:13, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>Fluxo de Caixa por Mês</h3>
          {monthKeys.length === 0 ? <p style={{ color:C.textDim, fontSize:13 }}>Ainda não há movimentações suficientes para montar o fluxo.</p> : (
            <>
              <div style={{ display:'flex', gap:8, alignItems:'flex-end', height:160 }}>
                {monthKeys.map(key => {
                  const rec = m.revenueByMonth[key] || 0
                  const exp = m.expenseByMonth[key] || 0
                  const recH = Math.max((rec / maxBar) * 140, 2)
                  const expH = Math.max((exp / maxBar) * 140, 2)
                  const label = new Date(`${key}-01T00:00:00`).toLocaleDateString('pt-BR', { month:'short' })
                  return <div key={key} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}><div style={{ display:'flex', gap:3, alignItems:'flex-end', height:140 }}><div style={{ width:16, height:recH, background:`linear-gradient(0deg,${C.green},${C.cyan})`, borderRadius:'3px 3px 0 0' }} /><div style={{ width:16, height:expH, background:`linear-gradient(0deg,${C.red}88,${C.red})`, borderRadius:'3px 3px 0 0' }} /></div><span style={{ fontSize:10, color:C.textDim }}>{label}</span></div>
                })}
              </div>
              <div style={{ display:'flex', gap:16, marginTop:14 }}><span style={{ fontSize:11, color:C.textSub, display:'flex', alignItems:'center', gap:6 }}><span style={{ width:10, height:10, background:C.green, borderRadius:2, display:'inline-block' }} />Entradas</span><span style={{ fontSize:11, color:C.textSub, display:'flex', alignItems:'center', gap:6 }}><span style={{ width:10, height:10, background:C.red, borderRadius:2, display:'inline-block' }} />Saídas</span></div>
            </>
          )}
        </Card>

        <Card>
          <h3 style={{ margin:'0 0 20px', fontSize:13, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>Procedimentos mais lucrativos</h3>
          {m.byProcedure.length === 0 && <p style={{ color:C.textDim, fontSize:13 }}>Sem cirurgias no período.</p>}
          {m.byProcedure.slice(0, 5).map(item => (
            <div key={item.id} style={{ marginBottom:18 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}><span style={{ fontSize:13, color:C.text, fontWeight:600 }}>{item.name}</span><span style={{ fontSize:13, color:C.textSub }}>{fmt(item.profit)}</span></div>
              <Progress val={item.profit} max={Math.max(m.byProcedure[0]?.profit || 1, 1)} color={C.accent} h={8} />
              <span style={{ fontSize:11, color:C.textDim, marginTop:3, display:'block' }}>{item.count} cirurgia{item.count !== 1 ? 's' : ''}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
