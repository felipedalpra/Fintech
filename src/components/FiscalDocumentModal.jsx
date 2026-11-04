import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { fmt, formatDateBR, today } from '../utils.js'
import { Btn, FInput, Modal, Badge } from './UI.jsx'
import { FISCAL_DOCUMENT_TYPES, financialEntryKey, fiscalDocumentLabel } from '../lib/fiscalDocuments.js'
import { createFiscalDocumentForTarget, updateFiscalDocumentStatus } from '../lib/fiscalDocumentStore.js'
import { persistFiscalMutation } from '../lib/fiscalMutation.js'

function emptyForm(target) {
  return {
    documentType:'nfse',
    number:'',
    series:'',
    accessKey:'',
    verificationCode:'',
    issueDate:today(),
    competenceDate:target?.competenceDate || today(),
    issuerName:'',
    recipientName:'',
    totalAmount:Number(target?.totalAmount || 0),
    allocatedAmount:Number(target?.totalAmount || 0),
    status:target?.direction === 'payable' ? 'received' : 'issued',
    notes:'',
  }
}

export function FiscalDocumentCell({ documents = [], onClick }) {
  const active = documents.filter(document => document.status !== 'canceled')
  const first = active[0] || documents[0]
  return <Btn variant="ghost" onClick={onClick} style={{ padding:'5px 9px', fontSize:11, whiteSpace:'nowrap' }}>
    {first ? `${fiscalDocumentLabel(first)}${documents.length > 1 ? ` +${documents.length - 1}` : ''}` : '+ Documento'}
  </Btn>
}

export function FiscalDocumentSummary({ target, documents = [], onOpen }) {
  if (!target) return null
  return <div style={{ border:`1px solid ${C.border}`, borderRadius:10, padding:12, background:C.surface, marginBottom:16 }} data-testid="fiscal-document-summary">
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap' }}>
      <div>
        <div style={{ color:C.textSub, fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'.06em' }}>Documento fiscal</div>
        {documents.length > 0
          ? <div style={{ color:C.text, fontWeight:800, marginTop:4 }}>{documents.map(fiscalDocumentLabel).join(' · ')}</div>
          : <div style={{ color:C.textDim, fontSize:12, marginTop:4 }}>Nenhuma nota vinculada a este lançamento.</div>}
      </div>
      <Btn variant="ghost" onClick={onOpen} style={{ padding:'7px 11px', fontSize:12 }}>{documents.length ? 'Ver documentos' : '+ Adicionar nota'}</Btn>
    </div>
  </div>
}

