import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Hero } from './Hero.jsx'
import { Benefits } from './Benefits.jsx'
import { Features } from './Features.jsx'
import { ProofSection } from './ProofSection.jsx'
import { Pricing } from './Pricing.jsx'
import { FAQ } from './FAQ.jsx'
import { CTA } from './CTA.jsx'
import { BrandLogo } from '../components/BrandLogo.jsx'
import { SectionCTA } from './SectionCTA.jsx'
import { ComparisonSection } from './ComparisonSection.jsx'
import { SimulatorSection } from './SimulatorSection.jsx'
import { HowItWorks } from './HowItWorks.jsx'
import { LogoWall } from './LogoWall.jsx'

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

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('.reveal'))
    if (!nodes.length) return

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold:0.2, rootMargin:'0px 0px -30px 0px' }
    )

    nodes.forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [])

  if (!loading && user) {
    return <Navigate to="/app/dashboard" replace />
  }

  return (
    <div style={{ minHeight:'100vh', color:'#E6F4FA', overflow:'hidden', background:'radial-gradient(circle at 15% 10%, #123341 0%, transparent 24%), radial-gradient(circle at 85% 0%, #3f1a2a 0%, transparent 26%), linear-gradient(180deg, #030a12 0%, #07131f 40%, #071a24 100%)' }}>
      <style>{`
        :root {
          --surface: rgba(8, 19, 30, 0.84);
          --border-soft: rgba(255,255,255,0.12);
          --primary: #14b8a6;
          --accent: #38bdf8;
          --hot: #fb7185;
          --text: #f2fbff;
          --muted: #9db4c1;
        }
        @keyframes cardFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        @keyframes pulseBar {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
        @keyframes pulseLine {
          0%, 100% { opacity: 0.4; transform: scaleX(0.96); }
          50% { opacity: 1; transform: scaleX(1); }
        }
        @keyframes floatOrb {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(0, -18px, 0); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes marqueeScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        html { scroll-behavior: smooth; }
        .reveal {
          opacity: 0;
          transform: translateY(20px);
          transition: opacity 0.65s ease, transform 0.65s ease;
          will-change: transform, opacity;
        }
        .reveal.in-view {
          opacity: 1;
          transform: translateY(0);
        }
        @media (max-width: 900px) {
          .floating-cta { bottom: 14px !important; right: 14px !important; }
          .landing-shell { padding: 0 14px !important; }
          .landing-divider { margin: 4px 0 10px !important; }
        }
      `}</style>

      <header style={{ position:'sticky', top:0, zIndex:30, backdropFilter:'blur(14px)', background:'rgba(4,10,16,0.72)', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ maxWidth:1180, margin:'0 auto', padding:isMobile ? '14px 16px' : '16px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:20 }}>
          <BrandLogo size="sm" />
          {isMobile ? (
            <button type="button" onClick={() => setMenuOpen(current => !current)} style={{ width:42, height:42, borderRadius:12, border:'1px solid rgba(255,255,255,0.14)', background:'rgba(255,255,255,0.04)', color:'#EAF4F8', cursor:'pointer', fontSize:18 }}>
              {menuOpen ? '×' : '☰'}
            </button>
          ) : (
            <nav style={{ display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
              <a href="#beneficios" style={navLink}>Benefícios</a>
              <a href="#social" style={navLink}>Resultados</a>
              <a href="#funcionalidades" style={navLink}>Funcionalidades</a>
              <a href="#comparativo" style={navLink}>Comparativo</a>
              <a href="#simulador" style={navLink}>Simulador</a>
              <a href="#planos" style={navLink}>Planos</a>
              <a href="#faq" style={navLink}>FAQ</a>
              <Link to="/login" style={{ ...navLink, padding:'9px 13px', border:'1px solid rgba(255,255,255,0.16)', borderRadius:999, color:'#EAF5FA' }}>Login</Link>
              <a href="#planos" style={{ ...navLink, padding:'9px 13px', border:'1px solid rgba(255,255,255,0.2)', borderRadius:999, color:'#EAFAFF' }}>Teste grátis</a>
            </nav>
          )}
        </div>

        {isMobile && menuOpen && (
          <div style={{ maxWidth:1180, margin:'0 auto', padding:'0 16px 16px' }}>
            <nav style={{ display:'grid', gap:8, padding:12, borderRadius:18, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.04)' }}>
              <a href="#beneficios" onClick={() => setMenuOpen(false)} style={mobileNavLink}>Benefícios</a>
              <a href="#social" onClick={() => setMenuOpen(false)} style={mobileNavLink}>Resultados</a>
              <a href="#funcionalidades" onClick={() => setMenuOpen(false)} style={mobileNavLink}>Funcionalidades</a>
              <a href="#comparativo" onClick={() => setMenuOpen(false)} style={mobileNavLink}>Comparativo</a>
              <a href="#simulador" onClick={() => setMenuOpen(false)} style={mobileNavLink}>Simulador</a>
              <a href="#planos" onClick={() => setMenuOpen(false)} style={mobileNavLink}>Planos</a>
              <a href="#faq" onClick={() => setMenuOpen(false)} style={mobileNavLink}>FAQ</a>
              <Link to="/login" onClick={() => setMenuOpen(false)} style={{ ...mobileNavLink, textAlign:'center', border:'1px solid rgba(255,255,255,0.16)', borderRadius:12, color:'#EAF5FA' }}>Login</Link>
              <a href="#planos" onClick={() => setMenuOpen(false)} style={{ ...mobileNavLink, textAlign:'center', border:'1px solid rgba(255,255,255,0.2)', borderRadius:12, color:'#EAF8FF' }}>Teste grátis</a>
            </nav>
          </div>
        )}
      </header>

      <main>
        <div className="landing-shell" style={{ maxWidth:1180, margin:'0 auto', padding:isMobile ? '0 16px' : '0 24px', position:'relative' }}>
          <div style={{ position:'absolute', top:130, left:-150, width:320, height:320, borderRadius:'50%', background:'radial-gradient(circle, rgba(20,184,166,0.2), transparent 70%)', filter:'blur(10px)', pointerEvents:'none', animation:'floatOrb 10s ease-in-out infinite' }} />
          <div style={{ position:'absolute', top:720, right:-120, width:290, height:290, borderRadius:'50%', background:'radial-gradient(circle, rgba(251,113,133,0.18), transparent 70%)', filter:'blur(14px)', pointerEvents:'none', animation:'floatOrb 9s ease-in-out 1s infinite' }} />

          <Hero />
          <div className="landing-divider" style={{ height:1, background:'linear-gradient(90deg, transparent, rgba(255,255,255,0.24), transparent)', animation:'pulseLine 4s ease-in-out infinite' }} />

          <HowItWorks />
          <div id="beneficios"><Benefits /></div>
          <div id="social"><ProofSection /></div>
          <LogoWall />
          <SectionCTA tone="blue" />
          <div id="funcionalidades"><Features /></div>
          <div id="comparativo"><ComparisonSection /></div>
          <SectionCTA tone="coral" />
          <div id="simulador"><SimulatorSection /></div>
          <div id="planos"><Pricing /></div>
          <SectionCTA tone="teal" />
          <div id="faq"><FAQ /></div>
          <CTA />
        </div>
      </main>
    </div>
  )
}

const navLink = {
  color:'#B6CAD3',
  textDecoration:'none',
  fontSize:14,
  fontWeight:700,
}

const mobileNavLink = {
  color:'#DCEAF0',
  textDecoration:'none',
  fontSize:14,
  fontWeight:700,
  padding:'10px 12px',
}
