import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo.jsx'
import { Btn } from '../components/UI.jsx'

const TYPEWRITER_PHRASES = [
  'Você sabe a margem real de cada cirurgia?',
  'Seu caixa bate com o que você esperava?',
  'Quanto escapa em custos operacionais ocultos?',
  'Em quanto tempo você fecha o DRE do mês?',
]

const TABS = ['Dashboard', 'Cirurgias', 'Fluxo de caixa']

const TAB_CONTENTS = {
  Dashboard: {
    stats: [
      ['Receita do mês', 'R$ 186 mil', '#67E8F9'],
      ['Margem média', '38,7%', '#86EFAC'],
      ['Consultas', '94', '#FDE68A'],
    ],
    chart: [32, 38, 42, 48, 54, 62],
    chartLabel: 'Projeção de caixa',
    chartColors: ['#0EA5E9', '#0EA5E9', '#0EA5E9', '#0EA5E9', '#14B8A6', '#14B8A6'],
  },
  Cirurgias: {
    rows: [
      { proc: 'Lipoaspiração', valor: 'R$ 28.400', margem: '44%', status: '#86EFAC' },
      { proc: 'Rinoplastia', valor: 'R$ 19.800', margem: '38%', status: '#86EFAC' },
      { proc: 'Mamoplastia', valor: 'R$ 24.600', margem: '51%', status: '#67E8F9' },
    ],
    chartLabel: 'Margem por procedimento',
    chart: [38, 44, 51, 42, 38, 46],
    chartColors: ['#86EFAC', '#86EFAC', '#67E8F9', '#86EFAC', '#86EFAC', '#67E8F9'],
  },
  'Fluxo de caixa': {
    flows: [
      { label: 'Entradas pagas', value: 'R$ 164.200', color: '#86EFAC' },
      { label: 'A receber', value: 'R$ 38.800', color: '#FDE68A' },
      { label: 'Saídas', value: 'R$ 97.100', color: '#FDA4AF' },
    ],
    chartLabel: 'Entradas x Saídas (6 meses)',
    chart: [58, 72, 64, 80, 68, 86],
    chartColors: ['#14B8A6', '#14B8A6', '#14B8A6', '#14B8A6', '#14B8A6', '#14B8A6'],
  },
}

function TypewriterText() {
  const [idx, setIdx] = useState(0)
  const [chars, setChars] = useState(0)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const phrase = TYPEWRITER_PHRASES[idx]
    let timer
    if (!deleting) {
      if (chars < phrase.length) {
        timer = setTimeout(() => setChars(c => c + 1), 36)
      } else {
        timer = setTimeout(() => setDeleting(true), 2400)
      }
    } else {
      if (chars > 0) {
        timer = setTimeout(() => setChars(c => c - 1), 16)
      } else {
        setDeleting(false)
        setIdx(i => (i + 1) % TYPEWRITER_PHRASES.length)
      }
    }
    return () => clearTimeout(timer)
  }, [chars, deleting, idx])

  return (
    <span>
      {TYPEWRITER_PHRASES[idx].slice(0, chars)}
      <span style={{ borderRight:'2px solid #5EEAD4', marginLeft:1, animation:'blink 1s step-end infinite' }}>&nbsp;</span>
    </span>
  )
}

