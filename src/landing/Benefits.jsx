import { useState } from 'react'

const ITEMS = [
  {
    title: 'Margem por cirurgia',
    text: 'Veja onde o lucro cresce e onde vaza — por procedimento, não só no consolidado.',
    color: '#67E8F9',
    delay: 0,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
        <polyline points="16 7 22 7 22 13"/>
      </svg>
    ),
  },
  {
    title: 'Caixa previsível',
    text: 'Antecipe semanas de pressão financeira antes que elas cheguem.',
    color: '#86EFAC',
    delay: 80,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2"/>
        <path d="M16 7V5a2 2 0 00-4 0v2"/>
        <line x1="12" y1="12" x2="12" y2="16"/>
        <line x1="10" y1="14" x2="14" y2="14"/>
      </svg>
    ),
  },
  {
    title: 'Menos operação manual',
    text: 'Pare de conciliar planilhas paralelas. Recorrências, despesas e metas no mesmo lugar.',
    color: '#FDE68A',
    delay: 160,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 22 4"/>
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
      </svg>
    ),
  },
  {
    title: 'Mais tempo clínico',
    text: 'Troque retrabalho financeiro por foco no paciente e na qualidade técnica.',
    color: '#FDA4AF',
    delay: 240,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
  },
]

export function Benefits() {
  const [active, setActive] = useState(0)

  return (
    <section style={{ padding:'16px 0 82px' }}>
      <div className="reveal" style={{ marginBottom:20 }}>
        <div style={{ fontSize:12, color:'#5EEAD4', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Benefícios centrais</div>
        <h2 style={{ margin:'0 0 10px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.04, letterSpacing:'-0.04em', color:'#F3FBFF', maxWidth:860 }}>
          Troque texto longo por clareza visual e ação diária
        </h2>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap:14 }}>
        {ITEMS.map((item, index) => (
          <button
            key={item.title}
            type="button"
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onClick={() => setActive(index)}
            className="reveal"
            style={{
              textAlign:'left',
              padding:'22px 18px',
              borderRadius:20,
              border:index === active ? `1px solid ${item.color}55` : '1px solid rgba(255,255,255,0.1)',
              background:index === active
                ? `linear-gradient(140deg, rgba(13,41,46,0.86), rgba(8,27,34,0.9))`
                : 'linear-gradient(145deg, rgba(10, 18, 30, 0.9), rgba(12, 24, 38, 0.84))',
              minHeight:168,
              cursor:'pointer',
              transition:'transform 0.24s ease, border-color 0.24s ease',
              transform:index === active ? 'translateY(-3px)' : 'translateY(0)',
              transitionDelay:`${item.delay}ms`,
            }}
          >
            <div style={{
              width:38,
              height:38,
              borderRadius:11,
              background:`linear-gradient(135deg, ${item.color}22, ${item.color}0A)`,
              border:`1px solid ${item.color}35`,
              display:'grid',
              placeItems:'center',
              color:item.color,
              marginBottom:12,
            }}>
              {item.icon}
            </div>
            <h3 style={{ margin:'0 0 8px', color:'#F5FCFF', fontSize:21, lineHeight:1.2 }}>{item.title}</h3>
            <p style={{ margin:0, color:'#A8C0CB', fontSize:14, lineHeight:1.6 }}>{item.text}</p>
          </button>
        ))}
      </div>
    </section>
  )
}
