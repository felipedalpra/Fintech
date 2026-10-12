// financialLedger.js — Fase 1 (fundação) do razão financeiro canônico.
//
// PURO e testável: deriva `financial_entries` (títulos) + `financial_installments` (parcelas) a partir
// do dataset atual, reusando a MESMA função canônica de cronograma (`paymentScheduleFlow`) que o
// `buildMetrics` e os relatórios já usam — então o razão bate com o resto do sistema por construção.
//
// É uma PROJEÇÃO canônica derivada dos registros operacionais. Desde a Fase 10, buildMetrics e seus
// consumidores financeiros leem desta projeção; a autoridade de cada campo migra gradualmente.
// Design: docs/superpowers/specs/2026-10-12-financial-core-ledger-design.md
import { paymentScheduleFlow } from './paymentScheduleFlow.js'

function num(v) { return Number(v) || 0 }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

function statusFromAmounts(paid, open, canceled) {
  if (canceled) return 'canceled'
  if (paid <= 0) return open <= 0 ? 'paid' : 'pending' // total 0 e não cancelado → 'paid' (quitado trivialmente)
  if (open <= 0) return 'paid'
  return 'partially_paid'
}

// Numera e ordena as parcelas (pagas + abertas) de um item com cronograma.
function installmentsFromFlow(flow, canceled) {
  const all = [
    ...(flow.paidInstallments || []).map(p => ({ amount: round2(p.amount), due_date: p.date || null, settlement_date: p.date || null, status: 'paid' })),
    ...(flow.openInstallments || []).map(o => ({ amount: round2(o.amount), due_date: o.date || null, settlement_date: null, status: 'pending' })),
  ].sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
  all.forEach((x, i) => {
    x.installment_number = i + 1
    if (canceled) { x.status = 'canceled' }
  })
  return all
}

// Título com cronograma (cirurgia/consulta) — direção 'receivable'.
function scheduledEntry({ sourceType, item, total, competenceDate, issueDate, partyName }) {
  const canceled = item.paymentStatus === 'cancelado'
  const flow = paymentScheduleFlow(total, item)
  const installments = installmentsFromFlow(flow, canceled)
  const paid = canceled ? 0 : round2(flow.paidAmount)
  const open = canceled ? 0 : round2(flow.openAmount)
  return {
    entry: {
      source_type: sourceType, source_id: item.id, source_component: 'revenue', direction: 'receivable',
      party_type: 'patient', party_id: item.patientId || null, party_name_snapshot: partyName || '',
      competence_date: competenceDate || null, issue_date: issueDate || null,
      total_amount: round2(total), status: statusFromAmounts(paid, open, canceled),
    },
    installments,
  }
}

// Título de parcela única (venda/compra/receita extra/despesa).
function invoiceTax(base, percent) {
  const p = Math.max(0, Math.min(100, num(percent)))
  return round2(num(base) * (p / 100))
}

// Imposto de NF: usa o valor CONGELADO (invoiceTaxAmount) quando existir — assim mudar a alíquota
// no futuro não altera relatórios antigos. Sem o congelado, deriva da alíquota (projeção).
function frozenOrDerivedTax(item, base) {
  if (item.invoiceTaxAmount != null) return round2(item.invoiceTaxAmount)
  return invoiceTax(base, item.invoiceIssuancePercent)
}

function singleEntry({ sourceType, sourceComponent, direction, item, total, competenceDate, issueDate, dueDate,
  paidDate, isPaid, canceled, partyType, partyId, partyName, category, costCenter }) {
  const paid = canceled ? 0 : (isPaid ? round2(total) : 0)
  const open = canceled ? 0 : (isPaid ? 0 : round2(total))
  const installment = {
    installment_number: 1,
    amount: round2(total),
    due_date: dueDate || null,
    settlement_date: isPaid && !canceled ? (paidDate || dueDate || null) : null,
    status: canceled ? 'canceled' : (isPaid ? 'paid' : 'pending'),
  }
  return {
    entry: {
      source_type: sourceType, source_id: item.id, source_component: sourceComponent || 'revenue', direction,
      party_type: partyType || 'other', party_id: partyId || item.patientId || null, party_name_snapshot: partyName || '',
      category: category || null, cost_center: costCenter || null,
      competence_date: competenceDate || null, issue_date: issueDate || null,
      total_amount: round2(total), status: statusFromAmounts(paid, open, canceled),
    },
    installments: total > 0 ? [installment] : [],
  }
}