export function Hero() {
  const [activeTab, setActiveTab] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setActiveTab(t => (t + 1) % TABS.length), 3800)
    return () => clearInterval(id)
  }, [])

  const tab = TAB_CONTENTS[TABS[activeTab]]

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
          <p style={{ margin:'0 0 24px', color:'#7EC8DA', fontSize:'clamp(15px, 3.2vw, 18px)', lineHeight:1.5, maxWidth:580, minHeight:'2.2em' }}>
            <TypewriterText />
          </p>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:24 }}>
            <a href="#planos" style={{ textDecoration:'none' }}><Btn style={{ padding:'14px 22px', boxShadow:'0 18px 42px rgba(20,184,166,0.32)' }}>Começar grátis</Btn></a>
            <Link to="/login" style={{ textDecoration:'none' }}><Btn variant="ghost" style={{ padding:'14px 22px', borderColor:'rgba(255,255,255,0.24)', color:'#ECF8FC' }}>Acessar plataforma</Btn></Link>
          </div>
          <div style={{ display:'flex', gap:18, flexWrap:'wrap', color:'#B4CBD5', fontSize:13 }}>
            <span>✓ Sem cartão no trial</span>
            <span>✓ Rentabilidade por cirurgia</span>
            <span>✓ DRE e caixa automáticos</span>
          </div>
        </div>

        <div className="reveal" style={{ display:'grid', gap:12 }}>
          <div style={{ padding:'20px clamp(16px, 2.8vw, 24px)', borderRadius:26, background:'linear-gradient(145deg, rgba(8,18,28,0.96), rgba(13,28,39,0.92))', border:'1px solid rgba(255,255,255,0.14)', boxShadow:'0 24px 70px rgba(0,0,0,0.3)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <BrandLogo size="md" />
              <div style={{ padding:'7px 10px', borderRadius:999, background:'rgba(52,211,153,0.16)', color:'#86EFAC', fontSize:11, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>
                Ao vivo
              </div>
            </div>

            <div style={{ display:'flex', gap:6, marginBottom:14 }}>
              {TABS.map((tabLabel, i) => (
                <button
                  key={tabLabel}
                  type="button"
                  onClick={() => setActiveTab(i)}
                  style={{
                    padding:'5px 10px',
                    borderRadius:999,
                    border:'none',
                    fontSize:11,
                    fontWeight:700,
                    cursor:'pointer',
                    transition:'all 0.22s ease',
                    background:i === activeTab ? 'rgba(20,184,166,0.24)' : 'rgba(255,255,255,0.06)',
                    color:i === activeTab ? '#5EEAD4' : '#7A9BAA',
                    letterSpacing:'0.04em',
                  }}
                >
                  {tabLabel}
                </button>
              ))}
            </div>

            <div style={{ minHeight:130 }}>
              {TABS[activeTab] === 'Dashboard' && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginBottom:12 }}>
                  {tab.stats.map(([label, value, tone]) => (
                    <article key={label} style={{ padding:10, borderRadius:12, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.04)' }}>
                      <div style={{ fontSize:9, color:'#7E98A5', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{label}</div>
                      <div style={{ color:tone, fontSize:16, fontWeight:900, letterSpacing:'-0.03em' }}>{value}</div>
                    </article>
                  ))}
                </div>
              )}
              {TABS[activeTab] === 'Cirurgias' && (
                <div style={{ display:'grid', gap:6, marginBottom:12 }}>
                  {tab.rows.map(row => (
                    <div key={row.proc} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px', borderRadius:10, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)' }}>
                      <span style={{ fontSize:12, color:'#C8E0E8', fontWeight:600 }}>{row.proc}</span>
                      <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                        <span style={{ fontSize:12, color:'#A8C0CA' }}>{row.valor}</span>
                        <span style={{ fontSize:11, fontWeight:800, color:row.status }}>↑{row.margem}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {TABS[activeTab] === 'Fluxo de caixa' && (
                <div style={{ display:'grid', gap:6, marginBottom:12 }}>
                  {tab.flows.map(f => (
                    <div key={f.label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px', borderRadius:10, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)' }}>
                      <span style={{ fontSize:12, color:'#B8D0DA' }}>{f.label}</span>
                      <span style={{ fontSize:14, fontWeight:800, color:f.color }}>{f.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ border:'1px solid rgba(255,255,255,0.12)', borderRadius:14, padding:12, background:'linear-gradient(135deg, rgba(45,212,191,0.12), rgba(56,189,248,0.12))' }}>
              <div style={{ fontSize:11, color:'#B3CBD6', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>{tab.chartLabel}</div>
              <div style={{ height:54, display:'grid', alignItems:'end', gridTemplateColumns:`repeat(${tab.chart.length}, 1fr)`, gap:5 }}>
                {tab.chart.map((h, i) => (
                  <div key={i} style={{ height:`${h}px`, borderRadius:5, background:`linear-gradient(180deg, ${tab.chartColors[i]}CC, ${tab.chartColors[i]})`, animation:`pulseBar 1.8s ease-in-out ${i * 0.12}s infinite`, transition:'height 0.4s ease' }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
