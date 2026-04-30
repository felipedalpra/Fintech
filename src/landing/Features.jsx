const FEATURES = [
  {
    title: 'Painel executivo',
    text: 'Visão instantânea de receita, custo e lucro.',
    color: '#67E8F9',
    delay: 0,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="12" width="4" height="9" rx="1"/>
        <rect x="10" y="7" width="4" height="14" rx="1"/>
        <rect x="17" y="4" width="4" height="17" rx="1"/>
        <line x1="2" y1="21" x2="22" y2="21"/>
      </svg>
    ),
  },
  {
    title: 'Agenda financeira',
    text: 'Receitas e despesas com contexto clínico.',
    color: '#A5B4FC',
    delay: 80,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <rect x="7" y="14" width="3" height="3" rx="0.5" fill="currentColor" stroke="none"/>
        <rect x="11" y="14" width="3" height="3" rx="0.5" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    title: 'Cirurgias e consultas',
    text: 'Ticket, margem e performance por procedimento.',
    color: '#86EFAC',
    delay: 160,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3H5a2 2 0 00-2 2v4"/>
        <path d="M9 3h10a2 2 0 012 2v4"/>
        <path d="M3 9h18"/>
        <path d="M3 9v10a2 2 0 002 2h14a2 2 0 002-2V9"/>
        <path d="M12 13v4M10 15h4"/>
      </svg>
    ),
  },
  {
    title: 'DRE inteligente',
    text: 'Leitura consolidada com menos retrabalho.',
    color: '#FDE68A',
    delay: 240,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="8" y1="13" x2="16" y2="13"/>
        <line x1="8" y1="17" x2="13" y2="17"/>
      </svg>
    ),
  },
  {
    title: 'Metas e alertas',
    text: 'Sinalização de risco e oportunidades em tempo real.',
    color: '#FDA4AF',
    delay: 320,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 01-3.46 0"/>
        <circle cx="18" cy="5" r="3" fill="#FDA4AF" stroke="none"/>
      </svg>
    ),
  },
  {
    title: 'Assistente IA',
    text: 'Pergunte e receba insights acionáveis em segundos.',
    color: '#C4B5FD',
    delay: 400,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-5.26L4 10l5.91-1.74L12 2z"/>
        <path d="M19 15l.85 2.55L22 18.5l-2.15.95L19 22l-.85-2.55L16 18.5l2.15-.95L19 15z"/>
      </svg>
    ),
  },
]

export function Features() {
  return (
    <section style={{ padding:'14px 0 82px' }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap:18, alignItems:'start' }}>
        <div className="reveal">
          <div style={{ fontSize:12, color:'#F9A8D4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Funcionalidades chave</div>
          <h2 style={{ margin:'0 0 10px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.04, letterSpacing:'-0.04em', color:'#F2FBFF' }}>
            Recursos que movem o ponteiro do negócio
          </h2>
          <p style={{ margin:0, color:'#A7C0CB', fontSize:16, lineHeight:1.65, maxWidth:560 }}>
            Tudo foi desenhado para leitura rápida e decisão com menos fricção.
          </p>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(210px, 1fr))', gap:12 }}>
          {FEATURES.map((item, index) => (
            <article
              key={item.title}
              className="reveal"
              style={{
                padding:18,
                borderRadius:18,
                background:'rgba(12, 20, 34, 0.84)',
                border:'1px solid rgba(255,255,255,0.1)',
                minHeight:128,
                animation:`cardFloat 8s ease-in-out ${index * 0.25}s infinite`,
                transitionDelay:`${item.delay}ms`,
              }}
            >
              <div style={{
                width:36,
                height:36,
                borderRadius:10,
                background:`linear-gradient(135deg, ${item.color}28, ${item.color}10)`,
                border:`1px solid ${item.color}30`,
                display:'grid',
                placeItems:'center',
                color:item.color,
                marginBottom:10,
              }}>
                {item.icon}
              </div>
              <div style={{ color:'#F0F9FF', fontSize:17, fontWeight:800, lineHeight:1.2, marginBottom:7 }}>{item.title}</div>
              <div style={{ color:'#9EB5C0', fontSize:14, lineHeight:1.6 }}>{item.text}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