// Custos de cirurgia/consulta como títulos A PAGAR independentes (hospital, anestesia, material,
// outros, imposto de NF). Modelo atual = caixa na data do atendimento → projeção = pago nessa data.
// Depois (autoridade) cada custo pode ganhar vencimento/fornecedor/status próprios.
function pushCostEntries(parts, item, sourceType, baseValue) {
  if (item.paymentStatus === 'cancelado') return
  const date = item.date
  const competence = item.competenceDate || item.date
  const components = sourceType === 'surgery'
    ? [
      ['hospital_cost', item.hospitalCost],
      ['anesthesia_cost', item.anesthesiaCost],
      ['material_cost', item.materialCost],
      ['other_cost', item.otherCosts],
      ['invoice_tax', frozenOrDerivedTax(item, baseValue)],
    ]
    : [['invoice_tax', frozenOrDerivedTax(item, baseValue)]]
  for (const [component, raw] of components) {
    const value = round2(raw)
    if (value <= 0) continue
    parts.push(singleEntry({
      sourceType, sourceComponent: component, direction: 'payable', item, total: value,
      competenceDate: competence, issueDate: date, dueDate: date, paidDate: date,
      isPaid: true, canceled: false,
      partyType: 'other',
      partyName: `${sourceType === 'surgery' ? 'Custo cirúrgico' : 'Custo consulta'} - ${item.patient || ''}`,
      category: sourceType === 'surgery' ? 'custo_cirurgico' : 'custo_consulta',
    }))
  }
}

// Monta o razão (entries + installments) a partir do dataset. Puro.
export function buildLedger(data = {}) {
  const surgeries = data.surgeries || []
  const consultations = data.consultations || []
  const productSales = data.productSales || []
  const productPurchases = data.productPurchases || []
  const extraRevenues = data.extraRevenues || []
  const expenses = data.expenses || []

  const parts = []

  surgeries.forEach(item => {
    parts.push(scheduledEntry({
      sourceType: 'surgery', item, total: item.totalValue || 0,
      competenceDate: item.competenceDate || item.date, issueDate: item.date, partyName: item.patient,
    }))
    pushCostEntries(parts, item, 'surgery', item.totalValue || 0)
  })

  consultations.forEach(item => {
    parts.push(scheduledEntry({
      sourceType: 'consultation', item, total: item.value || 0,
      competenceDate: item.competenceDate || item.date, issueDate: item.date, partyName: item.patient,
    }))
    pushCostEntries(parts, item, 'consultation', item.value || 0)
  })

  // Venda de produto: usa o mesmo cronograma canônico das demais receitas. "Recebido" quita as
  // parcelas nas datas declaradas; pendente/legacy_unverified permanece em aberto; cancelado não
  // entra nos resultados. receivedDate é a data real de caixa; saleDate nunca a substitui como fato
  // confirmado, embora o legado ainda mantenha o fallback visível e bloqueado pela auditoria.
  productSales.forEach(item => {
    const normalized = {
      ...item,
      date:item.saleDate,
      dueDate:item.dueDate || item.saleDate,
      paymentStatus:item.paymentStatus === 'recebido' ? 'pago' : item.paymentStatus,
      paymentDate:item.receivedDate || item.paymentDate || '',
    }
    parts.push(scheduledEntry({
      sourceType:'product_sale', item:normalized, total:item.totalValue || 0,
      competenceDate:item.competenceDate || item.saleDate, issueDate:item.saleDate, partyName:item.patientName,
    }))
  })

  // Compra de produto: paga → caixa em paymentDate||purchaseDate; a pagar/legacy_unverified → em
  // aberto no vencimento; cancelada → cancelada. Fornecedor vinculado por supplier_id.
  productPurchases.forEach(item => parts.push(singleEntry({
    sourceType: 'product_purchase', direction: 'payable', item, total: item.totalValue || 0,
    competenceDate: item.competenceDate || item.purchaseDate, issueDate: item.purchaseDate,
    dueDate: item.dueDate || item.purchaseDate, paidDate: item.paymentDate || item.purchaseDate,
    isPaid: item.status === 'pago', canceled: item.status === 'cancelado',
    partyType: 'supplier', partyId: item.supplierId || null, partyName: item.supplier || '', category: 'compra_produto',
  })))

  // Receita extra: recebida (status padrão 'recebido') → caixa em received_date||date; senão em aberto.
  extraRevenues.forEach(item => {
    const received = (item.status || 'recebido') === 'recebido'
    parts.push(singleEntry({
      sourceType: 'extra_revenue', direction: 'receivable', item, total: item.value || 0,
      competenceDate: item.competenceDate || item.date, issueDate: item.date || item.competenceDate || item.dueDate,
      dueDate: item.dueDate || item.date, paidDate: item.receivedDate || item.date,
      isPaid: received, canceled: item.status === 'cancelado',
      partyType: item.patientId ? 'patient' : 'other', partyId: item.patientId || null,
      partyName: item.patient || item.description || '', category: item.category || 'outras_receitas',
      costCenter: item.originLabel || null,
    }))
  })

  // Despesa: paga → caixa em paymentDate||dueDate; cancelada → canceled; senão em aberto no vencimento.
  expenses.forEach(item => parts.push(singleEntry({
    sourceType: 'expense', direction: 'payable', item, total: item.value || 0,
    competenceDate: item.competenceDate || item.dueDate, issueDate: item.dueDate,
    dueDate: item.dueDate, paidDate: item.paymentDate || item.dueDate,
    isPaid: item.status === 'pago', canceled: item.status === 'cancelado',
    partyType: 'supplier', partyId: item.supplierId || null,
    partyName: item.supplier || item.description || '', category: item.category || null,
    costCenter: item.originLabel || null,
  })))

  const entries = parts.map(p => p.entry)
  const installments = parts.map(p => p.installments)
  return { entries, installments } // installments[i] pertence a entries[i]
}

