import { useState } from 'react'

const ITEMS = [
  {
    q:'Serve para clínica pequena?',
    a:'Sim. O ganho vem cedo: você organiza caixa, custos e margem antes do crescimento ficar caótico.',
  },
  {
    q:'Preciso manter planilhas?',
    a:'Não. O objetivo é centralizar operação financeira e reduzir controle paralelo.',
  },
  {
    q:'Posso começar sem cartão?',
    a:'Sim. Você entra em trial grátis e só decide sobre assinatura depois de validar o uso.',
  },
  {
    q:'Tem suporte para implantação?',
    a:'Sim. Você recebe orientação para configurar rotina e acelerar adoção na clínica.',
  },
]

export function FAQ() {
  const [open, setOpen] = useState(0)

  return (
    <section style={{ padding:'12px 0 82px' }}>
      <div className="reveal" style={{ marginBottom:20 }}>
        <div style={{ fontSize:12, color:'#C4B5FD', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>FAQ</div>
        <h2 style={{ margin:'0 0 10px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.04, letterSpacing:'-0.04em', color:'#F4FCFF' }}>
          Perguntas rápidas antes de começar
        </h2>
      </div>

      <div style={{ display:'grid', gap:10 }}>
        {ITEMS.map((item, index) => {
          const expanded = index === open
          return (
            <article key={item.q} className="reveal" style={{ borderRadius:16, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(255,255,255,0.03)', overflow:'hidden' }}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? -1 : index)}
                style={{ width:'100%', textAlign:'left', padding:'16px 18px', background:'transparent', border:'none', color:'#F2FBFF', fontSize:18, fontWeight:700, cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}
              >
                <span>{item.q}</span>
                <span style={{ color:'#A9C2CD' }}>{expanded ? '−' : '+'}</span>
              </button>
              {expanded && <p style={{ margin:0, padding:'0 18px 16px', color:'#A6BFCA', fontSize:15, lineHeight:1.65 }}>{item.a}</p>}
            </article>
          )
        })}
      </div>
    </section>
  )
}
