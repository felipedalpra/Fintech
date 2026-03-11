import { useEffect, useMemo, useRef, useState } from 'react'
import { C, base } from '../theme.js'
import { buildFinancialBrain } from '../ai/financialBrain.js'
import { queryFinancialAssistant } from '../lib/aiClient.js'

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
    { role:'assistant', content:'Sou o copiloto do SurgiFlow. Posso responder sobre lucro, caixa, metas, riscos e previsões.' },
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
    const answer = await queryFinancialAssistant({ question, brain, history })
    setSending(false)

    setMessages(current => [...current, { role:'assistant', content:answer }])
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
          <div style={{ padding:'16px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
            <div>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Copiloto</div>
              <div style={{ color:C.text, fontWeight:800, marginTop:4 }}>Assistente financeiro da clínica</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} style={{ width:34, height:34, borderRadius:10, border:`1px solid ${C.border}`, background:'transparent', color:C.textSub, cursor:'pointer' }}>×</button>
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
