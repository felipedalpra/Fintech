// financialLedger.js — Fase 1 (fundação) do razão financeiro canônico.
//
// PURO e testável: deriva `financial_entries` (títulos) + `financial_installments` (parcelas) a partir
// do dataset atual, reusando a MESMA função canônica de cronograma (`paymentScheduleFlow`) que o
// `buildMetrics` e os relatórios já usam — então o razão bate com o resto do sistema por construção.
//
// Nesta fase é uma PROJEÇÃO (derivada dos registros atuais). Ainda NÃO é a fonte de verdade: o app não
// lê daqui. Serve para validar o modelo (invariantes) antes de persistir/migrar a autoridade.
// Design: docs/superpowers/specs/2026-10-12-financial-core-ledger-design.md
import { paymentScheduleFlow } from '../financialMetrics.js'

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
      ['invoice_tax', invoiceTax(baseValue, item.invoiceIssuancePercent)],
    ]
    : [['invoice_tax', invoiceTax(baseValue, item.invoiceIssuancePercent)]]
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

  // Venda de produto: recebido → caixa na data da venda; pendente/legacy_unverified → em aberto
  // (não assume recebimento sem confirmação); cancelado → cancelado. Cliente vinculado por patient_id.
  productSales.forEach(item => parts.push(singleEntry({
    sourceType: 'product_sale', direction: 'receivable', item, total: item.totalValue || 0,
    competenceDate: item.competenceDate || item.saleDate, issueDate: item.saleDate,
    dueDate: item.saleDate, paidDate: item.saleDate,
    isPaid: item.paymentStatus === 'recebido', canceled: item.paymentStatus === 'cancelado',
    partyType: 'patient', partyId: item.patientId || null, partyName: item.patientName || '', category: 'venda_produto',
  })))

  // Compra de produto: paga → caixa em paymentDate||purchaseDate; a pagar/legacy_unverified → em
  // aberto no vencimento; cancelada → cancelada. Fornecedor vinculado por supplier_id.
  productPurchases.forEach(item => parts.push(singleEntry({
    sourceType: 'product_purchase', direction: 'payable', item, total: item.totalValue || 0,
    competenceDate: item.competenceDate || item.purchaseDate, issueDate: item.purchaseDate,
    dueDate: item.dueDate || item.purchaseDate, paidDate: item.paymentDate || item.purchaseDate,
    isPaid: (item.status || 'pago') === 'pago', canceled: item.status === 'cancelado',
    partyType: 'supplier', partyId: item.supplierId || null, partyName: item.supplier || '', category: 'compra_produto',
  })))

  // Receita extra: recebida (status padrão 'recebido') → caixa em received_date||date; senão em aberto.
  extraRevenues.forEach(item => {
    const received = (item.status || 'recebido') === 'recebido'
    parts.push(singleEntry({
      sourceType: 'extra_revenue', direction: 'receivable', item, total: item.value || 0,
      competenceDate: item.competenceDate || item.date, issueDate: item.date,
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