// Reconciliação RAZÃO × FONTE: por tipo de origem, soma do dado bruto vs soma dos títulos do razão.
// Deve bater a centavo (prova que o razão capturou todos os registros, sem perder nem duplicar).
// Também devolve os totais derivados do razão (aberto/liquidado) para a comparação com o dashboard.
export function reconcileLedger(data = {}) {
  const notCanceled = (arr, statusKey) => (arr || []).filter(i => i[statusKey] !== 'cancelado')
  const sumBy = (arr, f) => round2((arr || []).reduce((a, i) => a + num(f(i)), 0))
  const { entries, installments } = buildLedger(data)
  const ledgerSum = (type, component) => round2(entries
    .filter(e => e.source_type === type && e.source_component === component && e.status !== 'canceled')
    .reduce((a, e) => a + e.total_amount, 0))

  const surgeries = data.surgeries || []
  const consults = data.consultations || []
  const rawSurgeryCost = sumBy(notCanceled(surgeries, 'paymentStatus'), s =>
    num(s.hospitalCost) + num(s.anesthesiaCost) + num(s.materialCost) + num(s.otherCosts) + frozenOrDerivedTax(s, s.totalValue))
  const rawConsultCost = sumBy(notCanceled(consults, 'paymentStatus'), c => frozenOrDerivedTax(c, c.value))

  const sources = [
    { label: 'Cirurgias (receita)', raw: sumBy(notCanceled(surgeries, 'paymentStatus'), s => s.totalValue), ledger: ledgerSum('surgery', 'revenue') },
    { label: 'Consultas (receita)', raw: sumBy(notCanceled(consults, 'paymentStatus'), c => c.value), ledger: ledgerSum('consultation', 'revenue') },
    { label: 'Vendas de produto', raw: sumBy(notCanceled(data.productSales, 'paymentStatus'), s => s.totalValue), ledger: ledgerSum('product_sale', 'revenue') },
    { label: 'Receitas extras', raw: sumBy(notCanceled(data.extraRevenues, 'status'), r => r.value), ledger: ledgerSum('extra_revenue', 'revenue') },
    { label: 'Despesas', raw: sumBy(notCanceled(data.expenses, 'status'), e => e.value), ledger: ledgerSum('expense', 'revenue') },
    { label: 'Compras de produto', raw: sumBy(notCanceled(data.productPurchases, 'status'), p => p.totalValue), ledger: ledgerSum('product_purchase', 'revenue') },
    { label: 'Custos de cirurgia', raw: rawSurgeryCost, ledger: round2(['hospital_cost', 'anesthesia_cost', 'material_cost', 'other_cost', 'invoice_tax'].reduce((a, c) => a + ledgerSum('surgery', c), 0)) },
    { label: 'Custos de consulta (NF)', raw: rawConsultCost, ledger: ledgerSum('consultation', 'invoice_tax') },
  ].map(r => ({ ...r, diff: round2(r.raw - r.ledger) }))

  // Totais derivados do razão (para comparar com o dashboard).
  let receivableOpen = 0, payableOpen = 0, receivablePaid = 0, payablePaid = 0
  entries.forEach((e, i) => {
    if (e.status === 'canceled') return
    const rows = installments[i] || []
    const paid = round2(rows.filter(r => r.status === 'paid').reduce((a, r) => a + r.amount, 0))
    const open = round2(rows.filter(r => r.status === 'pending' || r.status === 'partially_paid').reduce((a, r) => a + r.amount, 0))
    if (e.direction === 'receivable') { receivablePaid = round2(receivablePaid + paid); receivableOpen = round2(receivableOpen + open) }
    else { payablePaid = round2(payablePaid + paid); payableOpen = round2(payableOpen + open) }
  })

  return { sources, totals: { receivableOpen, payableOpen, receivablePaid, payablePaid } }
}

