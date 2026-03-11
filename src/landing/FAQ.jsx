import { C } from '../theme.js'

const ITEMS = [
  {
    q:'O SurgiFlow é só para controle financeiro?',
    a:'Ele foi pensado para entregar visão gerencial do negócio. Você acompanha cirurgias, consultas, receitas, despesas e entende o resultado financeiro real da clínica.',
  },
  {
    q:'Preciso continuar usando planilhas?',
    a:'Não. A ideia é justamente substituir controles soltos por uma experiência mais profissional, clara e centralizada.',
  },
  {
    q:'Isso serve para clínica pequena também?',
    a:'Sim. Quanto antes a gestão financeira ganha organização, mais fácil fica crescer sem perder margem e sem aumentar o caos operacional.',
  },
  {
    q:'O sistema passa uma imagem mais profissional para a clínica?',
    a:'Sim. Além do ganho de controle, o SurgiFlow posiciona a operação com um nível de gestão compatível com clínicas premium.',
  },
]

export function FAQ() {
  return (
    <section style={{ padding:'10px 0 82px' }}>
      <div style={{ marginBottom:24, animation:'fadeUp 0.8s ease both' }}>
        <div style={{ fontSize:12, color:'#C4B5FD', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Perguntas frequentes</div>
        <h2 style={{ margin:'0 0 12px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.02, letterSpacing:'-0.04em', color:C.text }}>Respostas para quem quer crescer com mais controle</h2>
        <p style={{ margin:0, color:'#9FB2BC', fontSize:17, lineHeight:1.8, maxWidth:740 }}>A seção foi ajustada para reduzir objeção comercial, não para explicar arquitetura do sistema.</p>
      </div>
      <div style={{ display:'grid', gap:14 }}>
        {ITEMS.map((item, index) => (
          <article key={item.q} style={{ padding:24, borderRadius:22, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', animation:'fadeUp 0.85s ease both', animationDelay:`${0.06 * index}s` }}>
            <h3 style={{ margin:'0 0 10px', color:C.text, fontSize:19 }}>{item.q}</h3>
            <p style={{ margin:0, color:'#A9BCC5', fontSize:15, lineHeight:1.8 }}>{item.a}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
