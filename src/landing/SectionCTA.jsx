import { Link } from 'react-router-dom'
import { Btn } from '../components/UI.jsx'

export function SectionCTA({ tone = 'teal', compact = false }) {
  const palettes = {
    teal: {
      glow:'rgba(20, 184, 166, 0.28)',
      border:'rgba(45, 212, 191, 0.28)',
      bg:'linear-gradient(120deg, rgba(13, 45, 50, 0.85), rgba(10, 26, 38, 0.8))',
      title:'Pronto para testar no seu cenário?',
    },
    coral: {
      glow:'rgba(251, 113, 133, 0.26)',
      border:'rgba(251, 113, 133, 0.32)',
      bg:'linear-gradient(120deg, rgba(56, 23, 31, 0.8), rgba(12, 26, 38, 0.82))',
      title:'Quer ver isso funcionando hoje?',
    },
    blue: {
      glow:'rgba(56, 189, 248, 0.28)',
      border:'rgba(56, 189, 248, 0.34)',
      bg:'linear-gradient(120deg, rgba(14, 39, 68, 0.82), rgba(9, 24, 37, 0.82))',
      title:'Ative sua conta e valide em minutos',
    },
  }
  const current = palettes[tone] || palettes.teal

  return (
    <div className="reveal" style={{
      margin:compact ? '20px 0 34px' : '26px 0 42px',
      padding:compact ? '14px 16px' : '18px 22px',
      borderRadius:18,
      border:`1px solid ${current.border}`,
      background:current.bg,
      boxShadow:`0 18px 44px ${current.glow}`,
      display:'flex',
      alignItems:'center',
      justifyContent:'space-between',
      gap:12,
      flexWrap:'wrap',
    }}>
      <div style={{ color:'#E6F3F8', fontSize:compact ? 14 : 15, fontWeight:700, letterSpacing:'-0.02em' }}>{current.title}</div>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
        <a href="#planos" style={{ textDecoration:'none' }}><Btn style={{ padding:compact ? '10px 16px' : '11px 18px' }}>Testar grátis</Btn></a>
        <Link to="/login" style={{ textDecoration:'none' }}><Btn variant="ghost" style={{ padding:compact ? '10px 16px' : '11px 18px', borderColor:'rgba(255,255,255,0.26)', color:'#E8F4F8' }}>Entrar</Btn></Link>
      </div>
    </div>
  )
}
