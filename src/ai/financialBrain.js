import { buildMetrics } from '../useMetrics.js'
import { fmt, fmtN, getPeriodRange, monthKey, today } from '../utils.js'

export function buildFinancialBrain(data) {
  const monthRange = getPeriodRange('month')
  const yearRange = getPeriodRange('year')
  const previousMonthRange = getRelativeMonthRange(-1)
  const previousYearRange = getRelativeYearRange(-1)

  const currentMonth = buildMetrics(data, { startDate:monthRange.start, endDate:monthRange.end, balanceDate:monthRange.end })
  const previousMonth = buildMetrics(data, { startDate:previousMonthRange.start, endDate:previousMonthRange.end, balanceDate:previousMonthRange.end })
  const currentYear = buildMetrics(data, { startDate:yearRange.start, endDate:yearRange.end, balanceDate:yearRange.end })
  const previousYear = buildMetrics(data, { startDate:previousYearRange.start, endDate:previousYearRange.end, balanceDate:previousYearRange.end })
  const allTime = buildMetrics(data, { balanceDate:today() })

  const months = buildMonthSeries(allTime)
  const daily = buildDailySeries(allTime.cashFlowEntries)

  const forecast = {
    nextDay: forecastNextDay(daily),
    nextMonth: forecastNextMonth(months, currentMonth),
    nextYear: forecastNextYear(months, currentYear),
  }

  const dataLayer = buildDataLayer(data, { currentMonth, currentYear, allTime })
  const analysisLayer = buildAnalysisLayer({ currentMonth, previousMonth, currentYear, previousYear, allTime, months })
  const diagnosisLayer = buildDiagnosisLayer({ currentMonth, previousMonth, currentYear, previousYear, allTime, forecast, months, analysisLayer })
  const recommendationLayer = buildRecommendationLayer({ currentMonth, allTime, forecast, analysisLayer, diagnosisLayer })
  const health = buildHealthScore({ currentMonth, allTime, forecast, diagnosisLayer })
  const goals = buildSmartGoals({ currentMonth, allTime, analysisLayer })
  const strategicPanel = buildStrategicPanel({ currentMonth, currentYear, allTime, months, analysisLayer, diagnosisLayer, goals })
  const weeklyPlan = buildWeeklyPlan({ currentMonth, allTime, diagnosisLayer, recommendationLayer, goals })

  return {
    dataLayer,
    analysisLayer,
    diagnosisLayer,
    recommendationLayer,
    health,
    goals,
    strategicPanel,
    weeklyPlan,
    forecast,
    currentMonth,
    previousMonth,
    currentYear,
    previousYear,
    allTime,
    months,
    daily,
  }
}

export function buildFinancialWelcomeMessage(brain) {
  const lines = [
    'Atuo em quatro camadas: dados, análise financeira, diagnóstico e recomendações.',
    `Receita do mês: ${fmt(brain.analysisLayer.main.monthRevenue)}. Lucro líquido do mês: ${fmt(brain.analysisLayer.main.monthNetProfit)}.`,
    `Margem líquida atual: ${brain.analysisLayer.main.monthMarginLabel}. Fluxo de caixa do mês: ${fmt(brain.analysisLayer.main.monthCashFlow)}.`,
    `Previsão do próximo mês: ${fmt(brain.forecast.nextMonth.netProfit)} de lucro líquido. Próximos 12 meses: ${fmt(brain.forecast.nextYear.netProfit)}.`,
    `Financial Health Score: ${brain.health.score}/100 (${brain.health.label.toLowerCase()}).`,
  ]

  if (brain.diagnosisLayer.alerts[0]) {
    lines.push(`Alerta principal: ${brain.diagnosisLayer.alerts[0].title}.`)
  }
  if (brain.recommendationLayer.priorities[0]) {
    lines.push(`Ação prioritária: ${brain.recommendationLayer.priorities[0]}.`)
  }
  lines.push('Posso explicar o financeiro, prever resultados, apontar erros e dizer o que fazer para melhorar a lucratividade.')
  return lines.join('\n')
}

