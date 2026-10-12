import { buildMetrics, generateRecurringOccurrences } from '../financialMetrics.js'
import { decodePaymentMethod } from './paymentMethodCodec.js'
import { buildProductCosting } from './inventoryCosting.js'

const CATEGORY_LABELS = {
  financeiro:'Financeiro',
  estoque:'Estoque e produtos',
  operacao:'Operação clínica',
  clientes:'Clientes',
  gestao:'Gestão e auditoria',
}

const PAYMENT_LABELS = {
  pix:'PIX', cartao:'Cartão', dinheiro:'Dinheiro', boleto:'Boleto', transferencia:'Transferência',
}

const REPORTS = [
  report('accounts-receivable', 'financeiro', 'Contas a receber', 'Títulos em aberto, vencimentos, parcelas e inadimplência.', buildAccountsReceivable),
  report('accounts-payable', 'financeiro', 'Contas a pagar', 'Obrigações em aberto por vencimento, categoria e fornecedor.', buildAccountsPayable),
  report('cash-flow', 'financeiro', 'Fluxo de caixa realizado', 'Entradas e saídas efetivamente reconhecidas no caixa.', buildCashFlow),
  report('projected-cash-flow', 'financeiro', 'Fluxo de caixa projetado', 'Previsão líquida baseada nas contas a pagar e a receber.', buildProjectedCashFlow),
  report('dre', 'financeiro', 'DRE por competência', 'Receitas, custos, despesas e resultado do período.', buildDre),
  report('revenues', 'financeiro', 'Receitas detalhadas', 'Faturamento por competência, origem e categoria.', buildRevenues),
  report('expenses', 'financeiro', 'Custos e despesas detalhados', 'Gastos por competência, origem e centro de custo.', buildExpenses),
  report('balance-sheet', 'financeiro', 'Balanço gerencial', 'Ativos, obrigações e patrimônio líquido na data-base.', buildBalanceSheet),
  report('stock-position', 'estoque', 'Posição financeira do estoque', 'Saldo, custo corrente, preço de venda e valor potencial.', buildStockPosition, { periodMode:'snapshot' }),
  report('stock-movements', 'estoque', 'Movimentações de estoque', 'Entradas, saídas e saldo por produto no período.', buildStockMovements),
  report('product-sales', 'estoque', 'Vendas de produtos', 'Itens vendidos, pacientes, quantidades e valores.', buildProductSales),
  report('product-purchases', 'estoque', 'Compras por fornecedor', 'Reposições de estoque por produto e fornecedor.', buildProductPurchases),
  report('product-abc', 'estoque', 'Curva ABC de produtos', 'Classificação por participação acumulada no faturamento.', buildProductAbc),
  report('contribution-margin', 'estoque', 'Margem de contribuição por produto', 'Receita, custo estimado e margem usando o custo cadastrado.', buildContributionMargin),
  report('surgeries', 'operacao', 'Cirurgias', 'Agenda, faturamento, custos e situação financeira das cirurgias.', buildSurgeries),
  report('consultations', 'operacao', 'Consultas', 'Atendimentos, convênios, valores e situação de recebimento.', buildConsultations),
  report('procedure-performance', 'operacao', 'Desempenho por procedimento', 'Volume, receita, custos, lucro e ticket médio.', buildProcedurePerformance),
  report('patients', 'clientes', 'Cadastro de clientes', 'Base administrativa de pacientes, contato e consentimento.', buildPatients, { periodMode:'snapshot', sensitive:true }),
  report('patient-financial', 'clientes', 'Financeiro por cliente', 'Faturamento por paciente em cirurgias, consultas e produtos.', buildPatientFinancial),
  report('patient-abc', 'clientes', 'Curva ABC de clientes', 'Participação dos pacientes no faturamento do período.', buildPatientAbc),
  report('goals', 'gestao', 'Metas', 'Objetivos financeiros cadastrados e valores realizados.', buildGoals, { periodMode:'snapshot' }),
  report('data-quality', 'gestao', 'Qualidade dos dados', 'Pendências que podem reduzir a confiabilidade dos relatórios.', buildDataQuality, { periodMode:'snapshot' }),
]

function report(id, category, title, description, builder, extra = {}) {
  return { id, category, categoryLabel:CATEGORY_LABELS[category], title, description, builder, ...extra }
}

export function getReportDefinitions() {
  return REPORTS.map(({ builder:_builder, ...definition }) => definition)
}

export function buildReport(reportId, context) {
  const definition = REPORTS.find(item => item.id === reportId)
  if (!definition) throw new Error(`Relatório desconhecido: ${reportId}`)
  const normalized = normalizeContext(context)
  const result = definition.builder(normalized)
  return {
    ...definition,
    ...result,
    generatedAt:normalized.generatedAt,
    period:definition.periodMode === 'snapshot'
      ? { start:'', end:normalized.range.end, label:`Posição em ${normalized.range.end || 'hoje'}` }
      : normalized.range,
    sourceCounts:buildSourceCounts(normalized),
  }
}

export function buildAllReports(context) {
  return REPORTS.map(item => buildReport(item.id, context))
}

function normalizeContext(context = {}) {
  return {
    data:context.data || {},
    patients:Array.isArray(context.patients) ? context.patients : [],
    recurrences:Array.isArray(context.recurrences) ? context.recurrences : [],
    range:{ start:context.range?.start || '', end:context.range?.end || '' },
    generatedAt:context.generatedAt || new Date().toISOString(),
  }
}

function buildSourceCounts({ data, patients, recurrences }) {
  return {
    Cirurgias:(data.surgeries || []).length,
    Consultas:(data.consultations || []).length,
    Produtos:(data.products || []).length,
    'Vendas de produtos':(data.productSales || []).length,
    'Compras de produtos':(data.productPurchases || []).length,
    'Receitas extras':(data.extraRevenues || []).length,
    Despesas:(data.expenses || []).length,
    Pacientes:patients.length,
    Recorrências:recurrences.length,
  }
}

function col(key, label, type = 'text', width = 18) {
  return { key, label, type, width }
}

function result(columns, rows, summary = [], warnings = [], methodology = '') {
  return { columns, rows, summary, warnings:[...new Set(warnings.filter(Boolean))], methodology }
}

