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