export function buildFinancialContext(brain) {
  return {
    main:brain.analysisLayer.main,
    unitEconomics:brain.analysisLayer.unitEconomics,
    operational:brain.analysisLayer.operational,
    trends:brain.analysisLayer.trends,
    forecast:brain.forecast,
    health:brain.health,
    strategicPanel:brain.strategicPanel,
    alerts:brain.diagnosisLayer.alerts,
    highlights:brain.diagnosisLayer.highlights,
    recommendations:brain.recommendationLayer.priorities,
    goals:brain.goals.items.map(item => ({
      title:item.title,
      metric:item.metric,
      current:item.current,
      target:item.target,
      gap:item.gap,
      guidance:item.guidance,
    })),
  }
}

export function answerFinancialQuestion(question, brain) {
  const q = normalize(question)
  const lines = []

  if (matches(q, ['lucro este mes', 'lucro do mes', 'lucro do mês'])) {
    lines.push(`Lucro do mês: ${fmt(brain.analysisLayer.main.monthNetProfit)}.`)
    lines.push(`Margem líquida: ${brain.analysisLayer.main.monthMarginLabel}.`)
    lines.push(`Recomendação: ${brain.recommendationLayer.profit[0] || brain.recommendationLayer.priorities[0] || 'Mantenha disciplina de caixa e priorize os procedimentos de maior margem.'}`)
  }

  if (matches(q, ['dobrar o lucro', 'quanto preciso faturar'])) {
    const targetProfit = brain.analysisLayer.main.monthNetProfit * 2
    const margin = Math.max(brain.analysisLayer.main.monthMargin, 0.08)
    const requiredRevenue = targetProfit / margin
    const gap = Math.max(0, requiredRevenue - brain.analysisLayer.main.monthRevenue)
    lines.push(`Para dobrar o lucro no ritmo atual, a receita mensal teria de chegar perto de ${fmt(requiredRevenue)}.`)
    lines.push(`Isso representa um aumento aproximado de ${fmt(gap)} sobre o faturamento atual.`)
    if (brain.goals.revenueBridge) lines.push(brain.goals.revenueBridge)
  }

  if (matches(q, ['score', 'saude financeira', 'saúde financeira', 'health score'])) {
    lines.push(`Financial Health Score: ${brain.health.score}/100.`)
    lines.push(`Status: ${brain.health.label}.`)
    lines.push(brain.health.summary)
    brain.health.factors.forEach(item => lines.push(`${item.label}: ${item.value}.`))
  }

  if (matches(q, ['previsao', 'previsão', 'proximo mes', 'próximo mês'])) {
    lines.push(`Receita prevista para o próximo mês: ${fmt(brain.forecast.nextMonth.revenue)}.`)
    lines.push(`Saídas previstas: ${fmt(brain.forecast.nextMonth.expenses)}.`)
    lines.push(`Lucro líquido projetado: ${fmt(brain.forecast.nextMonth.netProfit)}.`)
    lines.push(`Fluxo projetado do próximo dia útil médio: ${fmt(brain.forecast.nextDay.netProfit)}.`)
  }

  if (matches(q, ['ano', '12 meses', 'proximo ano', 'próximo ano'])) {
    lines.push(`Receita prevista para os próximos 12 meses: ${fmt(brain.forecast.nextYear.revenue)}.`)
    lines.push(`Lucro líquido previsto: ${fmt(brain.forecast.nextYear.netProfit)}.`)
    lines.push(`Base da projeção: média móvel recente ajustada pelo mês atual.`)
  }

  if (matches(q, ['erro', 'riscos', 'risco', 'alerta', 'alertas', 'problema'])) {
    if (brain.diagnosisLayer.alerts.length === 0) {
      lines.push('Não encontrei alertas críticos no momento.')
    } else {
      lines.push('Principais diagnósticos automáticos:')
      brain.diagnosisLayer.alerts.slice(0, 5).forEach((item, index) => {
        lines.push(`${index + 1}. ${item.title}: ${item.detail}`)
      })
    }
  }

  if (matches(q, ['despesa mais cresceu', 'despesas cresceram', 'qual despesa'])) {
    const expense = brain.strategicPanel.fastestGrowingExpense
    lines.push(expense
      ? `A despesa com maior aceleração é ${expense.category}, que cresceu ${expense.growthLabel} contra o mês anterior.`
      : 'Ainda não há base suficiente para comparar crescimento de despesas entre meses.')
  }

  if (matches(q, ['procedimento mais lucrativo', 'cirurgia mais lucrativa', 'qual cirurgia'])) {
    const top = brain.analysisLayer.operational.topProcedure
    if (top) {
      lines.push(`Procedimento mais lucrativo: ${top.name}.`)
      lines.push(`Lucro acumulado: ${fmt(top.profit)} em ${fmtN(top.count)} cirurgia(s).`)
      lines.push(`Recomendação: ${brain.recommendationLayer.profit[0] || `Avalie aumentar a participação de ${top.name} na agenda.`}`)
    } else {
      lines.push('Ainda não há base suficiente de cirurgias para ranquear procedimentos.')
    }
  }

  if (matches(q, ['meta', 'quantas cirurgias preciso', 'quantas consultas'])) {
    if (brain.goals.items.length === 0) {
      lines.push('Não há metas cadastradas para simular cenário.')
    } else {
      lines.push('Metas inteligentes:')
      brain.goals.items.slice(0, 4).forEach((item, index) => {
        lines.push(`${index + 1}. ${item.title}: ${item.guidance}`)
      })
    }
  }

  if (matches(q, ['fluxo de caixa previsto', 'fluxo de caixa', 'caixa previsto'])) {
    lines.push(`Fluxo de caixa realizado no mês: ${fmt(brain.analysisLayer.main.monthCashFlow)}.`)
    lines.push(`Fluxo previsto de curto prazo: ${fmt(brain.forecast.nextMonth.netProfit)} no próximo mês.`)
    lines.push(`Saldo potencial incluindo recebíveis e contas a pagar: ${fmt(brain.allTime.prediction)}.`)
  }

  if (matches(q, ['resumo', 'geral', 'analise', 'análise', 'dashboard'])) {
    lines.push('Resumo executivo:')
    lines.push(`Receita do mês: ${fmt(brain.analysisLayer.main.monthRevenue)}.`)
    lines.push(`Lucro líquido do mês: ${fmt(brain.analysisLayer.main.monthNetProfit)}.`)
    lines.push(`Margem líquida: ${brain.analysisLayer.main.monthMarginLabel}.`)
    lines.push(`Conversão consulta → cirurgia: ${brain.analysisLayer.operational.conversionLabel}.`)
    lines.push(`Melhor mês recente: ${brain.strategicPanel.bestMonth?.label || 'sem base suficiente'}.`)
    if (brain.diagnosisLayer.alerts[0]) lines.push(`Risco principal: ${brain.diagnosisLayer.alerts[0].title}.`)
    if (brain.recommendationLayer.priorities[0]) lines.push(`Próxima ação: ${brain.recommendationLayer.priorities[0]}.`)
  }

  if (matches(q, ['semana', 'acao semanal', 'ação semanal', 'o que fazer'])) {
    lines.push('Plano de ação da semana:')
    brain.weeklyPlan.forEach((item, index) => lines.push(`${index + 1}. ${item.title}: ${item.description}`))
  }

  if (lines.length === 0) {
    lines.push(`Receita do mês ${fmt(brain.analysisLayer.main.monthRevenue)}, lucro ${fmt(brain.analysisLayer.main.monthNetProfit)} e score ${brain.health.score}/100.`)
    lines.push(`Próximo mês projetado: ${fmt(brain.forecast.nextMonth.netProfit)}. Próximos 12 meses: ${fmt(brain.forecast.nextYear.netProfit)}.`)
    if (brain.diagnosisLayer.alerts[0]) lines.push(`Diagnóstico principal: ${brain.diagnosisLayer.alerts[0].title}. ${brain.diagnosisLayer.alerts[0].detail}`)
    if (brain.recommendationLayer.priorities[0]) lines.push(`Recomendação: ${brain.recommendationLayer.priorities[0]}`)
  }

  return lines.join('\n')
}

