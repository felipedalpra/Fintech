import { useMemo, useState, useRef, useEffect } from 'react'
import { C, base } from '../theme.js'
import { fmt, fmtN, getPeriodRange, today } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Btn, Badge, Progress } from './UI.jsx'

const SUGGESTIONS = [
  'Qual foi meu lucro este mês?',
  'Faça uma previsão para o próximo mês.',
  'Faça uma previsão para o próximo ano.',
  'Quais erros financeiros você encontrou?',
  'Qual procedimento mais lucrativo?',
  'O que eu devo fazer para aumentar minha lucratividade?',
  'Qual meu fluxo de caixa previsto?',
  'Qual é meu score de saúde financeira?',
  'O que preciso fazer esta semana?',
]

export function AIAssistant({ data }) {
  const analysis = useMemo(() => buildAssistantAnalysis(data), [data])
  const [messages, setMessages] = useState([{ role:'assistant', content:buildWelcomeMessage(analysis) }])
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' })
  }, [messages])

  const send = () => {
    if (!input.trim()) return
    const question = input.trim()
    const answer = answerQuestion(question, analysis)
    setMessages(current => [...current, { role:'user', content:question }, { role:'assistant', content:answer }])
    setInput('')
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16, minHeight:560 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14 }}>
        <InsightCard label="Próximo mês" value={fmt(analysis.forecast.nextMonth.netProfit)} hint={`Receita prevista ${fmt(analysis.forecast.nextMonth.revenue)}`} color={analysis.forecast.nextMonth.netProfit >= 0 ? C.green : C.red} />
        <InsightCard label="Próximo ano" value={fmt(analysis.forecast.nextYear.netProfit)} hint={`Receita anual estimada ${fmt(analysis.forecast.nextYear.revenue)}`} color={analysis.forecast.nextYear.netProfit >= 0 ? C.accent : C.red} />
        <InsightCard label="Risco principal" value={analysis.risks[0]?.title || 'Sem alertas críticos'} hint={analysis.risks[0]?.severity || 'estável'} color={analysis.risks[0]?.severity === 'alta' ? C.red : analysis.risks[0] ? C.yellow : C.green} />
        <InsightCard label="Oportunidade" value={analysis.opportunities[0]?.title || 'Sem oportunidade clara'} hint={analysis.opportunities[0]?.impact || 'acompanhar dados'} color={C.cyan} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.1fr 0.9fr', gap:16 }}>
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, gap:12, flexWrap:'wrap' }}>
            <div>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Saúde financeira</div>
              <div style={{ fontSize:24, color:C.text, fontWeight:900, letterSpacing:'-0.03em', marginTop:6 }}>{analysis.health.label}</div>
            </div>
            <Badge color={analysis.health.color}>{analysis.health.score}/100</Badge>
          </div>
          <Progress val={analysis.health.score} max={100} color={analysis.health.color} h={10} />
          <div style={{ color:C.textDim, fontSize:12, marginTop:10 }}>{analysis.health.summary}</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0,1fr))', gap:10, marginTop:16 }}>
            {analysis.health.factors.map(item => <div key={item.label} style={{ padding:12, borderRadius:14, background:C.surface, border:`1px solid ${C.border}` }}><div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{item.label}</div><div style={{ color:item.color, fontWeight:800 }}>{item.value}</div></div>)}
          </div>
        </Card>

        <Card>
          <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:14 }}>Alertas automáticos</div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {analysis.risks.length === 0 && <div style={{ color:C.textDim, fontSize:13 }}>Nenhum alerta relevante no momento.</div>}
            {analysis.risks.slice(0, 4).map(item => <AlertRow key={item.title} title={item.title} detail={item.detail} severity={item.severity} />)}
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:14 }}>
          <div>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Plano de ação semanal</div>
            <div style={{ color:C.textDim, fontSize:12, marginTop:4 }}>Prioridades práticas para aumentar controle e lucratividade.</div>
          </div>
          <Badge color={C.accent}>{analysis.weeklyPlan.length} ações</Badge>
        </div>
        <div style={{ display:'grid', gap:10 }}>
          {analysis.weeklyPlan.map((item, index) => <ActionRow key={`${index}-${item.title}`} index={index + 1} {...item} />)}
        </div>
      </Card>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {SUGGESTIONS.map((item, index) => <button key={index} onClick={() => setInput(item)} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:20, padding:'6px 14px', color:C.textSub, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>{item}</button>)}
      </div>

      <Card style={{ flex:1, minHeight:340, overflowY:'auto', display:'flex', flexDirection:'column', gap:16, padding:20 }}>
        {messages.map((message, index) => (
          <div key={index} style={{ display:'flex', justifyContent:message.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ maxWidth:'82%', background:message.role === 'user' ? C.accent : C.surface, border:`1px solid ${message.role === 'user' ? C.accent+'60' : C.border}`, borderRadius:message.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px', padding:'13px 17px', fontSize:14, color:C.text, lineHeight:1.7, whiteSpace:'pre-wrap' }}>
              {message.role === 'assistant' && <div style={{ fontSize:11, color:C.accent, fontWeight:700, marginBottom:8, letterSpacing:'0.06em', textTransform:'uppercase' }}>Assistente Financeiro</div>}
              {message.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </Card>

      <div style={{ display:'flex', gap:10 }}>
        <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="Pergunte sobre previsões, riscos, score financeiro, rentabilidade, metas ou fluxo de caixa" rows={3} style={{ ...base.input, flex:1, padding:'12px 16px', fontSize:14, resize:'none', lineHeight:1.5 }} />
        <Btn onClick={send} disabled={!input.trim()} style={{ padding:'12px 24px', alignSelf:'flex-end' }}>Enviar</Btn>
      </div>
    </div>
  )
}

function buildAssistantAnalysis(data) {
  const monthRange = getPeriodRange('month')
  const yearRange = getPeriodRange('year')
  const currentMonth = buildMetrics(data, { startDate:monthRange.start, endDate:monthRange.end, balanceDate:monthRange.end })
  const currentYear = buildMetrics(data, { startDate:yearRange.start, endDate:yearRange.end, balanceDate:yearRange.end })
  const allTime = buildMetrics(data, { balanceDate:today() })
  const months = buildMonthSeries(allTime)
  const daily = buildDailySeries(allTime.cashFlowEntries)

  const forecast = {
    nextDay: forecastNextDay(daily),
    nextMonth: forecastNextMonth(months, currentMonth),
    nextYear: forecastNextYear(months, currentYear),
  }

  const risks = detectRisks({ currentMonth, currentYear, allTime, forecast, months })
  const opportunities = detectOpportunities({ currentMonth, currentYear, allTime, forecast, months })
  const recommendations = buildRecommendations({ currentMonth, currentYear, allTime, risks, opportunities })
  const health = buildHealthScore({ currentMonth, currentYear, allTime, forecast, risks })
  const weeklyPlan = buildWeeklyPlan({ currentMonth, allTime, risks, opportunities, recommendations })

  return {
    currentMonth,
    currentYear,
    allTime,
    months,
    daily,
    forecast,
    risks,
    opportunities,
    recommendations,
    health,
    weeklyPlan,
  }
}

function buildWelcomeMessage(analysis) {
  const lines = [
    'Analisei os dados atuais da clínica e já consigo atuar como um copiloto financeiro.',
    `No mês atual, o lucro líquido está em ${fmt(analysis.currentMonth.netProfit)} e o fluxo de caixa realizado está em ${fmt(analysis.currentMonth.cashBalance)}.`,
    `A previsão para o próximo mês aponta ${fmt(analysis.forecast.nextMonth.netProfit)} de lucro líquido e ${fmt(analysis.forecast.nextYear.netProfit)} para os próximos 12 meses.`,
    `Seu score de saúde financeira atual é ${analysis.health.score}/100 (${analysis.health.label.toLowerCase()}).`,
  ]

  if (analysis.risks[0]) lines.push(`Alerta principal: ${analysis.risks[0].title}.`)
  if (analysis.opportunities[0]) lines.push(`Maior oportunidade: ${analysis.opportunities[0].title}.`)
  lines.push('Posso prever resultado diário, mensal e anual, apontar erros, gerar plano de ação semanal e sugerir formas práticas de aumentar a lucratividade.')
  return lines.join('\n')
}

function answerQuestion(question, analysis) {
  const q = normalize(question)
  const lines = []

  if (matches(q, ['score', 'saude financeira', 'saude', 'saúde financeira'])) {
    lines.push(`Seu score de saúde financeira é ${analysis.health.score}/100.`)
    lines.push(`Classificação atual: ${analysis.health.label}.`)
    lines.push(analysis.health.summary)
    analysis.health.factors.forEach(item => {
      lines.push(`${item.label}: ${item.value}.`)
    })
  }

  if (matches(q, ['semana', 'esta semana', 'ação semanal', 'acao semanal', 'o que preciso fazer'])) {
    lines.push('Plano de ação da semana:')
    analysis.weeklyPlan.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}: ${item.description}`)
    })
  }

  if (matches(q, ['ano', 'anual', '12 meses', 'proximo ano', 'próximo ano'])) {
    lines.push('Previsão para os próximos 12 meses:')
    lines.push(`Receita estimada: ${fmt(analysis.forecast.nextYear.revenue)}.`)
    lines.push(`Despesas e custos estimados: ${fmt(analysis.forecast.nextYear.expenses)}.`)
    lines.push(`Lucro líquido estimado: ${fmt(analysis.forecast.nextYear.netProfit)}.`)
    lines.push('Base da projeção: média recente da operação combinada com o ritmo do mês atual.')
  }

  if (matches(q, ['mes', 'mês', 'proximo mes', 'próximo mês'])) {
    lines.push('Previsão para o próximo mês:')
    lines.push(`Receita estimada: ${fmt(analysis.forecast.nextMonth.revenue)}.`)
    lines.push(`Saídas estimadas: ${fmt(analysis.forecast.nextMonth.expenses)}.`)
    lines.push(`Lucro líquido estimado: ${fmt(analysis.forecast.nextMonth.netProfit)}.`)
  }

  if (matches(q, ['dia', 'amanha', 'amanhã', 'proximo dia', 'próximo dia'])) {
    lines.push('Previsão de curto prazo para o próximo dia operacional:')
    lines.push(`Entradas estimadas: ${fmt(analysis.forecast.nextDay.revenue)}.`)
    lines.push(`Saídas estimadas: ${fmt(analysis.forecast.nextDay.expenses)}.`)
    lines.push(`Saldo estimado: ${fmt(analysis.forecast.nextDay.netProfit)}.`)
  }

  if (matches(q, ['erro', 'erros', 'problema', 'problemas', 'risco', 'riscos', 'alerta', 'alertas'])) {
    if (analysis.risks.length === 0) {
      lines.push('Não encontrei alertas críticos nos dados atuais, mas a base ainda pode estar curta para diagnóstico mais agressivo.')
    } else {
      lines.push('Principais erros ou riscos identificados:')
      analysis.risks.slice(0, 5).forEach((risk, index) => {
        lines.push(`${index + 1}. ${risk.title}: ${risk.detail}`)
      })
    }
  }

  if (matches(q, ['lucratividade', 'melhorar lucro', 'melhorar lucratividade', 'aumentar lucro', 'aumentar lucratividade'])) {
    lines.push('Ações prioritárias para melhorar a lucratividade:')
    analysis.recommendations.slice(0, 6).forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`)
    })
  }

  if (matches(q, ['procedimento'])) {
    const top = analysis.allTime.byProcedure[0]
    const weak = analysis.allTime.byProcedure.filter(item => item.count > 0).at(-1)
    lines.push(top ? `Procedimento mais lucrativo: ${top.name}, com ${fmt(top.profit)} e ${fmtN(top.count)} cirurgia(s).` : 'Ainda não há cirurgias suficientes para ranquear procedimentos.')
    if (weak && analysis.allTime.byProcedure.length > 1) lines.push(`Ponto de atenção: ${weak.name} entrega ${fmt(weak.profit)} no período analisado.`)
  }

  if (matches(q, ['produto', 'modelador'])) {
    const top = analysis.allTime.productsByPerformance[0]
    const weak = analysis.allTime.productsByPerformance.find(item => item.profit < 0)
    lines.push(top ? `Produto mais lucrativo: ${top.name}, com ${fmt(top.profit)} e ${fmtN(top.soldQty)} unidades vendidas.` : 'Ainda não há vendas de produtos suficientes para análise.')
    if (weak) lines.push(`Alerta: ${weak.name} está com margem negativa de ${fmt(weak.profit)}.`)
  }

  if (matches(q, ['meta'])) {
    const revenueGoal = analysis.allTime.goals.find(goal => goal.metric === 'faturamento')
    if (revenueGoal) {
      const gap = revenueGoal.target - analysis.currentMonth.grossRevenue
      const avg = analysis.currentMonth.averageTicket || analysis.allTime.averageTicket || 1
      lines.push(gap > 0 ? `Faltam ${fmt(gap)} para a meta de faturamento. No ticket médio atual, isso representa cerca de ${Math.ceil(gap / avg)} cirurgia(s).` : 'A meta de faturamento já foi atingida no período atual.')
    } else {
      lines.push('Não há meta de faturamento cadastrada para calcular o gap de resultado.')
    }
  }

  if (matches(q, ['despesa', 'custos'])) {
    const topExpense = Object.entries(analysis.currentMonth.expensesByCategory).sort(([, a], [, b]) => b - a)[0]
    lines.push(topExpense ? `A categoria de saída mais pesada no mês atual é ${topExpense[0]}, com ${fmt(topExpense[1])}.` : 'Não há despesas suficientes no período atual.')
    lines.push(`Custos cirúrgicos do mês: ${fmt(analysis.currentMonth.surgeryCostTotal)}. Compras de produtos: ${fmt(analysis.currentMonth.productPurchaseTotal)}.`)
  }

  if (matches(q, ['fluxo', 'caixa'])) {
    lines.push(`Fluxo de caixa realizado no mês: ${fmt(analysis.currentMonth.cashBalance)}.`)
    lines.push(`Previsão financeira de curto prazo: ${fmt(analysis.allTime.prediction)} considerando recebíveis e contas a pagar em aberto.`)
    lines.push(`Projeção do próximo mês: ${fmt(analysis.forecast.nextMonth.netProfit)}.`)
  }

  if (matches(q, ['consulta'])) {
    lines.push(`Consultas realizadas no mês: ${fmtN(analysis.currentMonth.consultationsCompleted)}.`)
    lines.push(`Receita de consultas no mês: ${fmt(analysis.currentMonth.consultationRevenue)}.`)
  }

  if (matches(q, ['resumo', 'geral', 'analise', 'análise'])) {
    lines.push('Resumo executivo:')
    lines.push(`Receita do mês: ${fmt(analysis.currentMonth.grossRevenue)}.`)
    lines.push(`Lucro do mês: ${fmt(analysis.currentMonth.netProfit)}.`)
    lines.push(`Score financeiro: ${analysis.health.score}/100.`)
    lines.push(`Próximo mês: ${fmt(analysis.forecast.nextMonth.netProfit)} de lucro projetado.`)
    if (analysis.risks[0]) lines.push(`Principal risco: ${analysis.risks[0].title}.`)
    if (analysis.opportunities[0]) lines.push(`Maior oportunidade: ${analysis.opportunities[0].title}.`)
  }

  if (lines.length === 0) {
    lines.push(`Receita do mês ${fmt(analysis.currentMonth.grossRevenue)}, lucro do mês ${fmt(analysis.currentMonth.netProfit)} e fluxo de caixa ${fmt(analysis.currentMonth.cashBalance)}.`)
    lines.push(`Score financeiro atual: ${analysis.health.score}/100.`)
    lines.push(`Próximo mês projetado: ${fmt(analysis.forecast.nextMonth.netProfit)}. Próximos 12 meses: ${fmt(analysis.forecast.nextYear.netProfit)}.`)
    if (analysis.risks[0]) lines.push(`Alerta principal: ${analysis.risks[0].title}. ${analysis.risks[0].detail}`)
    if (analysis.recommendations[0]) lines.push(`Ação recomendada: ${analysis.recommendations[0]}`)
  }

  return lines.join('\n')
}

