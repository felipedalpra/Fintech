import { paymentScheduleFlow } from './paymentScheduleFlow.js'

const PAYMENT_METHODS = new Set(['pix', 'cartao', 'cartao_link', 'dinheiro', 'boleto', 'transferencia'])

export function sourceCollection(sourceType) {
  return {
    surgery:'surgeries',
    consultation:'consultations',
    product_sale:'productSales',
    product_purchase:'productPurchases',
    extra_revenue:'extraRevenues',
    expense:'expenses',
  }[sourceType] || null
}

export function settlementSource(installment) {
  const sourceType = installment?.financial_entries?.source_type || installment?.financial_entry?.source_type || installment?.entry?.source_type
  const sourceId = installment?.financial_entries?.source_id || installment?.financial_entry?.source_id || installment?.entry?.source_id
  return { sourceType, sourceId, collection:sourceCollection(sourceType) }
}

export function defaultSettlementAdjustments(installment, line) {
  const gross = Math.abs(Number(installment?.amount || 0))
  const bank = Math.abs(Number(line?.amount || 0))
  const direction = installment?.financial_entries?.direction || installment?.financial_entry?.direction || installment?.entry?.direction
  return { paidAmount:gross, feesAmount:direction === 'receivable' ? Math.max(0, gross - bank) : Math.max(0, bank - gross), interestAmount:0, discountAmount:0 }
}

export function validateSettlementAdjustments(installment, line, adjustments = {}) {
  const gross = Math.min(Math.abs(Number(installment?.amount || 0)), Math.max(0, Number(adjustments.paidAmount ?? installment?.amount ?? 0)))
  const bank = Math.abs(Number(line?.amount || 0))
  const fees = Math.max(0, Number(adjustments.feesAmount || 0))
  const interest = Math.max(0, Number(adjustments.interestAmount || 0))
  const discount = Math.max(0, Number(adjustments.discountAmount || 0))
  const direction = installment?.financial_entries?.direction || installment?.financial_entry?.direction || installment?.entry?.direction
  const expected = direction === 'receivable' ? gross - fees + interest - discount : gross + fees + interest - discount
  return { valid:Math.abs(expected - bank) <= 0.005, expected, bank }
}

function sourceStatus(sourceType, paid) {
  if (sourceType === 'product_sale' || sourceType === 'extra_revenue') return paid ? 'recebido' : 'pendente'
  return paid ? 'pago' : 'pendente'
}

function setScheduledSettlement(record, sourceType, installment, line, paymentMethod, adjustments = {}) {
  const key = String(installment.source_installment_number || installment.installment_number || 1)
  const receiptSettlements = {
    ...(record.receiptSettlements || {}),
    [key]:{
      ...(record.receiptSettlements?.[key] || {}),
      receivedDate:line.posted_date || line.postedDate,
      amount:Number(adjustments.paidAmount ?? installment.amount ?? 0),
      method:paymentMethod,
      financialAccountId:line.financial_account_id || null,
      feesAmount:Number(adjustments.feesAmount || 0),
      interestAmount:Number(adjustments.interestAmount || 0),
      discountAmount:Number(adjustments.discountAmount || 0),
      status:'received',
    },
  }
  const total = sourceType === 'consultation' ? record.value : record.totalValue
  const next = { ...record, receiptSettlements }
  const flow = paymentScheduleFlow(total, next)
  const paid = Number(flow.openAmount || 0) <= 0.005
  const dates = (flow.paidInstallments || []).map(item => item.settlementDate).filter(Boolean).sort()
  return {
    ...next,
    paymentStatus:sourceStatus(sourceType, paid),
    paymentDate:dates.at(-1) || record.paymentDate || '',
    ...(sourceType === 'product_sale' ? { receivedDate:dates.at(-1) || record.receivedDate || '' } : {}),
  }
}

export function applyBankSettlement(data, installment, line, paymentMethod, adjustments = {}) {
  const { sourceType, sourceId } = settlementSource(installment)
  const sourceComponent = installment?.financial_entries?.source_component || installment?.financial_entry?.source_component || installment?.entry?.source_component || 'revenue'
  const collection = sourceCollection(sourceType)
  const date = line?.posted_date || line?.postedDate
  if (!collection || !sourceId || !date || !PAYMENT_METHODS.has(String(paymentMethod || ''))) {
    throw new Error('Dados insuficientes para baixar a parcela conciliada.')
  }

  const next = { ...data }
  const records = Array.isArray(data?.[collection]) ? data[collection] : []
  if (!records.some(record => record.id === sourceId)) throw new Error('A origem financeira da parcela não foi encontrada.')

  next[collection] = records.map(record => {
    if (record.id !== sourceId) return record
    if (['surgery', 'consultation', 'product_sale'].includes(sourceType) && sourceComponent === 'revenue') {
      return setScheduledSettlement(record, sourceType, installment, line, paymentMethod, adjustments)
    }
    if (['surgery', 'consultation'].includes(sourceType) && sourceComponent !== 'revenue') {
      const current = record.costSettlements?.[sourceComponent] || {}
      return {
        ...record,
        costSettlements:{
          ...(record.costSettlements || {}),
          [sourceComponent]:{ ...current, status:'pago', paymentDate:date, paymentMethod, financialAccountId:line.financial_account_id || null },
        },
      }
    }
    return {
      ...record,
      status:sourceStatus(sourceType, true),
      ...(sourceType === 'extra_revenue' ? { receivedDate:date } : { paymentDate:date }),
      paymentMethod,
      financialAccountId:line.financial_account_id || null,
      feesAmount:Number(adjustments.feesAmount || 0),
      interestAmount:Number(adjustments.interestAmount || 0),
      discountAmount:Number(adjustments.discountAmount || 0),
    }
  })
  return next
}