function buildDataLayer(data, { currentMonth, currentYear, allTime }) {
  const catalog = {
    procedures:(data?.procedures || []).length,
    surgeries:(data?.surgeries || []).length,
    consultations:(data?.consultations || []).length,
    productSales:(data?.productSales || []).length,
    expenses:(data?.expenses || []).length,
    goals:(data?.goals || []).length,
  }

  return {
    sources:[
      { key:'cirurgias', label:'Cirurgias', count:catalog.surgeries },
      { key:'consultas', label:'Consultas', count:catalog.consultations },
      { key:'produtos', label:'Vendas de produtos', count:catalog.productSales },
      { key:'despesas', label:'Despesas', count:catalog.expenses },
      { key:'metas', label:'Metas', count:catalog.goals },
    ],
    coverageScore:buildCoverageScore(catalog),
    snapshots:{
      month:{ revenue:currentMonth.grossRevenue, profit:currentMonth.netProfit, cash:currentMonth.cashBalance },
      year:{ revenue:currentYear.grossRevenue, profit:currentYear.netProfit, cash:currentYear.cashBalance },
      allTime:{ revenue:allTime.grossRevenue, profit:allTime.netProfit, cash:allTime.cashBalance },
    },
  }
}

function buildAnalysisLayer({ currentMonth, previousMonth, currentYear, previousYear, allTime, months }) {
  const monthGrowthRevenue = growthRate(currentMonth.grossRevenue, previousMonth.grossRevenue)
  const monthGrowthProfit = growthRate(currentMonth.netProfit, previousMonth.netProfit)
  const monthGrowthCash = growthRate(currentMonth.cashBalance, previousMonth.cashBalance)
  const avgRevenuePerSurgery = currentMonth.surgeriesCompleted > 0 ? currentMonth.surgeryRevenue / currentMonth.surgeriesCompleted : 0
  const avgRevenuePerConsultation = currentMonth.consultationsCompleted > 0 ? currentMonth.consultationRevenue / currentMonth.consultationsCompleted : 0
  const conversionRate = currentMonth.consultationsCompleted > 0 ? Math.min(1, currentMonth.surgeriesCompleted / currentMonth.consultationsCompleted) : 0
  const bestMonth = months.reduce((best, item) => (!best || item.netProfit > best.netProfit ? item : best), null)

  return {
    main:{
      monthRevenue:currentMonth.grossRevenue,
      monthNetProfit:currentMonth.netProfit,
      monthMargin:currentMonth.grossRevenue > 0 ? currentMonth.netProfit / currentMonth.grossRevenue : 0,
      monthMarginLabel:`${((currentMonth.grossRevenue > 0 ? currentMonth.netProfit / currentMonth.grossRevenue : 0) * 100).toFixed(1)}%`,
      monthCashFlow:currentMonth.cashBalance,
      monthGrowthRevenue,
      monthGrowthProfit,
      monthGrowthCash,
      yearRevenue:currentYear.grossRevenue,
      yearNetProfit:currentYear.netProfit,
      allTimeRevenue:allTime.grossRevenue,
    },
    unitEconomics:{
      avgRevenuePerSurgery,
      avgRevenuePerConsultation,
      averageTicket:currentMonth.averageTicket,
    },
    operational:{
      surgeries:currentMonth.surgeriesCompleted,
      consultations:currentMonth.consultationsCompleted,
      conversionRate,
      conversionLabel:`${(conversionRate * 100).toFixed(1)}%`,
      topProcedure:allTime.byProcedure[0] || null,
      topProduct:allTime.productsByPerformance[0] || null,
      bestMonth:bestMonth ? { ...bestMonth, label:formatMonthLabel(bestMonth.key) } : null,
    },
    trends:{
      bestMonth,
      revenueVsLastMonthLabel:signedPctLabel(monthGrowthRevenue),
      profitVsLastMonthLabel:signedPctLabel(monthGrowthProfit),
      cashVsLastMonthLabel:signedPctLabel(monthGrowthCash),
      yearRevenueGrowth:growthRate(currentYear.grossRevenue, previousYear.grossRevenue),
    },
  }
}

