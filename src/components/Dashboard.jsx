import { C } from '../theme.js'
import { fmt, fmtN, getPeriodRange } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Progress } from './UI.jsx'

export function Dashboard({ data }) {
  const monthRange = getPeriodRange('month')
  const m = buildMetrics(data, { startDate:monthRange.start, endDate:monthRange.end, balanceDate:monthRange.end })
  const monthKeys = Object.keys({ ...m.revenueByMonth, ...m.expenseByMonth }).sort().slice(-6)
  const maxBar = Math.max(...monthKeys.map(key => Math.max(m.revenueByMonth[key] || 0, m.expenseByMonth[key] || 0)), 1)
  const topProcedure = m.byProcedure[0]
  const topProduct = m.productsByPerformance[0]

  const kpis = [
    { label:'Receita do mês', value:fmt(m.grossRevenue), sub:`Lucro líquido: ${fmt(m.netProfit)}`, color:C.green, glow:C.green+'22' },
    { label:'Cirurgias realizadas', value:fmtN(m.surgeriesCompleted), sub:`Ticket médio: ${fmt(m.averageTicket)}`, color:C.accent, glow:C.accent+'22' },
    { label:'Consultas realizadas', value:fmtN(m.consultationsCompleted), sub:`Receita de consultas: ${fmt(m.consultationRevenue)}`, color:C.cyan, glow:C.cyan+'22' },
    { label:'Produtos vendidos', value:fmt(m.productSalesRevenue), sub:`Compras de estoque: ${fmt(m.productPurchaseTotal)}`, color:C.yellow, glow:C.yellow+'22' },
    { label:'Fluxo de caixa', value:fmt(m.cashBalance), sub:`Previsão: ${fmt(m.prediction)}`, color:m.cashBalance >= 0 ? C.green : C.red, glow:(m.cashBalance >= 0 ? C.green : C.red)+'22' },
    { label:'Contas em aberto', value:fmt(m.receivablesOpenTotal), sub:`A pagar: ${fmt(m.payablesOpenTotal)}`, color:C.purple, glow:C.purple+'22' },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:16 }}>
        {kpis.map(item => (
          <Card key={item.label} glow={item.glow} style={{ padding:20 }}>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:8 }}>{item.label}</div>
            <div style={{ fontSize:26, fontWeight:800, color:item.color, letterSpacing:'-0.02em' }}>{item.value}</div>
            <div style={{ fontSize:12, color:C.textDim, marginTop:4 }}>{item.sub}</div>
          </Card>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.25fr 1fr', gap:16 }}>
        <Card>
          <h3 style={{ margin:'0 0 20px', fontSize:13, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>Entradas x saídas por mês</h3>
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
          <h3 style={{ margin:'0 0 16px', fontSize:13, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>Ranking de rentabilidade</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}><span style={{ fontSize:13, color:C.text, fontWeight:600 }}>Procedimento líder</span><span style={{ fontSize:13, color:C.textSub }}>{topProcedure ? fmt(topProcedure.profit) : 'Sem dados'}</span></div>
              <Progress val={topProcedure?.profit || 0} max={Math.max(topProcedure?.profit || 1, 1)} color={C.accent} h={8} />
              <span style={{ fontSize:11, color:C.textDim, marginTop:3, display:'block' }}>{topProcedure ? topProcedure.name : 'Cadastre cirurgias para ranquear procedimentos.'}</span>
            </div>
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}><span style={{ fontSize:13, color:C.text, fontWeight:600 }}>Produto líder</span><span style={{ fontSize:13, color:C.textSub }}>{topProduct ? fmt(topProduct.profit) : 'Sem dados'}</span></div>
              <Progress val={topProduct?.profit || 0} max={Math.max(topProduct?.profit || 1, 1)} color={C.yellow} h={8} />
              <span style={{ fontSize:11, color:C.textDim, marginTop:3, display:'block' }}>{topProduct ? `${topProduct.name} · ${fmtN(topProduct.soldQty)} vendido(s)` : 'Cadastre produtos e registre vendas.'}</span>
            </div>
            <div style={{ padding:'14px 0', borderTop:`1px solid ${C.border}22` }}>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:8 }}>Composição do faturamento</div>
              <Stack label="Cirurgias" value={m.surgeryRevenue} total={m.grossRevenue} color={C.accent} />
              <Stack label="Consultas" value={m.consultationRevenue} total={m.grossRevenue} color={C.cyan} />
              <Stack label="Produtos" value={m.productSalesRevenue} total={m.grossRevenue} color={C.yellow} />
              <Stack label="Outras receitas" value={m.extraRevenueTotal} total={m.grossRevenue} color={C.green} />
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Stack({ label, value, total, color }) {
  return <div style={{ marginBottom:10 }}><div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span style={{ color:C.textSub, fontSize:12 }}>{label}</span><span style={{ color, fontSize:12, fontWeight:700 }}>{fmt(value)}</span></div><Progress val={value} max={Math.max(total || 1, 1)} color={color} h={7} /></div>
}
