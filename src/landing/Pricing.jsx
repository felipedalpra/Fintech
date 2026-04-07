import { Link } from 'react-router-dom'
import { Btn } from '../components/UI.jsx'
import { BILLING_CYCLES, FREE_TRIAL_DAYS, buildCheckoutUrl } from '../billing/plans.js'

export function Pricing() {
  return (
    <section style={{ padding:'12px 0 82px' }}>
      <div className="reveal" style={{ marginBottom:20 }}>
        <div style={{ fontSize:12, color:'#FDE68A', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Planos</div>
        <h2 style={{ margin:'0 0 8px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.04, letterSpacing:'-0.04em', color:'#F3FBFF' }}>
          Um produto, ciclos diferentes para encaixar no seu caixa
        </h2>
        <p style={{ margin:0, color:'#A8C1CC', fontSize:16, lineHeight:1.65, maxWidth:720 }}>
          {FREE_TRIAL_DAYS} dias grátis, sem cartão. Depois, você mantém acesso no ciclo que preferir.
        </p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(250px, 1fr))', gap:14, alignItems:'stretch' }}>
        {BILLING_CYCLES.map((cycle, index) => (
          <article
            key={cycle.id}
            className="reveal"
            style={{
              padding:20,
              borderRadius:20,
              background:index === 2 ? 'linear-gradient(140deg, rgba(15, 50, 68, 0.82), rgba(8, 24, 40, 0.9))' : 'rgba(255,255,255,0.03)',
              border:index === 2 ? '1px solid rgba(125,211,252,0.5)' : '1px solid rgba(255,255,255,0.1)',
              boxShadow:index === 2 ? '0 18px 46px rgba(56,189,248,0.22)' : 'none',
              display:'flex',
              flexDirection:'column',
              minHeight:312,
            }}
          >
            <div style={{ minHeight:26, marginBottom:8 }}>
              {cycle.badge && <div style={{ display:'inline-flex', padding:'5px 10px', borderRadius:999, background:'rgba(255,255,255,0.12)', color:'#D8F3FF', fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em' }}>{cycle.badge}</div>}
            </div>

            <div style={{ color:'#F2FBFF', fontSize:20, fontWeight:800, marginBottom:6, whiteSpace:'nowrap' }}>{cycle.label}</div>
            <div style={{ display:'flex', alignItems:'baseline', gap:4, marginBottom:6, flexWrap:'nowrap' }}>
              <span style={{ fontSize:34, fontWeight:900, color:'#F4FCFF', letterSpacing:'-0.03em', whiteSpace:'nowrap' }}>{cycle.headline}</span>
              <span style={{ color:'#8CA6B2', fontSize:13, whiteSpace:'nowrap' }}>{cycle.periodLabel}</span>
            </div>

            <p style={{ margin:'0 0 8px', color:'#D1E6EF', fontSize:13, fontWeight:700, whiteSpace:'nowrap' }}>
              {cycle.id === 'semestral' ? 'Cobrança a cada 6 meses' : cycle.id === 'anual' ? 'Cobrança anual' : cycle.cadenceLabel}
            </p>
            <p style={{ margin:'0 0 12px', color:'#A4BCC7', fontSize:14, lineHeight:1.5, minHeight:42 }}>
              {cycle.note}
            </p>
            <p style={{ margin:'0 0 16px', color:'#86EFAC', fontSize:12, fontWeight:800 }}>
              {FREE_TRIAL_DAYS} dias grátis. Cancele quando quiser.
            </p>

            <Link to={buildCheckoutUrl(cycle.id)} style={{ textDecoration:'none', display:'block', marginTop:'auto' }}>
              <Btn variant={index === 2 ? 'primary' : 'ghost'} style={{ width:'100%', justifyContent:'center', display:'inline-flex', padding:'12px 16px' }}>
                Iniciar trial
              </Btn>
            </Link>
          </article>
        ))}
      </div>
    </section>
  )
}
