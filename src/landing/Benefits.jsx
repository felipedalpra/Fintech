import { useState } from 'react'

const ITEMS = [
  { icon:'↗', title:'Margem por cirurgia', text:'Veja onde o lucro cresce e onde vaza.' },
  { icon:'◴', title:'Caixa previsível', text:'Antecipe semanas de pressão financeira.' },
  { icon:'✦', title:'Menos operação manual', text:'Pare de conciliar planilhas paralelas.' },
  { icon:'◎', title:'Mais tempo clínico', text:'Troque retrabalho por foco no paciente.' },
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
              border:index === active ? '1px solid rgba(94,234,212,0.5)' : '1px solid rgba(255,255,255,0.1)',
              background:index === active
                ? 'linear-gradient(140deg, rgba(13, 41, 46, 0.86), rgba(8, 27, 34, 0.9))'
                : 'linear-gradient(145deg, rgba(10, 18, 30, 0.9), rgba(12, 24, 38, 0.84))',
              minHeight:168,
              cursor:'pointer',
              transition:'transform 0.24s ease, border-color 0.24s ease',
              transform:index === active ? 'translateY(-3px)' : 'translateY(0)',
            }}
          >
            <div style={{ width:38, height:38, borderRadius:11, border:'1px solid rgba(255,255,255,0.16)', display:'grid', placeItems:'center', fontSize:17, color:'#CFFAFE', marginBottom:12 }}>{item.icon}</div>
            <h3 style={{ margin:'0 0 8px', color:'#F5FCFF', fontSize:21, lineHeight:1.2 }}>{item.title}</h3>
            <p style={{ margin:0, color:'#A8C0CB', fontSize:14, lineHeight:1.6 }}>{item.text}</p>
          </button>
        ))}
      </div>
    </section>
  )
}
