const FEATURES = [
  ['Painel executivo', 'Visão instantânea de receita, custo e lucro.'],
  ['Agenda financeira', 'Receitas e despesas com contexto clínico.'],
  ['Cirurgias e consultas', 'Ticket, margem e performance por linha.'],
  ['DRE inteligente', 'Leitura consolidada com menos retrabalho.'],
  ['Metas e alertas', 'Sinalização de risco e oportunidades.'],
  ['Assistente IA', 'Pergunte e receba insights acionáveis.'],
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
          {FEATURES.map(([title, text], index) => (
            <article key={title} className="reveal" style={{ padding:18, borderRadius:18, background:'rgba(12, 20, 34, 0.84)', border:'1px solid rgba(255,255,255,0.1)', minHeight:128, animation:`cardFloat 8s ease-in-out ${index * 0.25}s infinite` }}>
              <div style={{ width:32, height:32, borderRadius:10, background:'linear-gradient(135deg, rgba(56,189,248,0.3), rgba(45,212,191,0.3))', marginBottom:10 }} />
              <div style={{ color:'#F0F9FF', fontSize:17, fontWeight:800, lineHeight:1.2, marginBottom:7 }}>{title}</div>
              <div style={{ color:'#9EB5C0', fontSize:14, lineHeight:1.6 }}>{text}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
