import { createClient } from '@supabase/supabase-js'
import { normalizeData } from '../../src/dataModel.js'
import { buildMetrics } from '../../src/financialMetrics.js'

const MAX_QUESTION_LENGTH = 2_000
const MAX_HISTORY_ITEMS = 8
const MAX_HISTORY_CONTENT_LENGTH = 4_000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const FINANCIAL_ASSISTANT_TOOLS = [
  tool(
    'get_financial_summary',
    'Obtém receita, custos, despesas, lucro, margem, caixa e obrigações de um período.',
    dateRangeProperties(),
    ['start_date', 'end_date'],
  ),
  tool(
    'compare_financial_periods',
    'Compara os principais indicadores financeiros entre dois períodos explícitos.',
    {
      current_start:dateProperty('Início do período atual.'),
      current_end:dateProperty('Fim do período atual.'),
      comparison_start:dateProperty('Início do período de comparação.'),
      comparison_end:dateProperty('Fim do período de comparação.'),
    },
    ['current_start', 'current_end', 'comparison_start', 'comparison_end'],
  ),
  tool(
    'get_expense_breakdown',
    'Lista despesas agrupadas por categoria em um período e status.',
    {
      ...dateRangeProperties(),
      status:{ type:'string', enum:['all', 'open', 'paid'], description:'Status das despesas.' },
      limit:{ type:'integer', minimum:1, maximum:20, description:'Máximo de categorias.' },
    },
    ['start_date', 'end_date', 'status', 'limit'],
  ),
  tool(
    'get_procedure_performance',
    'Obtém ranking de procedimentos por receita, custo, lucro, margem e volume.',
    {
      ...dateRangeProperties(),
      procedure_name:{ type:['string', 'null'], description:'Nome do procedimento ou null para ranking completo.' },
      limit:{ type:'integer', minimum:1, maximum:20, description:'Máximo de procedimentos.' },
    },
    ['start_date', 'end_date', 'procedure_name', 'limit'],
  ),
  tool(
    'get_product_performance',
    'Obtém ranking financeiro de produtos, incluindo receita, custo, lucro, vendas e estoque.',
    {
      ...dateRangeProperties(),
      product_name:{ type:['string', 'null'], description:'Nome do produto ou null para ranking completo.' },
      limit:{ type:'integer', minimum:1, maximum:20, description:'Máximo de produtos.' },
    },
    ['start_date', 'end_date', 'product_name', 'limit'],
  ),
  tool(
    'get_open_obligations',
    'Obtém contas a pagar ou receber sem revelar nomes de pacientes.',
    {
      kind:{ type:'string', enum:['payable', 'receivable'], description:'Tipo de obrigação.' },
      ...dateRangeProperties(),
      overdue_only:{ type:'boolean', description:'Se true, retorna apenas itens vencidos.' },
      limit:{ type:'integer', minimum:1, maximum:50, description:'Máximo de itens.' },
    },
    ['kind', 'start_date', 'end_date', 'overdue_only', 'limit'],
  ),
  tool(
    'get_goal_progress',
    'Obtém o progresso das metas financeiras para um período.',
    {
      ...dateRangeProperties(),
      goal_name:{ type:['string', 'null'], description:'Nome da meta ou null para todas.' },
      limit:{ type:'integer', minimum:1, maximum:20, description:'Máximo de metas.' },
    },
    ['start_date', 'end_date', 'goal_name', 'limit'],
  ),
  tool(
    'get_forecast',
    'Obtém as projeções determinísticas atuais da clínica e a saúde financeira.',
    {},
    [],
  ),
]

export class AssistantError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'AssistantError'
    this.status = status
    this.code = code
  }
}

export function validateAssistantPayload(body) {
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) throw new AssistantError(400, 'INVALID_QUESTION', 'Pergunta obrigatória.')
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new AssistantError(400, 'QUESTION_TOO_LONG', `A pergunta deve ter no máximo ${MAX_QUESTION_LENGTH} caracteres.`)
  }

  const history = sanitizeHistory(body?.history)
  return { question, history }
}

