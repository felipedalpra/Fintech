import { useMemo, useState } from 'react'

const BEFORE = [
  'Planilhas separadas por pessoa',
  'Decisão com atraso',
  'Sem visão real de margem por cirurgia',
  'Caixa imprevisível no fim do mês',
]

const AFTER = [
  'Tudo centralizado em uma tela',
  'Leitura diária de receita e despesa',
  'Margem por procedimento em tempo real',
  'Previsão de caixa com mais segurança',
]

export function ComparisonSection() {
  const [split, setSplit] = useState(0)

  const meter = useMemo(() => `${Math.max(0, 100 - split * 2)}%`, [split])
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 760 : false

  return (
    <section style={{ padding:isMobile ? '10px 0 64px' : '12px 0 82px' }}>
      <div className="reveal" style={{ marginBottom:20 }}>
        <div style={{ fontSize:12, color:'#2DD4BF', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Antes x depois</div>
        <h2 style={{ margin:'0 0 10px', fontSize:'clamp(26px, 4vw, 48px)', lineHeight:1.06, letterSpacing:'-0.04em', color:'#F3FBFF', maxWidth:860 }}>
          Arraste e compare seu financeiro atual com um fluxo organizado
        </h2>
      </div>

      <div className="reveal" style={{ position:'relative', borderRadius:isMobile ? 20 : 28, overflow:'hidden', border:'1px solid rgba(255,255,255,0.14)', minHeight:isMobile ? 300 : 360, background:'linear-gradient(160deg, rgba(9, 19, 30, 0.92), rgba(15, 30, 40, 0.86))' }}>
        <div style={{ position:'absolute', inset:0, padding:isMobile ? '18px 14px' : '26px clamp(18px, 3vw, 30px)', background:'linear-gradient(120deg, rgba(12, 42, 46, 0.36), rgba(9, 32, 54, 0.28))' }}>
          <Row title="Depois" tone="#5EEAD4" items={AFTER} />
        </div>
        <div style={{ position:'absolute', inset:0, padding:isMobile ? '18px 14px' : '26px clamp(18px, 3vw, 30px)', background:'linear-gradient(120deg, rgb(83, 28, 37), rgb(42, 18, 25))', clipPath:`polygon(0 0, ${meter} 0, ${meter} 100%, 0 100%)`, zIndex:2 }}>
          <Row title="Antes" tone="#FDA4AF" items={BEFORE} />
        </div>

        <div style={{ position:'absolute', top:0, bottom:0, left:meter, width:2, background:'rgba(255,255,255,0.86)', boxShadow:'0 0 24px rgba(255,255,255,0.52)', zIndex:3 }} />
        <div style={{ position:'absolute', left:`calc(${meter} - ${isMobile ? 16 : 19}px)`, top:'50%', transform:'translateY(-50%)', width:isMobile ? 32 : 38, height:isMobile ? 32 : 38, borderRadius:'50%', border:'1px solid rgba(255,255,255,0.54)', background:'rgba(9,14,24,0.92)', color:'#ECF7FA', display:'grid', placeItems:'center', fontWeight:900, zIndex:4 }}>
          ↔
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={split}
          onChange={e => setSplit(Number(e.target.value))}
          aria-label="Comparar antes e depois"
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', opacity:0, cursor:'ew-resize', zIndex:5 }}
        />
      </div>
    </section>
  )
}

function Row({ title, tone, items }) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 760 : false
  return (
    <div style={{ width:'min(560px, 100%)' }}>
      <div style={{ display:'inline-flex', marginBottom:isMobile ? 10 : 16, padding:isMobile ? '6px 10px' : '8px 12px', borderRadius:999, background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', color:tone, fontSize:isMobile ? 10 : 11, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>
        {title}
      </div>
      <div style={{ display:'grid', gap:isMobile ? 8 : 12 }}>
        {items.map(item => (
          <div key={item} style={{ display:'flex', alignItems:'center', gap:10, padding:isMobile ? '10px 11px' : '12px 14px', borderRadius:isMobile ? 10 : 14, border:'1px solid rgba(255,255,255,0.14)', background:'rgba(5,11,18,0.34)', color:'#DCECF2', fontSize:isMobile ? 13 : 15, lineHeight:1.35 }}>
            <span style={{ color:tone, fontWeight:900 }}>•</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
