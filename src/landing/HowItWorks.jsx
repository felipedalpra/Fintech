const STEPS = [
  {
    number: '01',
    title: 'Cadastre',
    text: 'Lance cirurgias, consultas e despesas em segundos. Sem contador, sem planilha paralela.',
    color: '#67E8F9',
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    ),
  },
  {
    number: '02',
    title: 'Configure',
    text: 'Automatize recorrências, defina metas por procedimento e conecte convênios ao resultado real.',
    color: '#A5B4FC',
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="6" x2="20" y2="6"/>
        <line x1="4" y1="12" x2="14" y2="12"/>
        <line x1="4" y1="18" x2="18" y2="18"/>
        <circle cx="17" cy="6" r="3"/>
        <circle cx="11" cy="12" r="3"/>
        <circle cx="15" cy="18" r="3"/>
      </svg>
    ),
  },
  {
    number: '03',
    title: 'Leia e decida',
    text: 'Caixa, margem, DRE e alertas em uma tela atualizada em tempo real. Decida com número, não com intuição.',
    color: '#86EFAC',
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    ),
  },
]

export function HowItWorks() {
  return (
    <section style={{ padding:'14px 0 82px' }}>
      <div className="reveal" style={{ marginBottom:36 }}>
        <div style={{ fontSize:12, color:'#67E8F9', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Como funciona</div>
        <h2 style={{ margin:'0 0 10px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.04, letterSpacing:'-0.04em', color:'#F4FCFF', maxWidth:760 }}>
          Três passos para clareza financeira total
        </h2>
        <p style={{ margin:0, color:'#A7C0CB', fontSize:16, lineHeight:1.6, maxWidth:560 }}>
          Do primeiro lançamento ao painel de decisão em menos de uma semana.
        </p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap:0, position:'relative' }}>
        <div style={{ display:'contents' }}>
          {STEPS.map((step, index) => (
            <div key={step.number} className="reveal" style={{ transitionDelay:`${index * 120}ms`, display:'flex', flexDirection:'column', alignItems:'flex-start', position:'relative' }}>
              {index < STEPS.length - 1 && (
                <div style={{
                  display:'none',
                  position:'absolute',
                  top:38,
                  right:0,
                  left:'calc(100% - 20px)',
                  height:2,
                  background:`linear-gradient(90deg, ${step.color}60, ${STEPS[index + 1].color}40)`,
                  zIndex:1,
                }} className="step-connector" />
              )}
              <div style={{
                padding:'28px 24px 32px',
                borderRadius:22,
                border:`1px solid ${step.color}28`,
                background:`linear-gradient(145deg, rgba(12,20,34,0.9), rgba(8,18,30,0.85))`,
                width:'100%',
                boxSizing:'border-box',
                position:'relative',
                transition:'transform 0.28s ease, border-color 0.28s ease',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderColor = `${step.color}55` }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = `${step.color}28` }}
              >
                <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:18 }}>
                  <div style={{
                    width:52,
                    height:52,
                    borderRadius:14,
                    background:`linear-gradient(135deg, ${step.color}22, ${step.color}0A)`,
                    border:`1px solid ${step.color}40`,
                    display:'grid',
                    placeItems:'center',
                    color:step.color,
                    flexShrink:0,
                  }}>
                    {step.icon}
                  </div>
                  <div style={{ fontSize:13, fontWeight:900, color:`${step.color}90`, letterSpacing:'0.06em' }}>{step.number}</div>
                </div>
                <h3 style={{ margin:'0 0 10px', fontSize:22, fontWeight:900, color:'#F2FBFF', letterSpacing:'-0.03em' }}>{step.title}</h3>
                <p style={{ margin:0, color:'#9BB5C1', fontSize:15, lineHeight:1.65 }}>{step.text}</p>

                {index < STEPS.length - 1 && (
                  <div style={{ position:'absolute', right:-14, top:'50%', transform:'translateY(-50%)', width:28, height:28, borderRadius:'50%', background:'rgba(8,18,28,0.96)', border:'1px solid rgba(255,255,255,0.16)', display:'grid', placeItems:'center', color:'rgba(255,255,255,0.4)', fontSize:14, zIndex:2, fontWeight:700 }}>→</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