function buildDiagnosisLayer({ currentMonth, previousMonth, allTime, forecast, months, analysisLayer }) {
  const alerts = []
  const highlights = []

  if (allTime.payablesOpenTotal > allTime.cashBalance && allTime.payablesOpenTotal > 0) {
    alerts.push({
      title:'Fluxo de caixa pressionado por contas a pagar',
      detail:`Há ${fmt(allTime.payablesOpenTotal)} em aberto contra ${fmt(allTime.cashBalance)} de caixa realizado.`,
      severity:'alta',
      pillar:'caixa',
    })
  }

  if (analysisLayer.main.monthMargin < 0.15 && currentMonth.grossRevenue > 0) {
    alerts.push({
      title:'Margem de lucro abaixo do nível saudável',
      detail:`A margem líquida caiu para ${analysisLayer.main.monthMarginLabel}. O peso maior está em custos cirúrgicos e despesas operacionais.`,
      severity:'alta',
      pillar:'margem',
    })
  }

  if (forecast.nextMonth.netProfit < 0) {
    alerts.push({
      title:'Próximo mês projetado no negativo',
      detail:`A projeção indica ${fmt(forecast.nextMonth.netProfit)} de lucro líquido, o que exige ajuste antes do fechamento do mês.`,
      severity:'alta',
      pillar:'previsao',
    })
  }

  if (analysisLayer.main.monthGrowthRevenue < -0.12) {
    alerts.push({
      title:'Queda relevante de receita',
      detail:`A receita recuou ${signedPctLabel(analysisLayer.main.monthGrowthRevenue)} contra o mês anterior.`,
      severity:'média',
      pillar:'receita',
    })
  }

  const topExpense = Object.entries(currentMonth.expensesByCategory).sort(([, a], [, b]) => b - a)[0]
  if (topExpense && currentMonth.cashOut > 0 && topExpense[1] / currentMonth.cashOut > 0.35) {
    alerts.push({
      title:'Despesa concentrada demais em uma categoria',
      detail:`${topExpense[0]} representa ${((topExpense[1] / currentMonth.cashOut) * 100).toFixed(1)}% das saídas do mês.`,
      severity:'média',
      pillar:'despesas',
    })
  }

  const decliningMonths = months.slice(-3)
  if (decliningMonths.length === 3 && decliningMonths[2].netProfit < decliningMonths[1].netProfit && decliningMonths[1].netProfit < decliningMonths[0].netProfit) {
    alerts.push({
      title:'Deterioração de resultado por três meses',
      detail:'Os últimos três meses mostram queda progressiva do resultado líquido.',
      severity:'média',
      pillar:'tendencia',
    })
  }

  const negativeProducts = allTime.productsByPerformance.filter(item => item.profit < 0)
  if (negativeProducts.length > 0) {
    alerts.push({
      title:'Produtos com margem negativa',
      detail:`${fmtN(negativeProducts.length)} item(ns) estão reduzindo lucro da clínica.`,
      severity:'média',
      pillar:'produtos',
    })
  }

  const overdueReceivables = allTime.accountsReceivable.filter(item => item.dueDate && item.dueDate < today())
  if (overdueReceivables.length > 0) {
    alerts.push({
      title:'Recebimentos atrasados',
      detail:`Há ${fmtN(overdueReceivables.length)} recebível(eis) vencidos somando ${fmt(sum(overdueReceivables.map(item => item.value)))}.`,
      severity:'média',
      pillar:'recebiveis',
    })
  }

  if (analysisLayer.main.monthGrowthRevenue > 0.1) {
    highlights.push({
      title:'Receita em crescimento',
      detail:`A receita subiu ${signedPctLabel(analysisLayer.main.monthGrowthRevenue)} contra o mês anterior.`,
    })
  }

  if (currentMonth.netProfit > previousMonth.netProfit && currentMonth.netProfit > 0) {
    highlights.push({
      title:'Resultado líquido melhorou',
      detail:`O lucro do mês superou o mês anterior em ${fmt(currentMonth.netProfit - previousMonth.netProfit)}.`,
    })
  }

  if (analysisLayer.operational.topProcedure) {
    highlights.push({
      title:`${analysisLayer.operational.topProcedure.name} é o principal motor de lucro`,
      detail:`O procedimento acumulou ${fmt(analysisLayer.operational.topProcedure.profit)} no período analisado.`,
    })
  }

  return { alerts, highlights }
}

