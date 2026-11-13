export const CLINICAL_COST_COMPONENTS = {
  surgery:[
    { key:'hospital_cost', label:'Hospital', amountField:'hospitalCost' },
    { key:'anesthesia_cost', label:'Anestesia', amountField:'anesthesiaCost' },
    { key:'material_cost', label:'Material', amountField:'materialCost' },
    { key:'instrumentation_cost', label:'Instrumentadora', amountField:'instrumentationCost' },
    { key:'prosthesis_cost', label:'Prótese', amountField:'prosthesisCost' },
    { key:'other_cost', label:'Outros custos', amountField:'otherCosts' },
    { key:'invoice_tax', label:'Imposto / emissão de NF', derived:true },
  ],
  consultation:[
    { key:'invoice_tax', label:'Imposto / emissão de NF', derived:true },
  ],
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

// Congela a dedução de NF no momento em que a operação é salva. A alíquota continua disponível
// para exibição, mas DRE/razão passam a ler o valor monetário persistido e não recalculam o passado
// por efeito colateral de mudanças futuras no formulário ou nas configurações da clínica.
export function withFrozenInvoiceTax(item) {
  const rate = Math.max(0, Math.min(100, Number(item?.invoiceIssuancePercent || 0)))
  const base = item?.totalValue != null ? item.totalValue : item?.value
  return {
    ...item,
    invoiceIssuancePercent:rate,
    invoiceTaxRate:rate,
    invoiceTaxAmount:round2(Number(base || 0) * (rate / 100)),
  }
}

export function clinicalCostAmount(item, component) {
  if (!component?.derived) return round2(item?.[component?.amountField])
  if (item?.invoiceTaxAmount != null) return round2(item.invoiceTaxAmount)
  const base = item?.totalValue != null ? item.totalValue : item?.value
  const percent = Math.max(0, Math.min(100, Number(item?.invoiceIssuancePercent || 0)))
  return round2(Number(base || 0) * (percent / 100))
}

export function clinicalCostRows(item, sourceType) {
  return (CLINICAL_COST_COMPONENTS[sourceType] || [])
    .map(component => ({
      ...component,
      amount:clinicalCostAmount(item, component),
      settlement:item?.costSettlements?.[component.key] || null,
    }))
    .filter(component => component.amount > 0)
}

// Só é aplicado quando o usuário salva o atendimento. Registros antigos sem metadados continuam
// legados; ao editar/salvar, os custos passam a nascer conservadoramente como contas em aberto.
export function withClinicalCostSettlementDefaults(item, sourceType) {
  const frozenItem = withFrozenInvoiceTax(item)
  const existing = frozenItem?.costSettlements || {}
  const next = { ...existing }
  clinicalCostRows(frozenItem, sourceType).forEach(component => {
    const current = existing[component.key] || {}
    const status = current.status || 'pendente'
    next[component.key] = {
      supplierId:current.supplierId || null,
      supplier:current.supplier || '',
      status,
      competenceDate:current.competenceDate || frozenItem.competenceDate || frozenItem.date || '',
      dueDate:current.dueDate || frozenItem.date || '',
      paymentDate:status === 'pago' ? (current.paymentDate || '') : '',
      paymentMethod:current.paymentMethod || '',
    }
  })
  return { ...frozenItem, costSettlements:next }
}
