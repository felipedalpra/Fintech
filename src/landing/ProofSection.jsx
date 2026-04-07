import { useEffect, useMemo, useState } from 'react'

const STATS = [
  { label:'Clínicas ativas', value:320, suffix:'+' },
  { label:'Horas poupadas/mês', value:42, suffix:'h' },
  { label:'Melhora média de margem', value:17, suffix:'%' },
]

const TESTIMONIALS = [
  {
    quote:'Em duas semanas eu já conseguia mostrar margem por procedimento em reunião de equipe.',
    author:'Dra. Mariana Ribeiro',
    role:'Cirurgiã plástica',
  },
  {
    quote:'A sensação é de sair da planilha para um cockpit de gestão real.',
    author:'Clínica Lumina',
    role:'Gestão administrativa',
  },
  {
    quote:'Paramos de decidir por intuição. Agora temos base diária de caixa e lucro.',
    author:'Dr. Paulo Siqueira',
    role:'Cirurgião plástico',
  },
]

export function ProofSection() {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setActive(current => (current + 1) % TESTIMONIALS.length), 5000)
    return () => window.clearInterval(id)
  }, [])

  const testimonial = useMemo(() => TESTIMONIALS[active], [active])

  return (
    <section style={{ padding:'10px 0 82px' }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap:18, alignItems:'start' }}>
        <div className="reveal">
          <div style={{ fontSize:12, color:'#67E8F9', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Prova social</div>
          <h2 style={{ margin:'0 0 12px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.04, letterSpacing:'-0.04em', color:'#F4FCFF' }}>
            Números e relatos para reduzir incerteza
          </h2>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:10 }}>
            {STATS.map((item, index) => (
              <article key={item.label} className="reveal" style={{ padding:14, borderRadius:16, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.12)' }}>
                <div style={{ fontSize:11, color:'#8CA6B2', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:5 }}>{item.label}</div>
                <div style={{ fontSize:31, lineHeight:1, color:'#E8F8FF', fontWeight:900, letterSpacing:'-0.04em' }}>
                  <CountUp to={item.value} delay={index * 120} />{item.suffix}
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="reveal" style={{ padding:'24px clamp(18px, 3vw, 24px)', borderRadius:22, border:'1px solid rgba(255,255,255,0.12)', background:'linear-gradient(145deg, rgba(18,22,38,0.88), rgba(8,20,36,0.9))' }}>
          <p style={{ margin:'0 0 14px', color:'#F2FBFF', fontSize:20, lineHeight:1.5 }}>&ldquo;{testimonial.quote}&rdquo;</p>
          <div style={{ color:'#D4EAF4', fontSize:13, fontWeight:700 }}>{testimonial.author}</div>
          <div style={{ color:'#8DA6B2', fontSize:12, marginTop:3 }}>{testimonial.role}</div>
          <div style={{ display:'flex', gap:8, marginTop:15 }}>
            {TESTIMONIALS.map((item, index) => (
              <button
                key={item.author}
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Depoimento ${index + 1}`}
                style={{
                  width:index === active ? 24 : 10,
                  height:10,
                  borderRadius:999,
                  border:'none',
                  background:index === active ? '#67E8F9' : 'rgba(255,255,255,0.28)',
                  cursor:'pointer',
                  transition:'all 0.22s ease',
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function CountUp({ to, delay = 0 }) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const started = performance.now()
      const duration = 920
      let raf = 0
      const step = now => {
        const p = Math.min(1, (now - started) / duration)
        setValue(Math.round(to * p))
        if (p < 1) raf = window.requestAnimationFrame(step)
      }
      raf = window.requestAnimationFrame(step)
      return () => window.cancelAnimationFrame(raf)
    }, delay)

    return () => window.clearTimeout(timeoutId)
  }, [to, delay])

  return value
}