function buildRecommendationLayer({ currentMonth, allTime, forecast, analysisLayer, diagnosisLayer }) {
  const priorities = []
  const profit = []
  const cash = []
  const growth = []

  if (diagnosisLayer.alerts.some(item => item.pillar === 'caixa')) {
    cash.push('Acelere cobrança dos recebíveis e renegocie vencimentos para aliviar o caixa das próximas semanas.')
  }
  if (allTime.accountsReceivable.length > 0) {
    cash.push('Implemente rotina semanal de follow-up dos pacientes e convênios com valores em aberto.')
  }
  if (analysisLayer.main.monthMargin < 0.15) {
    profit.push('Revise a precificação dos procedimentos e o pacote de custos hospitalares para recuperar margem líquida.')
  }
  const weakProcedure = allTime.byProcedure.filter(item => item.count > 0).sort((a, b) => a.profit - b.profit)[0]
  if (weakProcedure) {
    profit.push(`Recalcule preço e custos de ${weakProcedure.name}, que hoje entrega ${fmt(weakProcedure.profit)} no período.`)
  }
  const topProcedure = analysisLayer.operational.topProcedure
  if (topProcedure) {
    growth.push(`Aumente a participação de ${topProcedure.name} na agenda, porque ele concentra a melhor rentabilidade atual.`)
  }
  const weakProduct = allTime.productsByPerformance.find(item => item.profit < 0)
  if (weakProduct) {
    profit.push(`Corrija margem de ${weakProduct.name} ajustando preço, mix ou custo de compra.`)
  }
  if (forecast.nextMonth.netProfit < currentMonth.netProfit) {
    growth.push('Trave gastos discricionários e monte agenda comercial para proteger o próximo mês antes que a projeção piore.')
  }
  if (analysisLayer.operational.conversionRate < 0.3 && analysisLayer.operational.consultations > 0) {
    growth.push('Melhore a conversão de consultas para cirurgias com follow-up comercial estruturado e proposta financeira mais rápida.')
  }

  priorities.push(...cash, ...profit, ...growth)

  return {
    priorities:dedupe(priorities).slice(0, 8),
    profit:dedupe(profit),
    cash:dedupe(cash),
    growth:dedupe(growth),
  }
}