function buildMonthSeries(metrics) {
  const keys = Object.keys({ ...metrics.revenueByMonth, ...metrics.expenseByMonth }).sort()
  return keys.map(key => {
    const revenue = metrics.revenueByMonth[key] || 0
    const expenses = metrics.expenseByMonth[key] || 0
    return { key, revenue, expenses, netProfit:revenue - expenses }
  })
}

function buildDailySeries(entries) {
  const grouped = {}
  entries.forEach(item => {
    if (!item.date) return
    if (!grouped[item.date]) grouped[item.date] = { date:item.date, revenue:0, expenses:0, netProfit:0 }
    if (item.type === 'entrada') grouped[item.date].revenue += item.value || 0
    if (item.type === 'saida') grouped[item.date].expenses += item.value || 0
    grouped[item.date].netProfit = grouped[item.date].revenue - grouped[item.date].expenses
  })
  return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date))
}

function forecastNextMonth(months, currentMonth) {
  const recent = months.slice(-3)
  const avgRevenue = average(recent.map(item => item.revenue))
  const avgExpenses = average(recent.map(item => item.expenses))
  const blendedRevenue = blend(avgRevenue, currentMonth.grossRevenue, 0.65)
  const blendedExpenses = blend(avgExpenses, currentMonth.cashOut, 0.65)
  return {
    revenue:blendedRevenue,
    expenses:blendedExpenses,
    netProfit:blendedRevenue - blendedExpenses,
  }
}

