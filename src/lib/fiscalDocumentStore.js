import { supabase } from './supabase.js'
import { financialEntryKey } from './fiscalDocuments.js'

function isMissingSchema(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase()
  return text.includes('pgrst205') || text.includes('does not exist') || text.includes('schema cache')
}

export async function loadFiscalDocuments(ownerId, client = supabase) {
  if (!ownerId) return { documents:[], documentsByEntry:{}, schemaMissing:false }
  const [entriesResult, documentsResult, allocationsResult] = await Promise.all([
    client.from('financial_entries').select('id,source_type,source_id,source_component,direction,description,total_amount,competence_date').eq('user_id', ownerId).is('archived_at', null),
    client.from('fiscal_documents').select('*').eq('user_id', ownerId).is('archived_at', null).order('issue_date', { ascending:false }),
    client.from('fiscal_document_allocations').select('id,fiscal_document_id,financial_entry_id,allocated_amount').eq('user_id', ownerId),
  ])
  const error = entriesResult.error || documentsResult.error || allocationsResult.error
  if (error) {
    if (isMissingSchema(error)) return { documents:[], documentsByEntry:{}, schemaMissing:true }
    throw error
  }
  const entries = new Map((entriesResult.data || []).map(entry => [entry.id, entry]))
  const documents = new Map((documentsResult.data || []).map(document => [document.id, { ...document, allocations:[] }]))
  ;(allocationsResult.data || []).forEach(allocation => {
    const entry = entries.get(allocation.financial_entry_id)
    const document = documents.get(allocation.fiscal_document_id)
    if (!entry || !document) return
    document.allocations.push({ ...allocation, financialEntry:entry })
  })
  const documentRows = [...documents.values()]
  const documentsByEntry = {}
  documentRows.forEach(document => document.allocations.forEach(allocation => {
    const key = financialEntryKey(allocation.financialEntry)
    if (!key) return
    documentsByEntry[key] ||= []
    documentsByEntry[key].push(document)
  }))
  return { documents:documentRows, documentsByEntry, schemaMissing:false }
}

export async function createFiscalDocumentForTarget(target, values, client = supabase) {
  if (!target?.sourceType || !target?.sourceId) throw new Error('Lançamento financeiro inválido para vínculo fiscal.')
  const { data:entry, error:entryError } = await client.from('financial_entries')
    .select('id,direction,total_amount')
    .eq('source_type', target.sourceType)
    .eq('source_id', target.sourceId)
    .eq('source_component', target.sourceComponent || 'revenue')
    .is('archived_at', null)
    .maybeSingle()
  if (entryError) throw entryError
  if (!entry) throw new Error('O título financeiro ainda não foi sincronizado. Salve o lançamento e tente novamente.')
  const payload = {
    document_type:values.documentType,
    number:String(values.number || '').trim(),
    series:String(values.series || '').trim() || null,
    access_key:String(values.accessKey || '').replace(/\s/g, '') || null,
    verification_code:String(values.verificationCode || '').trim() || null,
    issue_date:values.issueDate,
    competence_date:values.competenceDate || null,
    issuer_name:String(values.issuerName || '').trim() || null,
    recipient_name:String(values.recipientName || '').trim() || null,
    total_amount:Number(values.totalAmount || 0),
    allocated_amount:Number(values.allocatedAmount || values.totalAmount || 0),
    status:values.status,
    notes:String(values.notes || '').trim() || null,
  }
  const { data, error } = await client.rpc('create_fiscal_document_for_entry', {
    p_financial_entry_id:entry.id,
    p_document:payload,
  })
  if (error) throw error
  return data
}

export async function updateFiscalDocumentStatus(documentId, status, client = supabase) {
  const { data, error } = await client.rpc('set_fiscal_document_status', {
    p_fiscal_document_id:documentId,
    p_status:status,
  })
  if (error) throw error
  return data
}

