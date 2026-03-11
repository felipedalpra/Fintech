import { Link } from 'react-router-dom'
import { C } from '../theme.js'
import { Btn } from '../components/UI.jsx'

export function CTA() {
  return (
    <section style={{ padding:'16px 0 102px' }}>
      <div style={{ padding:'44px clamp(24px, 4vw, 52px)', borderRadius:32, background:'linear-gradient(135deg, rgba(255,111,60,0.16), rgba(59,130,246,0.16), rgba(0,184,217,0.12))', border:'1px solid rgba(255,255,255,0.12)', display:'flex', flexWrap:'wrap', justifyContent:'space-between', gap:20, alignItems:'center', boxShadow:'0 28px 90px rgba(0,0,0,0.28)', animation:'fadeUp 0.85s ease both' }}>
        <div>
          <div style={{ fontSize:12, color:'#D6EAF1', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Próximo passo</div>
          <h2 style={{ margin:'0 0 8px', fontSize:'clamp(30px, 4vw, 44px)', lineHeight:1.02, letterSpacing:'-0.04em', color:C.text }}>Tenha controle total sobre o financeiro da sua clínica</h2>
          <p style={{ margin:0, color:'#C2D3DA', fontSize:16, lineHeight:1.8, maxWidth:660 }}>Se a sua clínica já opera com padrão elevado, o financeiro também precisa refletir esse mesmo nível de gestão.</p>
        </div>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          <Link to="/signup" style={{ textDecoration:'none' }}><Btn style={{ padding:'15px 24px' }}>Criar conta</Btn></Link>
          <Link to="/login" style={{ textDecoration:'none' }}><Btn variant="ghost" style={{ padding:'15px 24px', borderColor:'rgba(255,255,255,0.18)', color:'#EAF4F8' }}>Acessar plataforma</Btn></Link>
        </div>
      </div>
    </section>
  )
}