function forecastNextYear(months, currentYear) {
  const recent = months.slice(-6)
  const avgMonthlyRevenue = average(recent.map(item => item.revenue)) || currentYear.grossRevenue / monthSpan() || 0
  const avgMonthlyExpenses = average(recent.map(item => item.expenses)) || currentYear.cashOut / monthSpan() || 0
  const revenue = avgMonthlyRevenue * 12
  const expenses = avgMonthlyExpenses * 12
  return { revenue, expenses, netProfit:revenue - expenses }
}

function forecastNextDay(daily) {
  const recent = daily.slice(-14)
  const revenue = average(recent.map(item => item.revenue))
  const expenses = average(recent.map(item => item.expenses))
  return { revenue, expenses, netProfit:revenue - expenses }
}

function detectRisks({ currentMonth, allTime, forecast, months }) {
  const risks = []
  if (allTime.payablesOpenTotal > allTime.cashBalance && allTime.payablesOpenTotal > 0) {
    risks.push({ title:'Contas a pagar acima do caixa disponível', detail:`Há ${fmt(allTime.payablesOpenTotal)} em aberto contra ${fmt(allTime.cashBalance)} de caixa realizado.`, severity:'alta' })
  }
  if (currentMonth.grossRevenue > 0 && currentMonth.netProfit / currentMonth.grossRevenue < 0.15) {
    risks.push({ title:'Margem líquida comprimida', detail:`A margem líquida do mês está em ${((currentMonth.netProfit / currentMonth.grossRevenue) * 100).toFixed(1)}%, abaixo do nível confortável.`, severity:'alta' })
  }
  const topExpense = Object.entries(currentMonth.expensesByCategory).sort(([, a], [, b]) => b - a)[0]
  if (topExpense && currentMonth.cashOut > 0 && topExpense[1] / currentMonth.cashOut > 0.35) {
    risks.push({ title:'Concentração alta de despesas', detail:`A categoria ${topExpense[0]} representa ${((topExpense[1] / currentMonth.cashOut) * 100).toFixed(1)}% das saídas do período.`, severity:'média' })
  }
  const decliningMonths = months.slice(-3)
  if (decliningMonths.length === 3 && decliningMonths[2].netProfit < decliningMonths[1].netProfit && decliningMonths[1].netProfit < decliningMonths[0].netProfit) {
    risks.push({ title:'Queda de resultado em sequência', detail:'Os últimos três meses mostram deterioração progressiva do resultado líquido.', severity:'média' })
  }
  if (forecast.nextMonth.netProfit < 0) {
    risks.push({ title:'Próximo mês projetado no negativo', detail:`A projeção aponta ${fmt(forecast.nextMonth.netProfit)} de resultado líquido.`, severity:'alta' })
  }
  const negativeProducts = allTime.productsByPerformance.filter(item => item.profit < 0)
  if (negativeProducts.length > 0) {
    risks.push({ title:'Produtos com margem negativa', detail:`${negativeProducts.length} produto(s) estão destruindo margem no período analisado.`, severity:'média' })
  }
  return risks
}