function num(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function inRange(value, range) {
  if (!value) return false
  if (range.start && value < range.start) return false
  if (range.end && value > range.end) return false
  return true
}

function onOrBefore(value, end) {
  return Boolean(value) && (!end || value <= end)
}

function labelize(value) {
  if (!value) return 'Não informado'
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function paymentMethodLabel(raw) {
  const decoded = decodePaymentMethod(raw)
  if (decoded.paymentMode === 'misto') {
    return `${PAYMENT_LABELS[decoded.mixMethodA] || labelize(decoded.mixMethodA)} + ${PAYMENT_LABELS[decoded.mixMethodB] || labelize(decoded.mixMethodB)}`
  }
  const methods = [...new Set((decoded.payments || []).map(item => PAYMENT_LABELS[item.method] || labelize(item.method)))]
  return methods.length ? methods.join(' + ') : (PAYMENT_LABELS[decoded.paymentMethod] || labelize(decoded.paymentMethod))
}

function dueStatus(dueDate, referenceDate) {
  if (!dueDate) return 'Sem vencimento'
  if (referenceDate && dueDate < referenceDate) return 'Vencido'
  if (referenceDate && dueDate === referenceDate) return 'Vence hoje'
  return 'A vencer'
}

function procedureMap(data) {
  return new Map((data.procedures || []).map(item => [item.id, item.name]))
}

function productMap(data) {
  return new Map((data.products || []).map(item => [item.id, item]))
}

function recurringMatch(record, occurrence, type) {
  if (type === 'receita') {
    return (record.description || '') === (occurrence.descricao || '')
      && num(record.value) === num(occurrence.valor)
      && (record.date || record.dueDate || '') === occurrence.dueDate
  }
  return (record.description || '') === (occurrence.descricao || '')
    && num(record.value) === num(occurrence.valor)
    && (record.dueDate || '') === occurrence.dueDate
}

function receivableRows(ctx) {
  const { data, recurrences, range } = ctx
  const metrics = buildMetrics({ ...data, recurrences }, { startDate:range.start, endDate:range.end, balanceDate:range.end })
  const sourceLabels = { cirurgia:'Cirurgia', consulta:'Consulta', venda_produto:'Venda de produto', outra_receita:'Receita extra', recorrencia:'Recorrência' }
  const sourceRecords = new Map([
    ...(data.surgeries || []).map(item => [`cirurgia:${item.id}`, item]),
    ...(data.consultations || []).map(item => [`consulta:${item.id}`, item]),
    ...(data.productSales || []).map(item => [`venda_produto:${item.id}`, item]),
    ...(data.extraRevenues || []).map(item => [`outra_receita:${item.id}`, item]),
  ])
  return metrics.accountsReceivable
    .filter(item => inRange(item.dueDate, range))
    .map(item => {
      const source = sourceRecords.get(`${item.source}:${item.sourceId}`)
      return {
        source:sourceLabels[item.source] || labelize(item.source), document:item.sourceId || item.id,
        customer:item.patient || 'Não informado', description:item.description || '', installment:item.openInstallments || 1,
        competenceDate:item.competenceDate, dueDate:item.dueDate, value:num(item.value),
        status:dueStatus(item.dueDate, range.end), paymentMethod:paymentMethodLabel(source?.paymentMethod),
      }
    })
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
}

function payableRows(ctx) {
  const { data, recurrences, range } = ctx
  const metrics = buildMetrics({ ...data, recurrences }, { startDate:range.start, endDate:range.end, balanceDate:range.end })
  const sourceLabels = { despesa:'Despesa', compra_produto:'Compra de produto', custo_cirurgico:'Custo cirúrgico', custo_consulta:'Custo de consulta', recorrencia:'Recorrência' }
  return metrics.accountsPayable
    .filter(item => inRange(item.dueDate, range))
    .map(item => ({
      source:sourceLabels[item.source] || labelize(item.source), document:item.sourceId || item.id,
      supplier:item.supplier || 'Não informado', description:item.description || '', category:labelize(item.category),
      costCenter:item.costCenter || 'Não informado', competenceDate:item.competenceDate, dueDate:item.dueDate,
      value:num(item.value), status:dueStatus(item.dueDate, range.end),
    }))
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
}

function buildAccountsReceivable(ctx) {
  const rows = receivableRows(ctx)
  const overdue = rows.filter(item => item.status === 'Vencido')
  return result(
    [col('source','Origem'), col('document','ID', 'text', 38), col('customer','Cliente', 'text', 28), col('description','Descrição','text',32), col('installment','Parcela','integer',10), col('competenceDate','Competência','date',14), col('dueDate','Vencimento','date',14), col('value','Valor','currency',16), col('status','Situação', 'text', 14), col('paymentMethod','Forma de pagamento','text',20)],
    rows,
    [['Total em aberto', sum(rows, 'value')], ['Total vencido', sum(overdue, 'value')], ['Títulos', rows.length]],
    [],
    'Fonte: razão financeiro canônico. Inclui todos os títulos a receber em aberto na data-base, inclusive vendas de produtos e recorrências não automáticas.',
  )
}

function buildAccountsPayable(ctx) {
  const rows = payableRows(ctx)
  const overdue = rows.filter(item => item.status === 'Vencido')
  return result(
    [col('source','Origem'), col('document','ID','text',38), col('supplier','Fornecedor/beneficiário','text',28), col('description','Descrição','text',32), col('category','Categoria'), col('costCenter','Centro de custo'), col('competenceDate','Competência','date',14), col('dueDate','Vencimento','date',14), col('value','Valor','currency',16), col('status','Situação', 'text', 14)],
    rows,
    [['Total em aberto', sum(rows, 'value')], ['Total vencido', sum(overdue, 'value')], ['Títulos', rows.length]],
    [],
    'Fonte: razão financeiro canônico. Inclui despesas, compras de produtos, custos clínicos e recorrências que estejam em aberto na data-base.',
  )
}

function buildCashFlow(ctx) {
  const metrics = buildMetrics({ ...ctx.data, recurrences:ctx.recurrences }, { startDate:ctx.range.start, endDate:ctx.range.end, balanceDate:ctx.range.end })
  let balance = 0
  const rows = metrics.cashFlowEntries.map(item => {
    const inflow = item.type === 'entrada' ? num(item.value) : 0
    const outflow = item.type === 'saida' ? num(item.value) : 0
    balance += inflow - outflow
    return { date:item.date, type:item.type === 'entrada' ? 'Entrada' : 'Saída', category:labelize(item.category), description:item.description, origin:labelize(item.origin), inflow, outflow, balance }
  })
  return result(
    [col('date','Data','date',14), col('type','Tipo', 'text', 12), col('category','Categoria'), col('description','Histórico','text',38), col('origin','Origem'), col('inflow','Entradas','currency',16), col('outflow','Saídas','currency',16), col('balance','Saldo acumulado','currency',18)],
    rows,
    [['Entradas', metrics.cashIn], ['Saídas', metrics.cashOut], ['Saldo do período', metrics.cashBalance]],
    ['Recebimentos de vendas sem data própria e custos clínicos sem liquidação independente são sinalizados pela auditoria de qualidade.'],
    'Fonte: razão financeiro canônico. O caixa reconhece somente parcelas liquidadas, usando a data real disponível ou a aproximação explicitamente auditada.',
  )
}

function buildProjectedCashFlow(ctx) {
  const receivables = receivableRows(ctx).map(item => ({ date:item.dueDate, type:'Entrada prevista', description:item.description, party:item.customer, inflow:item.value, outflow:0 }))
  const payables = payableRows(ctx).map(item => ({ date:item.dueDate, type:'Saída prevista', description:item.description, party:item.supplier, inflow:0, outflow:item.value }))
  let balance = 0
  const rows = [...receivables, ...payables].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(item => {
    balance += item.inflow - item.outflow
    return { ...item, balance }
  })
  return result(
    [col('date','Data prevista','date',14), col('type','Tipo'), col('description','Descrição','text',34), col('party','Cliente/fornecedor','text',28), col('inflow','Entradas previstas','currency',18), col('outflow','Saídas previstas','currency',18), col('balance','Saldo projetado','currency',18)],
    rows,
    [['A receber', sum(rows, 'inflow')], ['A pagar', sum(rows, 'outflow')], ['Projeção líquida', balance]],
    ['A projeção começa em zero e não inclui saldo bancário inicial. Registros legados sem situação confirmada permanecem em aberto.'],
    'Projeção construída exclusivamente com títulos abertos e suas datas de vencimento.',
  )
}

function buildDre(ctx) {
  const m = buildMetrics({ ...ctx.data, recurrences:ctx.recurrences }, { startDate:ctx.range.start, endDate:ctx.range.end, balanceDate:ctx.range.end })
  const rows = [
    ['Receita de cirurgias', m.surgeryRevenue, 'Receita'], ['Receita de consultas', m.consultationRevenue, 'Receita'],
    ['Receita de produtos', m.productSalesRevenue, 'Receita'], ['Outras receitas', m.extraRevenueTotal, 'Receita'],
    ['Receita bruta', m.grossRevenue, 'Subtotal'], ['Custos de cirurgias', -m.surgeryCostTotal, 'Custo'],
    ['Custos de consultas', -m.consultationCostTotal, 'Custo'], ['CMV — produtos vendidos', m.productCostOfSales ? -m.productCostOfSales : 0, 'Custo'],
    ['Despesas operacionais', -m.operationalExpenses, 'Despesa'], ['Resultado operacional', m.operatingProfit, 'Subtotal'],
    ['Impostos', -m.taxExpenses, 'Despesa'], ['Resultado líquido', m.netProfit, 'Total'],
  ].map(([description, value, group]) => ({ group, description, value }))
  return result(
    [col('group','Grupo'), col('description','Descrição','text',38), col('value','Valor','currency',18)],
    rows,
    [['Receita bruta', m.grossRevenue], ['Resultado líquido', m.netProfit], ['Margem líquida', m.grossRevenue ? m.netProfit / m.grossRevenue : 0, 'percent']],
    ['Este demonstrativo é gerencial e não substitui demonstração contábil assinada.'],
    'Regime de competência. Produtos reconhecem CMV pelo custo médio móvel vigente na data de cada venda; compras formam estoque e não são despesa imediata. Cancelados não compõem o resultado.',
  )
}

function buildRevenues(ctx) {
  const { data, recurrences, range } = ctx
  const products = productMap(data)
  const procedures = procedureMap(data)
  const rows = []
  ;(data.surgeries || []).filter(item => item.paymentStatus !== 'cancelado' && inRange(item.competenceDate || item.date, range)).forEach(item => rows.push({ competenceDate:item.competenceDate || item.date, source:'Cirurgia', category:'Cirurgias', description:procedures.get(item.procedureId) || 'Procedimento', customer:item.patient || '', status:labelize(item.paymentStatus), value:num(item.totalValue) }))
  ;(data.consultations || []).filter(item => item.paymentStatus !== 'cancelado' && inRange(item.competenceDate || item.date, range)).forEach(item => rows.push({ competenceDate:item.competenceDate || item.date, source:'Consulta', category:labelize(item.paymentType), description:labelize(item.consultationType), customer:item.patient || '', status:labelize(item.paymentStatus), value:num(item.value) }))
  ;(data.productSales || []).filter(item => item.paymentStatus !== 'cancelado' && inRange(item.competenceDate || item.saleDate, range)).forEach(item => rows.push({ competenceDate:item.competenceDate || item.saleDate, source:'Venda de produto', category:labelize(products.get(item.productId)?.category), description:products.get(item.productId)?.name || 'Produto', customer:item.patientName || '', status:labelize(item.paymentStatus || 'a conferir'), value:num(item.totalValue) }))
  ;(data.extraRevenues || []).filter(item => item.status !== 'cancelado' && inRange(item.competenceDate || item.date, range)).forEach(item => rows.push({ competenceDate:item.competenceDate || item.date, source:'Receita extra', category:labelize(item.category), description:item.description || '', customer:item.originLabel || '', status:labelize(item.status || 'recebido'), value:num(item.value) }))
  generateRecurringOccurrences(recurrences, range.start, range.end).filter(item => item.tipo === 'receita' && !(data.extraRevenues || []).some(entry => recurringMatch(entry, item, 'receita'))).forEach(item => rows.push({ competenceDate:item.dueDate, source:'Recorrência', category:labelize(item.categoria), description:item.descricao || '', customer:'', status:item.autoMarkAsPaid ? 'Recebido automaticamente' : 'Pendente', value:num(item.valor) }))
  rows.sort((a, b) => (a.competenceDate || '').localeCompare(b.competenceDate || ''))
  return result([col('competenceDate','Competência','date',14), col('source','Origem'), col('category','Categoria'), col('description','Descrição','text',34), col('customer','Cliente','text',28), col('status','Situação'), col('value','Valor','currency',16)], rows, [['Receita por competência', sum(rows,'value')], ['Lançamentos', rows.length]], [], 'Detalhamento das receitas reconhecidas no período pelo regime de competência, excluindo registros cancelados.')
}

function buildExpenses(ctx) {
  const { data, recurrences, range } = ctx
  const products = productMap(data)
  const productCosting = buildProductCosting(data)
  const rows = []
  ;(data.surgeries || []).filter(item => item.paymentStatus !== 'cancelado' && inRange(item.competenceDate || item.date, range)).forEach(item => {
    const date = item.competenceDate || item.date
    ;[['Hospital',item.hospitalCost],['Anestesia',item.anesthesiaCost],['Material',item.materialCost],['Outros custos',item.otherCosts],['Emissão de nota',item.invoiceTaxAmount != null ? item.invoiceTaxAmount : num(item.totalValue) * num(item.invoiceIssuancePercent) / 100]].forEach(([description,value]) => { if (num(value)) rows.push({ competenceDate:date, source:'Cirurgia', category:description, description:`${description} — ${item.patient || 'Paciente'}`, costCenter:'Cirurgias', supplier:'Não informado', status:'Liquidado na data clínica', value:num(value) }) })
  })
  ;(data.consultations || []).filter(item => item.paymentStatus !== 'cancelado' && inRange(item.competenceDate || item.date, range)).forEach(item => { const value = item.invoiceTaxAmount != null ? num(item.invoiceTaxAmount) : num(item.value) * num(item.invoiceIssuancePercent) / 100; if (value) rows.push({ competenceDate:item.competenceDate || item.date, source:'Consulta', category:'Emissão de nota', description:`Emissão de nota — ${item.patient || 'Paciente'}`, costCenter:'Consultas', supplier:'Não informado', status:'Liquidado na data clínica', value }) })
  ;(data.productSales || []).filter(item => item.paymentStatus !== 'cancelado' && inRange(item.competenceDate || item.saleDate, range)).forEach(item => {
    const value = num(productCosting.salesCost[item.id]?.totalCost)
    if (value) rows.push({ competenceDate:item.competenceDate || item.saleDate, source:'CMV', category:labelize(products.get(item.productId)?.category), description:products.get(item.productId)?.name || 'Produto', costCenter:'Estoque', supplier:'Custo médio móvel', status:'Reconhecido na venda', value })
  })
  ;(data.expenses || []).filter(item => item.status !== 'cancelado' && inRange(item.competenceDate || item.dueDate, range)).forEach(item => rows.push({ competenceDate:item.competenceDate || item.dueDate, source:'Despesa', category:labelize(item.category), description:item.description || '', costCenter:item.costCenter || 'Não informado', supplier:item.originLabel || 'Não informado', status:labelize(item.status), value:num(item.value) }))
  generateRecurringOccurrences(recurrences, range.start, range.end).filter(item => item.tipo === 'despesa' && !(data.expenses || []).some(entry => recurringMatch(entry, item, 'despesa'))).forEach(item => rows.push({ competenceDate:item.dueDate, source:'Recorrência', category:labelize(item.categoria), description:item.descricao || '', costCenter:'Não informado', supplier:'Recorrência', status:item.autoMarkAsPaid ? 'Pago automaticamente' : 'Pendente', value:num(item.valor) }))
  rows.sort((a, b) => (a.competenceDate || '').localeCompare(b.competenceDate || ''))
  return result([col('competenceDate','Competência','date',14), col('source','Origem'), col('category','Categoria'), col('description','Descrição','text',36), col('costCenter','Centro de custo'), col('supplier','Fornecedor','text',24), col('status','Situação'), col('value','Valor','currency',16)], rows, [['Custos e despesas', sum(rows,'value')], ['Lançamentos', rows.length]], [], 'Detalhamento de custos e despesas pelo regime de competência, com impostos de nota congelados e cancelados excluídos.')
}

function buildBalanceSheet(ctx) {
  const m = buildMetrics({ ...ctx.data, recurrences:ctx.recurrences }, { balanceDate:ctx.range.end, startDate:'', endDate:ctx.range.end })
  const rows = [
    ...(ctx.data.assets || []).map(item => ({ group:'Ativo cadastrado', description:item.name, category:labelize(item.category), value:num(item.value) })),
    { group:'Ativo calculado', description:'Caixa acumulado', category:'Disponibilidades', value:m.assetsTotal - m.receivablesOpenTotal - m.inventoryAsset - sum(ctx.data.assets || [], 'value') },
    { group:'Ativo calculado', description:'Contas a receber', category:'Créditos', value:m.receivablesOpenTotal },
    { group:'Ativo calculado', description:'Estoque a custo médio', category:'Estoques', value:m.inventoryAsset },
    ...(ctx.data.liabilities || []).map(item => ({ group:'Passivo cadastrado', description:item.name, category:labelize(item.category), value:-num(item.value) })),
    { group:'Passivo calculado', description:'Contas a pagar', category:'Obrigações', value:-m.payablesOpenTotal },
    { group:'Patrimônio líquido', description:'Ativos menos passivos', category:'Patrimônio', value:m.equity },
  ]
  return result([col('group','Grupo','text',22), col('description','Descrição','text',34), col('category','Categoria'), col('value','Valor','currency',18)], rows, [['Total de ativos',m.assetsTotal],['Total de passivos',m.liabilitiesTotal],['Patrimônio líquido',m.equity]], ['Liquidações aproximadas são identificadas no relatório de qualidade dos dados.', 'Balanço gerencial; não substitui balanço contábil.'], 'Posição patrimonial calculada pelo razão canônico até a data-base, somando ativos cadastrados, caixa e contas a receber, menos passivos cadastrados e contas a pagar.')
}

function stockAt(data, product, endDate) {
  const purchases = (data.productPurchases || []).filter(item => item.status !== 'cancelado' && item.productId === product.id && onOrBefore(item.purchaseDate, endDate)).reduce((acc,item) => acc + num(item.quantity), 0)
  const sales = (data.productSales || []).filter(item => item.paymentStatus !== 'cancelado' && item.productId === product.id && onOrBefore(item.saleDate, endDate)).reduce((acc,item) => acc + num(item.quantity), 0)
  return num(product.stock) + purchases - sales
}

function buildStockPosition(ctx) {
  const snapshotData = {
    ...ctx.data,
    productPurchases:(ctx.data.productPurchases || []).filter(item => onOrBefore(item.purchaseDate, ctx.range.end)),
    productSales:(ctx.data.productSales || []).filter(item => onOrBefore(item.saleDate, ctx.range.end)),
  }
  const costing = buildProductCosting(snapshotData)
  const rows = (ctx.data.products || []).map(item => {
    const stock = stockAt(ctx.data, item, ctx.range.end)
    const averageCost = num(costing.averageByProduct[item.id])
    return { product:item.name, category:labelize(item.category), active:item.active === false ? 'Inativo' : 'Ativo', stock, purchasePrice:averageCost, inventoryValue:stock * averageCost, salePrice:num(item.salePrice), potentialRevenue:stock * num(item.salePrice), potentialMargin:stock * (num(item.salePrice) - averageCost) }
  }).sort((a,b) => b.inventoryValue - a.inventoryValue)
  return result([col('product','Produto','text',30),col('category','Categoria'),col('active','Status', 'text', 12),col('stock','Saldo','number',12),col('purchasePrice','Custo médio histórico','currency',18),col('inventoryValue','Valor em estoque','currency',18),col('salePrice','Preço de venda','currency',16),col('potentialRevenue','Receita potencial','currency',18),col('potentialMargin','Margem potencial','currency',18)], rows, [['Unidades em estoque',sum(rows,'stock')],['Valor do estoque',sum(rows,'inventoryValue')],['Receita potencial',sum(rows,'potentialRevenue')]], [], 'Saldo e valorização na data-base pelo custo médio móvel das entradas históricas; cancelados são excluídos.')
}

function buildStockMovements(ctx) {
  const products = productMap(ctx.data)
  const running = new Map()
  ;(ctx.data.products || []).forEach(product => {
    const beforeRange = ctx.range.start ? previousDate(ctx.range.start) : ''
    running.set(product.id, stockAt(ctx.data, product, beforeRange))
  })
  const movements = [
    ...(ctx.data.productPurchases || []).filter(item => item.status !== 'cancelado' && inRange(item.purchaseDate, ctx.range)).map(item => ({ date:item.purchaseDate, productId:item.productId, type:'Entrada', document:item.id, quantity:num(item.quantity), unitValue:num(item.quantity) ? num(item.totalValue) / num(item.quantity) : 0, totalValue:num(item.totalValue), party:item.supplier || '' })),
    ...(ctx.data.productSales || []).filter(item => item.paymentStatus !== 'cancelado' && inRange(item.saleDate, ctx.range)).map(item => ({ date:item.saleDate, productId:item.productId, type:'Saída', document:item.id, quantity:-num(item.quantity), unitValue:num(item.unitValue), totalValue:num(item.totalValue), party:item.patientName || '' })),
  ].sort((a,b) => a.date.localeCompare(b.date) || a.productId.localeCompare(b.productId))
  const rows = movements.map(item => {
    const balance = num(running.get(item.productId)) + item.quantity
    running.set(item.productId, balance)
    return { date:item.date, product:products.get(item.productId)?.name || 'Produto não encontrado', type:item.type, document:item.document, party:item.party, quantity:item.quantity, unitValue:item.unitValue, totalValue:item.totalValue, balance }
  })
  return result([col('date','Data','date',14),col('product','Produto','text',30),col('type','Movimento', 'text', 12),col('document','ID','text',38),col('party','Fornecedor/cliente','text',26),col('quantity','Quantidade','number',14),col('unitValue','Valor unitário','currency',16),col('totalValue','Valor total','currency',16),col('balance','Saldo após movimento','number',18)], rows, [['Entradas (un.)',rows.filter(i=>i.quantity>0).reduce((a,i)=>a+i.quantity,0)],['Saídas (un.)',-rows.filter(i=>i.quantity<0).reduce((a,i)=>a+i.quantity,0)],['Movimentações',rows.length]], [], 'Histórico derivado exclusivamente das compras e vendas de produtos registradas.')
}

function buildProductSales(ctx) {
  const products = productMap(ctx.data)
  const rows = (ctx.data.productSales || []).filter(item => item.paymentStatus !== 'cancelado' && inRange(item.saleDate,ctx.range)).map(item => ({ date:item.saleDate, competenceDate:item.competenceDate || item.saleDate, product:products.get(item.productId)?.name || 'Produto não encontrado', category:labelize(products.get(item.productId)?.category), customer:item.patientName || 'Não informado', status:labelize(item.paymentStatus || 'a conferir'), quantity:num(item.quantity), unitValue:num(item.unitValue), totalValue:num(item.totalValue), paymentMethod:paymentMethodLabel(item.paymentMethod) })).sort((a,b)=>a.date.localeCompare(b.date))
  return result([col('date','Data da venda','date',14),col('competenceDate','Competência','date',14),col('product','Produto','text',30),col('category','Categoria'),col('customer','Cliente','text',26),col('status','Situação'),col('quantity','Quantidade','number',12),col('unitValue','Valor unitário','currency',16),col('totalValue','Valor total','currency',16),col('paymentMethod','Forma de pagamento','text',20)],rows,[['Faturamento',sum(rows,'totalValue')],['Unidades vendidas',sum(rows,'quantity')],['Vendas',rows.length]],['Vendas canceladas são excluídas dos totais. A auditoria sinaliza recebimentos sem data própria.'],'Vendas operacionais efetivas registradas no módulo de produtos.')
}

function buildProductPurchases(ctx) {
  const products = productMap(ctx.data)
  const rows = (ctx.data.productPurchases || []).filter(item => item.status !== 'cancelado' && inRange(item.purchaseDate,ctx.range)).map(item => ({ date:item.purchaseDate, competenceDate:item.competenceDate || item.purchaseDate, dueDate:item.dueDate || item.purchaseDate, paymentDate:item.paymentDate || '', product:products.get(item.productId)?.name || 'Produto não encontrado', category:labelize(products.get(item.productId)?.category), supplier:item.supplier || 'Não informado', status:labelize(item.status || 'a conferir'), quantity:num(item.quantity), unitCost:num(item.quantity) ? num(item.totalValue)/num(item.quantity) : 0, totalValue:num(item.totalValue) })).sort((a,b)=>a.date.localeCompare(b.date))
  return result([col('date','Data da compra','date',14),col('competenceDate','Competência','date',14),col('dueDate','Vencimento','date',14),col('paymentDate','Pagamento','date',14),col('product','Produto','text',30),col('category','Categoria'),col('supplier','Fornecedor','text',26),col('status','Situação'),col('quantity','Quantidade','number',12),col('unitCost','Custo unitário','currency',16),col('totalValue','Valor total','currency',16)],rows,[['Compras',sum(rows,'totalValue')],['Unidades compradas',sum(rows,'quantity')],['Lançamentos',rows.length]],['Compras canceladas são excluídas dos totais.'],'Compras efetivas de estoque registradas no período operacional.')
}

function productSalesAggregation(ctx) {
  const products = productMap(ctx.data)
  const costing = buildProductCosting(ctx.data)
  const grouped = new Map()
  ;(ctx.data.productSales || []).filter(item => item.paymentStatus !== 'cancelado' && inRange(item.competenceDate || item.saleDate,ctx.range)).forEach(item => {
    const product = products.get(item.productId)
    const current = grouped.get(item.productId) || { product:product?.name || 'Produto não encontrado', category:labelize(product?.category), quantity:0, revenue:0, cost:0 }
    current.quantity += num(item.quantity)
    current.revenue += num(item.totalValue)
    current.cost += num(costing.salesCost[item.id]?.totalCost)
    grouped.set(item.productId,current)
  })
  return [...grouped.values()].sort((a,b)=>b.revenue-a.revenue)
}

function applyAbc(rows, valueKey) {
  const total = sum(rows,valueKey)
  let cumulative = 0
  return rows.map((item,index) => {
    const share = total ? num(item[valueKey])/total : 0
    cumulative += share
    return { ...item, position:index+1, share, cumulative, curve:cumulative <= 0.8 ? 'A' : cumulative <= 0.95 ? 'B' : 'C' }
  })
}

function buildProductAbc(ctx) {
  const rows = applyAbc(productSalesAggregation(ctx),'revenue')
  return result([col('position','Posição','integer',10),col('product','Produto','text',30),col('category','Categoria'),col('quantity','Quantidade vendida','number',18),col('revenue','Faturamento','currency',16),col('share','% individual','percent',14),col('cumulative','% acumulado','percent',14),col('curve','Curva','text',10)],rows,[['Faturamento',sum(rows,'revenue')],['Produtos vendidos',rows.length]],[], 'Classificação Olist/ABC por faturamento acumulado: A até 80%, B de 80% a 95%, C acima de 95%.')
}

function buildContributionMargin(ctx) {
  const rows = productSalesAggregation(ctx).map(item => { const margin=item.revenue-item.cost; return {...item,margin,marginPercent:item.revenue?margin/item.revenue:0} })
  return result([col('product','Produto','text',30),col('category','Categoria'),col('quantity','Quantidade','number',12),col('revenue','Faturamento','currency',16),col('cost','CMV histórico','currency',16),col('margin','Margem de contribuição','currency',20),col('marginPercent','Margem %','percent',14)],rows,[['Faturamento',sum(rows,'revenue')],['CMV',sum(rows,'cost')],['Margem',sum(rows,'margin')]],['Impostos, taxas e comissões específicos da venda ainda não estão abatidos nesta margem.'],'Margem = faturamento − CMV pelo custo médio móvel vigente na data de cada venda.')
}

function surgeryCost(item) {
  const invoiceTax = item.invoiceTaxAmount != null ? num(item.invoiceTaxAmount) : num(item.totalValue)*num(item.invoiceIssuancePercent)/100
  return num(item.hospitalCost)+num(item.anesthesiaCost)+num(item.materialCost)+num(item.otherCosts)+invoiceTax
}

function buildSurgeries(ctx) {
  const procedures=procedureMap(ctx.data)
  const rows=(ctx.data.surgeries||[]).filter(item=>inRange(item.date,ctx.range)).map(item=>{const cost=surgeryCost(item);const canceled=item.paymentStatus==='cancelado';return { date:item.date, competenceDate:item.competenceDate||item.date, patient:item.patient||'', procedure:procedures.get(item.procedureId)||'Não informado', surgeon:item.surgeon||'Não informado', status:labelize(item.paymentStatus), paymentDate:item.paymentDate||'', dueDate:item.dueDate||item.date, paymentMethod:paymentMethodLabel(item.paymentMethod), revenue:canceled?0:num(item.totalValue), cost:canceled?0:cost, profit:canceled?0:num(item.totalValue)-cost }}).sort((a,b)=>a.date.localeCompare(b.date))
  return result([col('date','Data','date',14),col('competenceDate','Competência','date',14),col('patient','Paciente','text',28),col('procedure','Procedimento','text',28),col('surgeon','Cirurgião','text',24),col('status','Pagamento'),col('paymentDate','Recebimento','date',14),col('dueDate','Vencimento','date',14),col('paymentMethod','Forma de pagamento','text',20),col('revenue','Receita','currency',16),col('cost','Custo','currency',16),col('profit','Resultado','currency',16)],rows,[['Receita',sum(rows,'revenue')],['Custos',sum(rows,'cost')],['Resultado',sum(rows,'profit')],['Cirurgias',rows.length]],['Os custos cirúrgicos não possuem status/data própria de pagamento; são atribuídos à cirurgia.'],'Cirurgias pela data operacional; valores de resultado usam receita menos custos informados e percentual de emissão de nota.')
}

function buildConsultations(ctx) {
  const rows=(ctx.data.consultations||[]).filter(item=>inRange(item.date,ctx.range)).map(item=>{const cost=item.invoiceTaxAmount != null ? num(item.invoiceTaxAmount) : num(item.value)*num(item.invoiceIssuancePercent)/100;return { date:item.date, competenceDate:item.competenceDate||item.date, patient:item.patient||'', type:labelize(item.consultationType), paymentType:labelize(item.paymentType), insurance:item.insurance||'', status:labelize(item.paymentStatus), forecastDate:item.forecastPaymentDate||'', paymentDate:item.paymentDate||'', paymentMethod:paymentMethodLabel(item.paymentMethod), revenue:item.paymentStatus==='cancelado'?0:num(item.value), cost:item.paymentStatus==='cancelado'?0:cost, net:item.paymentStatus==='cancelado'?0:num(item.value)-cost }}).sort((a,b)=>a.date.localeCompare(b.date))
  return result([col('date','Data','date',14),col('competenceDate','Competência','date',14),col('patient','Paciente','text',28),col('type','Tipo'),col('paymentType','Atendimento'),col('insurance','Convênio'),col('status','Pagamento'),col('forecastDate','Previsão','date',14),col('paymentDate','Recebimento','date',14),col('paymentMethod','Forma de pagamento','text',20),col('revenue','Receita','currency',16),col('cost','Custo NF','currency',16),col('net','Resultado','currency',16)],rows,[['Receita',sum(rows,'revenue')],['Resultado',sum(rows,'net')],['Consultas',rows.length]],[], 'Consultas pela data operacional, com situação de pagamento e custo de emissão de nota informado.')
}

function buildProcedurePerformance(ctx) {
  const rows=(ctx.data.procedures||[]).map(procedure=>{const surgeries=(ctx.data.surgeries||[]).filter(item=>item.procedureId===procedure.id&&item.paymentStatus!=='cancelado'&&inRange(item.competenceDate||item.date,ctx.range));const revenue=surgeries.reduce((a,i)=>a+num(i.totalValue),0);const costs=surgeries.reduce((a,i)=>a+surgeryCost(i),0);return { procedure:procedure.name, surgeries:surgeries.length, revenue, costs, profit:revenue-costs, margin:revenue?(revenue-costs)/revenue:0, averageTicket:surgeries.length?revenue/surgeries.length:0 }}).filter(item=>item.surgeries>0).sort((a,b)=>b.profit-a.profit)
  return result([col('procedure','Procedimento','text',30),col('surgeries','Cirurgias','integer',12),col('revenue','Receita','currency',16),col('costs','Custos','currency',16),col('profit','Resultado','currency',16),col('margin','Margem','percent',14),col('averageTicket','Ticket médio','currency',16)],rows,[['Receita',sum(rows,'revenue')],['Resultado',sum(rows,'profit')],['Cirurgias',sum(rows,'surgeries')]],[], 'Agrupamento de cirurgias não canceladas pela data de competência e procedimento vinculado.')
}

function buildPatients(ctx) {
  const rows=ctx.patients.map(item=>({ name:item.full_name||'',cpf:item.cpf||'',birthDate:item.date_of_birth||'',sex:labelize(item.sex),phone:item.phone||'',email:item.email||'',profession:item.profession||'',city:item.address_city||'',state:item.address_state||'',startDate:item.start_date||'',consent:item.consent_signed?'Assinado':'Pendente',consentDate:item.consent_date||'',status:item.active===false?'Arquivado':'Ativo',createdAt:String(item.created_at||'').slice(0,10) })).sort((a,b)=>a.name.localeCompare(b.name))
  return result([col('name','Nome','text',30),col('cpf','CPF','text',16),col('birthDate','Nascimento','date',14),col('sex','Sexo'),col('phone','Telefone','text',18),col('email','E-mail','text',30),col('profession','Profissão'),col('city','Cidade'),col('state','UF','text',8),col('startDate','Início','date',14),col('consent','TCLE'),col('consentDate','Data TCLE','date',14),col('status','Status'),col('createdAt','Cadastro','date',14)],rows,[['Pacientes',rows.length],['Ativos',rows.filter(i=>i.status==='Ativo').length],['TCLE pendente',rows.filter(i=>i.consent==='Pendente').length]],['Contém dados pessoais protegidos pela LGPD. Compartilhe somente com pessoas autorizadas. Dados clínicos e de anamnese não são incluídos.'],'Cadastro administrativo de pacientes. O período não restringe a base; a data final funciona como referência de geração.')
}

function patientFinancialRows(ctx) {
  const patientById=new Map(ctx.patients.map(item=>[item.id,item]))
  const grouped=new Map()
  const add=(patientId,name,type,value)=>{const key=patientId||`name:${String(name||'Não informado').trim().toLowerCase()}`;const patient=patientById.get(patientId);const current=grouped.get(key)||{ patient:patient?.full_name||name||'Não informado',cpf:patient?.cpf||'',surgeries:0,consultations:0,products:0,revenue:0,linked:Boolean(patientId&&patient) };current[type]+=1;current.revenue+=num(value);grouped.set(key,current)}
  ;(ctx.data.surgeries||[]).filter(i=>i.paymentStatus!=='cancelado'&&inRange(i.competenceDate||i.date,ctx.range)).forEach(i=>add(i.patientId,i.patient,'surgeries',i.totalValue))
  ;(ctx.data.consultations||[]).filter(i=>i.paymentStatus!=='cancelado'&&inRange(i.competenceDate||i.date,ctx.range)).forEach(i=>add(i.patientId,i.patient,'consultations',i.value))
  ;(ctx.data.productSales||[]).filter(i=>i.paymentStatus!=='cancelado'&&inRange(i.competenceDate||i.saleDate,ctx.range)).forEach(i=>add(i.patientId,i.patientName,'products',i.totalValue))
  return [...grouped.values()].sort((a,b)=>b.revenue-a.revenue)
}

function buildPatientFinancial(ctx) {
  const rows=patientFinancialRows(ctx)
  return result([col('patient','Paciente','text',30),col('cpf','CPF','text',16),col('surgeries','Cirurgias','integer',12),col('consultations','Consultas','integer',12),col('products','Compras de produtos','integer',18),col('revenue','Faturamento','currency',16),col('linked','Vínculo por ID','boolean',14)],rows,[['Faturamento',sum(rows,'revenue')],['Clientes com movimento',rows.length]],['Registros antigos sem patient_id são agrupados pelo nome exato e podem gerar duplicidades. Vendas de produtos atualmente guardam apenas o nome do paciente.'],'Faturamento por competência, agrupado prioritariamente pelo identificador do paciente e, quando ausente, pelo nome informado.')
}

function buildPatientAbc(ctx) {
  const rows=applyAbc(patientFinancialRows(ctx),'revenue')
  return result([col('position','Posição','integer',10),col('patient','Paciente','text',30),col('cpf','CPF','text',16),col('revenue','Faturamento','currency',16),col('share','% individual','percent',14),col('cumulative','% acumulado','percent',14),col('curve','Curva','text',10)],rows,[['Faturamento',sum(rows,'revenue')],['Clientes',rows.length]],['Registros antigos sem patient_id são agrupados pelo nome exato e podem gerar duplicidades.'],'Classificação ABC por faturamento acumulado: A até 80%, B de 80% a 95%, C acima de 95%.')
}

function buildGoals(ctx) {
  const m=buildMetrics({ ...ctx.data,recurrences:ctx.recurrences })
  const actual={faturamento:m.grossRevenue,lucro:m.netProfit,cirurgias:m.surgeriesCompleted,consultas:m.consultationsCompleted}
  const rows=(ctx.data.goals||[]).map(item=>{const realized=num(actual[item.metric]);const target=num(item.target);return{name:item.name,metric:labelize(item.metric),period:labelize(item.period),dueDate:item.dueDate||'',target,realized,progress:target?realized/target:0,status:target&&realized>=target?'Atingida':'Em andamento'}})
  return result([col('name','Meta','text',30),col('metric','Indicador'),col('period','Período'),col('dueDate','Prazo','date',14),col('target','Alvo','number',16),col('realized','Realizado','number',16),col('progress','Progresso','percent',14),col('status','Situação')],rows,[['Metas',rows.length],['Atingidas',rows.filter(i=>i.status==='Atingida').length]],['O realizado usa os indicadores acumulados disponíveis; metas sem janela temporal própria não podem ser reconciliadas por competência.'],'Metas cadastradas comparadas aos indicadores acumulados do sistema.')
}

function buildDataQuality(ctx) {
  const rows=[]
  const add=(severity,domain,recordId,record,issue,impact)=>rows.push({severity,domain,recordId,record,issue,impact})
  ;(ctx.data.surgeries||[]).forEach(i=>{if(!i.patientId)add('Atenção','Cirurgias',i.id,i.patient,'Paciente sem vínculo por ID','Pode duplicar relatórios por cliente.');if(!i.competenceDate)add('Atenção','Cirurgias',i.id,i.patient,'Competência ausente','O sistema usa a data da cirurgia.');if(i.paymentStatus==='pago'&&!i.paymentDate)add('Crítico','Cirurgias',i.id,i.patient,'Pago sem data de recebimento','Fluxo de caixa usa data operacional.');if(num(i.totalValue)<0)add('Crítico','Cirurgias',i.id,i.patient,'Valor negativo','Distorce faturamento e resultado.')})
  ;(ctx.data.consultations||[]).forEach(i=>{if(!i.patientId)add('Atenção','Consultas',i.id,i.patient,'Paciente sem vínculo por ID','Pode duplicar relatórios por cliente.');if(i.paymentStatus==='pago'&&!i.paymentDate)add('Crítico','Consultas',i.id,i.patient,'Pago sem data de recebimento','Fluxo de caixa pode usar data operacional.');if(i.paymentType!=='particular'&&!i.insurance)add('Atenção','Consultas',i.id,i.patient,'Convênio não informado','Análise por convênio fica incompleta.')})
  ;(ctx.data.productSales||[]).forEach(i=>{if(!i.patientName)add('Atenção','Vendas de produtos',i.id,'Venda','Cliente não informado','Relatório por cliente fica incompleto.');if(!i.paymentStatus||i.paymentStatus==='legacy_unverified')add('Estrutural','Vendas de produtos',i.id,'Venda','Sem status/data de recebimento','Não é possível provar se o valor entrou no caixa.');else if(i.paymentStatus==='recebido'&&!i.receivedDate)add('Estrutural','Vendas de produtos',i.id,'Venda','Recebimento sem data própria','O caixa usa a data declarada no cronograma ou na venda.')})
  ;(ctx.data.productPurchases||[]).forEach(i=>{if(!i.supplier)add('Atenção','Compras de produtos',i.id,'Compra','Fornecedor não informado','Relatório por fornecedor fica incompleto.');if(!i.status||i.status==='legacy_unverified')add('Estrutural','Compras de produtos',i.id,'Compra','Sem status/data de pagamento','Não é possível classificar a obrigação com fidelidade.');else if(i.status==='pago'&&!i.paymentDate)add('Crítico','Compras de produtos',i.id,'Compra','Paga sem data de pagamento','O caixa usa a data da compra como aproximação.')})
  ;(ctx.data.expenses||[]).forEach(i=>{if(!i.competenceDate)add('Atenção','Despesas',i.id,i.description,'Competência ausente','O sistema usa o vencimento.');if(i.status==='pago'&&!i.paymentDate)add('Crítico','Despesas',i.id,i.description,'Paga sem data de pagamento','Fluxo usa o vencimento como aproximação.')})
  ;(ctx.data.products||[]).forEach(i=>{if(num(i.purchasePrice)<=0)add('Atenção','Produtos',i.id,i.name,'Custo de compra zerado','Margem e valor do estoque podem ficar incorretos.');if(stockAt(ctx.data,i,ctx.range.end)<0)add('Crítico','Produtos',i.id,i.name,'Estoque negativo','Indica venda sem saldo ou movimentação ausente.')})
  const order={Crítico:0,Atenção:1,Estrutural:2}
  rows.sort((a,b)=>(order[a.severity]??9)-(order[b.severity]??9)||a.domain.localeCompare(b.domain))
  return result([col('severity','Severidade', 'text', 14),col('domain','Área'),col('recordId','ID','text',38),col('record','Registro','text',28),col('issue','Pendência','text',34),col('impact','Impacto no relatório','text',46)],rows,[['Pendências',rows.length],['Críticas',rows.filter(i=>i.severity==='Crítico').length],['Estruturais',rows.filter(i=>i.severity==='Estrutural').length]],['Itens “Estruturais” dependem de novos campos no modelo de dados e não podem ser resolvidos apenas na exportação.'],'Auditoria automática de campos e vínculos que impactam caixa, competência, estoque, margem e agrupamento por paciente.')
}

function sum(rows,key) {
  return rows.reduce((total,item)=>total+num(item[key]),0)
}

function previousDate(value) {
  if (!value) return ''
  const date=new Date(`${value}T00:00:00`)
  if(Number.isNaN(date.getTime()))return''
  date.setDate(date.getDate()-1)
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

