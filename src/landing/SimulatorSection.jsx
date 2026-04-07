import { useMemo, useState } from 'react'
import { Btn } from '../components/UI.jsx'

export function SimulatorSection() {
  const [surgeries, setSurgeries] = useState(12)
  const [ticket, setTicket] = useState(18500)
  const [costRate, setCostRate] = useState(42)

  const calc = useMemo(() => {
    const revenue = surgeries * ticket
    const costs = revenue * (costRate / 100)
    const profit = revenue - costs
    const recovered = profit * 0.07
    return { revenue, costs, profit, recovered }
  }, [surgeries, ticket, costRate])

  return (
    <section style={{ padding:'12px 0 82px' }}>
      <div className="reveal" style={{ marginBottom:20 }}>
        <div style={{ fontSize:12, color:'#FB7185', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Simulador rápido</div>
        <h2 style={{ margin:'0 0 10px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.04, letterSpacing:'-0.04em', color:'#F3FBFF', maxWidth:860 }}>
          Estime seu potencial financeiro em menos de 30 segundos
        </h2>
      </div>

      <div className="reveal" style={{ borderRadius:26, border:'1px solid rgba(255,255,255,0.12)', background:'linear-gradient(145deg, rgba(17, 16, 31, 0.84), rgba(10, 25, 38, 0.88))', padding:'clamp(18px, 3vw, 28px)' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap:14 }}>
          <Input label="Cirurgias por mês" value={surgeries} min={1} max={60} step={1} onChange={setSurgeries} />
          <Input label="Ticket médio (R$)" value={ticket} min={5000} max={100000} step={500} onChange={setTicket} />
          <Input label="Custo operacional (%)" value={costRate} min={10} max={85} step={1} onChange={setCostRate} />
        </div>

        <div style={{ marginTop:18, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:12 }}>
          <Kpi label="Faturamento" value={money(calc.revenue)} tone="#7DD3FC" />
          <Kpi label="Custos estimados" value={money(calc.costs)} tone="#FDA4AF" />
          <Kpi label="Lucro estimado" value={money(calc.profit)} tone="#86EFAC" />
          <Kpi label="Ganho com ajuste de 7%" value={money(calc.recovered)} tone="#FBCFE8" />
        </div>

        <div style={{ marginTop:18, display:'flex', flexWrap:'wrap', alignItems:'center', gap:10 }}>
          <div style={{ color:'#C2D6DF', fontSize:14 }}>Leve essa visibilidade para o dia a dia da clínica.</div>
          <a href="#planos" style={{ textDecoration:'none' }}><Btn style={{ padding:'11px 18px' }}>Começar teste grátis</Btn></a>
        </div>
      </div>
    </section>
  )
}

function Input({ label, value, min, max, step, onChange }) {
  return (
    <label style={{ display:'grid', gap:8 }}>
      <span style={{ fontSize:12, color:'#9FB8C5', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width:'100%' }}
      />
      <div style={{ color:'#F1FAFF', fontSize:18, fontWeight:800, letterSpacing:'-0.02em' }}>
        {label.includes('%') ? `${value}%` : label.includes('Ticket') ? money(value) : value}
      </div>
    </label>
  )
}

function Kpi({ label, value, tone }) {
  return (
    <article style={{ border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.03)', borderRadius:16, padding:'12px 14px' }}>
      <div style={{ fontSize:11, color:'#9BB2BE', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:23, fontWeight:900, color:tone, letterSpacing:'-0.03em' }}>{value}</div>
    </article>
  )
}

function money(v) {
  return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:0 }).format(v)
}
