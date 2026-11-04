import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { fmt, formatDateBR } from '../utils.js'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Badge, Card, FInput } from './UI.jsx'
import { fiscalDocumentLabel, fiscalDocumentsSearchText } from '../lib/fiscalDocuments.js'
import { loadFiscalDocuments } from '../lib/fiscalDocumentStore.js'

export function FiscalDocuments() {
  const { ownerId } = useUserRole()
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ search:'', status:'all', direction:'all' })

  useEffect(() => {
    let active = true
    setLoading(true)
    loadFiscalDocuments(ownerId).then(result => {
      if (!active) return
      setDocuments(result.documents)
      setSchemaMissing(result.schemaMissing)
      setError('')
    }).catch(cause => active && setError(cause?.message || 'Falha ao carregar documentos fiscais.')).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [ownerId])

  const filtered = useMemo(() => documents.filter(document => {
    if (filters.status !== 'all' && document.status !== filters.status) return false
    if (filters.direction !== 'all' && document.direction !== filters.direction) return false
    if (!filters.search.trim()) return true
    const entryText = document.allocations?.map(allocation => allocation.financialEntry?.description || '').join(' ') || ''
    return `${fiscalDocumentsSearchText([document])} ${entryText}`.toLowerCase().includes(filters.search.toLowerCase().trim())
  }), [documents, filters])

  return <div style={{ display:'grid', gap:16 }} data-testid="fiscal-documents-page">
    <Card style={{ padding:18 }}>
      <div style={{ color:C.text, fontSize:18, fontWeight:850 }}>Documentos fiscais</div>
      <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6, marginTop:5 }}>Notas emitidas e recebidas vinculadas aos títulos financeiros. O vínculo é único por título e se mantém em todas as parcelas.</div>
    </Card>
    {schemaMissing && <Card style={{ padding:16, border:`1px solid ${C.yellow}66`, color:C.yellow }}>A estrutura de documentos fiscais ainda não foi aplicada no banco. Execute <code>supabase/fiscal_documents_schema.sql</code>.</Card>}
    {error && <Card style={{ padding:16, border:`1px solid ${C.red}66`, color:C.red }}>{error}</Card>}
    <Card style={{ padding:14 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))', gap:10 }}>
        <FInput label="Buscar por número, chave ou lançamento" value={filters.search} onChange={value => setFilters(current => ({ ...current, search:value }))} />
        <FInput label="Status" value={filters.status} onChange={value => setFilters(current => ({ ...current, status:value }))} options={[{ v:'all', l:'Todos' }, { v:'pending', l:'Pendente' }, { v:'issued', l:'Emitida' }, { v:'received', l:'Recebida' }, { v:'canceled', l:'Cancelada' }, { v:'replaced', l:'Substituída' }]} />
        <FInput label="Fluxo" value={filters.direction} onChange={value => setFilters(current => ({ ...current, direction:value }))} options={[{ v:'all', l:'Todos' }, { v:'issued', l:'Emitidas' }, { v:'received', l:'Recebidas' }]} />
      </div>
    </Card>
    <Card style={{ padding:0, overflow:'hidden' }}>
      {loading ? <div style={{ padding:28, color:C.textSub }}>Carregando documentos fiscais...</div> : filtered.length === 0 ? <div style={{ padding:28, color:C.textSub, textAlign:'center' }}>Nenhum documento fiscal encontrado.</div> : <div style={{ overflowX:'auto' }}><table style={{ width:'100%', borderCollapse:'collapse' }}><thead><tr>{['Documento','Emissão','Lançamento','Fluxo','Valor','Status'].map(label => <th key={label} style={{ padding:'12px 14px', textAlign:'left', color:C.textDim, fontSize:10, textTransform:'uppercase', borderBottom:`1px solid ${C.border}` }}>{label}</th>)}</tr></thead><tbody>{filtered.map(document => <tr key={document.id}><td style={{ padding:14, color:C.text, fontWeight:750, borderBottom:`1px solid ${C.border}44` }}>{fiscalDocumentLabel(document)}</td><td style={{ padding:14, color:C.textSub, borderBottom:`1px solid ${C.border}44` }}>{formatDateBR(document.issue_date)}</td><td style={{ padding:14, color:C.textSub, borderBottom:`1px solid ${C.border}44` }}>{document.allocations?.map(allocation => allocation.financialEntry?.description).filter(Boolean).join(', ') || '—'}</td><td style={{ padding:14, color:C.textSub, borderBottom:`1px solid ${C.border}44` }}>{document.direction === 'issued' ? 'Emitida' : 'Recebida'}</td><td style={{ padding:14, color:C.text, fontWeight:700, borderBottom:`1px solid ${C.border}44` }}>{fmt(Number(document.total_amount || 0))}</td><td style={{ padding:14, borderBottom:`1px solid ${C.border}44` }}><Badge color={document.status === 'canceled' ? C.red : document.status === 'pending' ? C.yellow : C.green} small>{document.status}</Badge></td></tr>)}</tbody></table></div>}
    </Card>
  </div>
}

