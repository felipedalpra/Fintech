import { Link } from 'react-router-dom'
import { C } from '../theme.js'
import { BrandLogo } from '../components/BrandLogo.jsx'
import { Btn } from '../components/UI.jsx'

export function Hero() {
  return (
    <section style={{ padding:'clamp(54px, 9vw, 104px) 0 clamp(54px, 8vw, 84px)', position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', inset:0, background:`radial-gradient(circle at 18% 18%, rgba(0,184,217,0.22), transparent 24%), radial-gradient(circle at 82% 14%, rgba(255,111,60,0.24), transparent 24%), radial-gradient(circle at 52% 78%, rgba(255,255,255,0.06), transparent 28%)` }} />
      <div style={{ position:'absolute', top:80, right:'12%', width:220, height:220, borderRadius:'50%', background:'radial-gradient(circle, rgba(255,255,255,0.14), transparent 64%)', filter:'blur(8px)', animation:'orbFloat 10s ease-in-out infinite' }} />
      <div style={{ position:'relative', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap:30, alignItems:'center' }}>
        <div style={{ animation:'fadeUp 0.8s ease both' }}>
          <div style={{ display:'inline-flex', padding:'8px 14px', borderRadius:999, border:'1px solid rgba(255,255,255,0.14)', background:'rgba(255,255,255,0.04)', color:'#C8E8F1', fontSize:12, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:700, marginBottom:18 }}>
            Mais controle. Mais margem. Menos improviso.
          </div>
          <h1 style={{ margin:'0 0 18px', fontSize:'clamp(44px, 7vw, 78px)', lineHeight:0.92, letterSpacing:'-0.06em', color:C.text, maxWidth:760 }}>
            A forma mais elegante de comandar o financeiro da sua clínica
          </h1>
          <p style={{ margin:'0 0 14px', color:'#D3E2EA', fontSize:'clamp(18px, 4vw, 22px)', lineHeight:1.45, maxWidth:700 }}>
            Gestão financeira inteligente para cirurgiões plásticos.
          </p>
          <p style={{ margin:'0 0 28px', color:'#8EA6B2', fontSize:'clamp(15px, 3.8vw, 17px)', lineHeight:1.8, maxWidth:680 }}>
            Tenha visibilidade clara do faturamento, da lucratividade de cada cirurgia e do caixa da clínica sem depender de planilhas, controles paralelos ou decisões no escuro.
          </p>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:28 }}>
            <Link to="/signup" style={{ textDecoration:'none' }}><Btn style={{ padding:'15px 24px', boxShadow:'0 18px 40px rgba(59,130,246,0.28)' }}>Criar conta</Btn></Link>
            <Link to="/login" style={{ textDecoration:'none' }}><Btn variant="ghost" style={{ padding:'15px 24px', borderColor:'rgba(255,255,255,0.18)', color:'#EAF4F8' }}>Acessar plataforma</Btn></Link>
          </div>
          <div style={{ display:'flex', gap:22, flexWrap:'wrap', color:'#A8BCC6', fontSize:13 }}>
            <span>Visão de caixa em tempo real</span>
            <span>Rentabilidade por procedimento</span>
            <span>DRE e balanço automáticos</span>
          </div>
        </div>

        <div style={{ display:'grid', gap:14, animation:'fadeUp 1s ease both', animationDelay:'0.12s' }}>
          <div style={{ padding:22, borderRadius:28, background:'linear-gradient(145deg, rgba(9,18,28,0.96), rgba(17,24,39,0.96))', border:'1px solid rgba(255,255,255,0.12)', boxShadow:'0 28px 90px rgba(0,0,0,0.34)', animation:'cardFloat 8s ease-in-out infinite' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
              <div>
                <div style={{ fontSize:11, color:'#8AA2AE', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Clínica no controle</div>
              <BrandLogo size="md" />
              </div>
              <div style={{ padding:'8px 12px', borderRadius:999, background:'rgba(16,185,129,0.16)', color:'#6EE7B7', fontSize:12, fontWeight:700 }}>Caixa saudável</div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, marginBottom:12 }}>
              {[
                ['Faturamento do mês', 'R$ 186 mil', '#5EEAD4'],
                ['Lucro líquido', 'R$ 72 mil', '#7DD3FC'],
                ['Ticket médio', 'R$ 18,4 mil', '#FDBA74'],
                ['Procedimento líder', 'Mamoplastia', '#C4B5FD'],
              ].map(([label, value, color], index) => <div key={label} style={{ padding:15, borderRadius:18, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', animation:`fadeUp 0.7s ease both`, animationDelay:`${0.2 + index * 0.07}s` }}><div style={{ fontSize:10, color:'#8097A2', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{label}</div><div style={{ color, fontSize:18, fontWeight:800 }}>{value}</div></div>)}
            </div>
            <div style={{ padding:16, borderRadius:18, background:'linear-gradient(135deg, rgba(0,184,217,0.12), rgba(255,111,60,0.1))', border:'1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize:11, color:'#A8BCC6', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Resultado percebido</div>
              <div style={{ color:C.text, fontSize:16, lineHeight:1.65 }}>Veja o que realmente sobra em cada cirurgia, antecipe gargalos no caixa e conduza a clínica com confiança financeira.</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
