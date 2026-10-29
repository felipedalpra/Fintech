import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../theme.js'
import { fmt, formatDateBR } from '../utils.js'
import { Btn, Card, Modal } from './UI.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { parseStatementFile, statementTotals, updateStatementLine } from '../lib/statementParser.js'
import { mergeApprovedStatementRecords } from '../lib/statementImportReview.js'
import { approvableFinancialImportItem, buildFinancialImportReview, prepareFinancialImportLines } from '../lib/financialImport.js'
import { batchProgress, restoreReviewState } from '../lib/financialImportBatch.js'
import { closeBatch, createBatch, findActiveBatch, findResumableBatch, loadBatchLines, loadBatchStatuses, markLinesApproved, saveLineEdit, saveLinesDecision } from '../lib/financialImportStore.js'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_LINES = 50_000
const IMPORT_BATCH_SIZE = 50

function metadataOf(line) {
  return line.sourceMetadata || line.source_metadata || {}
}

function reviewLabel(item, rejected, approved) {
  if (approved) return { text:'Importado', color:C.green }
  if (rejected) return { text:'Rejeitado', color:C.textDim }
  if (item.reviewStatus === 'existing') return { text:'Já existe', color:C.green }
  if (item.reviewStatus === 'possible_duplicate') return { text:'Possível duplicado', color:C.yellow }
  if (item.reviewStatus === 'review') return { text:'Revisar', color:C.yellow }
  return { text:'Novo', color:C.accentLight }
}