function detectOpportunities({ currentMonth, allTime, forecast }) {
  const opportunities = []
  const topProcedure = allTime.byProcedure[0]
  if (topProcedure) opportunities.push({ title:`Escalar ${topProcedure.name}`, impact:`Maior lucro por procedimento: ${fmt(topProcedure.profit)}` })
  const receivableWeight = allTime.receivablesOpenTotal - allTime.payablesOpenTotal
  if (receivableWeight > 0) opportunities.push({ title:'Acelerar recebimentos em aberto', impact:`Existe potencial de caixa de ${fmt(receivableWeight)} acima das contas a pagar.` })
  const topProduct = allTime.productsByPerformance[0]
  if (topProduct && topProduct.profit > 0) opportunities.push({ title:`Expandir venda de ${topProduct.name}`, impact:`Produto com ${fmt(topProduct.profit)} de lucro acumulado.` })
  if (forecast.nextMonth.netProfit > currentMonth.netProfit) opportunities.push({ title:'Próximo mês com tendência melhor', impact:`A projeção supera o resultado atual em ${fmt(forecast.nextMonth.netProfit - currentMonth.netProfit)}.` })
  return opportunities
}

function buildRecommendations({ currentMonth, allTime, risks, opportunities }) {
  const recommendations = []
  if (risks.some(item => item.title.includes('Contas a pagar'))) recommendations.push('Priorize cobrança de recebíveis e renegociação de vencimentos para aliviar o caixa imediato.')
  if (currentMonth.grossRevenue > 0 && currentMonth.netProfit / currentMonth.grossRevenue < 0.15) recommendations.push('Revise precificação e custos dos procedimentos com menor margem para recuperar lucro líquido.')
  const weakProcedure = allTime.byProcedure.filter(item => item.count > 0).sort((a, b) => a.profit - b.profit)[0]
  if (weakProcedure) recommendations.push(`Analise o pacote de custo e o preço de ${weakProcedure.name}, que hoje entrega ${fmt(weakProcedure.profit)}.`)
  const weakProduct = allTime.productsByPerformance.find(item => item.profit < 0)
  if (weakProduct) recommendations.push(`Corrija a margem de ${weakProduct.name} ajustando preço, custo de compra ou mix de venda.`)
  if (allTime.accountsReceivable.length > 0) recommendations.push('Implemente rotina semanal de follow-up para consultas e cirurgias ainda não recebidas.')
  if (opportunities[0]) recommendations.push(`Aproveite a maior oportunidade atual: ${opportunities[0].title.toLowerCase()}.`)
  return dedupe(recommendations)
}

