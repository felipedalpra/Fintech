import { useEffect, useMemo, useRef, useState } from 'react'
import { C, base } from '../theme.js'
import { fmt } from '../utils.js'
import { answerFinancialQuestion, buildFinancialBrain, buildFinancialContext, buildFinancialWelcomeMessage } from '../ai/financialBrain.js'
import { Card, Btn, Badge, Progress } from './UI.jsx'

const SUGGESTIONS = [
  'Qual foi meu lucro este mês?',
  'Faça uma previsão para o próximo mês.',
  'Faça uma previsão para o próximo ano.',
  'Qual procedimento é mais lucrativo?',
  'Qual despesa mais cresceu?',
  'Quais erros financeiros você encontrou?',
  'Qual é meu score de saúde financeira?',
  'Quantas cirurgias preciso para bater minha meta?',
  'O que eu devo fazer esta semana?',
]

export function AIAssistant({ data }) {
  const brain = useMemo(() => buildFinancialBrain(data), [data])
  const [messages, setMessages] = useState([{ role:'assistant', content:buildFinancialWelcomeMessage(brain) }])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    setMessages([{ role:'assistant', content:buildFinancialWelcomeMessage(brain) }])
  }, [brain])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim()) return
    const question = input.trim()
    setMessages(current => [...current, { role:'user', content:question }])
    setInput('')
    setSending(true)

    const fallback = answerFinancialQuestion(question, brain)
    let answer = fallback

    try {
      const response = await fetch('/api/financial-assistant', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({
          question,
          context:buildFinancialContext(brain),
        }),
      })
      if (response.ok) {
        const payload = await response.json()
        if (payload?.answer) answer = payload.answer
      }
    } catch {
      answer = fallback
    } finally {
      setSending(false)
    }

    setMessages(current => [...current, { role:'assistant', content:answer }])
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16, minHeight:560 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14 }}>
        <InsightCard label="Próximo mês" value={fmt(brain.forecast.nextMonth.netProfit)} hint={`Receita prevista ${fmt(brain.forecast.nextMonth.revenue)}`} color={brain.forecast.nextMonth.netProfit >= 0 ? C.green : C.red} />
        <InsightCard label="Próximo ano" value={fmt(brain.forecast.nextYear.netProfit)} hint={`Receita anual estimada ${fmt(brain.forecast.nextYear.revenue)}`} color={brain.forecast.nextYear.netProfit >= 0 ? C.accent : C.red} />
        <InsightCard label="Health Score" value={`${brain.health.score}/100`} hint={brain.health.label} color={brain.health.color} />
        <InsightCard label="Cobertura de dados" value={`${brain.dataLayer.coverageScore}/100`} hint={`${brain.dataLayer.sources.filter(item => item.count > 0).length} fontes ativas`} color={brain.dataLayer.coverageScore >= 70 ? C.cyan : C.yellow} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.1fr 0.9fr', gap:16 }}>
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, gap:12, flexWrap:'wrap' }}>
            <div>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Saúde financeira</div>
              <div style={{ fontSize:24, color:C.text, fontWeight:900, letterSpacing:'-0.03em', marginTop:6 }}>{brain.health.label}</div>
            </div>
            <Badge color={brain.health.color}>{brain.health.score}/100</Badge>
          </div>
          <Progress val={brain.health.score} max={100} color={brain.health.color} h={10} />
          <div style={{ color:C.textDim, fontSize:12, marginTop:10 }}>{brain.health.summary}</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0,1fr))', gap:10, marginTop:16 }}>
            {brain.health.factors.map(item => (
              <div key={item.label} style={{ padding:12, borderRadius:14, background:C.surface, border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{item.label}</div>
                <div style={{ color:item.color, fontWeight:800 }}>{item.value}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:14 }}>Diagnóstico automático</div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {brain.diagnosisLayer.alerts.length === 0 && <div style={{ color:C.textDim, fontSize:13 }}>Nenhum alerta relevante no momento.</div>}
            {brain.diagnosisLayer.alerts.slice(0, 4).map(item => <AlertRow key={item.title} title={item.title} detail={item.detail} severity={item.severity} />)}
          </div>
        </Card>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))', gap:16 }}>
        <Card>
          <SectionLabel>Camada 1 · Dados</SectionLabel>
          <div style={{ display:'grid', gap:10 }}>
            {brain.dataLayer.sources.map(item => (
              <MiniMetric key={item.key} label={item.label} value={item.count} suffix=" registros" color={item.count > 0 ? C.green : C.textDim} />
            ))}
          </div>
        </Card>

        <Card>
          <SectionLabel>Camada 2 · Análise</SectionLabel>
          <div style={{ display:'grid', gap:10 }}>
            <MiniMetric label="Margem líquida" value={brain.analysisLayer.main.monthMarginLabel} color={brain.analysisLayer.main.monthMargin >= 0.15 ? C.green : C.red} />
            <MiniMetric label="Ticket médio" value={fmt(brain.analysisLayer.unitEconomics.averageTicket)} color={C.accent} />
            <MiniMetric label="Receita por cirurgia" value={fmt(brain.analysisLayer.unitEconomics.avgRevenuePerSurgery)} color={C.cyan} />
            <MiniMetric label="Conversão consulta → cirurgia" value={brain.analysisLayer.operational.conversionLabel} color={C.yellow} />
          </div>
        </Card>

        <Card>
          <SectionLabel>Camada 3 · Diagnóstico</SectionLabel>
          <div style={{ display:'grid', gap:10 }}>
            <MiniMetric label="Receita vs mês anterior" value={brain.analysisLayer.trends.revenueVsLastMonthLabel} color={brain.analysisLayer.main.monthGrowthRevenue >= 0 ? C.green : C.red} />
            <MiniMetric label="Lucro vs mês anterior" value={brain.analysisLayer.trends.profitVsLastMonthLabel} color={brain.analysisLayer.main.monthGrowthProfit >= 0 ? C.green : C.red} />
            <MiniMetric label="Alertas ativos" value={brain.diagnosisLayer.alerts.length} color={brain.diagnosisLayer.alerts.length ? C.yellow : C.green} />
            <MiniMetric label="Recebíveis em aberto" value={fmt(brain.allTime.receivablesOpenTotal)} color={C.purple} />
          </div>
        </Card>

        <Card>
          <SectionLabel>Camada 4 · Recomendações</SectionLabel>
          <div style={{ display:'grid', gap:10 }}>
            {(brain.recommendationLayer.priorities.slice(0, 3)).map((item, index) => (
              <div key={index} style={{ padding:12, borderRadius:14, background:C.surface, border:`1px solid ${C.border}` }}>
                <div style={{ color:C.text, fontSize:13, lineHeight:1.6 }}>{item}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:14 }}>
            <div>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Painel de decisões estratégicas</div>
              <div style={{ color:C.textDim, fontSize:12, marginTop:4 }}>O que a clínica deve atacar agora.</div>
            </div>
          </div>
          <div style={{ display:'grid', gap:10 }}>
            <StrategicRow label="Procedimento mais lucrativo" value={brain.strategicPanel.mostProfitableProcedure?.name || 'Sem base suficiente'} sub={brain.strategicPanel.mostProfitableProcedure ? fmt(brain.strategicPanel.mostProfitableProcedure.profit) : ''} />
            <StrategicRow label="Melhor mês" value={brain.strategicPanel.bestMonth?.label || 'Sem base suficiente'} sub={brain.strategicPanel.bestMonth ? fmt(brain.strategicPanel.bestMonth.netProfit) : ''} />
            <StrategicRow label="Despesa que mais cresce" value={brain.strategicPanel.fastestGrowingExpense?.category || 'Sem alerta'} sub={brain.strategicPanel.fastestGrowingExpense?.growthLabel || ''} />
            <StrategicRow label="Meta mais urgente" value={brain.strategicPanel.realisticGoal?.title || 'Sem meta ativa'} sub={brain.strategicPanel.realisticGoal?.guidance || ''} />
          </div>
        </Card>

        <Card>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:14 }}>
            <div>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Plano de ação semanal</div>
              <div style={{ color:C.textDim, fontSize:12, marginTop:4 }}>Prioridades práticas para melhorar lucratividade.</div>
            </div>
            <Badge color={C.accent}>{brain.weeklyPlan.length} ações</Badge>
          </div>
          <div style={{ display:'grid', gap:10 }}>
            {brain.weeklyPlan.map((item, index) => <ActionRow key={`${index}-${item.title}`} index={index + 1} {...item} />)}
          </div>
        </Card>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {SUGGESTIONS.map((item, index) => (
          <button key={index} onClick={() => setInput(item)} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:20, padding:'6px 14px', color:C.textSub, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
            {item}
          </button>
        ))}
      </div>

      <Card style={{ flex:1, minHeight:340, overflowY:'auto', display:'flex', flexDirection:'column', gap:16, padding:20 }}>
        {messages.map((message, index) => (
          <div key={index} style={{ display:'flex', justifyContent:message.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ maxWidth:'82%', background:message.role === 'user' ? C.accent : C.surface, border:`1px solid ${message.role === 'user' ? C.accent + '60' : C.border}`, borderRadius:message.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px', padding:'13px 17px', fontSize:14, color:C.text, lineHeight:1.7, whiteSpace:'pre-wrap' }}>
              {message.role === 'assistant' && <div style={{ fontSize:11, color:C.accent, fontWeight:700, marginBottom:8, letterSpacing:'0.06em', textTransform:'uppercase' }}>CFO Automático</div>}
              {message.content}
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ display:'flex', justifyContent:'flex-start' }}>
            <div style={{ maxWidth:'82%', background:C.surface, border:`1px solid ${C.border}`, borderRadius:'18px 18px 18px 4px', padding:'13px 17px', fontSize:14, color:C.textDim, lineHeight:1.7 }}>
              <div style={{ fontSize:11, color:C.accent, fontWeight:700, marginBottom:8, letterSpacing:'0.06em', textTransform:'uppercase' }}>CFO Automático</div>
              Analisando os dados da clínica...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </Card>

      <div style={{ display:'flex', gap:10 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !sending) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Pergunte sobre lucro, margem, metas, previsões, riscos, conversão, procedimentos ou caixa"
          rows={3}
          style={{ ...base.input, flex:1, padding:'12px 16px', fontSize:14, resize:'none', lineHeight:1.5 }}
        />
        <Btn onClick={send} disabled={!input.trim() || sending} style={{ padding:'12px 24px', alignSelf:'flex-end' }}>{sending ? 'Enviando...' : 'Enviar'}</Btn>
      </div>
    </div>
  )
}

function SectionLabel({ children }) {
  return <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:14 }}>{children}</div>
}

