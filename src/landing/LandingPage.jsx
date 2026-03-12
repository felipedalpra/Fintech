import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { C } from '../theme.js'
import { Hero } from './Hero.jsx'
import { Benefits } from './Benefits.jsx'
import { Features } from './Features.jsx'
import { ProofSection } from './ProofSection.jsx'
import { Pricing } from './Pricing.jsx'
import { FAQ } from './FAQ.jsx'
import { CTA } from './CTA.jsx'
import { BrandLogo } from '../components/BrandLogo.jsx'

export function LandingPage() {
  const { user, loading } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 900 : false)

  useEffect(() => {
    function onResize() {
      const nextMobile = window.innerWidth < 900
      setIsMobile(nextMobile)
      if (!nextMobile) setMenuOpen(false)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (!loading && user) {
    return <Navigate to="/app/dashboard" replace />
  }

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(180deg, #050B12 0%, #07101A 38%, #09121C 100%)', color:C.text, overflow:'hidden' }}>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(22px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes orbFloat {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(0, -18px, 0) scale(1.06); }
        }
        @keyframes cardFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes pulseLine {
          0%, 100% { opacity: 0.45; transform: scaleX(0.96); }
          50% { opacity: 1; transform: scaleX(1); }
        }
      `}</style>
      <header style={{ position:'sticky', top:0, zIndex:20, backdropFilter:'blur(14px)', background:'rgba(5,11,18,0.68)', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ maxWidth:1180, margin:'0 auto', padding:isMobile ? '14px 16px' : '16px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:20 }}>
          <BrandLogo size="sm" />
          {isMobile ? (
            <button type="button" onClick={() => setMenuOpen(current => !current)} style={{ width:42, height:42, borderRadius:12, border:'1px solid rgba(255,255,255,0.14)', background:'rgba(255,255,255,0.04)', color:'#EAF4F8', cursor:'pointer', fontSize:18 }}>
              {menuOpen ? '×' : '☰'}
            </button>
          ) : (
            <nav style={{ display:'flex', gap:18, alignItems:'center', flexWrap:'wrap' }}>
              <a href="#beneficios" style={navLink}>Benefícios</a>
              <a href="#funcionalidades" style={navLink}>Funcionalidades</a>
              <a href="#planos" style={navLink}>Planos</a>
              <a href="#faq" style={navLink}>FAQ</a>
              <Link to="/login" style={navLink}>Login</Link>
              <Link to="/signup" style={{ ...navLink, padding:'10px 14px', border:'1px solid rgba(255,255,255,0.14)', borderRadius:999, color:'#EAF4F8' }}>Criar conta</Link>
            </nav>
          )}
        </div>
        {isMobile && menuOpen && (
          <div style={{ maxWidth:1180, margin:'0 auto', padding:'0 16px 16px' }}>
            <nav style={{ display:'grid', gap:10, padding:14, borderRadius:18, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.04)' }}>
              <a href="#beneficios" onClick={() => setMenuOpen(false)} style={mobileNavLink}>Benefícios</a>
              <a href="#funcionalidades" onClick={() => setMenuOpen(false)} style={mobileNavLink}>Funcionalidades</a>
              <a href="#planos" onClick={() => setMenuOpen(false)} style={mobileNavLink}>Planos</a>
              <a href="#faq" onClick={() => setMenuOpen(false)} style={mobileNavLink}>FAQ</a>
              <Link to="/login" onClick={() => setMenuOpen(false)} style={mobileNavLink}>Login</Link>
              <Link to="/signup" onClick={() => setMenuOpen(false)} style={{ ...mobileNavLink, textAlign:'center', border:'1px solid rgba(255,255,255,0.14)', borderRadius:14, color:'#EAF4F8' }}>Criar conta</Link>
            </nav>
          </div>
        )}
      </header>

      <main>
        <div style={{ maxWidth:1180, margin:'0 auto', padding:isMobile ? '0 16px' : '0 24px', position:'relative' }}>
          <div style={{ position:'absolute', top:120, left:-180, width:360, height:360, borderRadius:'50%', background:'radial-gradient(circle, rgba(0,184,217,0.12), transparent 70%)', filter:'blur(10px)', pointerEvents:'none' }} />
          <div style={{ position:'absolute', top:780, right:-120, width:300, height:300, borderRadius:'50%', background:'radial-gradient(circle, rgba(255,111,60,0.12), transparent 70%)', filter:'blur(10px)', pointerEvents:'none' }} />
          <Hero />
          <div style={{ height:1, background:'linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent)', animation:'pulseLine 4s ease-in-out infinite' }} />
          <div id="beneficios"><Benefits /></div>
          <ProofSection />
          <div id="funcionalidades"><Features /></div>
          <div id="planos"><Pricing /></div>
          <div id="faq"><FAQ /></div>
          <CTA />
        </div>
      </main>
    </div>
  )
}

const navLink = {
  color:'#A9BCC5',
  textDecoration:'none',
  fontSize:14,
  fontWeight:600,
}

const mobileNavLink = {
  color:'#DCEAF0',
  textDecoration:'none',
  fontSize:14,
  fontWeight:600,
  padding:'10px 12px',
}
