import { Link } from 'react-router-dom'
import { C } from '../theme.js'
import { Btn } from '../components/UI.jsx'
import { BILLING_CYCLES, buildCheckoutUrl } from '../billing/plans.js'

export function Pricing() {
  return (
    <section style={{ padding:'10px 0 82px' }}>
      <div style={{ marginBottom:24, animation:'fadeUp 0.8s ease both' }}>
        <div style={{ fontSize:12, color:'#FCD34D', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Oferta</div>
        <h2 style={{ margin:'0 0 12px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.02, letterSpacing:'-0.04em', color:C.text }}>Um único plano, com liberdade para escolher o ciclo ideal</h2>
        <p style={{ margin:'0 0 14px', color:'#9FB2BC', fontSize:17, lineHeight:1.8, maxWidth:760 }}>Por agora, os cirurgiões podem criar conta gratuitamente. A estrutura de billing já fica pronta para Stripe depois.</p>
        <div style={{ display:'inline-flex', padding:'8px 14px', borderRadius:999, background:'rgba(16,185,129,0.16)', color:'#6EE7B7', fontSize:13, fontWeight:700 }}>7 dias grátis liberados agora</div>
      </div>

      <div style={{ padding:'28px clamp(22px, 4vw, 34px)', borderRadius:30, background:'linear-gradient(155deg, rgba(17,24,39,0.98), rgba(10,16,27,0.98))', border:'1px solid rgba(255,255,255,0.1)', boxShadow:'0 32px 90px rgba(0,0,0,0.24)' }}>
        <div style={{ display:'grid', gridTemplateColumns:'minmax(260px, 0.9fr) minmax(0,1.1fr)', gap:22, alignItems:'start' }}>
          <div style={{ animation:'fadeUp 0.85s ease both' }}>
            <div style={{ fontSize:24, color:C.text, fontWeight:900, letterSpacing:'-0.04em', marginBottom:10 }}>SurgiFlow Premium</div>
            <p style={{ margin:'0 0 16px', color:'#A9BCC5', fontSize:15, lineHeight:1.8 }}>Cirurgias, consultas, produtos, fluxo de caixa, DRE, balanço, metas e IA em uma única assinatura.</p>
            <div style={{ display:'grid', gap:10, color:'#D3E2EA', fontSize:14 }}>
              <span>• Dashboard financeiro completo</span>
              <span>• Gestão de cirurgias e consultas</span>
              <span>• Produtos, modeladores e estoque</span>
              <span>• Contas a pagar e receber</span>
              <span>• Fluxo de caixa, DRE e balanço</span>
              <span>• Metas financeiras e assistente IA</span>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(210px, 1fr))', gap:16 }}>
            {BILLING_CYCLES.map((cycle, index) => (
              <article key={cycle.id} style={{ padding:22, borderRadius:24, background:index === 2 ? 'linear-gradient(155deg, rgba(59,130,246,0.18), rgba(17,24,39,0.96))' : 'rgba(255,255,255,0.03)', border:index === 2 ? '1px solid rgba(125,211,252,0.45)' : '1px solid rgba(255,255,255,0.08)', animation:'fadeUp 0.85s ease both', animationDelay:`${0.06 * index}s` }}>
                {cycle.badge && <div style={{ display:'inline-flex', padding:'6px 10px', borderRadius:999, background:'rgba(255,255,255,0.08)', color:'#D8F3FF', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>{cycle.badge}</div>}
                <div style={{ color:C.text, fontSize:22, fontWeight:800, marginBottom:8 }}>{cycle.label}</div>
                <div style={{ display:'flex', alignItems:'baseline', gap:4, marginBottom:10 }}><span style={{ fontSize:36, fontWeight:900, color:C.text }}>{cycle.price}</span><span style={{ color:'#8198A3', fontSize:13 }}>/mês</span></div>
                <p style={{ margin:'0 0 12px', color:'#A9BCC5', fontSize:14, lineHeight:1.7 }}>{cycle.note}</p>
                <p style={{ margin:'0 0 18px', color:'#6EE7B7', fontSize:13, fontWeight:700 }}>Acesso gratuito no lançamento + teste grátis de 7 dias</p>
                <Link to={buildCheckoutUrl(cycle.id)} style={{ textDecoration:'none' }}><Btn variant={index === 2 ? 'primary' : 'ghost'} style={{ width:'100%', justifyContent:'center', display:'inline-flex', padding:'13px 18px' }}>Criar conta grátis</Btn></Link>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