function InsightCard({ label, value, hint, color }) {
  return (
    <Card style={{ padding:18 }}>
      <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:900, color, letterSpacing:'-0.03em' }}>{value}</div>
      <div style={{ color:C.textDim, fontSize:12, marginTop:6 }}>{hint}</div>
    </Card>
  )
}

function MiniMetric({ label, value, suffix = '', color }) {
  return (
    <div style={{ padding:12, borderRadius:14, background:C.surface, border:`1px solid ${C.border}` }}>
      <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{label}</div>
      <div style={{ color:color || C.text, fontWeight:800 }}>{value}{suffix}</div>
    </div>
  )
}

function AlertRow({ title, detail, severity }) {
  const color = severity === 'alta' ? C.red : severity === 'média' ? C.yellow : C.cyan
  return (
    <div style={{ padding:14, borderRadius:14, border:`1px solid ${color}33`, background:color + '10' }}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:12, marginBottom:6 }}>
        <div style={{ color:C.text, fontWeight:700 }}>{title}</div>
        <Badge color={color} small>{severity}</Badge>
      </div>
      <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6 }}>{detail}</div>
    </div>
  )
}

function StrategicRow({ label, value, sub }) {
  return (
    <div style={{ padding:12, borderRadius:14, background:C.surface, border:`1px solid ${C.border}` }}>
      <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{label}</div>
      <div style={{ color:C.text, fontWeight:800 }}>{value}</div>
      {sub ? <div style={{ color:C.textDim, fontSize:12, marginTop:4, lineHeight:1.5 }}>{sub}</div> : null}
    </div>
  )
}

function ActionRow({ index, title, description, priority }) {
  const color = priority === 'Alta' ? C.red : priority === 'Média' ? C.yellow : C.cyan
  return (
    <div style={{ display:'grid', gridTemplateColumns:'36px 1fr auto', gap:14, alignItems:'start', padding:14, borderRadius:16, background:C.surface, border:`1px solid ${C.border}` }}>
      <div style={{ width:36, height:36, borderRadius:10, background:C.card, display:'grid', placeItems:'center', color:C.text, fontWeight:800 }}>{index}</div>
      <div>
        <div style={{ color:C.text, fontWeight:700, marginBottom:4 }}>{title}</div>
        <div style={{ color:C.textDim, fontSize:13, lineHeight:1.6 }}>{description}</div>
      </div>
      <Badge color={color}>{priority}</Badge>
    </div>
  )
}
