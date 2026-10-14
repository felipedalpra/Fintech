import { buildLedger } from './financialLedger.js'

function entryKey(entry, installmentNumber) {
  return `${entry.source_type}|${entry.source_id}|${entry.source_component}|${installmentNumber}`
}

function persistedEntry(installment) {
  return installment.financial_entries || installment.financial_entry || installment.entry || {}
}

// Garante que a conciliação nunca sugira pares em cima de uma projeção persistida incompleta.
// Recorrências são sincronizadas separadamente e não entram neste gate; os registros operacionais
// carregados pelo financeStore precisam estar todos presentes a partir da mesma buildLedger canônica.
export function missingPersistedLedgerInstallments(financeData, persistedInstallments = []) {
  const ledger = buildLedger(financeData || {})
  const expected = []
  ledger.entries.forEach((entry, index) => {
    if (entry.source_type === 'recurrence') return
    ;(ledger.installments[index] || []).forEach(installment => {
      expected.push({
        key:entryKey(entry, installment.installment_number),
        sourceType:entry.source_type,
        sourceId:entry.source_id,
        sourceComponent:entry.source_component,
        installmentNumber:installment.installment_number,
      })
    })
  })
  const persisted = new Set(persistedInstallments.filter(item => !item.archived_at).map(item => {
    const entry = persistedEntry(item)
    return entryKey(entry, Number(item.installment_number || 1))
  }))
  return expected.filter(item => !persisted.has(item.key))
}
