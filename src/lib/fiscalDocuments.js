const TYPE_LABELS = {
  nfse:'NFS-e',
  nfe:'NF-e',
  nfce:'NFC-e',
  receipt:'Recibo',
  invoice:'Fatura',
  other:'Outro',
}

const MODAL_TARGETS = {
  surgery:{ sourceType:'surgery', direction:'receivable' },
  consultation:{ sourceType:'consultation', direction:'receivable' },
  'product-sale':{ sourceType:'product_sale', direction:'receivable' },
  'product-purchase':{ sourceType:'product_purchase', direction:'payable' },
  extra:{ sourceType:'extra_revenue', direction:'receivable' },
  expense:{ sourceType:'expense', direction:'payable' },
}

export const FISCAL_DOCUMENT_TYPES = Object.entries(TYPE_LABELS).map(([v, l]) => ({ v, l }))

export function financialEntryKey(item = {}) {
  const sourceType = item.sourceType || item.source_type || item.source
  const sourceId = item.sourceId || item.source_id || item.referenceId
  const sourceComponent = item.sourceComponent || item.source_component || 'revenue'
  if (!sourceType || !sourceId) return ''
  return `${sourceType}|${sourceId}|${sourceComponent}`
}

export function fiscalDocumentLabel(document = {}) {
  const type = TYPE_LABELS[document.document_type || document.documentType] || 'Documento'
  const number = String(document.number || '').trim()
  const series = String(document.series || '').trim()
  return `${type} ${number || 'sem número'}${series ? ` · série ${series}` : ''}`
}

export function fiscalDocumentsSearchText(documents = []) {
  return documents.map(document => [
    fiscalDocumentLabel(document),
    document.number,
    document.series,
    document.access_key || document.accessKey,
    document.verification_code || document.verificationCode,
    document.issuer_name || document.issuerName,
    document.recipient_name || document.recipientName,
  ].filter(Boolean).join(' ')).join(' ').toLowerCase()
}

export function fiscalTargetFromMetric(item = {}) {
  const key = financialEntryKey(item)
  if (!key) return null
  return {
    key,
    sourceType:item.sourceType || item.source_type || item.source,
    sourceId:item.sourceId || item.source_id || item.referenceId,
    sourceComponent:item.sourceComponent || item.source_component || 'revenue',
    direction:item.direction || (String(item.source || '').includes('despesa') ? 'payable' : 'receivable'),
    description:item.description || item.patient || item.supplier || 'Lançamento financeiro',
    totalAmount:Number(item.entryTotalAmount ?? item.totalAmount ?? item.value ?? 0),
    competenceDate:item.competenceDate || item.competence_date || item.date || '',
    installmentsTotal:Number(item.installmentsTotal || item.openInstallments || 1),
  }
}

export function fiscalTargetFromModal(modalType, form = {}) {
  const config = MODAL_TARGETS[modalType]
  if (!config || !form.id) return null
  const totalAmount = Number(form.totalValue ?? form.value ?? 0)
  return {
    key:financialEntryKey({ ...config, sourceId:form.id, sourceComponent:'revenue' }),
    sourceType:config.sourceType,
    sourceId:form.id,
    sourceComponent:'revenue',
    direction:config.direction,
    description:form.description || form.procedure || form.patient || form.supplier || 'Lançamento financeiro',
    totalAmount,
    competenceDate:form.competenceDate || form.date || form.dueDate || '',
    installmentsTotal:Number(form.installments || form.installmentCount || form.paymentInstallments || 1),
  }
}

export function documentsForTarget(documentsByEntry, target) {
  if (!target?.key) return []
  return documentsByEntry?.[target.key] || []
}

export function matchesFiscalFilter(documents, filter) {
  if (!filter || filter === 'all') return true
  if (filter === 'with') return documents.length > 0
  if (filter === 'without') return documents.length === 0
  return documents.some(document => document.status === filter)
}