function buildHealthScore({ currentMonth, allTime, forecast, risks }) {
  let score = 100
  if (allTime.payablesOpenTotal > allTime.cashBalance) score -= 20
  if (currentMonth.grossRevenue > 0 && currentMonth.netProfit / currentMonth.grossRevenue < 0.15) score -= 18
  if (forecast.nextMonth.netProfit < 0) score -= 18
  if (allTime.productsByPerformance.some(item => item.profit < 0)) score -= 10
  if (allTime.accountsReceivable.length > 0) score -= Math.min(12, allTime.accountsReceivable.length * 2)
  score -= Math.min(12, risks.length * 3)
  score = Math.max(15, Math.min(100, Math.round(score)))

  let label = 'Saudável'
  let color = C.green
  if (score < 80) { label = 'Atenção'; color = C.yellow }
  if (score < 60) { label = 'Pressionado'; color = '#FB923C' }
  if (score < 40) { label = 'Crítico'; color = C.red }

  return {
    score,
    label,
    color,
    summary:score >= 80
      ? 'A clínica mostra equilíbrio financeiro, com riscos controlados e boa base para crescimento.'
      : score >= 60
        ? 'Há sinais de pressão financeira. Vale agir agora para evitar perda de margem e aperto de caixa.'
        : 'A saúde financeira precisa de correções imediatas para proteger caixa, margem e previsibilidade.',
    factors:[
      { label:'Margem líquida', value:`${currentMonth.grossRevenue > 0 ? ((currentMonth.netProfit / currentMonth.grossRevenue) * 100).toFixed(1) : '0.0'}%`, color:currentMonth.netProfit >= 0 ? C.green : C.red },
      { label:'Caixa atual', value:fmt(allTime.cashBalance), color:allTime.cashBalance >= 0 ? C.cyan : C.red },
      { label:'Recebíveis abertos', value:fmt(allTime.receivablesOpenTotal), color:C.accent },
      { label:'Riscos ativos', value:fmtN(risks.length), color:risks.length > 0 ? C.yellow : C.green },
    ],
  }
}