function buildSmartGoals({ currentMonth, allTime, analysisLayer }) {
  const averageSurgeryRevenue = analysisLayer.unitEconomics.avgRevenuePerSurgery || allTime.averageTicket || 1
  const averageConsultationRevenue = analysisLayer.unitEconomics.avgRevenuePerConsultation || 1
  const conversionRate = Math.max(analysisLayer.operational.conversionRate, 0.1)

  const items = (allTime.goals || []).map(goal => {
    const current = {
      faturamento:currentMonth.grossRevenue,
      cirurgias:currentMonth.surgeriesCompleted,
      consultas:currentMonth.consultationsCompleted,
      lucro:currentMonth.netProfit,
      ticket_medio:currentMonth.averageTicket,
      fluxo_caixa:currentMonth.cashBalance,
    }[goal.metric] || 0

    const gap = Math.max(0, (goal.target || 0) - current)
    let guidance = 'Meta no radar.'

    if (goal.metric === 'faturamento') {
      const surgeriesNeeded = Math.ceil(gap / averageSurgeryRevenue)
      const consultationsNeeded = Math.ceil(surgeriesNeeded / conversionRate)
      guidance = gap > 0
        ? `Faltam ${fmt(gap)}. No ritmo atual, isso equivale a cerca de ${surgeriesNeeded} cirurgia(s) adicionais ou ${consultationsNeeded} consultas qualificadas para converter.`
        : 'Meta de faturamento já atingida.'
    }

    if (goal.metric === 'lucro') {
      const surgeriesNeeded = Math.ceil(gap / Math.max(averageSurgeryRevenue * Math.max(analysisLayer.main.monthMargin, 0.1), 1))
      guidance = gap > 0
        ? `Faltam ${fmt(gap)} de lucro. Mantendo a margem atual, isso exige perto de ${surgeriesNeeded} cirurgia(s) adicionais com perfil parecido.`
        : 'Meta de lucro já foi atingida.'
    }

    if (goal.metric === 'cirurgias') {
      guidance = gap > 0
        ? `Faltam ${fmtN(gap)} cirurgia(s). Pela conversão atual, você precisa gerar aproximadamente ${fmtN(Math.ceil(gap / conversionRate))} consultas qualificadas.`
        : 'Meta de cirurgias atingida.'
    }

    if (goal.metric === 'consultas') {
      guidance = gap > 0
        ? `Faltam ${fmtN(gap)} consulta(s). Proteja agenda, captação e confirmação para fechar esse volume.`
        : 'Meta de consultas atingida.'
    }

    return {
      ...goal,
      current,
      gap,
      title:goal.name || `Meta de ${goal.metric}`,
      guidance,
    }
  })

  const revenueGap = items.find(item => item.metric === 'faturamento' && item.gap > 0)

  return {
    items,
    revenueBridge:revenueGap ? revenueGap.guidance : '',
  }
}

