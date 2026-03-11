import { useState, useRef, useEffect } from 'react'
import { C, base } from '../theme.js'
import { fmt, getPeriodRange } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Btn } from './UI.jsx'

const SUGGESTIONS = [
  'Qual foi meu lucro este mês?',
  'Qual procedimento mais lucrativo?',
  'Quantas cirurgias preciso para bater minha meta?',
  'Qual despesa mais cresceu?',
  'Qual meu fluxo de caixa previsto?',
]

export function AIAssistant({ data }) {
  const month = getPeriodRange('month')
  const m = buildMetrics(data, { startDate:month.start, endDate:month.end, balanceDate:month.end })
  const [messages, setMessages] = useState([{ role:'assistant', content:'Sou seu assistente financeiro do ERP da cirurgiã. Posso responder sobre lucro, fluxo de caixa, metas, procedimentos, consultas e despesas com base nos dados atuais.' }])
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages])

  const send = () => {
    if (!input.trim()) return
    const question = input.trim()
    const answer = answerQuestion(question, data, m)
    setMessages(current => [...current, { role:'user', content:question }, { role:'assistant', content:answer }])
    setInput('')
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16, height:'calc(100vh - 160px)', minHeight:500 }}>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>{SUGGESTIONS.map((item, index) => <button key={index} onClick={() => setInput(item)} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:20, padding:'6px 14px', color:C.textSub, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>{item}</button>)}</div>
      <Card style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:16, padding:20 }}>{messages.map((message, index) => <div key={index} style={{ display:'flex', justifyContent:message.role === 'user' ? 'flex-end' : 'flex-start' }}><div style={{ maxWidth:'80%', background:message.role === 'user' ? C.accent : C.surface, border:`1px solid ${message.role === 'user' ? C.accent+'60' : C.border}`, borderRadius:message.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px', padding:'13px 17px', fontSize:14, color:C.text, lineHeight:1.65, whiteSpace:'pre-wrap' }}>{message.role === 'assistant' && <div style={{ fontSize:11, color:C.accent, fontWeight:700, marginBottom:8, letterSpacing:'0.06em', textTransform:'uppercase' }}>Assistente ERP</div>}{message.content}</div></div>)}<div ref={bottomRef} /></Card>
      <div style={{ display:'flex', gap:10 }}><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="Pergunte sobre lucro, metas, fluxo, procedimentos ou despesas" rows={2} style={{ ...base.input, flex:1, padding:'12px 16px', fontSize:14, resize:'none', lineHeight:1.5 }} /><Btn onClick={send} disabled={!input.trim()} style={{ padding:'12px 24px', alignSelf:'flex-end' }}>Enviar</Btn></div>
    </div>
  )
}

function answerQuestion(question, data, m) {
  const q = question.toLowerCase()
  const lines = []
  if (q.includes('lucro')) lines.push(`Seu lucro líquido no período atual é ${fmt(m.netProfit)}.`)
  if (q.includes('procedimento')) {
    const top = m.byProcedure[0]
    lines.push(top ? `O procedimento mais lucrativo é ${top.name}, com ${fmt(top.profit)} no período.` : 'Ainda não há cirurgias suficientes para ranquear procedimentos.')
  }
  if (q.includes('meta')) {
    const revenueGoals = data.goals.filter(goal => goal.metric === 'faturamento')
    if (revenueGoals[0]) {
      const gap = revenueGoals[0].target - m.grossRevenue
      const avg = m.averageTicket || 1
      lines.push(gap > 0 ? `Faltam ${fmt(gap)} para a meta de faturamento. Mantido o ticket médio atual, você precisa de aproximadamente ${Math.ceil(gap / avg)} cirurgia(s).` : 'A meta de faturamento já foi atingida.')
    } else {
      lines.push('Não há meta de faturamento cadastrada para estimar cirurgias necessárias.')
    }
  }
  if (q.includes('despesa')) {
    const category = Object.entries(m.expensesByCategory).sort(([, a], [, b]) => b - a)[0]
    lines.push(category ? `A categoria de despesa mais pesada no período é ${category[0]}, com ${fmt(category[1])}.` : 'Não há despesas no período selecionado.')
  }
  if (q.includes('fluxo')) lines.push(`Seu fluxo de caixa realizado é ${fmt(m.cashBalance)} e a previsão financeira é ${fmt(m.prediction)}.`)
  if (lines.length === 0) lines.push(`Receita bruta ${fmt(m.grossRevenue)}, lucro líquido ${fmt(m.netProfit)}, caixa ${fmt(m.cashBalance)} e previsão ${fmt(m.prediction)}.`)
  return lines.join('\n')
}