export function sanitizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) return []
  return rawHistory
    .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map(item => ({ role:item.role, content:item.content.trim().slice(0, MAX_HISTORY_CONTENT_LENGTH) }))
    .filter(item => item.content)
    .slice(-MAX_HISTORY_ITEMS)
}

export async function authenticateFinancialRequest(req) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new AssistantError(503, 'SUPABASE_NOT_CONFIGURED', 'Serviço de dados indisponível.')
  }

  const authHeader = req.headers?.authorization || req.headers?.Authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) throw new AssistantError(401, 'SESSION_REQUIRED', 'Sessão obrigatória.')

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth:{ persistSession:false, autoRefreshToken:false },
    global:{ headers:{ Authorization:`Bearer ${token}` } },
  })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) throw new AssistantError(401, 'SESSION_INVALID', 'Sessão inválida.')
  return { user:data.user, supabase }
}

export async function consumeAssistantQuota(supabase, limit = 60) {
  const { data, error } = await supabase.rpc('consume_ai_assistant_quota', { p_limit:limit })
  if (error) {
    throw new AssistantError(503, 'RATE_LIMIT_UNAVAILABLE', 'Controle de uso indisponível. Aplique a migração do assistente.')
  }
  const result = data && typeof data === 'object' ? data : {}
  if (result.allowed === false) {
    throw new AssistantError(429, 'RATE_LIMITED', `Limite diário de ${limit} perguntas atingido.`)
  }
  return result
}

export async function logAssistantEvent(supabase, event) {
  try {
    await supabase.rpc('log_ai_assistant_event', {
      p_request_id:event.requestId,
      p_status:event.status,
      p_mode:event.mode,
      p_model:event.model || null,
      p_tools:event.tools || [],
      p_record_count:Number(event.recordCount || 0),
      p_latency_ms:Number(event.latencyMs || 0),
      p_error_code:event.errorCode || null,
    })
  } catch {
    // Telemetria nunca deve bloquear a resposta ao usuário.
  }
}

export async function fetchFinancialData(supabase, userId) {
  const queries = [
    ['procedures', 'id,name,price,duration_hours'],
    ['products', 'id,name,category,purchase_price,sale_price,opening_stock,active'],
    ['surgeries', 'id,procedure_id,total_value,date,payment_method,payment_status,payment_date,hospital_cost,anesthesia_cost,material_cost,other_costs,invoice_issuance_percent'],
    ['consultations', 'id,date,consultation_type,value,payment_type,payment_method,invoice_issuance_percent,insurance,payment_status,forecast_payment_date,payment_date'],
    ['product_sales', 'id,product_id,quantity,unit_value,total_value,sale_date,payment_method'],
    ['product_purchases', 'id,product_id,quantity,total_value,purchase_date'],
    ['extra_revenues', 'id,category,value,date'],
    ['expenses', 'id,category,value,due_date,payment_date,status'],
    ['assets', 'id,category,value'],
    ['liabilities', 'id,category,value'],
    ['goals', 'id,name,metric,target,period,due_date'],
  ]

  const [results, recurrencesResult] = await Promise.all([
    Promise.all(queries.map(([tableName, columns]) => (
      supabase.from(tableName).select(columns).eq('user_id', userId)
    ))),
    supabase
      .from('recorrencias')
      .select('id,tipo,valor,categoria,frequencia,dia_execucao,data_inicio,data_fim,auto_mark_as_paid,ativo')
      .eq('user_id', userId),
  ])
  const failedIndex = results.findIndex(result => result.error)
  if (failedIndex >= 0) {
    const legacy = await supabase.from('user_finance_data').select('payload').eq('user_id', userId).maybeSingle()
    if (!legacy.error && legacy.data?.payload) return sanitizeLegacyFinancialData(legacy.data.payload)
    const tableName = queries[failedIndex][0]
    throw new AssistantError(503, 'FINANCIAL_DATA_UNAVAILABLE', `Não foi possível consultar ${tableName}.`)
  }

  const rows = Object.fromEntries(queries.map(([tableName], index) => [tableName, results[index].data || []]))
  rows.recorrencias = recurrencesResult.error ? [] : (recurrencesResult.data || [])
  return mapFinancialRows(rows)
}

