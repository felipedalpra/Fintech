import { useEffect, useMemo, useState } from 'react'
import { Btn } from '../components/UI.jsx'

const MARKET_BENCHMARK = 35

function getMarginZone(pct) {
  if (pct < 20) return { label:'Crítica', color:'#FDA4AF', bg:'rgba(251,113,133,0.12)', border:'rgba(251,113,133,0.3)' }
  if (pct < 35) return { label:'Atenção', color:'#FDE68A', bg:'rgba(253,230,138,0.1)', border:'rgba(253,230,138,0.3)' }
  if (pct <= 55) return { label:'Saudável', color:'#86EFAC', bg:'rgba(134,239,172,0.1)', border:'rgba(134,239,172,0.3)' }
  return { label:'Excelente', color:'#67E8F9', bg:'rgba(103,232,249,0.1)', border:'rgba(103,232,249,0.3)' }
}

export function SimulatorSection() {
  const [surgeries, setSurgeries] = useState(10)
  const [ticket, setTicket] = useState(18000)
  const [costRate, setCostRate] = useState(58)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 640 : false)

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 640) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const calc = useMemo(() => {
    const revenue = surgeries * ticket
    const costs = revenue * (costRate / 100)
    const profit = revenue - costs
    const costSaving = costs * 0.07
    const marginPct = Math.round(100 - costRate)
    return { revenue, costs, profit, costSaving, marginPct }
  }, [surgeries, ticket, costRate])

  const zone = getMarginZone(calc.marginPct)
  const benchmarkPct = Math.min(Math.max(MARKET_BENCHMARK, 0), 100)
  const userPct = Math.min(Math.max(calc.marginPct, 0), 100)

  return (
    <section style={{ padding:'12px 0 82px' }}>
      <div className="reveal" style={{ marginBottom:20 }}>
        <div style={{ fontSize:12, color:'#FB7185', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Simulador rápido</div>
        <h2 style={{ margin:'0 0 10px', fontSize:'clamp(28px, 4vw, 48px)', lineHeight:1.04, letterSpacing:'-0.04em', color:'#F3FBFF', maxWidth:860 }}>
          Estime seu potencial financeiro em menos de 30 segundos
        </h2>
      </div>

      <div className="reveal" style={{ borderRadius:26, border:'1px solid rgba(255,255,255,0.12)', background:'linear-gradient(145deg, rgba(17,16,31,0.84), rgba(10,25,38,0.88))', padding:isMobile ? '20px 16px' : 'clamp(18px, 3vw, 28px)' }}>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap:isMobile ? 18 : 14 }}>
          <Input label="Cirurgias por mês" value={surgeries} min={1} max={60} step={1} onChange={setSurgeries} isMobile={isMobile} format="number" />
          <Input label="Ticket médio (R$)" value={ticket} min={5000} max={100000} step={500} onChange={setTicket} isMobile={isMobile} format="currency" />
          <Input label="Custo operacional (%)" value={costRate} min={10} max={85} step={1} onChange={setCostRate} isMobile={isMobile} format="percent" />
        </div>

        <div style={{ marginTop:20, display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:10 }}>
          <Kpi label="Faturamento" value={money(calc.revenue)} tone="#7DD3FC" isMobile={isMobile} />
          <Kpi label="Lucro estimado" value={money(calc.profit)} tone="#86EFAC" isMobile={isMobile} />
          <Kpi label="Custos totais" value={money(calc.costs)} tone="#FDA4AF" isMobile={isMobile} />
          <Kpi label="Economia c/ redução de 7% em custos" value={money(calc.costSaving)} tone="#FBCFE8" isMobile={isMobile} />
        </div>

        <div style={{ marginTop:20, padding:isMobile ? '14px' : '18px 20px', borderRadius:18, background:zone.bg, border:`1px solid ${zone.border}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, gap:8, flexWrap:'wrap' }}>
            <div style={{ fontSize:12, color:'#A8C0CA', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Saúde da margem</div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:14, color:zone.color, fontWeight:900 }}>{userPct}%</span>
              <span style={{ fontSize:11, padding:'3px 9px', borderRadius:999, background:`${zone.color}22`, color:zone.color, fontWeight:700 }}>{zone.label}</span>
            </div>
          </div>

          <div style={{ position:'relative', height:16, borderRadius:99, background:'rgba(255,255,255,0.08)', overflow:'visible', marginBottom:12 }}>
            <div style={{ position:'absolute', inset:0, borderRadius:99, background:'linear-gradient(90deg, #FDA4AF 0%, #FDE68A 20%, #86EFAC 35%, #86EFAC 55%, #67E8F9 100%)', opacity:0.28 }} />
            <div style={{ position:'absolute', top:0, left:0, height:'100%', borderRadius:99, background:`linear-gradient(90deg, #FDA4AF 0%, ${zone.color} 100%)`, width:`${userPct}%`, transition:'width 0.4s ease', opacity:0.9 }} />
            <div style={{ position:'absolute', top:'50%', left:`${benchmarkPct}%`, transform:'translate(-50%, -50%)', width:3, height:26, background:'rgba(255,255,255,0.85)', borderRadius:2, boxShadow:'0 0 8px rgba(255,255,255,0.4)', zIndex:2 }} />
          </div>

          {isMobile ? (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 10px', fontSize:10 }}>
              <span style={{ color:'#FDA4AF' }}>■ Crítica &lt;20%</span>
              <span style={{ color:'#FDE68A' }}>■ Atenção 20–35%</span>
              <span style={{ color:'#86EFAC' }}>■ Saudável 35–55%</span>
              <span style={{ color:'rgba(255,255,255,0.6)' }}>│ Mercado: {MARKET_BENCHMARK}%</span>
            </div>
          ) : (
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:6, fontSize:11 }}>
              <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                <span style={{ color:'#FDA4AF' }}>■ Crítica &lt;20%</span>
                <span style={{ color:'#FDE68A' }}>■ Atenção 20–35%</span>
                <span style={{ color:'#86EFAC' }}>■ Saudável 35–55%</span>
                <span style={{ color:'#67E8F9' }}>■ Excelente &gt;55%</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:5, color:'rgba(255,255,255,0.65)', whiteSpace:'nowrap' }}>
                <div style={{ width:3, height:14, background:'rgba(255,255,255,0.7)', borderRadius:2 }} />
                <span>Média mercado: {MARKET_BENCHMARK}%</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop:18, display:'flex', flexWrap:'wrap', alignItems:'center', gap:10 }}>
          <div style={{ color:'#C2D6DF', fontSize:14, flex:1, minWidth:isMobile ? '100%' : 0 }}>Leve essa visibilidade para o dia a dia da clínica.</div>
          <a href="#planos" style={{ textDecoration:'none', width:isMobile ? '100%' : 'auto' }}>
            <Btn style={{ padding:'13px 20px', width:isMobile ? '100%' : 'auto' }}>Começar teste grátis</Btn>
          </a>
        </div>
      </div>
    </section>
  )
}

function Input({ label, value, min, max, step, onChange, isMobile, format = 'number' }) {
  const formattedValue = format === 'percent' ? `${value}%` : format === 'currency' ? money(value) : value
  return (
    <label style={{ display:'grid', gap:8 }}>
      <span style={{ fontSize:isMobile ? 11 : 12, color:'#9FB8C5', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width:'100%', cursor:'pointer' }}
      />
      <div style={{ color:'#F1FAFF', fontSize:isMobile ? 20 : 18, fontWeight:800, letterSpacing:'-0.02em' }}>
        {formattedValue}
      </div>
    </label>
  )
}

function Kpi({ label, value, tone, isMobile }) {
  return (
    <article style={{ border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.03)', borderRadius:14, padding:isMobile ? '10px 12px' : '12px 14px' }}>
      <div style={{ fontSize:isMobile ? 10 : 11, color:'#9BB2BE', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:5, lineHeight:1.3 }}>{label}</div>
      <div style={{ fontSize:isMobile ? 18 : 22, fontWeight:900, color:tone, letterSpacing:'-0.03em' }}>{value}</div>
    </article>
  )
}

function money(v) {
  return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:0 }).format(v)
}
