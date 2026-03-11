export function createEmptyData() {
  return {
    procedures: [],
    surgeries: [],
    consultations: [],
    products: [],
    productSales: [],
    productPurchases: [],
    extraRevenues: [],
    expenses: [],
    assets: [],
    liabilities: [],
    goals: [],
  }
}

export function normalizeData(data) {
  const procedures = Array.isArray(data?.procedures)
    ? data.procedures
    : Array.isArray(data?.plans)
      ? data.plans.map(plan => ({
          id:plan.id,
          name:plan.name,
          price:plan.price || 0,
          durationHours:plan.durationHours || 3,
          color:plan.color,
          desc:plan.desc || '',
          checklist:Array.isArray(plan.features) ? plan.features : [],
        }))
      : []

  const surgeries = Array.isArray(data?.surgeries)
    ? data.surgeries
    : Array.isArray(data?.sales)
      ? data.sales.map(sale => ({
          id:sale.id,
          patient:sale.client || '',
          procedureId:sale.plan || '',
          totalValue:sale.value || 0,
          date:sale.date || '',
          paymentMethod:sale.paymentMethod || 'pix',
          paymentStatus:sale.status === 'ativo' ? 'pago' : 'pendente',
          surgeon:sale.surgeon || '',
          hospitalCost:sale.hospitalCost || 0,
          anesthesiaCost:sale.anesthesiaCost || 0,
          materialCost:sale.materialCost || 0,
          otherCosts:sale.otherCosts || 0,
          notes:sale.notes || '',
        }))
      : []

  return {
    procedures,
    surgeries,
    consultations: Array.isArray(data?.consultations) ? data.consultations : [],
    products: Array.isArray(data?.products) ? data.products : [],
    productSales: Array.isArray(data?.productSales) ? data.productSales : [],
    productPurchases: Array.isArray(data?.productPurchases) ? data.productPurchases : [],
    extraRevenues: Array.isArray(data?.extraRevenues) ? data.extraRevenues : [],
    expenses: Array.isArray(data?.expenses)
      ? data.expenses.map(expense => ({
          id:expense.id,
          description:expense.description || expense.desc || '',
          category:expense.category || 'outros',
          value:expense.value || 0,
          dueDate:expense.dueDate || expense.date || '',
          paymentDate:expense.paymentDate || expense.paidDate || '',
          status:expense.status || (expense.paymentDate ? 'pago' : 'aberto'),
        }))
      : [],
    assets: Array.isArray(data?.assets) ? data.assets : [],
    liabilities: Array.isArray(data?.liabilities) ? data.liabilities : [],
    goals: Array.isArray(data?.goals) ? data.goals : [],
  }
}

export function isDataEmpty(data) {
  const normalized = normalizeData(data)
  return normalized.procedures.length === 0
    && normalized.surgeries.length === 0
    && normalized.consultations.length === 0
    && normalized.products.length === 0
    && normalized.productSales.length === 0
    && normalized.productPurchases.length === 0
    && normalized.extraRevenues.length === 0
    && normalized.expenses.length === 0
    && normalized.assets.length === 0
    && normalized.liabilities.length === 0
    && normalized.goals.length === 0
}