export function FiscalDocumentModal({ open, target, documents = [], onClose, onChanged }) {
  const [form, setForm] = useState(() => emptyForm(target))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(documents.length === 0)
  const activeAllocated = useMemo(() => documents
    .filter(document => !['canceled','replaced'].includes(document.status))
    .reduce((sum, document) => {
      const allocation = document.allocations?.find(item => financialEntryKey(item.financialEntry) === target?.key)
      return sum + Number(allocation?.allocated_amount || 0)
    }, 0), [documents, target?.key])
  const remaining = Math.max(0, Number(target?.totalAmount || 0) - activeAllocated)

  useEffect(() => {
    if (!open) return
    setForm({ ...emptyForm(target), totalAmount:remaining || Number(target?.totalAmount || 0), allocatedAmount:remaining || Number(target?.totalAmount || 0) })
    setError('')
    setShowForm(documents.length === 0)
  }, [open, target?.key])

  const save = async () => {
    if (!form.number.trim()) { setError('Informe o número do documento fiscal.'); return }
    if (!form.issueDate) { setError('Informe a data de emissão.'); return }
    if (Number(form.totalAmount || 0) <= 0 || Number(form.allocatedAmount || 0) <= 0) { setError('Informe um valor maior que zero.'); return }
    setSaving(true)
    setError('')
    let outcome
    try {
      outcome = await persistFiscalMutation(() => createFiscalDocumentForTarget(target, form), onChanged)
    } catch (cause) {
      setError(cause?.message || 'Não foi possível salvar o documento fiscal.')
      setSaving(false)
      return
    }
    setShowForm(false)
    if (outcome.refreshError) {
      setError('Documento fiscal salvo. Não foi possível atualizar a lista agora; recarregue a página para visualizá-lo.')
    }
    setSaving(false)
  }

  const cancelDocument = async document => {
    if (!window.confirm(`Cancelar ${fiscalDocumentLabel(document)}? O lançamento financeiro será preservado.`)) return
    setSaving(true)
    setError('')
    let outcome
    try {
      outcome = await persistFiscalMutation(() => updateFiscalDocumentStatus(document.id, 'canceled'), onChanged)
    } catch (cause) {
      setError(cause?.message || 'Não foi possível cancelar o documento fiscal.')
      setSaving(false)
      return
    }
    if (outcome.refreshError) {
      setError('Documento fiscal cancelado. Não foi possível atualizar a lista agora; recarregue a página para confirmar a visualização.')
    }
    setSaving(false)
  }

  return <Modal open={open} onClose={onClose} title="Documentos fiscais" width={720}>
    <div style={{ display:'grid', gap:14 }} data-testid="fiscal-document-modal">
      <div style={{ color:C.textSub, fontSize:12, lineHeight:1.55 }}>
        <strong style={{ color:C.text }}>{target?.description}</strong><br />
        A nota fica vinculada ao título financeiro. {target?.installmentsTotal > 1 ? `O mesmo número aparecerá nas ${target.installmentsTotal} parcelas.` : 'Ela aparecerá em todas as visões deste lançamento.'}
      </div>

      {documents.map(document => <div key={document.id} style={{ border:`1px solid ${C.border}`, borderRadius:10, padding:13, display:'grid', gap:8 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ color:C.text, fontWeight:850 }}>{fiscalDocumentLabel(document)}</div>
          <Badge color={document.status === 'canceled' ? C.red : document.status === 'pending' ? C.yellow : C.green} small>{document.status}</Badge>
        </div>
        <div style={{ display:'flex', gap:16, flexWrap:'wrap', color:C.textSub, fontSize:12 }}>
          <span>Emissão: {formatDateBR(document.issue_date)}</span>
          <span>Valor: {fmt(Number(document.total_amount || 0))}</span>
          {document.access_key && <span>Chave: {document.access_key}</span>}
        </div>
        {document.status !== 'canceled' && <div><Btn variant="danger" disabled={saving} onClick={() => cancelDocument(document)} style={{ padding:'5px 9px', fontSize:11 }}>Cancelar documento</Btn></div>}
      </div>)}

      {!showForm && <Btn variant="ghost" onClick={() => { setForm({ ...emptyForm(target), totalAmount:remaining, allocatedAmount:remaining }); setShowForm(true) }}>+ Adicionar outro documento</Btn>}

      {showForm && <div style={{ display:'grid', gap:12, paddingTop:documents.length ? 8 : 0, borderTop:documents.length ? `1px solid ${C.border}` : 'none' }}>
        <div style={{ color:C.text, fontWeight:800 }}>Novo documento</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))', gap:12 }}>
          <FInput label="Tipo" value={form.documentType} onChange={value => setForm(current => ({ ...current, documentType:value }))} options={FISCAL_DOCUMENT_TYPES} />
          <FInput label="Número" required value={form.number} onChange={value => setForm(current => ({ ...current, number:value }))} placeholder="Ex: 000123" />
          <FInput label="Série" value={form.series} onChange={value => setForm(current => ({ ...current, series:value }))} placeholder="Opcional" />
          <FInput label="Data de emissão" required type="date" value={form.issueDate} onChange={value => setForm(current => ({ ...current, issueDate:value }))} />
          <FInput label="Data de competência" type="date" value={form.competenceDate} onChange={value => setForm(current => ({ ...current, competenceDate:value }))} />
          <FInput label="Valor da nota" required type="number" value={form.totalAmount} onChange={value => setForm(current => ({ ...current, totalAmount:value, allocatedAmount:value }))} />
          <FInput label="Chave de acesso" value={form.accessKey} onChange={value => setForm(current => ({ ...current, accessKey:value }))} placeholder="Opcional" />
          <FInput label="Código de verificação" value={form.verificationCode} onChange={value => setForm(current => ({ ...current, verificationCode:value }))} placeholder="Opcional" />
          <FInput label={target?.direction === 'payable' ? 'Emitente' : 'Destinatário'} value={target?.direction === 'payable' ? form.issuerName : form.recipientName} onChange={value => setForm(current => target?.direction === 'payable' ? ({ ...current, issuerName:value }) : ({ ...current, recipientName:value }))} placeholder="Nome ou razão social" />
          <FInput label="Observações" value={form.notes} onChange={value => setForm(current => ({ ...current, notes:value }))} />
        </div>
        {error && <div style={{ color:C.red, fontSize:12, background:`${C.red}11`, border:`1px solid ${C.red}33`, borderRadius:8, padding:10 }}>{error}</div>}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
          {documents.length > 0 && <Btn variant="ghost" disabled={saving} onClick={() => setShowForm(false)}>Cancelar</Btn>}
          <Btn disabled={saving} onClick={save}>{saving ? 'Salvando...' : 'Salvar documento fiscal'}</Btn>
        </div>
      </div>}
    </div>
  </Modal>
}

