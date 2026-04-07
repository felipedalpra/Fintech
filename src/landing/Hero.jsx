import { Link } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo.jsx'
import { Btn } from '../components/UI.jsx'

const MINI_STATS = [
  ['Receita do mês', 'R$ 186 mil', '#67E8F9'],
  ['Margem média', '38,7%', '#86EFAC'],
  ['Consultas', '94', '#FDE68A'],
]

export function Hero() {
  return (
    <section style={{ padding:'clamp(50px, 8vw, 94px) 0 clamp(50px, 7vw, 72px)', position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', inset:0, background:'radial-gradient(circle at 12% 16%, rgba(45, 212, 191, 0.18), transparent 30%), radial-gradient(circle at 84% 10%, rgba(251, 113, 133, 0.18), transparent 28%), radial-gradient(circle at 54% 82%, rgba(56, 189, 248, 0.12), transparent 34%)' }} />

      <div style={{ position:'relative', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap:26, alignItems:'center' }}>
        <div className="reveal">
          <div style={{ display:'inline-flex', padding:'8px 14px', borderRadius:999, border:'1px solid rgba(255,255,255,0.2)', background:'rgba(255,255,255,0.06)', color:'#D5F4FF', fontSize:12, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:700, marginBottom:16 }}>
            Gestão premium para clínicas premium
          </div>
          <h1 style={{ margin:'0 0 14px', fontSize:'clamp(42px, 6.7vw, 76px)', lineHeight:0.94, letterSpacing:'-0.05em', color:'#F4FCFF', maxWidth:760 }}>
            Menos ruído. Mais decisão financeira.
          </h1>
          <p style={{ margin:'0 0 24px', color:'#B8CFD8', fontSize:'clamp(16px, 3.8vw, 21px)', lineHeight:1.45, maxWidth:660 }}>
            Veja caixa, margem e desempenho cirúrgico em uma tela viva e atualizada.
          </p>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:24 }}>
            <a href="#planos" style={{ textDecoration:'none' }}><Btn style={{ padding:'14px 22px', boxShadow:'0 18px 42px rgba(20,184,166,0.32)' }}>Começar grátis</Btn></a>
            <Link to="/login" style={{ textDecoration:'none' }}><Btn variant="ghost" style={{ padding:'14px 22px', borderColor:'rgba(255,255,255,0.24)', color:'#ECF8FC' }}>Acessar plataforma</Btn></Link>
          </div>
          <div style={{ display:'flex', gap:18, flexWrap:'wrap', color:'#B4CBD5', fontSize:13 }}>
            <span>Sem cartão no trial</span>
            <span>Rentabilidade por cirurgia</span>
            <span>DRE e caixa automáticos</span>
          </div>
        </div>

        <div className="reveal" style={{ display:'grid', gap:12 }}>
          <div style={{ padding:'20px clamp(16px, 2.8vw, 24px)', borderRadius:26, background:'linear-gradient(145deg, rgba(8,18,28,0.96), rgba(13,28,39,0.92))', border:'1px solid rgba(255,255,255,0.14)', boxShadow:'0 24px 70px rgba(0,0,0,0.3)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <BrandLogo size="md" />
              <div style={{ padding:'7px 10px', borderRadius:999, background:'rgba(52,211,153,0.16)', color:'#86EFAC', fontSize:11, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>
                Atualizado agora
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:10, marginBottom:12 }}>
              {MINI_STATS.map(([label, value, tone], idx) => (
                <article key={label} style={{ padding:12, borderRadius:14, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.04)', animation:`cardFloat 7s ease-in-out ${idx * 0.3}s infinite` }}>
                  <div style={{ fontSize:10, color:'#7E98A5', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{label}</div>
                  <div style={{ color:tone, fontSize:20, fontWeight:900, letterSpacing:'-0.03em' }}>{value}</div>
                </article>
              ))}
            </div>

            <div style={{ border:'1px solid rgba(255,255,255,0.12)', borderRadius:14, padding:12, background:'linear-gradient(135deg, rgba(45,212,191,0.12), rgba(56,189,248,0.12))' }}>
              <div style={{ fontSize:11, color:'#B3CBD6', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Projeção de caixa</div>
              <div style={{ height:58, display:'grid', alignItems:'end', gridTemplateColumns:'repeat(6, 1fr)', gap:6 }}>
                {[32, 38, 42, 48, 54, 62].map((h, idx) => (
                  <div key={h} style={{ height:`${h}px`, borderRadius:6, background:idx >= 4 ? 'linear-gradient(180deg, #5EEAD4, #14B8A6)' : 'linear-gradient(180deg, #7DD3FC, #0EA5E9)', animation:`pulseBar 1.8s ease-in-out ${idx * 0.12}s infinite` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
