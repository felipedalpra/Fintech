import { Link } from 'react-router-dom'
import { Btn } from '../components/UI.jsx'

export function CTA() {
  return (
    <section style={{ padding:'12px 0 102px' }}>
      <div className="reveal" style={{ padding:'36px clamp(22px, 4vw, 48px)', borderRadius:30, background:'linear-gradient(120deg, rgba(56,189,248,0.2), rgba(45,212,191,0.22), rgba(251,113,133,0.2))', border:'1px solid rgba(255,255,255,0.16)', boxShadow:'0 26px 84px rgba(0,0,0,0.3)', display:'flex', flexWrap:'wrap', justifyContent:'space-between', alignItems:'center', gap:16 }}>
        <div>
          <div style={{ fontSize:12, color:'#E7F7FC', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Último passo</div>
          <h2 style={{ margin:'0 0 8px', fontSize:'clamp(30px, 4vw, 44px)', lineHeight:1.02, letterSpacing:'-0.04em', color:'#F8FDFF' }}>
            Coloque o financeiro da clínica no mesmo nível da sua entrega médica
          </h2>
          <p style={{ margin:0, color:'#D0E4EC', fontSize:15, lineHeight:1.65, maxWidth:620 }}>
            Ative agora, valide com seu time e decida com números limpos.
          </p>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <a href="#planos" style={{ textDecoration:'none' }}><Btn style={{ padding:'14px 22px' }}>Escolher plano</Btn></a>
          <Link to="/login" style={{ textDecoration:'none' }}><Btn variant="ghost" style={{ padding:'14px 22px', borderColor:'rgba(255,255,255,0.24)', color:'#ECF8FC' }}>Entrar</Btn></Link>
        </div>
      </div>
    </section>
  )
}