export function sanitizeLegacyFinancialData(payload) {
  const normalized = normalizeData(payload)
  return {
    ...normalized,
    surgeries:normalized.surgeries.map(item => ({ ...item, patient:'', notes:'' })),
    consultations:normalized.consultations.map(item => ({ ...item, patient:'' })),
    productSales:normalized.productSales.map(item => ({ ...item, patientName:'' })),
    extraRevenues:normalized.extraRevenues.map(item => ({ ...item, description:'' })),
    expenses:normalized.expenses.map(item => ({ ...item, description:'' })),
    assets:normalized.assets.map(item => ({ ...item, name:'', notes:'' })),
    liabilities:normalized.liabilities.map(item => ({ ...item, name:'', notes:'' })),
    recurrences:[],
  }
}

export function mapFinancialRows(rows = {}) {
  return {
    procedures:(rows.procedures || []).map(item => ({
      id:item.id,
      name:item.name || 'Sem procedimento',
      price:number(item.price),
      durationHours:number(item.duration_hours),
    })),
    products:(rows.products || []).map(item => ({
      id:item.id,
      name:item.name || 'Sem produto',
      category:item.category || 'outros',
      purchasePrice:number(item.purchase_price),
      salePrice:number(item.sale_price),
      stock:number(item.opening_stock),
      active:item.active !== false,
    })),
    surgeries:(rows.surgeries || []).map(item => ({
      id:item.id,
      patient:'',
      procedureId:item.procedure_id || '',
      totalValue:number(item.total_value),
      date:item.date || '',
      paymentMethod:item.payment_method || 'pix',
      paymentStatus:item.payment_status || 'pendente',
      paymentDate:item.payment_date || '',
      hospitalCost:number(item.hospital_cost),
      anesthesiaCost:number(item.anesthesia_cost),
      materialCost:number(item.material_cost),
      otherCosts:number(item.other_costs),
      invoiceIssuancePercent:number(item.invoice_issuance_percent),
    })),
    consultations:(rows.consultations || []).map(item => ({
      id:item.id,
      patient:'',
      date:item.date || '',
      consultationType:item.consultation_type || 'avaliacao',
      value:number(item.value),
      paymentType:item.payment_type || 'particular',
      paymentMethod:item.payment_method || 'pix',
      invoiceIssuancePercent:number(item.invoice_issuance_percent),
      insurance:item.insurance || '',
      paymentStatus:item.payment_status || 'pendente',
      forecastPaymentDate:item.forecast_payment_date || '',
      paymentDate:item.payment_date || '',
    })),
    productSales:(rows.product_sales || []).map(item => ({
      id:item.id,
      productId:item.product_id,
      quantity:number(item.quantity),
      unitValue:number(item.unit_value),
      totalValue:number(item.total_value),
      saleDate:item.sale_date || '',
      paymentMethod:item.payment_method || 'pix',
    })),
    productPurchases:(rows.product_purchases || []).map(item => ({
      id:item.id,
      productId:item.product_id,
      quantity:number(item.quantity),
      totalValue:number(item.total_value),
      purchaseDate:item.purchase_date || '',
    })),
    extraRevenues:(rows.extra_revenues || []).map(item => ({
      id:item.id,
      description:'',
      category:item.category || 'outras_receitas',
      value:number(item.value),
      date:item.date || '',
    })),
    expenses:(rows.expenses || []).map(item => ({
      id:item.id,
      description:'',
      category:item.category || 'outros',
      value:number(item.value),
      dueDate:item.due_date || '',
      paymentDate:item.payment_date || '',
      status:item.status || 'aberto',
    })),
    assets:(rows.assets || []).map(item => ({
      id:item.id,
      name:'',
      category:item.category || 'banco',
      value:number(item.value),
    })),
    liabilities:(rows.liabilities || []).map(item => ({
      id:item.id,
      name:'',
      category:item.category || 'outros',
      value:number(item.value),
    })),
    goals:(rows.goals || []).map(item => ({
      id:item.id,
      name:item.name || `Meta de ${item.metric || 'resultado'}`,
      metric:item.metric || 'faturamento',
      target:number(item.target),
      period:item.period || 'mensal',
      dueDate:item.due_date || '',
    })),
    recurrences:(rows.recorrencias || []).map(item => ({
      id:item.id,
      tipo:item.tipo,
      descricao:'',
      valor:number(item.valor),
      categoria:item.categoria || 'outros',
      frequencia:item.frequencia || 'mensal',
      diaExecucao:number(item.dia_execucao),
      dataInicio:item.data_inicio || '',
      dataFim:item.data_fim || '',
      autoMarkAsPaid:Boolean(item.auto_mark_as_paid),
      ativo:item.ativo !== false,
    })),
  }
}

