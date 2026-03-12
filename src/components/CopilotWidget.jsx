import { useEffect, useMemo, useRef, useState } from 'react'
import { C, base } from '../theme.js'
import { buildFinancialBrain } from '../ai/financialBrain.js'
import { queryFinancialAssistant } from '../lib/aiClient.js'
import { BrandLogo } from './BrandLogo.jsx'

const QUICK_QUESTIONS = [
  'Qual foi meu lucro este mês?',
  'Qual procedimento é mais lucrativo?',
  'O que preciso fazer esta semana?',
]

export function CopilotWidget({ data }) {
  const brain = useMemo(() => buildFinancialBrain(data), [data])
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState([
    { role:'assistant', content:'Sou o copiloto do SurgiMetrics. Posso responder sobre lucro, caixa, metas, riscos e previsões.', meta:{ source:'local', reason:'' } },
  ])
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' })
  }, [messages, open, sending])

  const send = async presetQuestion => {
    const question = (presetQuestion || input).trim()
    if (!question || sending) return

    setMessages(current => [...current, { role:'user', content:question }])
    setInput('')
    setSending(true)

    const history = [...messages, { role:'user', content:question }]
    const result = await queryFinancialAssistant({ question, brain, history })
    setSending(false)

    setMessages(current => [...current, { role:'assistant', content:result.answer, meta:{ source:result.source, reason:result.reason } }])
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        style={{
          position:'fixed',
          right:24,
          bottom:24,
          width:62,
          height:62,
          borderRadius:20,
          border:`1px solid ${C.accent}55`,
          background:`linear-gradient(180deg, ${C.accent}, ${C.cyan})`,
          color:'#fff',
          display:'grid',
          placeItems:'center',
          fontSize:24,
          cursor:'pointer',
          boxShadow:'0 18px 45px rgba(15, 23, 42, 0.35)',
          zIndex:60,
        }}
        title={open ? 'Fechar copiloto' : 'Abrir copiloto'}
      >
        ✦
      </button>

      {open && (
        <div style={{ position:'fixed', right:24, bottom:98, width:'min(420px, calc(100vw - 32px))', height:'min(640px, calc(100vh - 140px))', borderRadius:24, border:`1px solid ${C.borderBright}`, background:C.card, boxShadow:'0 26px 80px rgba(15, 23, 42, 0.45)', zIndex:60, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'18px 18px 16px', borderBottom:`1px solid ${C.border}`, background:`radial-gradient(circle at top right, ${C.cyan}22, transparent 40%), linear-gradient(180deg, ${C.surface}, ${C.card})` }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:14 }}>
              <div>
                <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Copiloto</div>
                <div style={{ color:C.text, fontWeight:800, marginTop:4 }}>Assistente financeiro da clínica</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} style={{ width:34, height:34, borderRadius:10, border:`1px solid ${C.border}`, background:'transparent', color:C.textSub, cursor:'pointer' }}>×</button>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'84px 1fr', gap:14, alignItems:'center' }}>
              <AssistantPortrait />
              <div>
                <div style={{ color:C.text, fontSize:15, fontWeight:800, marginBottom:6 }}>Coruja analítica do SurgiMetrics</div>
                <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6, marginBottom:10 }}>
                  CFO virtual focado em lucro, caixa, metas e previsões.
                </div>
                <BrandLogo size="sm" />
              </div>
            </div>
          </div>

          <div style={{ padding:'12px 14px', display:'flex', gap:8, flexWrap:'wrap', borderBottom:`1px solid ${C.border}` }}>
            {QUICK_QUESTIONS.map(item => (
              <button key={item} type="button" onClick={() => send(item)} style={{ padding:'6px 10px', borderRadius:999, border:`1px solid ${C.border}`, background:C.surface, color:C.textSub, fontSize:12, cursor:'pointer' }}>
                {item}
              </button>
            ))}
          </div>

          <div style={{ flex:1, overflowY:'auto', padding:16, display:'flex', flexDirection:'column', gap:12 }}>
            {messages.map((message, index) => (
              <div key={index} style={{ alignSelf:message.role === 'user' ? 'flex-end' : 'flex-start', maxWidth:'88%', padding:'12px 14px', borderRadius:message.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background:message.role === 'user' ? C.accent : C.surface, border:`1px solid ${message.role === 'user' ? C.accent + '55' : C.border}`, color:C.text, whiteSpace:'pre-wrap', fontSize:13, lineHeight:1.6 }}>
                {message.content}
                {message.role === 'assistant' && (
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginTop:10 }}>
                    <span style={{ fontSize:10, color:message.meta?.source === 'openai' ? C.green : C.yellow, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:700 }}>
                      {message.meta?.source === 'openai' ? 'Resposta via OpenAI' : 'Fallback local'}
                    </span>
                    {message.meta?.reason ? <span style={{ fontSize:10, color:C.textDim }}>{message.meta.reason}</span> : null}
                  </div>
                )}
              </div>
            ))}
            {sending && <div style={{ maxWidth:'88%', padding:'12px 14px', borderRadius:'16px 16px 16px 4px', background:C.surface, border:`1px solid ${C.border}`, color:C.textDim, fontSize:13 }}>Analisando os dados...</div>}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding:14, borderTop:`1px solid ${C.border}`, display:'flex', gap:10 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={2}
              placeholder="Pergunte ao copiloto"
              style={{ ...base.input, flex:1, resize:'none', padding:'10px 12px', fontSize:13, lineHeight:1.5 }}
            />
            <button type="button" onClick={() => send()} disabled={!input.trim() || sending} style={{ minWidth:78, borderRadius:12, border:'none', background:C.accent, color:'#fff', cursor:sending ? 'not-allowed' : 'pointer', opacity:sending ? 0.6 : 1, fontWeight:700 }}>
              Enviar
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function AssistantPortrait() {
  return (
    <div style={{ width:84, height:84, borderRadius:22, position:'relative', overflow:'hidden', border:`1px solid ${C.borderBright}`, background:'linear-gradient(180deg, rgba(109, 190, 203, 0.22), rgba(19, 36, 64, 0.95))', boxShadow:'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
      <div style={{ position:'absolute', inset:0, background:'radial-gradient(circle at center, rgba(255,255,255,0.22), transparent 65%)' }} />
      <div style={{ position:'absolute', top:14, left:18, width:48, height:48, borderRadius:'50%', background:'#C8A98C', boxShadow:'0 0 0 6px rgba(255,255,255,0.06)' }} />
      <div style={{ position:'absolute', top:10, left:10, width:20, height:20, transform:'rotate(-26deg)', borderRadius:'4px 16px 4px 16px', background:'#5C4437' }} />
      <div style={{ position:'absolute', top:10, right:10, width:20, height:20, transform:'rotate(26deg)', borderRadius:'16px 4px 16px 4px', background:'#5C4437' }} />
      <div style={{ position:'absolute', top:28, left:21, width:15, height:15, borderRadius:'50%', background:'#EFD56E', boxShadow:'0 0 0 3px #244872' }} />
      <div style={{ position:'absolute', top:28, right:21, width:15, height:15, borderRadius:'50%', background:'#EFD56E', boxShadow:'0 0 0 3px #244872' }} />
      <div style={{ position:'absolute', top:33, left:27, width:5, height:5, borderRadius:'50%', background:'#0A1220' }} />
      <div style={{ position:'absolute', top:33, right:27, width:5, height:5, borderRadius:'50%', background:'#0A1220' }} />
      <div style={{ position:'absolute', top:40, left:30, width:24, height:6, borderRadius:999, border:'2px solid rgba(219,232,243,0.75)' }} />
      <div style={{ position:'absolute', top:44, left:38, width:8, height:12, clipPath:'polygon(50% 0%, 100% 100%, 0% 100%)', background:'#223A44' }} />
      <div style={{ position:'absolute', bottom:0, left:0, right:0, height:28, background:'linear-gradient(180deg, #16345B, #102440)' }} />
      <div style={{ position:'absolute', bottom:0, left:28, width:18, height:28, background:'linear-gradient(180deg, #36C0C4, #1D9DA8)', clipPath:'polygon(50% 0%, 100% 0, 78% 100%, 22% 100%, 0 0)' }} />
    </div>
  )
}
