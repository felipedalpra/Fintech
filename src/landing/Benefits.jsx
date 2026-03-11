import { C } from '../theme.js'

const ITEMS = [
  {
    title:'Pare de perder margem sem perceber',
    text:'Enxergue com clareza o que cada cirurgia entrega de resultado financeiro, sem adivinhação.',
  },
  {
    title:'Decida com confiança',
    text:'Saiba exatamente quanto entra, quanto sai e qual o impacto disso no caixa da clínica.',
  },
  {
    title:'Valorize sua operação',
    text:'Transforme uma rotina financeira desorganizada em uma gestão profissional, segura e previsível.',
  },
  {
    title:'Ganhe tempo mental',
    text:'Menos planilhas, menos retrabalho, menos dispersão. Mais foco em atendimento e crescimento.',
  },
]

export function Benefits() {
  return (
    <section style={{ padding:'24px 0 78px' }}>
      <div style={{ marginBottom:24, animation:'fadeUp 0.8s ease both' }}>
        <div style={{ fontSize:12, color:'#7DD3FC', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Por que escolher o SurgiMetrics</div>
        <h2 style={{ margin:'0 0 10px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.02, letterSpacing:'-0.04em', color:C.text, maxWidth:860 }}>Seu financeiro deixa de ser um ponto cego e passa a virar uma vantagem competitiva</h2>
        <p style={{ margin:0, color:'#9FB2BC', fontSize:17, lineHeight:1.8, maxWidth:760 }}>Cirurgiões plásticos de alta performance não podem operar com gestão improvisada. O SurgiMetrics organiza o bastidor financeiro para sustentar crescimento com controle.</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))', gap:18 }}>
        {ITEMS.map((item, index) => (
          <article key={item.title} style={{ padding:26, borderRadius:24, background:index % 2 === 0 ? 'linear-gradient(155deg, rgba(0,184,217,0.08), rgba(17,24,39,0.98))' : 'linear-gradient(155deg, rgba(255,111,60,0.08), rgba(17,24,39,0.98))', border:'1px solid rgba(255,255,255,0.1)', minHeight:230, animation:'fadeUp 0.8s ease both', animationDelay:`${0.08 * index}s` }}>
            <div style={{ width:42, height:42, borderRadius:14, background:'rgba(255,255,255,0.05)', display:'grid', placeItems:'center', color:C.text, fontSize:15, fontWeight:900, marginBottom:18 }}>{String(index + 1).padStart(2, '0')}</div>
            <h3 style={{ margin:'0 0 12px', color:C.text, fontSize:22, lineHeight:1.2 }}>{item.title}</h3>
            <p style={{ margin:0, color:'#A9BCC5', fontSize:15, lineHeight:1.8 }}>{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