function buildStrategicPanel({ currentMonth, allTime, months, analysisLayer, diagnosisLayer, goals }) {
  const fastestGrowingExpense = buildFastestGrowingExpense(currentMonth, allTime)
  return {
    mostProfitableProcedure:analysisLayer.operational.topProcedure,
    bestMonth:analysisLayer.operational.bestMonth,
    fastestGrowingExpense,
    realisticGoal:goals.items.find(item => item.gap > 0) || goals.items[0] || null,
    mainDecision:diagnosisLayer.alerts[0]?.title || analysisLayer.operational.topProcedure?.name || 'Sem decisão crítica identificada',
  }
}

function buildWeeklyPlan({ currentMonth, allTime, diagnosisLayer, recommendationLayer, goals }) {
  const plan = []

  if (allTime.accountsReceivable.length > 0) {
    plan.push({
      title:'Cobrar recebíveis em atraso',
      description:`Existem ${fmtN(allTime.accountsReceivable.length)} lançamento(s) em aberto somando ${fmt(allTime.receivablesOpenTotal)}.`,
      priority:'Alta',
    })
  }

  const topExpense = Object.entries(currentMonth.expensesByCategory).sort(([, a], [, b]) => b - a)[0]
  if (topExpense) {
    plan.push({
      title:'Revisar maior centro de custo',
      description:`A categoria ${topExpense[0]} consumiu ${fmt(topExpense[1])} no mês e precisa de revisão.`,
      priority:'Alta',
    })
  }

  if (goals.items.find(item => item.gap > 0)) {
    const pendingGoal = goals.items.find(item => item.gap > 0)
    plan.push({
      title:`Atacar a meta ${pendingGoal.title}`,
      description:pendingGoal.guidance,
      priority:'Média',
    })
  }

  recommendationLayer.priorities.slice(0, 3).forEach((item, index) => {
    plan.push({
      title:index === 0 ? 'Executar ação prioritária do CFO' : `Executar ação ${index + 1}`,
      description:item,
      priority:index === 0 ? 'Alta' : 'Média',
    })
  })

  diagnosisLayer.highlights.slice(0, 1).forEach(item => {
    plan.push({
      title:'Explorar oportunidade identificada',
      description:item.detail,
      priority:'Média',
    })
  })

  return dedupeByTitle(plan).slice(0, 6)
}

