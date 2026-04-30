import { useEffect, useMemo, useState } from 'react'

const STATS = [
  { label:'Clínicas ativas', value:320, suffix:'+' },
  { label:'Horas poupadas/mês', value:42, suffix:'h' },
  { label:'Melhora média de margem', value:17, suffix:'%' },
]

const TESTIMONIALS = [
  {
    quote: 'Descobri que rinoplastia rendia 11% menos que lipoaspiração. Ajustei a precificação na semana seguinte e recuperei a diferença em 30 dias.',
    author: 'Dra. Mariana Ribeiro',
    role: 'Cirurgiã plástica · São Paulo',
    initials: 'MR',
    avatarColor: '#14B8A6',
  },
  {
    quote: 'Fechávamos o mês em dois dias de planilha. Hoje em 2 horas. A equipe administrativa parou de atrasar o repasse dos números para os sócios.',
    author: 'Carolina Mello',
    role: 'Gestão administrativa · Clínica Lumina, RJ',
    initials: 'CM',
    avatarColor: '#8B5CF6',
  },
  {
    quote: 'Antecipei um trimestre de pressão financeira com 6 semanas de antecedência. Sem o caixa diário visível, teria percebido tarde demais.',
    author: 'Dr. Paulo Siqueira',
    role: 'Cirurgião plástico · Belo Horizonte',
    initials: 'PS',
    avatarColor: '#0EA5E9',
  },
]

const STARS = (
  <div style={{ display:'flex', gap:3, marginBottom:14 }}>
    {[1,2,3,4,5].map(i => (
      <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="#FDE68A" stroke="none">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    ))}
  </div>
)

export function ProofSection() {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setActive(current => (current + 1) % TESTIMONIALS.length), 5200)
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
              <article key={item.label} className="reveal" style={{ padding:14, borderRadius:16, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.12)', transitionDelay:`${index * 80}ms` }}>
                <div style={{ fontSize:11, color:'#8CA6B2', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:5 }}>{item.label}</div>
                <div style={{ fontSize:31, lineHeight:1, color:'#E8F8FF', fontWeight:900, letterSpacing:'-0.04em' }}>
                  <CountUp to={item.value} delay={index * 120} />{item.suffix}
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="reveal" style={{ padding:'24px clamp(18px, 3vw, 24px)', borderRadius:22, border:'1px solid rgba(255,255,255,0.12)', background:'linear-gradient(145deg, rgba(18,22,38,0.88), rgba(8,20,36,0.9))' }}>
          {STARS}
          <p style={{ margin:'0 0 18px', color:'#F2FBFF', fontSize:18, lineHeight:1.55 }}>&ldquo;{testimonial.quote}&rdquo;</p>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{
              width:38,
              height:38,
              borderRadius:'50%',
              background:`linear-gradient(135deg, ${testimonial.avatarColor}44, ${testimonial.avatarColor}22)`,
              border:`1px solid ${testimonial.avatarColor}55`,
              display:'grid',
              placeItems:'center',
              fontSize:13,
              fontWeight:800,
              color:testimonial.avatarColor,
              flexShrink:0,
            }}>
              {testimonial.initials}
            </div>
            <div>
              <div style={{ color:'#D4EAF4', fontSize:13, fontWeight:700 }}>{testimonial.author}</div>
              <div style={{ color:'#7A9BAA', fontSize:12, marginTop:2 }}>{testimonial.role}</div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:18 }}>
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
