import { C } from '../theme.js'

const METRICS = [
  ['Mais clareza', 'Sobre lucro e caixa'],
  ['Mais autoridade', 'Na gestão da clínica'],
  ['Mais previsibilidade', 'Para crescer com segurança'],
  ['Menos ruído', 'No dia a dia financeiro'],
]

const TESTIMONIALS = [
  {
    quote:'Antes eu sentia que trabalhava muito, mas não enxergava com precisão o resultado. Hoje tenho confiança no número que guia minhas decisões.',
    author:'Dra. Mariana Ribeiro',
    role:'Cirurgiã plástica',
  },
  {
    quote:'A clínica ganhou postura de empresa. O financeiro deixou de ser improvisado e passou a ser uma ferramenta de crescimento.',
    author:'Clínica Lumina',
    role:'Gestão administrativa',
  },
  {
    quote:'O mais valioso é a sensação de controle. Você entende onde está ganhando, onde está vazando dinheiro e o que precisa ajustar.',
    author:'Dr. Paulo Siqueira',
    role:'Cirurgião plástico',
  },
]

export function ProofSection() {
  return (
    <section style={{ padding:'10px 0 82px' }}>
      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,0.95fr) minmax(0,1.05fr)', gap:24, alignItems:'start' }}>
        <div style={{ animation:'fadeUp 0.8s ease both' }}>
          <div style={{ fontSize:12, color:'#6EE7B7', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Valor percebido</div>
          <h2 style={{ margin:'0 0 12px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.02, letterSpacing:'-0.04em', color:C.text }}>A clínica cresce melhor quando o financeiro transmite segurança</h2>
          <p style={{ margin:'0 0 22px', color:'#9FB2BC', fontSize:17, lineHeight:1.8, maxWidth:580 }}>
            O SurgiFlow não vende só controle. Ele vende tranquilidade para decidir, inteligência para crescer e uma operação financeira à altura da sua imagem profissional.
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0,1fr))', gap:14 }}>
            {METRICS.map(([label, value], index) => <div key={label} style={{ padding:18, borderRadius:20, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', animation:'fadeUp 0.8s ease both', animationDelay:`${0.08 * index}s` }}><div style={{ fontSize:11, color:'#7F98A3', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>{label}</div><div style={{ fontSize:24, color:C.text, fontWeight:900, letterSpacing:'-0.04em', lineHeight:1.2 }}>{value}</div></div>)}
          </div>
        </div>
        <div style={{ display:'grid', gap:14 }}>
          {TESTIMONIALS.map((item, index) => (
            <article key={item.author} style={{ padding:24, borderRadius:24, background:'linear-gradient(140deg, rgba(17,24,39,0.96), rgba(8,16,28,0.96))', border:'1px solid rgba(255,255,255,0.1)', animation:'fadeUp 0.85s ease both', animationDelay:`${0.1 + index * 0.08}s` }}>
              <p style={{ margin:'0 0 16px', color:C.text, fontSize:17, lineHeight:1.75 }}>&ldquo;{item.quote}&rdquo;</p>
              <div style={{ color:'#D9E8EE', fontSize:13, fontWeight:700 }}>{item.author}</div>
              <div style={{ color:'#7F98A3', fontSize:12, marginTop:4 }}>{item.role}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