export function FinancialImport({ data, saveDataNow }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const fileRef = useRef(null)
  // Lote persistido da revisão. null = revisão só em memória (migration ausente ou mapeamento
  // de colunas ainda pendente). Ver spec 2026-10-29-financial-import-review-persistence.md.
  const [batch, setBatch] = useState(null)
  const [reviewPersisted, setReviewPersisted] = useState(true)
  const [resumable, setResumable] = useState(null)
  const [resumableProgress, setResumableProgress] = useState(null)
  const [sourceFile, setSourceFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [lines, setLines] = useState([])
  const [mapping, setMapping] = useState({})
  const [selectedIds, setSelectedIds] = useState([])
  const [rejectedIds, setRejectedIds] = useState([])
  const [approvedIds, setApprovedIds] = useState([])
  const [editingId, setEditingId] = useState('')
  const [editDraft, setEditDraft] = useState(null)
  const [confirmItems, setConfirmItems] = useState([])
  const [importProgress, setImportProgress] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 820

  const s = {
    stack:{ display:'flex', flexDirection:'column', gap:16 },
    row:{ display:'flex', alignItems:'center', gap:9, flexWrap:'wrap' },
    input:{ width:'100%', boxSizing:'border-box', background:C.input || C.surface, color:C.text, border:`1px solid ${C.border}`, borderRadius:10, padding:'10px 12px', fontFamily:'inherit', fontSize:13 },
    label:{ display:'block', color:C.textDim, fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 },
    muted:{ color:C.textSub, fontSize:12.5, lineHeight:1.5 },
  }

  const reviewItems = useMemo(() => buildFinancialImportReview(lines, data, parsed?.fileName || ''), [lines, data, parsed?.fileName])
  const reviewById = useMemo(() => new Map(reviewItems.map(item => [item.line.id, item])), [reviewItems])
  const approvable = useMemo(() => reviewItems.filter(item => approvableFinancialImportItem(item) && !rejectedIds.includes(item.line.id) && !approvedIds.includes(item.line.id)), [reviewItems, rejectedIds, approvedIds])
  const pending = useMemo(() => reviewItems.filter(item => !rejectedIds.includes(item.line.id) && !approvedIds.includes(item.line.id)), [reviewItems, rejectedIds, approvedIds])
  const visibleItems = useMemo(() => reviewItems.filter(item => {
    const rejected = rejectedIds.includes(item.line.id)
    const approved = approvedIds.includes(item.line.id)
    const status = approved ? 'approved' : rejected ? 'rejected' : item.reviewStatus
    if (filter !== 'all' && status !== filter) return false
    const query = search.trim().toLowerCase()
    if (!query) return true
    const metadata = metadataOf(item.line)
    return `${item.line.description} ${item.line.amount} ${item.line.postedDate} ${metadata.category || ''} ${metadata.reference || ''}`.toLowerCase().includes(query)
  }), [reviewItems, rejectedIds, approvedIds, filter, search])
  const totals = useMemo(() => statementTotals(lines), [lines])
  const counts = useMemo(() => reviewItems.reduce((acc, item) => {
    const status = approvedIds.includes(item.line.id) ? 'approved' : rejectedIds.includes(item.line.id) ? 'rejected' : item.reviewStatus
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {}), [reviewItems, rejectedIds, approvedIds])

  // Oferece retomar uma revisão deixada pela metade, sem precisar do arquivo em mãos.
  useEffect(() => {
    if (!ownerId) return undefined
    let active = true
    findResumableBatch(ownerId).then(result => {
      if (!active) return
      if (result.schemaMissing) { setReviewPersisted(false); return }
      if (!result.batch) return
      setResumable(result.batch)
      loadBatchStatuses(result.batch.id).then(statuses => {
        if (active && statuses.rows) setResumableProgress(batchProgress(statuses.rows))
      }).catch(() => {})
    }).catch(() => {})
    return () => { active = false }
  }, [ownerId])

  function resetReview(result, file, preparedLines) {
    setParsed(result)
    setLines(preparedLines || prepareFinancialImportLines(result))
    setMapping(result.mapping || {})
    setSourceFile(file)
    setSelectedIds([])
    setRejectedIds([])
    setApprovedIds([])
    setImportProgress(null)
    setEditingId('')
    setEditDraft(null)
  }

  // Grava o lote ANTES de liberar a revisão. Se a gravação falhar, a usuária é bloqueada na
  // entrada com o motivo — é melhor que perder horas de classificação no fim, que foi o que
  // aconteceu quando a revisão vivia só na memória da aba.
  async function startReview(result, file) {
    const preparedLines = prepareFinancialImportLines(result)
    const parsedWithIds = { ...result, lines:preparedLines }
    if (!ownerId || !user?.id) throw new Error('Clínica não identificada. Recarregue a página antes de importar.')

    const existing = await findActiveBatch(ownerId, result.fileHash, result.sheetName)
    if (existing.schemaMissing) {
      setBatch(null)
      setReviewPersisted(false)
      resetReview(result, file, preparedLines)
      return
    }
    if (existing.error) throw new Error('Não foi possível verificar importações anteriores desta planilha. Tente novamente.')

    // Mesmo arquivo já em revisão: retoma as decisões gravadas em vez de começar de novo.
    if (existing.batch) {
      const loaded = await loadBatchLines(existing.batch.id)
      if (loaded.error || loaded.schemaMissing) throw new Error('Não foi possível carregar a revisão em andamento desta planilha.')
      const state = restoreReviewState(loaded.rows)
      resetReview(result, file, state.lines)
      setBatch(existing.batch)
      setApprovedIds(state.approvedIds)
      setRejectedIds(state.rejectedIds)
      setReviewPersisted(true)
      setResumable(null)
      toast(`Revisão retomada: ${state.approvedIds.length} já importada(s), ${state.rejectedIds.length} rejeitada(s).`)
      return
    }

    const created = await createBatch({ ownerId, actorId:user.id, parsed:parsedWithIds })
    if (created.schemaMissing) {
      setBatch(null)
      setReviewPersisted(false)
      resetReview(result, file, preparedLines)
      return
    }
    if (created.error) throw new Error(created.error.message || 'Não foi possível salvar a planilha para revisão. Nada foi importado.')
    resetReview(result, file, preparedLines)
    setBatch(created.batch)
    setReviewPersisted(true)
    setResumable(null)
  }

  async function parseFile(file, options = {}) {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) throw new Error('O arquivo excede o limite de 10 MB.')
    const result = await parseStatementFile(file, options)
    if (result.format !== 'xlsx') throw new Error('Use uma planilha Excel .xlsx ou .xls neste importador.')
    if (result.lines.length > MAX_LINES) throw new Error('A planilha excede o limite de 50.000 linhas.')
    // Mapeamento de colunas pendente: ainda não há linha nenhuma para gravar.
    if (result.requiresMapping) { setBatch(null); resetReview(result, file); return }
    await startReview(result, file)
  }

  // Retomada sem o arquivo: as linhas e as decisões já estão no banco.
  async function resumeBatch(batchRow) {
    setBusy(true)
    setError('')
    try {
      const loaded = await loadBatchLines(batchRow.id)
      if (loaded.error || loaded.schemaMissing) throw new Error('Não foi possível carregar a revisão em andamento.')
      const state = restoreReviewState(loaded.rows)
      resetReview({ fileName:batchRow.file_name, sheetName:batchRow.sheet_name, sheetNames:[], headers:[], errors:[], requiresMapping:false, mapping:{} }, null, state.lines)
      setBatch(batchRow)
      setApprovedIds(state.approvedIds)
      setRejectedIds(state.rejectedIds)
      setReviewPersisted(true)
      setResumable(null)
      setResumableProgress(null)
    } catch (caught) {
      setError(caught.message || 'Não foi possível retomar a revisão.')
    } finally {
      setBusy(false)
    }
  }

  // Uma decisão que não grava não pode passar como gravada: avisa e mantém o estado na tela.
  async function persistDecision(lineIds, decision) {
    if (!batch || !user?.id || !lineIds.length) return
    const result = await saveLinesDecision({ lineIds, decision, actorId:user.id })
    if (result?.schemaMissing) { setReviewPersisted(false); return }
    if (result?.error) setError('A decisão foi aplicada na tela, mas NÃO foi salva. Recarregue a página para ver o que está salvo de verdade.')
  }

  async function onFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await parseFile(file)
    } catch (caught) {
      setError(caught.message || 'Não foi possível interpretar a planilha.')
    } finally {
      setBusy(false)
    }
  }

  async function reparse(options) {
    if (!sourceFile) return
    setBusy(true)
    setError('')
    try {
      await parseFile(sourceFile, options)
    } catch (caught) {
      setError(caught.message || 'Não foi possível aplicar o mapeamento.')
    } finally {
      setBusy(false)
    }
  }

  function beginEdit(item) {
    const metadata = metadataOf(item.line)
    setEditingId(item.line.id)
    setEditDraft({
      postedDate:item.line.postedDate,
      description:item.line.description || '',
      amount:String(item.line.amount),
      category:metadata.category || '',
      costCenter:metadata.costCenter || '',
      reference:metadata.reference || '',
      observation:metadata.observation || '',
      chartAccountId:metadata.chartAccountId || '',
    })
  }

  async function saveEdit() {
    const target = lines.find(line => line.id === editingId)
    if (!target) return
    let updatedLine
    try {
      const updated = updateStatementLine(target, editDraft)
      updatedLine = { ...updated, id:target.id, sourceMetadata:{ ...updated.sourceMetadata, chartAccountId:editDraft.chartAccountId || '' } }
    } catch (caught) {
      setError(caught.message || 'Não foi possível validar a edição.')
      return
    }
    setLines(current => current.map(line => (line.id === editingId ? updatedLine : line)))
    setRejectedIds(current => current.filter(id => id !== editingId))
    setApprovedIds(current => current.filter(id => id !== editingId))
    setEditingId('')
    setEditDraft(null)
    setError('')
    if (!batch || !user?.id) return
    const result = await saveLineEdit({ lineId:updatedLine.id, line:updatedLine, actorId:user.id })
    if (result?.schemaMissing) setReviewPersisted(false)
    else if (result?.error) setError('A edição foi aplicada na tela, mas NÃO foi salva. Recarregue a página para ver o que está salvo de verdade.')
  }

  function toggleSelection(id, checked) {
    setSelectedIds(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id))
  }

  function reject(items) {
    const ids = items.map(item => item.line.id).filter(id => !approvedIds.includes(id))
    setRejectedIds(current => [...new Set([...current, ...ids])])
    setSelectedIds(current => current.filter(id => !ids.includes(id)))
    persistDecision(ids, 'reject')
  }

  function reopen(id) {
    setRejectedIds(current => current.filter(item => item !== id))
    persistDecision([id], 'reopen')
  }

  function requestApproval(items) {
    const eligible = items.filter(item => approvableFinancialImportItem(item) && !rejectedIds.includes(item.line.id) && !approvedIds.includes(item.line.id))
    if (!eligible.length) {
      setError('Selecione lançamentos novos. Duplicados e possíveis transferências precisam ser revisados ou rejeitados.')
      return
    }
    setImportProgress(null)
    setConfirmItems(eligible)
  }

  async function approveConfirmed() {
    if (!confirmItems.length || !saveDataNow) return
    const retrying = importProgress?.status === 'error'
    const baseCompleted = retrying ? importProgress.completed : 0
    const overallTotal = retrying ? importProgress.total : confirmItems.length
    const creations = confirmItems.map(item => ({ ...item, reviewStatus:'new' }))
    let completed = baseCompleted
    setBusy(true)
    setError('')
    setImportProgress({ status:'running', completed, total:overallTotal })
    try {
      // `chunk`, não `batch`: `batch` é o lote persistido da revisão.
      for (let offset = 0; offset < creations.length; offset += IMPORT_BATCH_SIZE) {
        const chunk = creations.slice(offset, offset + IMPORT_BATCH_SIZE)
        const operations = chunk.map(item => ({ collection:item.proposal.collection, record:item.proposal.record }))
        await saveDataNow(current => mergeApprovedStatementRecords(current, chunk), { operations })
        const ids = chunk.map(item => item.line.id)
        // Marca no lote só DEPOIS do bloco confirmado no financeiro. É isso que faz uma
        // confirmação interrompida no bloco 2 de 4 retomar exatamente nos blocos restantes.
        if (batch && user?.id) {
          const marked = await markLinesApproved({ lineIds:ids, actorId:user.id })
          if (marked?.schemaMissing) setReviewPersisted(false)
        }
        completed += ids.length
        setApprovedIds(current => [...new Set([...current, ...ids])])
        setSelectedIds(current => current.filter(id => !ids.includes(id)))
        setImportProgress({ status:'running', completed, total:overallTotal })
      }
      // Lote sem nenhuma linha aguardando decisão vira histórico e para de ser oferecido.
      const decided = new Set([...approvedIds, ...rejectedIds, ...creations.map(item => item.line.id)])
      const stillOpen = reviewItems.some(item => item.reviewStatus !== 'existing' && !decided.has(item.line.id))
      if (batch && !stillOpen) await closeBatch(batch.id)
      setImportProgress({ status:'complete', completed:overallTotal, total:overallTotal })
      toast(`${overallTotal} lançamento(s) importados e confirmados no financeiro.`)
    } catch (caught) {
      const remaining = creations.slice(completed - baseCompleted)
      setConfirmItems(remaining)
      setImportProgress({ status:'error', completed, total:overallTotal })
      setError(`${completed} de ${overallTotal} lançamento(s) foram confirmados. A importação parou com segurança antes dos restantes. ${caught.message || 'O banco não confirmou o próximo bloco.'}`)
    } finally {
      setBusy(false)
    }
  }

  function closeImportModal() {
    if (busy) return
    setConfirmItems([])
    setImportProgress(null)
  }

  const selectedItems = selectedIds.map(id => reviewById.get(id)).filter(Boolean)

  return (
    <div style={s.stack} data-testid="financial-import-page">
      <style>{`@keyframes financialImportSpin { to { transform: rotate(360deg); } }`}</style>
      {error && <div role="alert" style={{ padding:'12px 14px', borderRadius:10, color:C.red, background:`${C.red}12`, border:`1px solid ${C.red}55`, fontSize:13 }}>{error}</div>}

      {!reviewPersisted && <div role="alert" data-testid="financial-import-unsaved-warning" style={{ padding:'12px 14px', borderRadius:10, color:C.yellow, background:`${C.yellow}12`, border:`1px solid ${C.yellow}55`, fontSize:13, lineHeight:1.5 }}>
        <strong>A revisão desta planilha não está sendo salva.</strong> A migração <code>financial_import_batches_schema.sql</code> ainda não foi aplicada neste banco, então as suas decisões existem apenas nesta aba — fechar ou recarregar a página perde o trabalho. Os lançamentos já aprovados estão salvos normalmente no financeiro.
      </div>}

      {resumable && !parsed && <Card data-testid="financial-import-resume">
        <div style={{ ...s.row, justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ color:C.text, fontSize:15, fontWeight:900 }}>Você tem uma revisão em andamento</div>
            <div style={{ ...s.muted, marginTop:5 }}><strong>{resumable.file_name}</strong> · {resumable.line_count} linha(s) · iniciada em {formatDateBR(String(resumable.created_at).slice(0, 10))}</div>
            <div style={{ ...s.muted, marginTop:4 }}>Continue de onde parou, sem precisar subir a planilha de novo.</div>
          </div>
          <Btn variant="success" onClick={() => resumeBatch(resumable)} disabled={busy}>Retomar revisão</Btn>
        </div>
      </Card>}

      <Card>
        <div style={{ ...s.row, justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ color:C.text, fontSize:18, fontWeight:900 }}>Importar lançamentos retroativos</div>
            <div style={{ ...s.muted, marginTop:5, maxWidth:760 }}>Envie a planilha da clínica, revise receitas e despesas e só então aprove o que deve entrar no financeiro. Nenhuma conta bancária é necessária e nada é criado apenas ao escolher o arquivo.</div>
          </div>
          <span style={{ color:C.green, background:`${C.green}12`, border:`1px solid ${C.green}44`, borderRadius:999, padding:'5px 10px', fontSize:11, fontWeight:800 }}>Excel · processamento no navegador</span>
        </div>
        <label style={{ ...s.label, marginTop:18 }}>Planilha de lançamentos</label>
        <input ref={fileRef} aria-label="Planilha de lançamentos" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={onFileChange} style={{ ...s.input, cursor:'pointer' }} />
        <div style={{ ...s.muted, marginTop:6 }}>Até 10 MB e 50.000 linhas. O arquivo bruto não é enviado nem armazenado.</div>

        {parsed?.sheetNames?.length > 1 && <label style={{ ...s.label, marginTop:14, maxWidth:340 }}>Aba da planilha
          <select aria-label="Aba da planilha" value={parsed.sheetName || ''} onChange={event => reparse({ sheetName:event.target.value })} style={{ ...s.input, marginTop:6, textTransform:'none', letterSpacing:'normal' }}>
            {parsed.sheetNames.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>}

        {parsed?.requiresMapping && <div style={{ marginTop:18, padding:14, borderRadius:12, border:`1px solid ${C.yellow}44`, background:`${C.yellow}0D` }}>
          <div style={{ color:C.yellow, fontWeight:800, marginBottom:10 }}>Confirme quais colunas representam cada dado</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10 }}>
            {[["date","Data"],["description","Descrição"],["amount","Valor assinado"],["credit","Receita"],["debit","Despesa"],["category","Categoria"],["costCenter","Centro de custo"],["reference","Paciente/contrato"],["observation","Observação"]].map(([key, label]) => <label key={key} style={{ color:C.textSub, fontSize:12 }}>{label}
              <select value={mapping[key] ?? -1} onChange={event => setMapping(current => ({ ...current, [key]:Number(event.target.value) }))} style={{ ...s.input, marginTop:5 }}>
                <option value={-1}>Não usar</option>
                {parsed.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `Coluna ${index + 1}`}</option>)}
              </select>
            </label>)}
          </div>
          <div style={{ marginTop:12 }}><Btn onClick={() => reparse({ mapping, sheetName:parsed.sheetName, headerRow:parsed.headerRow })} disabled={busy}>Aplicar mapeamento</Btn></div>
        </div>}
      </Card>

      {parsed && !parsed.requiresMapping && <>
        <Card data-testid="financial-import-summary">
          <div style={{ ...s.row, justifyContent:'space-between' }}>
            <div><strong style={{ color:C.text }}>{parsed.fileName}</strong><div style={{ ...s.muted, marginTop:4 }}>{lines.length} de {lines.length} linhas exibidas · entradas {fmt(totals.receipts)} · saídas {fmt(totals.expenses)} · líquido {fmt(totals.net)}</div>
              {batch && <div style={{ color:C.green, fontSize:12, fontWeight:700, marginTop:4 }} data-testid="financial-import-saved-review">● Revisão salva — pode fechar a aba e voltar depois</div>}</div>
            <div style={s.row}><Btn variant="ghost" onClick={() => reject(pending)}>Rejeitar todas pendentes</Btn><Btn variant="success" onClick={() => requestApproval(approvable)} disabled={!approvable.length || busy}>Aprovar todas elegíveis ({approvable.length})</Btn></div>
          </div>
          {parsed.errors.length > 0 && <div style={{ color:C.red, fontSize:12, lineHeight:1.6, marginTop:12 }}><strong>{parsed.errors.length} linha(s) inválida(s) não foram incluídas:</strong>{parsed.errors.map(item => <div key={`${item.line}-${item.reason}`}>Linha {item.line}: {item.reason}</div>)}</div>}
          <div style={{ display:'grid', gridTemplateColumns:isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(6,minmax(100px,1fr))', gap:8, marginTop:16 }}>
            {[["new","Novos",counts.new || 0,C.accentLight],["existing","Já existem",counts.existing || 0,C.green],["possible_duplicate","Duplicados",counts.possible_duplicate || 0,C.yellow],["review","Revisar",counts.review || 0,C.yellow],["approved","Importados",counts.approved || 0,C.green],["rejected","Rejeitados",counts.rejected || 0,C.textDim]].map(([key,label,value,color]) => <button key={key} type="button" onClick={() => setFilter(filter === key ? 'all' : key)} style={{ padding:10, textAlign:'left', borderRadius:10, cursor:'pointer', color:C.text, background:filter === key ? `${color}14` : 'transparent', border:`1px solid ${filter === key ? color : C.border}` }}><div style={{ color, fontSize:10, fontWeight:800, textTransform:'uppercase' }}>{label}</div><div style={{ fontSize:20, fontWeight:900, marginTop:3 }}>{value}</div></button>)}
          </div>
          <div style={{ ...s.row, marginTop:14 }}>
            <input aria-label="Buscar lançamentos importados" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar descrição, categoria, data ou valor…" style={{ ...s.input, flex:'1 1 260px' }} />
            <Btn variant="ghost" onClick={() => reject(selectedItems)} disabled={!selectedItems.length}>Rejeitar selecionados ({selectedItems.length})</Btn>
            <Btn variant="success" onClick={() => requestApproval(selectedItems)} disabled={!selectedItems.some(approvableFinancialImportItem) || busy}>Aprovar selecionados ({selectedItems.length})</Btn>
          </div>
        </Card>

        <div style={{ display:'grid', gap:10 }} data-testid="financial-import-lines">
          {visibleItems.map(item => {
            const rejected = rejectedIds.includes(item.line.id)
            const approved = approvedIds.includes(item.line.id)
            const status = reviewLabel(item, rejected, approved)
            const canApprove = approvableFinancialImportItem(item) && !rejected && !approved
            const metadata = metadataOf(item.line)
            const existing = item.recommendedCandidate?.installment?.financial_entries || item.recommendedCandidate?.installment?.entry
            return <Card key={item.line.id} ariaLabel={`Lançamento linha ${item.line.lineIndex}`} style={{ padding:14, border:`1px solid ${status.color}44` }}>
              <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'auto minmax(0,1.4fr) minmax(180px,0.8fr) auto', gap:12, alignItems:'center' }}>
                <input type="checkbox" aria-label={`Selecionar linha ${item.line.lineIndex}`} checked={selectedIds.includes(item.line.id)} disabled={approved} onChange={event => toggleSelection(item.line.id, event.target.checked)} />
                <div>
                  <div style={s.row}><span style={{ color:status.color, background:`${status.color}14`, border:`1px solid ${status.color}44`, borderRadius:999, padding:'3px 8px', fontSize:10.5, fontWeight:800 }}>{status.text}</span><span style={s.muted}>Linha {item.line.lineIndex} · {formatDateBR(item.line.postedDate)}</span></div>
                  <div style={{ color:C.text, fontWeight:800, marginTop:7, overflowWrap:'anywhere' }}>{item.line.description || 'Sem descrição'}</div>
                  <div style={{ ...s.muted, marginTop:4 }}>{metadata.category || 'Sem categoria'} · {metadata.costCenter || 'Sem centro de custo'}{metadata.reference ? ` · ${metadata.reference}` : ''}</div>
                  {item.proposal.reasons.map(reason => <div key={reason} style={{ color:C.yellow, fontSize:11.5, marginTop:3 }}>⚠ {reason}</div>)}
                  {existing && <div style={{ color:C.green, fontSize:11.5, marginTop:4 }}>Correspondência existente: {existing.description || existing.category} · {formatDateBR(existing.competence_date)}</div>}
                </div>
                <div><div style={{ color:item.line.amount > 0 ? C.green : C.red, fontWeight:900, fontSize:16 }}>{fmt(item.line.amount)}</div><div style={{ ...s.muted, marginTop:4 }}>{item.line.amount > 0 ? 'Receita recebida' : 'Despesa paga'} · {item.proposal.accountName}</div></div>
                <div style={{ ...s.row, justifyContent:isMobile ? 'flex-start' : 'flex-end' }}>
                  <Btn variant="ghost" onClick={() => beginEdit(item)} disabled={approved}>Editar</Btn>
                  {rejected ? <Btn variant="ghost" onClick={() => reopen(item.line.id)}>Reabrir</Btn> : <Btn variant="ghost" onClick={() => reject([item])} disabled={approved}>Rejeitar</Btn>}
                  {canApprove && <Btn variant="success" onClick={() => requestApproval([item])}>Aprovar</Btn>}
                </div>
              </div>
            </Card>
          })}
          {visibleItems.length === 0 && <Card><div style={s.muted}>Nenhum lançamento encontrado neste filtro.</div></Card>}
        </div>
      </>}

      <Modal open={Boolean(editingId && editDraft)} onClose={() => { setEditingId(''); setEditDraft(null) }} title="Editar lançamento sugerido" width={720} trackDirty={false}>
        {editDraft && <div style={s.stack}>
          <div style={s.muted}>A edição altera somente esta sugestão. O financeiro continua intacto até a aprovação.</div>
          <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1fr 1fr', gap:12 }}>
            <label style={s.label}>Data<input aria-label="Data do lançamento" type="date" value={editDraft.postedDate} onChange={event => setEditDraft(current => ({ ...current, postedDate:event.target.value }))} style={{ ...s.input, marginTop:5 }} /></label>
            <label style={s.label}>Valor assinado<input aria-label="Valor do lançamento" inputMode="decimal" value={editDraft.amount} onChange={event => setEditDraft(current => ({ ...current, amount:event.target.value }))} style={{ ...s.input, marginTop:5 }} /><span style={{ display:'block', marginTop:4, textTransform:'none', letterSpacing:0, fontWeight:500 }}>Positivo = receita; negativo = despesa.</span></label>
          </div>
          <label style={s.label}>Descrição<input aria-label="Descrição do lançamento" value={editDraft.description} onChange={event => setEditDraft(current => ({ ...current, description:event.target.value }))} style={{ ...s.input, marginTop:5 }} /></label>
          <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1fr 1fr', gap:12 }}>
            <label style={s.label}>Plano de contas<select aria-label="Plano de contas do lançamento" value={editDraft.chartAccountId} onChange={event => setEditDraft(current => ({ ...current, chartAccountId:event.target.value }))} style={{ ...s.input, marginTop:5 }}><option value="">Sugerir pela categoria</option>{(data.chartAccounts || []).filter(account => account.nodeType === 'account' && account.isActive !== false).map(account => <option key={account.id} value={account.id}>{account.code ? `${account.code} · ` : ''}{account.name}</option>)}</select></label>
            <label style={s.label}>Categoria da planilha<input aria-label="Categoria do lançamento" value={editDraft.category} onChange={event => setEditDraft(current => ({ ...current, category:event.target.value }))} style={{ ...s.input, marginTop:5 }} /></label>
            <label style={s.label}>Centro de custo<input aria-label="Centro de custo do lançamento" value={editDraft.costCenter} onChange={event => setEditDraft(current => ({ ...current, costCenter:event.target.value }))} style={{ ...s.input, marginTop:5 }} /></label>
            <label style={s.label}>Paciente ou contrato<input aria-label="Referência do lançamento" value={editDraft.reference} onChange={event => setEditDraft(current => ({ ...current, reference:event.target.value }))} style={{ ...s.input, marginTop:5 }} /></label>
          </div>
          <label style={s.label}>Observação<input aria-label="Observação do lançamento" value={editDraft.observation} onChange={event => setEditDraft(current => ({ ...current, observation:event.target.value }))} style={{ ...s.input, marginTop:5 }} /></label>
          <div style={{ ...s.row, justifyContent:'flex-end' }}><Btn variant="ghost" onClick={() => { setEditingId(''); setEditDraft(null) }}>Cancelar</Btn><Btn onClick={saveEdit}>Aplicar edição</Btn></div>
        </div>}
      </Modal>

      <Modal open={confirmItems.length > 0} onClose={closeImportModal} closeOnBackdrop={!busy} title={importProgress?.status === 'complete' ? 'Importação concluída' : importProgress ? 'Importando lançamentos' : 'Confirmar importação financeira'} width={600} trackDirty={false}>
        <div style={s.stack}>
          {!importProgress && <>
            <div style={s.muted}>Serão criados {confirmItems.length} lançamento(s) no razão canônico. Os que já existem, foram rejeitados ou parecem transferências não entram nesta confirmação.</div>
            <Card style={{ padding:14 }}><strong style={{ color:C.text }}>Entradas {fmt(confirmItems.filter(item => item.line.amount > 0).reduce((sum, item) => sum + item.line.amount, 0))}</strong><div style={{ color:C.red, fontWeight:800, marginTop:5 }}>Saídas {fmt(confirmItems.filter(item => item.line.amount < 0).reduce((sum, item) => sum + Math.abs(item.line.amount), 0))}</div></Card>
            <div style={{ color:C.yellow, fontSize:12 }}>Competência, vencimento e caixa usarão a data da planilha. Edite a linha antes de aprovar caso alguma dessas datas precise ser diferente.</div>
            <div style={{ ...s.row, justifyContent:'flex-end' }}><Btn variant="ghost" onClick={closeImportModal}>Cancelar</Btn><Btn variant="success" onClick={approveConfirmed}>Confirmar e salvar</Btn></div>
          </>}
          {importProgress && <div aria-live="polite" data-testid="financial-import-progress" style={{ textAlign:'center', padding:'8px 0 2px' }}>
            <div style={{ width:46, height:46, margin:'0 auto 16px', borderRadius:'50%', border:`4px solid ${C.border}`, borderTopColor:importProgress.status === 'error' ? C.red : C.green, animation:importProgress.status === 'running' ? 'financialImportSpin .8s linear infinite' : 'none', display:'flex', alignItems:'center', justifyContent:'center', color:importProgress.status === 'complete' ? C.green : C.text }}>
              {importProgress.status === 'complete' ? '✓' : importProgress.status === 'error' ? '!' : ''}
            </div>
            <div style={{ color:C.text, fontSize:17, fontWeight:900 }}>{importProgress.status === 'complete' ? 'Todos os lançamentos foram importados' : importProgress.status === 'error' ? 'A importação foi interrompida' : 'Seus lançamentos estão sendo importados'}</div>
            <div style={{ color:importProgress.status === 'error' ? C.red : C.textSub, fontSize:14, fontWeight:800, marginTop:8 }}>{importProgress.completed} de {importProgress.total} importados</div>
            <div style={{ height:9, background:C.border, borderRadius:999, overflow:'hidden', marginTop:16 }}>
              <div style={{ width:`${Math.min(100, Math.round((importProgress.completed / Math.max(1, importProgress.total)) * 100))}%`, height:'100%', borderRadius:999, background:importProgress.status === 'error' ? C.red : C.green, transition:'width .25s ease' }} />
            </div>
            {importProgress.status === 'running' && <div style={{ ...s.muted, marginTop:12 }}>Mantenha esta janela aberta. Cada número exibido já foi confirmado no servidor.</div>}
            {importProgress.status === 'complete' && <div style={{ ...s.row, justifyContent:'center', marginTop:18 }}><Btn variant="success" onClick={closeImportModal}>Concluir</Btn></div>}
            {importProgress.status === 'error' && <div style={{ ...s.row, justifyContent:'center', marginTop:18 }}><Btn variant="ghost" onClick={closeImportModal}>Fechar</Btn><Btn variant="success" onClick={approveConfirmed}>Tentar importar os restantes ({confirmItems.length})</Btn></div>}
          </div>}
        </div>
      </Modal>
    </div>
  )
}
