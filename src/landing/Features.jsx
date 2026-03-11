import { C } from '../theme.js'

const FEATURES = [
  ['Dashboard financeiro', 'Tenha uma leitura imediata do desempenho da clínica.'],
  ['Registro de cirurgias', 'Acompanhe faturamento e lucratividade por procedimento.'],
  ['Controle de consultas', 'Organize atendimentos particulares e convênios com previsibilidade.'],
  ['Contas a pagar e receber', 'Centralize compromissos e recebimentos sem esquecer nada.'],
  ['Fluxo de caixa automático', 'Veja a dinâmica do caixa sem alimentar planilhas paralelas.'],
  ['DRE e balanço', 'Leitura gerencial e contábil em um formato profissional.'],
  ['Metas financeiras', 'Transforme objetivos em indicadores acompanháveis.'],
  ['Assistente IA', 'Faça perguntas e extraia respostas sobre o desempenho financeiro.'],
]

export function Features() {
  return (
    <section style={{ padding:'18px 0 82px' }}>
      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,0.92fr) minmax(0,1.08fr)', gap:24, alignItems:'start' }}>
        <div style={{ animation:'fadeUp 0.8s ease both' }}>
          <div style={{ fontSize:12, color:'#FDBA74', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>O que você ganha</div>
          <h2 style={{ margin:'0 0 12px', fontSize:'clamp(30px, 4vw, 48px)', lineHeight:1.02, letterSpacing:'-0.04em', color:C.text }}>Uma plataforma pensada para vender tranquilidade, clareza e crescimento</h2>
          <p style={{ margin:0, color:'#9FB2BC', fontSize:17, lineHeight:1.8, maxWidth:580 }}>
            O SurgiFlow combina visão executiva, controle financeiro e organização clínica em uma experiência que transmite sofisticação e controle do negócio.
          </p>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:16 }}>
          {FEATURES.map(([title, text], index) => (
            <div key={title} style={{ padding:22, borderRadius:22, background:'rgba(10,16,27,0.86)', border:'1px solid rgba(255,255,255,0.08)', minHeight:154, animation:'fadeUp 0.8s ease both', animationDelay:`${0.05 * index}s` }}>
              <div style={{ width:38, height:38, borderRadius:12, background:'linear-gradient(135deg, rgba(255,111,60,0.24), rgba(0,184,217,0.24))', marginBottom:16, boxShadow:'0 12px 24px rgba(0,0,0,0.18)' }} />
              <div style={{ color:C.text, fontSize:18, fontWeight:700, lineHeight:1.25, marginBottom:8 }}>{title}</div>
              <div style={{ color:'#97AAB4', fontSize:14, lineHeight:1.7 }}>{text}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
