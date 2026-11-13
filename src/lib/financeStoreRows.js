export function mapExtraRevenuesRows(userId, data) {
  return data.extraRevenues.map(item => ({
    id:item.id,
    user_id:userId,
    description:item.description,
    category:item.category || 'outras_receitas',
    value:item.value || 0,
    // `date` é uma coluna legada NOT NULL. Para títulos pendentes ela recebe apenas um
    // fallback estrutural; a liquidação real continua exclusivamente em `received_date`.
    date:item.date || item.competenceDate || item.dueDate || null,
    received_date:item.status === 'pendente' ? null : (item.receivedDate || item.date || null),
    patient_id:item.patientId || null,
    competence_date:item.competenceDate || item.date || null,
    due_date:item.dueDate || item.date || null,
    cost_center:item.costCenter || null,
    origin_label:item.originLabel || null,
    is_financial_import:item.isFinancialImport === true,
    status:item.status || 'recebido',
    ...(item.chartAccountId ? { chart_account_id:item.chartAccountId } : {}),
  }))
}

// Lê uma linha da tabela surgeries (snake_case) e devolve o item camelCase usado no app.
// Testada em ida-e-volta com mapSurgeriesRows — achado real (13/11/2026): campo novo mapeado
// só na escrita (ou só na leitura) do Supabase fica "salvo" na memória até a página recarregar,
// e depois disso some em silêncio, porque a leitura de volta não reconstrói o campo.
export function surgeryFromRow(item) {
  return {
    id:item.id,
    procedureId:item.procedure_id || '',
    patient:item.patient || '',
    patientId:item.patient_id || null,
    totalValue:Number(item.total_value || 0),
    date:item.date || '',
    startTime:String(item.start_time || '').slice(0, 5),
    durationMinutes:Number(item.duration_minutes || 0),
    paymentMethod:item.payment_method || 'pix',
    paymentStatus:item.payment_status || 'pendente',
    surgeon:item.surgeon || '',
    paymentDate:item.payment_date || '',
    competenceDate:item.competence_date || item.date || '',
    dueDate:item.due_date || item.date || '',
    hospitalCost:Number(item.hospital_cost || 0),
    anesthesiaCost:Number(item.anesthesia_cost || 0),
    materialCost:Number(item.material_cost || 0),
    instrumentationCost:Number(item.instrumentation_cost || 0),
    prosthesisCost:Number(item.prosthesis_cost || 0),
    otherCosts:Number(item.other_costs || 0),
    thirdPartyPassthroughValue:Number(item.third_party_passthrough_value || 0),
    customProcedureName:item.custom_procedure_name || null,
    city:item.city || null,
    locationDetail:item.location_detail || '',
    invoiceIssuancePercent:Number(item.invoice_issuance_percent || 0),
    invoiceTaxRate:Number(item.invoice_tax_rate ?? item.invoice_issuance_percent ?? 0),
    invoiceTaxAmount:item.invoice_tax_amount == null ? null : Number(item.invoice_tax_amount || 0),
    costSettlements:item.cost_settlements && typeof item.cost_settlements === 'object' ? item.cost_settlements : {},
    receiptSettlements:item.receipt_settlements && typeof item.receipt_settlements === 'object' ? item.receipt_settlements : {},
    notes:item.notes || '',
  }
}

// Mesma ideia do surgeryFromRow, para consultations.
export function consultationFromRow(item) {
  return {
    id:item.id,
    patient:item.patient || '',
    patientId:item.patient_id || null,
    date:item.date || '',
    startTime:String(item.start_time || '').slice(0, 5),
    durationMinutes:Number(item.duration_minutes || 0),
    consultationType:item.consultation_type || 'avaliacao',
    city:item.city || null,
    locationDetail:item.location_detail || '',
    value:Number(item.value || 0),
    paymentType:item.payment_type || 'particular',
    paymentMethod:item.payment_method || 'pix',
    invoiceIssuancePercent:Number(item.invoice_issuance_percent || 0),
    invoiceTaxRate:Number(item.invoice_tax_rate ?? item.invoice_issuance_percent ?? 0),
    invoiceTaxAmount:item.invoice_tax_amount == null ? null : Number(item.invoice_tax_amount || 0),
    costSettlements:item.cost_settlements && typeof item.cost_settlements === 'object' ? item.cost_settlements : {},
    receiptSettlements:item.receipt_settlements && typeof item.receipt_settlements === 'object' ? item.receipt_settlements : {},
    insurance:item.insurance || '',
    paymentStatus:item.payment_status || 'pendente',
    forecastPaymentDate:item.forecast_payment_date || '',
    paymentDate:item.payment_date || '',
    competenceDate:item.competence_date || item.date || '',
    dueDate:item.due_date || item.forecast_payment_date || item.date || '',
  }
}

