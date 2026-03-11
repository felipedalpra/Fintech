import { useMemo } from 'react'
import { C } from '../theme.js'
import { fmt } from '../utils.js'
import { buildFinancialBrain } from '../ai/financialBrain.js'
import { Card, Badge, Progress } from './UI.jsx'

export function AIAssistant({ data }) {
  const brain = useMemo(() => buildFinancialBrain(data), [data])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
      <TopicGrid>
        <SummaryCard title="Previsões" subtitle="Próximos movimentos financeiros">
          <Metric label="Próximo dia" value={fmt(brain.forecast.nextDay.netProfit)} hint={`Entradas ${fmt(brain.forecast.nextDay.revenue)} · saídas ${fmt(brain.forecast.nextDay.expenses)}`} color={brain.forecast.nextDay.netProfit >= 0 ? C.green : C.red} />
          <Metric label="Próximo mês" value={fmt(brain.forecast.nextMonth.netProfit)} hint={`Receita prevista ${fmt(brain.forecast.nextMonth.revenue)}`} color={brain.forecast.nextMonth.netProfit >= 0 ? C.cyan : C.red} />
          <Metric label="Próximo ano" value={fmt(brain.forecast.nextYear.netProfit)} hint={`Receita anual ${fmt(brain.forecast.nextYear.revenue)}`} color={brain.forecast.nextYear.netProfit >= 0 ? C.accent : C.red} />
        </SummaryCard>

        <SummaryCard title="Diagnóstico" subtitle="Erros e alertas automáticos">
          <div style={{ display:'grid', gap:10 }}>
            {brain.diagnosisLayer.alerts.length === 0 && <EmptyText>Nenhum alerta crítico no momento.</EmptyText>}
            {brain.diagnosisLayer.alerts.slice(0, 4).map(item => <AlertRow key={item.title} title={item.title} detail={item.detail} severity={item.severity} />)}
          </div>
        </SummaryCard>
      </TopicGrid>

      <TopicGrid>
        <SummaryCard title="Saúde financeira" subtitle="Financial Health Score">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:14 }}>
            <div>
              <div style={{ fontSize:28, fontWeight:900, color:brain.health.color }}>{brain.health.score}/100</div>
              <div style={{ color:C.textSub, fontSize:13 }}>{brain.health.label}</div>
            </div>
            <Badge color={brain.health.color}>{brain.health.label}</Badge>
          </div>
          <Progress val={brain.health.score} max={100} color={brain.health.color} h={10} />
          <div style={{ color:C.textDim, fontSize:13, lineHeight:1.6, marginTop:10 }}>{brain.health.summary}</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0,1fr))', gap:10, marginTop:14 }}>
            {brain.health.factors.map(item => <MiniBlock key={item.label} label={item.label} value={item.value} color={item.color} />)}
          </div>
        </SummaryCard>

        <SummaryCard title="Metas inteligentes" subtitle="A IA traduz meta em ação operacional">
          <div style={{ display:'grid', gap:10 }}>
            {brain.goals.items.length === 0 && <EmptyText>Cadastre metas para a IA calcular gaps e volume necessário.</EmptyText>}
            {brain.goals.items.slice(0, 4).map(item => (
              <div key={item.title} style={{ padding:12, borderRadius:14, border:`1px solid ${C.border}`, background:C.surface }}>
                <div style={{ color:C.text, fontWeight:700, marginBottom:4 }}>{item.title}</div>
                <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6 }}>{item.guidance}</div>
              </div>
            ))}
          </div>
        </SummaryCard>
      </TopicGrid>

      <TopicGrid>
        <SummaryCard title="Recomendações" subtitle="O que mais melhora a lucratividade agora">
          <div style={{ display:'grid', gap:10 }}>
            {brain.recommendationLayer.priorities.slice(0, 5).map((item, index) => (
              <div key={`${index}-${item}`} style={{ padding:12, borderRadius:14, border:`1px solid ${C.border}`, background:C.surface, color:C.textSub, fontSize:13, lineHeight:1.6 }}>
                <span style={{ color:C.text, fontWeight:700 }}>{index + 1}.</span> {item}
              </div>
            ))}
          </div>
        </SummaryCard>

        <SummaryCard title="Decisões estratégicas" subtitle="Leituras para a agenda e rentabilidade">
          <div style={{ display:'grid', gap:10 }}>
            <MiniBlock label="Procedimento mais lucrativo" value={brain.strategicPanel.mostProfitableProcedure?.name || 'Sem base'} sub={brain.strategicPanel.mostProfitableProcedure ? fmt(brain.strategicPanel.mostProfitableProcedure.profit) : ''} />
            <MiniBlock label="Melhor mês" value={brain.strategicPanel.bestMonth?.label || 'Sem base'} sub={brain.strategicPanel.bestMonth ? fmt(brain.strategicPanel.bestMonth.netProfit) : ''} />
            <MiniBlock label="Despesa que mais cresce" value={brain.strategicPanel.fastestGrowingExpense?.category || 'Sem alerta'} sub={brain.strategicPanel.fastestGrowingExpense?.growthLabel || ''} />
            <MiniBlock label="Conversão consulta → cirurgia" value={brain.analysisLayer.operational.conversionLabel} />
          </div>
        </SummaryCard>
      </TopicGrid>
    </div>
  )
}

function TopicGrid({ children }) {
  return <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:16 }}>{children}</div>
}

function SummaryCard({ title, subtitle, children }) {
  return (
    <Card>
      <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{title}</div>
      <div style={{ color:C.textDim, fontSize:13, marginBottom:16 }}>{subtitle}</div>
      {children}
    </Card>
  )
}

function Metric({ label, value, hint, color }) {
  return (
    <div style={{ padding:'12px 0', borderBottom:`1px solid ${C.border}` }}>
      <div style={{ fontSize:11, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:24, fontWeight:900, color }}>{value}</div>
      <div style={{ color:C.textSub, fontSize:12, marginTop:4 }}>{hint}</div>
    </div>
  )
}

function MiniBlock({ label, value, sub, color }) {
  return (
    <div style={{ padding:12, borderRadius:14, border:`1px solid ${C.border}`, background:C.surface }}>
      <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{label}</div>
      <div style={{ color:color || C.text, fontWeight:800 }}>{value}</div>
      {sub ? <div style={{ color:C.textSub, fontSize:12, marginTop:4, lineHeight:1.5 }}>{sub}</div> : null}
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

function EmptyText({ children }) {
  return <div style={{ color:C.textDim, fontSize:13, lineHeight:1.6 }}>{children}</div>
}