function buildWeeklyPlan({ currentMonth, allTime, risks, opportunities, recommendations }) {
  const plan = []
  if (allTime.accountsReceivable.length > 0) {
    plan.push({ title:'Cobrar recebíveis em aberto', description:`Existem ${fmtN(allTime.accountsReceivable.length)} lançamento(s) pendentes somando ${fmt(allTime.receivablesOpenTotal)}.`, priority:'Alta' })
  }
  const topExpense = Object.entries(currentMonth.expensesByCategory).sort(([, a], [, b]) => b - a)[0]
  if (topExpense) {
    plan.push({ title:'Revisar maior centro de custo', description:`A categoria ${topExpense[0]} está pressionando o resultado com ${fmt(topExpense[1])} no mês.`, priority:'Alta' })
  }
  const weakProcedure = allTime.byProcedure.filter(item => item.count > 0).sort((a, b) => a.profit - b.profit)[0]
  if (weakProcedure) {
    plan.push({ title:`Reavaliar rentabilidade de ${weakProcedure.name}`, description:`Hoje esse procedimento gera ${fmt(weakProcedure.profit)} no período analisado.`, priority:'Média' })
  }
  const weakProduct = allTime.productsByPerformance.find(item => item.profit < 0)
  if (weakProduct) {
    plan.push({ title:`Corrigir margem de ${weakProduct.name}`, description:`O produto está em ${fmt(weakProduct.profit)} e precisa de ajuste de preço ou custo.`, priority:'Média' })
  }
  if (opportunities[0]) {
    plan.push({ title:'Explorar oportunidade principal', description:opportunities[0].impact, priority:'Média' })
  }
  if (recommendations[0]) {
    plan.push({ title:'Executar ação prioritária', description:recommendations[0], priority:'Alta' })
  }
  return dedupeByTitle(plan).slice(0, 5)
}

function normalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function matches(text, patterns) {
  return patterns.some(pattern => text.includes(pattern))
}

function average(values) {
  const valid = values.filter(value => Number.isFinite(value))
  if (valid.length === 0) return 0
  return valid.reduce((acc, value) => acc + value, 0) / valid.length
}

function blend(baseValue, currentValue, currentWeight) {
  if (!baseValue && !currentValue) return 0
  if (!baseValue) return currentValue
  if (!currentValue) return baseValue
  return (baseValue * (1 - currentWeight)) + (currentValue * currentWeight)
}

function monthSpan() {
  return Math.max(new Date().getMonth() + 1, 1)
}

function dedupe(items) {
  return [...new Set(items.filter(Boolean))]
}

function dedupeByTitle(items) {
  const seen = new Set()
  return items.filter(item => {
    if (!item?.title || seen.has(item.title)) return false
    seen.add(item.title)
    return true
  })
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

function AlertRow({ title, detail, severity }) {
  const color = severity === 'alta' ? C.red : severity === 'média' ? C.yellow : C.cyan
  return <div style={{ padding:14, borderRadius:14, border:`1px solid ${color}33`, background:color+'10' }}><div style={{ display:'flex', justifyContent:'space-between', gap:12, marginBottom:6 }}><div style={{ color:C.text, fontWeight:700 }}>{title}</div><Badge color={color} small>{severity}</Badge></div><div style={{ color:C.textSub, fontSize:13, lineHeight:1.6 }}>{detail}</div></div>
}

function ActionRow({ index, title, description, priority }) {
  const color = priority === 'Alta' ? C.red : priority === 'Média' ? C.yellow : C.cyan
  return <div style={{ display:'grid', gridTemplateColumns:'36px 1fr auto', gap:14, alignItems:'start', padding:14, borderRadius:16, background:C.surface, border:`1px solid ${C.border}` }}><div style={{ width:36, height:36, borderRadius:10, background:C.card, display:'grid', placeItems:'center', color:C.text, fontWeight:800 }}>{index}</div><div><div style={{ color:C.text, fontWeight:700, marginBottom:4 }}>{title}</div><div style={{ color:C.textDim, fontSize:13, lineHeight:1.6 }}>{description}</div></div><Badge color={color}>{priority}</Badge></div>
}