export function mapSurgeriesRows(userId, data) {
  return data.surgeries.map(item => ({
    id:item.id,
    user_id:userId,
    procedure_id:item.procedureId || null,
    patient:item.patient || '',
    patient_id:item.patientId || null,
    total_value:item.totalValue || 0,
    date:item.date,
    competence_date:item.competenceDate || item.date || null,
    due_date:item.dueDate || item.date || null,
    start_time:item.startTime || null,
    duration_minutes:Number(item.durationMinutes) || null,
    payment_method:item.paymentMethod || null,
    payment_status:item.paymentStatus || 'pendente',
    surgeon:item.surgeon || null,
    payment_date:item.paymentDate || null,
    hospital_cost:item.hospitalCost || 0,
    anesthesia_cost:item.anesthesiaCost || 0,
    material_cost:item.materialCost || 0,
    instrumentation_cost:item.instrumentationCost || 0,
    prosthesis_cost:item.prosthesisCost || 0,
    other_costs:item.otherCosts || 0,
    third_party_passthrough_value:item.thirdPartyPassthroughValue || 0,
    custom_procedure_name:item.customProcedureName || null,
    city:item.city || null,
    location_detail:item.locationDetail || null,
    invoice_issuance_percent:item.invoiceIssuancePercent || 0,
    invoice_tax_rate:item.invoiceTaxRate ?? item.invoiceIssuancePercent ?? 0,
    invoice_tax_amount:item.invoiceTaxAmount ?? null,
    cost_settlements:item.costSettlements || {},
    receipt_settlements:item.receiptSettlements || {},
    notes:item.notes || null,
  }))
}

export function mapConsultationsRows(userId, data) {
  return data.consultations.map(item => ({
    id:item.id,
    user_id:userId,
    patient:item.patient || '',
    patient_id:item.patientId || null,
    date:item.date,
    competence_date:item.competenceDate || item.date || null,
    due_date:item.dueDate || item.forecastPaymentDate || item.date || null,
    start_time:item.startTime || null,
    duration_minutes:Number(item.durationMinutes) || null,
    consultation_type:item.consultationType || 'avaliacao',
    city:item.city || null,
    location_detail:item.locationDetail || null,
    value:item.value || 0,
    payment_type:item.paymentType || 'particular',
    payment_method:item.paymentMethod || null,
    invoice_issuance_percent:item.invoiceIssuancePercent || 0,
    invoice_tax_rate:item.invoiceTaxRate ?? item.invoiceIssuancePercent ?? 0,
    invoice_tax_amount:item.invoiceTaxAmount ?? null,
    cost_settlements:item.costSettlements || {},
    receipt_settlements:item.receiptSettlements || {},
    insurance:item.insurance || null,
    payment_status:item.paymentStatus || 'pendente',
    forecast_payment_date:item.forecastPaymentDate || null,
    payment_date:item.paymentDate || null,
  }))
}

export function mapExpensesRows(userId, data) {
  return data.expenses.map(item => ({
    id:item.id,
    user_id:userId,
    description:item.description,
    category:item.category || 'outros',
    value:item.value || 0,
    due_date:item.dueDate,
    competence_date:item.competenceDate || item.dueDate || null,
    payment_date:item.paymentDate || null,
    status:item.status || 'aberto',
    supplier_id:item.supplierId || null,
    cost_center:item.costCenter || null,
    origin_label:item.originLabel || null,
    is_financial_import:item.isFinancialImport === true,
    ...(item.chartAccountId ? { chart_account_id:item.chartAccountId } : {}),
  }))
}