// Auditoria contínua da fonte canônica. Além de conferir totais, aponta registros cuja liquidação
// ainda é inferida pelo modelo legado. Bloqueios indicam que os consumidores devem tratar a métrica
// como não confiável até a correção do fato financeiro de origem.
export function auditLedgerReadiness(data = {}) {
  const ledger = buildLedger(data)
  const reconciliation = reconcileLedger(data)
  const issues = []

  const addIssue = (code, severity, label, records, detail) => {
    const rows = (records || []).filter(Boolean)
    if (rows.length === 0) return
    const ids = rows.slice(0, 3).map(item => item.id).filter(Boolean)
    issues.push({
      code,
      severity,
      label,
      count:rows.length,
      detail,
      sampleIds:ids,
    })
  }

  const invariantProblems = checkLedgerInvariants(ledger)
  if (invariantProblems.length > 0) {
    issues.push({
      code:'ledger_invariant', severity:'blocking', label:'Parcelas inconsistentes',
      count:invariantProblems.length,
      detail:'A soma das parcelas ou a divisão entre pago e aberto não fecha com o total do título.',
      sampleIds:invariantProblems.slice(0, 3).map(item => item.entry),
    })
  }

  const sourceDifferences = reconciliation.sources.filter(item => Math.abs(item.diff) >= 0.01)
  if (sourceDifferences.length > 0) {
    issues.push({
      code:'source_difference', severity:'blocking', label:'Razão diverge da fonte',
      count:sourceDifferences.length,
      detail:'Há origens cuja soma bruta não bate a centavo com os títulos projetados.',
      sampleIds:sourceDifferences.slice(0, 3).map(item => item.label),
    })
  }

  const surgeries = data.surgeries || []
  const consultations = data.consultations || []
  const productSales = data.productSales || []
  const productPurchases = data.productPurchases || []
  const extraRevenues = data.extraRevenues || []
  const expenses = data.expenses || []

  addIssue('legacy_product_sale', 'blocking', 'Vendas antigas sem situação confirmada',
    productSales.filter(item => !item.paymentStatus || item.paymentStatus === 'legacy_unverified'),
    'Confirme cada venda como recebida, a receber ou cancelada.')
  addIssue('legacy_product_purchase', 'blocking', 'Compras antigas sem situação confirmada',
    productPurchases.filter(item => !item.status || item.status === 'legacy_unverified'),
    'Confirme cada compra como paga, a pagar ou cancelada.')

  addIssue('missing_settlement_date', 'blocking', 'Liquidações sem data real', [
    ...surgeries.filter(item => item.paymentStatus === 'pago' && !item.paymentDate),
    ...consultations.filter(item => item.paymentStatus === 'pago' && !item.paymentDate),
    ...productPurchases.filter(item => item.status === 'pago' && !item.paymentDate),
    // `date` era exibido historicamente como "Data do recebimento". Portanto ele é uma
    // liquidação real válida para registros anteriores à coluna received_date, não uma estimativa.
    ...extraRevenues.filter(item => (item.status || 'recebido') === 'recebido' && !item.receivedDate && !item.date),
    ...expenses.filter(item => item.status === 'pago' && !item.paymentDate),
  ], 'O caixa está usando a data operacional ou o vencimento como aproximação.')

  addIssue('legacy_extra_revenue_date', 'warning', 'Receitas usam o campo histórico de recebimento',
    extraRevenues.filter(item => (item.status || 'recebido') === 'recebido' && !item.receivedDate && item.date),
    'A data é válida e continua sendo usada no caixa; ao editar o registro ela pode ser migrada para received_date.')

  addIssue('product_sale_assumed_settlement', 'blocking', 'Vendas recebidas sem data real própria',
    productSales.filter(item => item.paymentStatus === 'recebido' && !item.receivedDate),
    'O caixa ainda usa as datas declaradas no cronograma ou a data da venda; informe received_date para confirmar a liquidação.')

  const costsWithoutSettlement = []
  surgeries.filter(item => item.paymentStatus !== 'cancelado').forEach(item => {
    if ([item.hospitalCost, item.anesthesiaCost, item.materialCost, item.otherCosts]
      .some(value => num(value) > 0) || frozenOrDerivedTax(item, item.totalValue) > 0) costsWithoutSettlement.push(item)
  })
  consultations.filter(item => item.paymentStatus !== 'cancelado').forEach(item => {
    if (frozenOrDerivedTax(item, item.value) > 0) costsWithoutSettlement.push(item)
  })
  addIssue('cost_assumed_settlement', 'blocking', 'Custos usam a data do atendimento',
    costsWithoutSettlement,
    'Custos cirúrgicos e impostos ainda não têm situação, vencimento e data de pagamento próprios.')

  const entriesMissingDates = ledger.entries.flatMap((entry, index) => {
    if (entry.status === 'canceled' || entry.total_amount <= 0) return []
    const rows = ledger.installments[index] || []
    if (!entry.competence_date || !entry.issue_date || rows.some(row => !row.due_date)) {
      return [{ id:`${entry.source_type}:${entry.source_id}` }]
    }
    return []
  })
  addIssue('missing_financial_dates', 'blocking', 'Títulos sem datas obrigatórias', entriesMissingDates,
    'Preencha competência, emissão e vencimento para todos os títulos com valor.')

  addIssue('missing_patient_link', 'warning', 'Receitas sem cliente vinculado', [
    ...surgeries.filter(item => item.paymentStatus !== 'cancelado' && !item.patientId),
    ...consultations.filter(item => item.paymentStatus !== 'cancelado' && !item.patientId),
    ...productSales.filter(item => item.paymentStatus !== 'cancelado' && !item.patientId),
  ], 'O nome em texto é preservado, mas relatórios por cliente podem ficar fragmentados.')

  addIssue('missing_supplier_link', 'warning', 'Saídas sem fornecedor vinculado', [
    ...productPurchases.filter(item => item.status !== 'cancelado' && !item.supplierId),
    ...expenses.filter(item => item.status !== 'cancelado' && !item.supplierId),
  ], 'O valor é preservado, mas relatórios por fornecedor podem ficar fragmentados.')

  const blockers = issues.filter(item => item.severity === 'blocking')
  const warnings = issues.filter(item => item.severity === 'warning')
  return {
    ready:blockers.length === 0,
    blockers,
    warnings,
    issues,
    reconciliation,
    invariantProblems,
  }
}

// Invariantes de integridade por título (para testes e validação em runtime):
// (1) soma das parcelas == total; (2) pago + aberto == total.
export function checkLedgerInvariants({ entries, installments }) {
  const problems = []
  entries.forEach((entry, i) => {
    const rows = installments[i] || []
    const sum = round2(rows.reduce((a, r) => a + (r.amount || 0), 0))
    const paid = round2(rows.filter(r => r.status === 'paid').reduce((a, r) => a + (r.amount || 0), 0))
    const open = round2(rows.filter(r => r.status === 'pending' || r.status === 'partially_paid').reduce((a, r) => a + (r.amount || 0), 0))
    const total = round2(entry.total_amount)
    const canceled = entry.status === 'canceled'
    if (!canceled && total > 0 && sum !== total) {
      problems.push({ entry: `${entry.source_type}:${entry.source_id}`, kind: 'sum_mismatch', total, sum })
    }
    if (!canceled && round2(paid + open) !== (total > 0 ? total : 0) && rows.length > 0) {
      problems.push({ entry: `${entry.source_type}:${entry.source_id}`, kind: 'paid_open_mismatch', total, paid, open })
    }
  })
  return problems
}