export function executeFinancialTool(name, rawArgs, data, currentDate = saoPauloDate()) {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
  switch (name) {
    case 'get_financial_summary':
      return getFinancialSummary(data, validateRange(args.start_date, args.end_date))
    case 'compare_financial_periods':
      return compareFinancialPeriods(data, args)
    case 'get_expense_breakdown':
      return getExpenseBreakdown(data, args)
    case 'get_procedure_performance':
      return getProcedurePerformance(data, args)
    case 'get_product_performance':
      return getProductPerformance(data, args)
    case 'get_open_obligations':
      return getOpenObligations(data, args, currentDate)
    case 'get_goal_progress':
      return getGoalProgress(data, args)
    case 'get_forecast':
      return getForecast(data)
    default:
      throw new AssistantError(400, 'UNKNOWN_TOOL', 'Ferramenta financeira não permitida.')
  }
}

export function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim()
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(block => (block?.type === 'output_text' || block?.type === 'text') && block.text)
    .map(block => block.text)
    .join('\n')
    .trim()
}

export function findFunctionCalls(payload) {
  return (Array.isArray(payload?.output) ? payload.output : []).filter(item => item?.type === 'function_call')
}

export function parseFunctionArguments(value) {
  try {
    const parsed = JSON.parse(value || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    return parsed
  } catch {
    throw new AssistantError(400, 'INVALID_TOOL_ARGUMENTS', 'A IA gerou filtros inválidos para a consulta.')
  }
}

export function saoPauloDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function getFinancialSummary(data, range) {
  const metrics = buildMetrics(data, { startDate:range.startDate, endDate:range.endDate, balanceDate:range.endDate })
  const result = metricsSummary(metrics)
  return {
    period:periodLabel(range),
    ...result,
    recordCount:countMetricsRecords(metrics),
  }
}

function compareFinancialPeriods(data, args) {
  const current = validateRange(args.current_start, args.current_end)
  const comparison = validateRange(args.comparison_start, args.comparison_end)
  const currentMetrics = buildMetrics(data, { startDate:current.startDate, endDate:current.endDate, balanceDate:current.endDate })
  const comparisonMetrics = buildMetrics(data, { startDate:comparison.startDate, endDate:comparison.endDate, balanceDate:comparison.endDate })
  const currentSummary = metricsSummary(currentMetrics)
  const comparisonSummary = metricsSummary(comparisonMetrics)
  return {
    current:{ period:periodLabel(current), ...currentSummary },
    comparison:{ period:periodLabel(comparison), ...comparisonSummary },
    variation:{
      revenuePercent:percentChange(currentSummary.revenue, comparisonSummary.revenue),
      expensesPercent:percentChange(currentSummary.totalExpenses, comparisonSummary.totalExpenses),
      netProfitPercent:percentChange(currentSummary.netProfit, comparisonSummary.netProfit),
      cashFlowPercent:percentChange(currentSummary.cashFlow, comparisonSummary.cashFlow),
    },
    recordCount:countMetricsRecords(currentMetrics) + countMetricsRecords(comparisonMetrics),
  }
}

function getExpenseBreakdown(data, args) {
  const range = validateRange(args.start_date, args.end_date)
  const status = ['all', 'open', 'paid'].includes(args.status) ? args.status : 'all'
  const limit = boundedInteger(args.limit, 10, 1, 20)
  const filteredData = status === 'all' ? data : {
    ...data,
    expenses:(data.expenses || []).filter(item => status === 'paid' ? item.status === 'pago' : !['pago', 'cancelado'].includes(item.status)),
    recurrences:(data.recurrences || []).filter(item => status === 'paid' ? item.autoMarkAsPaid : !item.autoMarkAsPaid),
  }
  const metrics = buildMetrics(filteredData, { startDate:range.startDate, endDate:range.endDate, balanceDate:range.endDate })
  const categories = Object.entries(metrics.expensesByCategory)
    .map(([category, total]) => ({ category, total:money(total) }))
    .sort((a, b) => b.total - a.total)
  const grandTotal = categories.reduce((sum, item) => sum + item.total, 0)
  return {
    period:periodLabel(range),
    status,
    total:money(grandTotal),
    categories:categories.slice(0, limit).map(item => ({
      ...item,
      sharePercent:grandTotal > 0 ? percent(item.total / grandTotal) : 0,
    })),
    recordCount:categories.length,
  }
}

function getProcedurePerformance(data, args) {
  const range = validateRange(args.start_date, args.end_date)
  const limit = boundedInteger(args.limit, 10, 1, 20)
  const metrics = buildMetrics(data, { startDate:range.startDate, endDate:range.endDate, balanceDate:range.endDate })
  const needle = normalizeText(args.procedure_name)
  let items = metrics.byProcedure.map(item => ({
    name:item.name,
    surgeries:item.count,
    revenue:money(item.revenue),
    costs:money(item.revenue - item.profit),
    profit:money(item.profit),
    marginPercent:item.revenue > 0 ? percent(item.profit / item.revenue) : 0,
    averageTicket:item.count > 0 ? money(item.revenue / item.count) : 0,
  }))
  if (needle) items = items.filter(item => normalizeText(item.name).includes(needle))
  return { period:periodLabel(range), procedures:items.slice(0, limit), recordCount:items.length }
}

function getProductPerformance(data, args) {
  const range = validateRange(args.start_date, args.end_date)
  const limit = boundedInteger(args.limit, 10, 1, 20)
  const metrics = buildMetrics(data, { startDate:range.startDate, endDate:range.endDate, balanceDate:range.endDate })
  const needle = normalizeText(args.product_name)
  let items = metrics.productsByPerformance.map(item => ({
    name:item.name,
    revenue:money(item.revenue),
    cost:money(item.cost),
    profit:money(item.profit),
    marginPercent:item.revenue > 0 ? percent(item.profit / item.revenue) : 0,
    soldQuantity:number(item.soldQty),
    stock:number(item.stock),
  }))
  if (needle) items = items.filter(item => normalizeText(item.name).includes(needle))
  return { period:periodLabel(range), products:items.slice(0, limit), recordCount:items.length }
}

function getOpenObligations(data, args, currentDate) {
  const range = validateRange(args.start_date, args.end_date)
  const kind = args.kind === 'payable' ? 'payable' : 'receivable'
  const limit = boundedInteger(args.limit, 20, 1, 50)
  const metrics = buildMetrics(data, { startDate:range.startDate, endDate:range.endDate, balanceDate:range.endDate })
  const source = kind === 'payable' ? metrics.accountsPayable : metrics.accountsReceivable
  const items = source
    .filter(item => item.dueDate >= range.startDate && item.dueDate <= range.endDate)
    .filter(item => !args.overdue_only || item.dueDate < currentDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map(item => ({
      source:item.source,
      category:item.category || 'outros',
      value:money(item.value),
      dueDate:item.dueDate,
      status:item.status,
    }))
  return {
    kind,
    period:periodLabel(range),
    overdueOnly:Boolean(args.overdue_only),
    total:money(items.reduce((sum, item) => sum + item.value, 0)),
    items:items.slice(0, limit),
    recordCount:items.length,
  }
}

function getGoalProgress(data, args) {
  const range = validateRange(args.start_date, args.end_date)
  const limit = boundedInteger(args.limit, 10, 1, 20)
  const metrics = buildMetrics(data, { startDate:range.startDate, endDate:range.endDate, balanceDate:range.endDate })
  const needle = normalizeText(args.goal_name)
  let items = (metrics.goals || []).map(goal => {
    const current = {
      faturamento:metrics.grossRevenue,
      cirurgias:metrics.surgeriesCompleted,
      consultas:metrics.consultationsCompleted,
      lucro:metrics.netProfit,
      ticket_medio:metrics.averageTicket,
      fluxo_caixa:metrics.cashBalance,
    }[goal.metric] || 0
    const target = number(goal.target)
    return {
      name:goal.name,
      metric:goal.metric,
      period:goal.period,
      dueDate:goal.dueDate || null,
      current:money(current),
      target:money(target),
      gap:money(Math.max(0, target - current)),
      progressPercent:target > 0 ? percent(current / target) : 0,
    }
  })
  if (needle) items = items.filter(item => normalizeText(item.name).includes(needle))
  return { period:periodLabel(range), goals:items.slice(0, limit), recordCount:items.length }
}

function getForecast(data) {
  const currentDate = saoPauloDate()
  const currentMonthStart = `${currentDate.slice(0, 7)}-01`
  const currentMonth = buildMetrics(data, { startDate:currentMonthStart, endDate:currentDate, balanceDate:currentDate })
  const allTime = buildMetrics(data, { balanceDate:currentDate })
  const monthKeys = Object.keys({ ...allTime.revenueByMonth, ...allTime.expenseByMonth }).sort()
  const months = monthKeys.map(key => ({
    revenue:number(allTime.revenueByMonth[key]),
    expenses:number(allTime.expenseByMonth[key]),
  }))
  const recentThree = months.slice(-3)
  const recentSix = months.slice(-6)
  const nextMonthRevenue = blend(average(recentThree.map(item => item.revenue)), currentMonth.grossRevenue, 0.65)
  const nextMonthExpenses = blend(average(recentThree.map(item => item.expenses)), currentMonth.cashOut, 0.65)
  const nextYearRevenue = average(recentSix.map(item => item.revenue)) * 12
  const nextYearExpenses = average(recentSix.map(item => item.expenses)) * 12
  const recentDays = groupDaily(allTime.cashFlowEntries).slice(-14)
  const nextDayRevenue = average(recentDays.map(item => item.revenue))
  const nextDayExpenses = average(recentDays.map(item => item.expenses))
  return {
    generatedAt:currentDate,
    methodology:'Médias móveis recentes combinadas com o desempenho do período atual.',
    nextDay:moneyObject({ revenue:nextDayRevenue, expenses:nextDayExpenses, netProfit:nextDayRevenue - nextDayExpenses }),
    nextMonth:moneyObject({ revenue:nextMonthRevenue, expenses:nextMonthExpenses, netProfit:nextMonthRevenue - nextMonthExpenses }),
    nextYear:moneyObject({ revenue:nextYearRevenue, expenses:nextYearExpenses, netProfit:nextYearRevenue - nextYearExpenses }),
    recordCount:(data.surgeries || []).length + (data.consultations || []).length + (data.expenses || []).length,
  }
}

function metricsSummary(metrics) {
  const totalExpenses = metrics.surgeryCostTotal + metrics.consultationCostTotal + metrics.productPurchaseTotal + metrics.operationalExpenses + metrics.taxExpenses
  return {
    revenue:money(metrics.grossRevenue),
    surgeryRevenue:money(metrics.surgeryRevenue),
    consultationRevenue:money(metrics.consultationRevenue),
    productRevenue:money(metrics.productSalesRevenue),
    extraRevenue:money(metrics.extraRevenueTotal),
    totalExpenses:money(totalExpenses),
    netProfit:money(metrics.netProfit),
    netMarginPercent:metrics.grossRevenue > 0 ? percent(metrics.netProfit / metrics.grossRevenue) : 0,
    cashIn:money(metrics.cashIn),
    cashOut:money(metrics.cashOut),
    cashFlow:money(metrics.cashBalance),
    receivablesOpen:money(metrics.receivablesOpenTotal),
    payablesOpen:money(metrics.payablesOpenTotal),
    projectedBalance:money(metrics.prediction),
    surgeries:metrics.surgeriesCompleted,
    consultations:metrics.consultationsCompleted,
  }
}

function countMetricsRecords(metrics) {
  return metrics.entriesFinancial.length + metrics.exitsFinancial.length + metrics.accountsReceivable.length + metrics.accountsPayable.length
}

function validateRange(startDate, endDate) {
  if (!validDate(startDate) || !validDate(endDate)) {
    throw new AssistantError(400, 'INVALID_DATE_RANGE', 'Use datas válidas no formato YYYY-MM-DD.')
  }
  if (startDate > endDate) throw new AssistantError(400, 'INVALID_DATE_RANGE', 'A data inicial deve ser anterior à data final.')
  return { startDate, endDate }
}

function validDate(value) {
  if (!DATE_PATTERN.test(String(value || ''))) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function periodLabel(range) {
  return `${range.startDate}/${range.endDate}`
}

function percentChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null
  return percent((current - previous) / Math.abs(previous))
}

function percent(value) {
  return Math.round((number(value) * 100 + Number.EPSILON) * 100) / 100
}

function money(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100
}

function moneyObject(value = {}) {
  return { revenue:money(value.revenue), expenses:money(value.expenses), netProfit:money(value.netProfit) }
}

function average(values) {
  const valid = values.filter(value => Number.isFinite(value))
  if (valid.length === 0) return 0
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function blend(baseValue, currentValue, currentWeight) {
  if (!baseValue && !currentValue) return 0
  if (!baseValue) return currentValue
  if (!currentValue) return baseValue
  return (baseValue * (1 - currentWeight)) + (currentValue * currentWeight)
}

function groupDaily(entries) {
  const grouped = {}
  for (const item of entries || []) {
    if (!item.date) continue
    if (!grouped[item.date]) grouped[item.date] = { date:item.date, revenue:0, expenses:0 }
    if (item.type === 'entrada') grouped[item.date].revenue += number(item.value)
    if (item.type === 'saida') grouped[item.date].expenses += number(item.value)
  }
  return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date))
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function dateProperty(description) {
  return { type:'string', pattern:'^\\d{4}-\\d{2}-\\d{2}$', description:`${description} Formato YYYY-MM-DD.` }
}

function dateRangeProperties() {
  return {
    start_date:dateProperty('Data inicial inclusiva.'),
    end_date:dateProperty('Data final inclusiva.'),
  }
}

function tool(name, description, properties, required) {
  return {
    type:'function',
    name,
    description,
    strict:true,
    parameters:{ type:'object', properties, required, additionalProperties:false },
  }
}