function buildHealthScore({ currentMonth, allTime, forecast, diagnosisLayer }) {
  let score = 100
  const monthMargin = currentMonth.grossRevenue > 0 ? currentMonth.netProfit / currentMonth.grossRevenue : 0
  if (allTime.payablesOpenTotal > allTime.cashBalance) score -= 20
  if (monthMargin < 0.15) score -= 18
  if (forecast.nextMonth.netProfit < 0) score -= 18
  if (allTime.productsByPerformance.some(item => item.profit < 0)) score -= 10
  if (allTime.accountsReceivable.length > 0) score -= Math.min(12, allTime.accountsReceivable.length * 2)
  score -= Math.min(12, diagnosisLayer.alerts.length * 3)
  score = Math.max(15, Math.min(100, Math.round(score)))

  let label = 'Saudável'
  let color = '#34D399'
  if (score < 80) { label = 'Atenção'; color = '#FBBF24' }
  if (score < 60) { label = 'Pressionado'; color = '#FB923C' }
  if (score < 40) { label = 'Crítico'; color = '#F87171' }

  return {
    score,
    label,
    color,
    summary:score >= 80
      ? 'A clínica mostra equilíbrio financeiro, com boa base para crescer sem perder controle.'
      : score >= 60
        ? 'Há sinais claros de pressão financeira. O sistema já indica as correções mais urgentes.'
        : 'A operação exige ação imediata para proteger caixa, margem e previsibilidade.',
    factors:[
      { label:'Margem líquida', value:`${(monthMargin * 100).toFixed(1)}%`, color:monthMargin >= 0.15 ? '#34D399' : '#F87171' },
      { label:'Caixa atual', value:fmt(allTime.cashBalance), color:allTime.cashBalance >= 0 ? '#22D3EE' : '#F87171' },
      { label:'Recebíveis abertos', value:fmt(allTime.receivablesOpenTotal), color:'#8B5CF6' },
      { label:'Alertas ativos', value:fmtN(diagnosisLayer.alerts.length), color:diagnosisLayer.alerts.length > 0 ? '#FBBF24' : '#34D399' },
    ],
  }
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
  const avgMonthlyRevenue = average(recent.map(item => item.revenue)) || (currentYear.grossRevenue / monthSpan()) || 0
  const avgMonthlyExpenses = average(recent.map(item => item.expenses)) || (currentYear.cashOut / monthSpan()) || 0
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

function getRelativeMonthRange(monthOffset) {
  const reference = new Date(`${today()}T00:00:00`)
  const base = new Date(reference.getFullYear(), reference.getMonth() + monthOffset, 1)
  const start = new Date(base.getFullYear(), base.getMonth(), 1)
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0)
  return {
    start:toIsoDate(start),
    end:toIsoDate(end),
  }
}

function getRelativeYearRange(yearOffset) {
  const reference = new Date(`${today()}T00:00:00`)
  const year = reference.getFullYear() + yearOffset
  return { start:`${year}-01-01`, end:`${year}-12-31` }
}

function buildCoverageScore(catalog) {
  const weights = { surgeries:25, consultations:20, productSales:15, expenses:20, goals:10, procedures:10 }
  const raw = Object.entries(weights).reduce((acc, [key, weight]) => acc + (catalog[key] > 0 ? weight : 0), 0)
  return Math.min(100, raw)
}

function growthRate(current, previous) {
  if (!previous && !current) return 0
  if (!previous) return 1
  return (current - previous) / Math.abs(previous)
}

function signedPctLabel(value) {
  const pct = (value * 100).toFixed(1)
  return `${value >= 0 ? '+' : ''}${pct}%`
}

function buildFastestGrowingExpense(currentMonth, allTime) {
  const currentMonthKey = monthKey(today())
  const previousMonthKey = getRelativeMonthRange(-1).start.slice(0, 7)
  const byCategory = {}

  allTime.exitsFinancial.filter(item => item.origin === 'despesa').forEach(item => {
    const key = monthKey(item.date)
    if (!key) return
    if (!byCategory[item.category]) byCategory[item.category] = {}
    byCategory[item.category][key] = (byCategory[item.category][key] || 0) + (item.value || 0)
  })

  const ranked = Object.entries(byCategory).map(([category, months]) => {
    const current = months[currentMonthKey] || 0
    const previous = months[previousMonthKey] || 0
    return {
      category,
      current,
      previous,
      growth:previous > 0 ? (current - previous) / previous : current > 0 ? 1 : 0,
      growthLabel:signedPctLabel(previous > 0 ? (current - previous) / previous : current > 0 ? 1 : 0),
    }
  }).sort((a, b) => b.growth - a.growth)

  return ranked[0]?.current > 0 ? ranked[0] : null
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

function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatMonthLabel(key) {
  return new Date(`${key}-01T00:00:00`).toLocaleDateString('pt-BR', { month:'long', year:'numeric' })
}

function normalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function matches(text, patterns) {
  return patterns.some(pattern => text.includes(pattern))
}

function sum(values) {
  return values.reduce((acc, value) => acc + (value || 0), 0)
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
