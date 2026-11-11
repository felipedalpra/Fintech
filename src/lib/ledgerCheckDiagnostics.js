import { buildMetrics } from '../financialMetrics.js'
import { today } from '../utils.js'
import { buildLedger } from './financialLedger.js'

const REVENUE_SOURCE_TYPES = new Set(['surgery', 'consultation', 'product_sale', 'extra_revenue', 'recurrence'])

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function sumEntries(entries) {
  return round2(entries.reduce((sum, entry) => sum + Number(entry.total_amount || 0), 0))
}

function sourceForEntry(data, entry) {
  const collections = {
    surgery:'surgeries',
    consultation:'consultations',
    product_sale:'productSales',
    extra_revenue:'extraRevenues',
    recurrence:'recurrences',
  }
  return (data[collections[entry.source_type]] || []).find(item => item.id === entry.source_id)
}

function financialRevenueDetail(data, entry) {
  const source = sourceForEntry(data, entry)
  const account = (data.chartAccounts || []).find(item => item.id === entry.chart_account_id)
  const description = source?.description || source?.descricao || source?.patient || source?.patientName || entry.party_name_snapshot || 'Receita financeira'
  return {
    id:`${entry.source_type}:${entry.source_id}:${entry.source_component}`,
    description,
    account:account?.name || entry.category || 'Receita financeira',
    competenceDate:entry.competence_date || '',
    value:round2(entry.total_amount),
  }
}

// Compara os consumidores usando exatamente o mesmo escopo contábil dos indicadores.
// Receita financeira permanece no razão, mas fica fora da receita bruta operacional e
// aparece separadamente no resultado financeiro da DRE.
export function buildLedgerConsumerComparison(data = {}, currentDate = today()) {
  const metrics = buildMetrics(data)
  const recurrenceStart = `${currentDate.slice(0, 4)}-01-01`
  const ledger = buildLedger(data, { recurrenceFrom:recurrenceStart, recurrenceTo:currentDate })
  const usesChartOfAccounts = (data.chartAccounts || []).length > 0
  const revenueEntries = ledger.entries.filter(entry =>
    entry.status !== 'canceled' && entry.direction === 'receivable' && REVENUE_SOURCE_TYPES.has(entry.source_type))
  const financialRevenueEntries = usesChartOfAccounts
    ? revenueEntries.filter(entry => entry.account_nature === 'financial_revenue')
    : []
  const operatingRevenueEntries = usesChartOfAccounts
    ? revenueEntries.filter(entry => entry.account_nature !== 'financial_revenue')
    : revenueEntries

  return {
    metrics,
    ledger,
    operatingGrossRevenue:sumEntries(operatingRevenueEntries),
    financialRevenue:sumEntries(financialRevenueEntries),
    totalRevenueInLedger:sumEntries(revenueEntries),
    financialRevenueDetails:financialRevenueEntries.map(entry => financialRevenueDetail(data, entry)),
  }
}

