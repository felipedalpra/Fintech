import { useEffect, useRef, useState } from 'react'
import { C } from '../theme.js'
import { Btn } from './UI.jsx'
import { supabase } from '../lib/supabase.js'
import { formatDateBR } from '../utils.js'
import {
  budgetDocumentSha256,
  budgetDocumentStatusLabel,
  buildBudgetDocumentRpcArgs,
  buildBudgetDocumentWhatsAppMessage,
  sortBudgetDocumentsByVersion,
  validateBudgetDocumentFile,
} from '../lib/budgetDocuments.js'

const DOC_COLUMNS = 'id,patient_id,opportunity_id,version,bucket_id,object_path,file_name,file_size,status,created_at,archived_at'

async function fetchBudgetDocuments(patientId, ownerId) {
  const { data, error } = await supabase
    .from('budget_documents')
    .select(DOC_COLUMNS)
    .eq('user_id', ownerId)
    .eq('patient_id', patientId)
    .order('version', { ascending:false })
  if (error) throw error
  return sortBudgetDocumentsByVersion(data || [])
}

// Seção "Orçamentos" — mesmo componente aparece na ficha do paciente (Financeiro) e no
// painel da oportunidade do CRM, filtrados pelo mesmo patient_id (spec biblioteca-orcamento-pdf).
export function BudgetDocuments({ patient, ownerId, opportunityId = null, canArchive = false, patientPhone = '' }) {
  const [docs, setDocs] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  async function load() {
    if (!patient?.id || !ownerId) return
    setStatus('loading')
    try {
      const rows = await fetchBudgetDocuments(patient.id, ownerId)
      setDocs(rows)
      setStatus('ready')
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os orçamentos.')
      setStatus('error')
    }
  }
  useEffect(() => { load() }, [patient?.id, ownerId])

  async function handleFile(file) {
    const invalid = validateBudgetDocumentFile(file)
    if (invalid) { setError(invalid); return }
    setError('')
    setUploading(true)
    try {
      const sha256 = await budgetDocumentSha256(file)
      const { data:createdRows, error:createError } = await supabase.rpc(
        'create_budget_document_upload',
        buildBudgetDocumentRpcArgs({ patientId:patient.id, opportunityId, file, sha256 }),
      )
      if (createError) throw createError
      const reserved = createdRows?.[0]
      if (!reserved) throw new Error('Não foi possível reservar o upload.')

      const { error:uploadError } = await supabase.storage
        .from(reserved.bucket_id)
        .upload(reserved.object_path, file, { upsert:false, contentType:'application/pdf', cacheControl:'3600' })
      if (uploadError) throw uploadError

      const { data:completed, error:completeError } = await supabase.rpc('complete_budget_document_upload', { p_document_id:reserved.document_id })
      if (completeError) throw completeError
      if (!completed) throw new Error('O upload não pôde ser confirmado. Tente novamente.')

      await load()
    } catch (err) {
      setError(err.message || 'Falha ao anexar o orçamento.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function openDocument(doc) {
    const { data, error:signError } = await supabase.storage.from(doc.bucket_id).createSignedUrl(doc.object_path, 300)
    if (signError || !data?.signedUrl) { setError('URL temporária indisponível.'); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function shareOnWhatsApp(doc) {
    const digits = String(patientPhone || '').replace(/\D/g, '')
    if (!digits) { setError('Paciente sem telefone cadastrado.'); return }
    const { data, error:signError } = await supabase.storage.from(doc.bucket_id).createSignedUrl(doc.object_path, 300)
    if (signError || !data?.signedUrl) { setError('URL temporária indisponível.'); return }
    const message = buildBudgetDocumentWhatsAppMessage({ patientName:patient?.full_name, version:doc.version, signedUrl:data.signedUrl })
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  async function archiveDocument(doc) {
    const { data, error:archiveError } = await supabase.rpc('set_budget_document_archived', { p_document_id:doc.id, p_archived:doc.status !== 'archived' })
    if (archiveError) { setError(archiveError.message || 'Não foi possível arquivar.'); return }
    if (data) await load()
  }

  if (!patient?.id) return null

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }} data-testid="budget-documents-section">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
        <div style={{ fontSize:12, fontWeight:700, color:C.textSub, letterSpacing:'0.06em', textTransform:'uppercase' }}>Orçamentos</div>
        <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display:'none' }}
          onChange={e => { const file = e.target.files?.[0]; if (file) handleFile(file) }} />
        <Btn variant="ghost" disabled={uploading} onClick={() => fileInputRef.current?.click()} style={{ padding:'5px 12px', fontSize:12 }}>
          {uploading ? 'Enviando…' : 'Anexar orçamento'}
        </Btn>
      </div>

      {error && <div role="alert" style={{ fontSize:12, color:C.red }}>{error}</div>}

      {status === 'loading' && <div style={{ fontSize:12, color:C.textDim }}>Carregando…</div>}

      {status === 'ready' && docs.length === 0 && (
        <div style={{ fontSize:12, color:C.textDim }}>Nenhum orçamento anexado ainda.</div>
      )}

      {status === 'ready' && docs.map(doc => (
        <div key={doc.id} data-testid="budget-document-row" style={{
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:10,
          background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'8px 12px',
          opacity:doc.status === 'archived' ? 0.6 : 1,
        }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13, color:C.text, fontWeight:600 }}>
              Versão {doc.version} — {doc.file_name}
            </div>
            <div style={{ fontSize:11, color:C.textDim }}>
              {formatDateBR(doc.created_at?.slice(0, 10))} · {budgetDocumentStatusLabel(doc.status)}
            </div>
          </div>
          <div style={{ display:'flex', gap:6, flexShrink:0 }}>
            {doc.status === 'available' && (
              <>
                <Btn variant="ghost" onClick={() => openDocument(doc)} style={{ padding:'4px 10px', fontSize:11 }}>Abrir</Btn>
                <Btn variant="ghost" onClick={() => shareOnWhatsApp(doc)} style={{ padding:'4px 10px', fontSize:11 }}>WhatsApp</Btn>
              </>
            )}
            {canArchive && (doc.status === 'available' || doc.status === 'archived') && (
              <Btn variant="ghost" onClick={() => archiveDocument(doc)} style={{ padding:'4px 10px', fontSize:11 }}>
                {doc.status === 'archived' ? 'Restaurar' : 'Arquivar'}
              </Btn>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
