import { paymentScheduleFlow } from './paymentScheduleFlow.js'

const activeSettlement = settlement => Boolean(
  settlement?.receivedDate && settlement?.status !== 'reversed',
)

export function hasActiveReceiptSettlements(record) {
  return Object.values(record?.receiptSettlements || {}).some(activeSettlement)
}

export function hasRecognizedReceipt(record) {
  if (hasActiveReceiptSettlements(record)) return true
  if (record?.paymentStatus === 'cancelado') return false
  if (['pago', 'recebido'].includes(record?.paymentStatus)) return true
  return Boolean(record?.paymentDate || record?.receivedDate)
}

export function hasChangedReceiptFields(before, after, fields) {
  return fields.some(field => String(before?.[field] ?? '') !== String(after?.[field] ?? ''))
}

function receiptSnapshot(settlement = {}) {
  return {
    receivedDate:settlement.receivedDate || null,
    amount:Number(settlement.amount || 0),
    method:settlement.method || '',
    status:settlement.status || 'received',
  }
}

function materializeLegacySettlements(record, totalValue, paidStatus) {
  const settlements = { ...(record?.receiptSettlements || {}) }
  const flowRecord = paidStatus === 'recebido' && record?.paymentStatus === 'recebido'
    ? { ...record, paymentStatus:'pago', paymentDate:record.receivedDate || record.paymentDate }
    : record
  const flow = paymentScheduleFlow(totalValue, flowRecord)

  for (const installment of flow.paidInstallments || []) {
    const key = String(installment.index + 1)
    if (activeSettlement(settlements[key])) continue
    settlements[key] = {
      receivedDate:installment.settlementDate || record?.paymentDate || record?.receivedDate || installment.dueDate || installment.date,
      amount:installment.amount,
      method:installment.method || record?.paymentMethod || 'manual',
      status:'received',
      legacy:true,
      history:Array.isArray(settlements[key]?.history) ? settlements[key].history : [],
    }
  }

  return settlements
}

export function reverseReceivableInstallment(record, {
  totalValue,
  installmentNumber,
  reversedAt = new Date().toISOString(),
  reversedByRole = '',
  reason = 'Estorno manual no financeiro',
  paidStatus = 'pago',
  pendingStatus = 'pendente',
  receivedDateField = false,
} = {}) {
  const key = String(Number(installmentNumber || 1))
  const receiptSettlements = materializeLegacySettlements(record, totalValue, paidStatus)
  const current = receiptSettlements[key]

  if (!activeSettlement(current)) {
    throw new Error('Esta parcela não possui um recebimento ativo para estornar.')
  }
  if (current.chargeId) {
    throw new Error('Este recebimento veio de uma cobrança bancária. Faça o estorno pelo fluxo da cobrança para evitar que o provedor restaure a baixa.')
  }

  receiptSettlements[key] = {
    ...current,
    status:'reversed',
    reversedAt,
    reversedByRole:reversedByRole || null,
    reversalReason:reason,
    history:[
      ...(Array.isArray(current.history) ? current.history : []),
      { action:'reversed', at:reversedAt, byRole:reversedByRole || null, reason, previous:receiptSnapshot(current) },
    ],
  }

  const reversedRecord = { ...record, receiptSettlements }
  const flowAfterReversal = paymentScheduleFlow(totalValue, reversedRecord)
  const remainingDates = (flowAfterReversal.paidInstallments || [])
    .map(entry => entry.settlementDate)
    .filter(Boolean)
    .sort()
  const latestReceiptDate = remainingDates.at(-1) || null
  const fullyPaid = Number(flowAfterReversal.openAmount || 0) <= 0.005
  const next = {
    ...reversedRecord,
    paymentStatus:fullyPaid ? paidStatus : pendingStatus,
    paymentDate:latestReceiptDate,
  }

  if (receivedDateField) next.receivedDate = latestReceiptDate
  return next
}

export function withReceivedInstallmentHistory(previous, settlement) {
  return {
    ...settlement,
    status:'received',
    history:Array.isArray(previous?.history) ? previous.history : [],
  }
}
