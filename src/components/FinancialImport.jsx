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
import { batchProgress, isBatchComplete, restoreReviewState } from '../lib/financialImportBatch.js'
import { canCancelImport, canDiscardImport, canResumeImport, importCancelBlockedMessage, importHistoryStatus, removeCanceledImportSources } from '../lib/financialImportHistory.js'
import { approveFinancialImportLines, cancelFinancialImportBatch, closeBatch, createBatch, discardFinancialImportBatch, findActiveBatch, findResumableBatch, loadBatchLines, loadBatchStatuses, loadImportHistory, reopenBatch, saveLineEdit, saveLinesDecision } from '../lib/financialImportStore.js'

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

export function FinancialImport({ data, applyServerConfirmedData }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const fileRef = useRef(null)
  // Lote persistido da revisão. A revisão só é liberada depois de o banco confirmar o lote.
  const [batch, setBatch] = useState(null)
  const [reviewPersisted, setReviewPersisted] = useState(true)
  const [resumable, setResumable] = useState(null)
  const [resumableProgress, setResumableProgress] = useState(null)
  const [incompleteBatch, setIncompleteBatch] = useState(null)
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
  // Abre em 'new' e só salta para o histórico quando o banco confirma que existe histórico: numa
  // clínica que nunca importou, cair numa lista vazia esconderia a única ação possível. O salto
  // acontece UMA vez e nunca por cima de uma escolha da usuária (viewTouchedRef).
  const [view, setView] = useState('new')
  const viewTouchedRef = useRef(false)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [discardTarget, setDiscardTarget] = useState(null)
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

  async function refreshHistory() {
    if (!ownerId) return
    setHistoryLoading(true)
    const result = await loadImportHistory()
    setHistoryLoading(false)
    if (result.schemaMissing) {
      setHistoryError('Aplique financial_import_batch_cancellation.sql para ativar o histórico e o cancelamento seguro.')
      return
    }
    if (result.error) {
      setHistoryError('Não foi possível carregar o histórico de importações. Tente novamente.')
      return
    }
    setHistory(result.batches)
    setHistoryError('')
    if (!viewTouchedRef.current && (result.batches || []).length > 0) {
      viewTouchedRef.current = true
      setView('history')
    }
  }

  useEffect(() => {
    refreshHistory().catch(() => setHistoryError('Não foi possível carregar o histórico de importações.'))
  }, [ownerId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Oferece retomar uma revisão deixada pela metade, sem precisar do arquivo em mãos.
  useEffect(() => {
    if (!ownerId) return undefined
    let active = true
    findResumableBatch(ownerId).then(result => {
      if (!active) return
      if (result.schemaMissing) {
        setReviewPersisted(false)
        setError('A revisão de importações está indisponível porque as tabelas de persistência não existem neste banco. Nenhum arquivo será aberto sem salvamento.')
        return
      }
      if (result.error) {
        setError('Não foi possível verificar revisões salvas. Recarregue a página antes de importar.')
        return
      }
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
      setReviewPersisted(false)
      throw new Error('A revisão não pode ser iniciada: as tabelas de persistência ainda não existem neste banco. O arquivo não foi aberto e nenhuma decisão será perdida.')
    }
    if (existing.error) throw new Error('Não foi possível verificar importações anteriores desta planilha. Tente novamente.')

    // Mesmo arquivo+aba já tem lote: retoma as decisões gravadas em vez de começar de novo.
    if (existing.batch) {
      // Um lote concluído volta a 'reviewing' para que rejeições possam ser revistas.
      if (existing.batch.status === 'ready') {
        const reopened = await reopenBatch(existing.batch.id)
        if (reopened?.schemaMissing || reopened?.error) throw new Error('Não foi possível reabrir a revisão salva. Nada foi alterado.')
      }
      await applyPersistedBatch(existing.batch, result, file)
      return
    }

    const created = await createBatch({ ownerId, actorId:user.id, parsed:parsedWithIds })
    if (created.schemaMissing) {
      setReviewPersisted(false)
      throw new Error('A revisão não pode ser iniciada porque o banco não confirmou sua persistência. O arquivo não foi aberto.')
    }
    if (created.error) throw new Error(created.error.message || 'Não foi possível salvar a planilha para revisão. Nada foi importado.')
    const persistedState = restoreReviewState(created.rows)
    resetReview(result, file, persistedState.lines)
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

  // Carrega um lote persistido para a tela. Recusa lote INCOMPLETO: se a gravação das linhas foi
  // interrompida, abrir a revisão como se estivesse inteira esconderia linhas que nunca entrariam
  // no financeiro — a mesma perda silenciosa que esta feature veio impedir.
  async function applyPersistedBatch(batchRow, parsedShape, file) {
    const loaded = await loadBatchLines(batchRow.id)
    if (loaded.error || loaded.schemaMissing) throw new Error('Não foi possível carregar a revisão em andamento desta planilha.')
    // 'creating' = a gravação das linhas nunca terminou.
    if (batchRow.status === 'creating' || !isBatchComplete(loaded.rows, batchRow.line_count)) {
      setIncompleteBatch({ ...batchRow, loadedCount:loaded.rows.length })
      throw new Error(`A revisão salva desta planilha está incompleta (${loaded.rows.length} de ${batchRow.line_count} linha(s) gravadas): a gravação foi interrompida. Descarte-a abaixo para subir a planilha de novo.`)
    }
    const state = restoreReviewState(loaded.rows)
    resetReview(parsedShape, file, state.lines)
    setBatch(batchRow)
    setApprovedIds(state.approvedIds)
    setRejectedIds(state.rejectedIds)
    setReviewPersisted(true)
    setResumable(null)
    setResumableProgress(null)
    toast(`Revisão retomada: ${state.approvedIds.length} já importada(s), ${state.rejectedIds.length} rejeitada(s).`)
  }

  // Descarta um lote inutilizável (gravação interrompida). Sem isso o usuário ficaria preso: o lote
  // ocupa o índice único do arquivo, então todo upload novo bateria no mesmo erro.
  async function discardIncomplete() {
    if (!incompleteBatch) return
    setBusy(true)
    const result = await discardFinancialImportBatch(incompleteBatch.id, 'gravação interrompida')
    setBusy(false)
    if (result?.schemaMissing) {
      setError('O descarte seguro ainda não está instalado. Aplique financial_import_batch_discard.sql; nada foi alterado.')
      return
    }
    if (result?.error) { setError(result.error.message || 'Não foi possível descartar a revisão incompleta. Tente novamente.'); return }
    setIncompleteBatch(null)
    setResumable(null)
    setResumableProgress(null)
    setError('')
    refreshHistory().catch(() => {})
    toast('Revisão incompleta descartada. Suba a planilha novamente.')
  }

  // Retomada sem o arquivo: as linhas e as decisões já estão no banco.
  async function resumeBatch(batchRow) {
    viewTouchedRef.current = true
    setView('new')
    setBusy(true)
    setError('')
    try {
      await applyPersistedBatch(batchRow, { fileName:batchRow.file_name, sheetName:batchRow.sheet_name, sheetNames:[], headers:[], errors:[], requiresMapping:false, mapping:{} }, null)
    } catch (caught) {
      setError(caught.message || 'Não foi possível retomar a revisão.')
    } finally {
      setBusy(false)
    }
  }

  // Uma decisão só muda a tela DEPOIS de o banco confirmá-la.
  async function persistDecision(lineIds, decision) {
    if (!lineIds.length) return true
    if (!batch || !user?.id || !reviewPersisted) {
      setError('A revisão não está persistida. Recarregue a página antes de continuar.')
      return false
    }
    const result = await saveLinesDecision({ batchId:batch.id, lineIds, decision, actorId:user.id })
    if (result?.schemaMissing) setReviewPersisted(false)
    if (result?.schemaMissing || result?.error) {
      setError(`A decisão não foi totalmente confirmada e não foi aplicada na tela. ${result?.error?.message || 'Recarregue a página antes de continuar.'}`)
      return false
    }
    return true
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
    if (!batch || !user?.id || !reviewPersisted) {
      setError('A revisão não está persistida. A edição não foi aplicada.')
      return
    }
    const result = await saveLineEdit({ batchId:batch.id, lineId:updatedLine.id, line:updatedLine, actorId:user.id })
    if (result?.schemaMissing) setReviewPersisted(false)
    if (result?.schemaMissing || result?.error) {
      setError(`A edição não foi confirmada e não foi aplicada na tela. ${result?.error?.message || 'Recarregue a página antes de continuar.'}`)
      return
    }
    setLines(current => current.map(line => (line.id === editingId ? updatedLine : line)))
    setRejectedIds(current => current.filter(id => id !== editingId))
    setApprovedIds(current => current.filter(id => id !== editingId))
    setEditingId('')
    setEditDraft(null)
    setError('')
  }

  function toggleSelection(id, checked) {
    setSelectedIds(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id))
  }

  async function reject(items) {
    // Linha 'existing' já está no financeiro: rejeitá-la não significa nada e só distorceria o
    // progresso do lote.
    const ids = items.filter(item => item.reviewStatus !== 'existing').map(item => item.line.id).filter(id => !approvedIds.includes(id))
    if (await persistDecision(ids, 'reject')) {
      setRejectedIds(current => [...new Set([...current, ...ids])])
      setSelectedIds(current => current.filter(id => !ids.includes(id)))
    }
  }

  async function reopen(id) {
    if (await persistDecision([id], 'reopen')) setRejectedIds(current => current.filter(item => item !== id))
  }

  function requestApproval(items) {
    if (!batch || !reviewPersisted) {
      setError('A revisão não está confirmada no banco. Não é possível aprovar lançamentos.')
      return
    }
    const eligible = items.filter(item => approvableFinancialImportItem(item) && !rejectedIds.includes(item.line.id) && !approvedIds.includes(item.line.id))
    if (!eligible.length) {
      setError('Selecione lançamentos novos. Duplicados e possíveis transferências precisam ser revisados ou rejeitados.')
      return
    }
    setImportProgress(null)
    setConfirmItems(eligible)
  }

  async function approveConfirmed() {
    if (!confirmItems.length || !applyServerConfirmedData) return
    if (!batch || !reviewPersisted || !user?.id) {
      setError('A revisão não está confirmada no banco. Nenhum lançamento foi aprovado.')
      return
    }
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
        const approved = await approveFinancialImportLines({ batchId:batch.id, items:chunk })
        if (approved?.error) {
          const message = String(approved.error.message || '')
          if (/approve_financial_import_lines|schema cache|function/i.test(message)) {
            throw new Error('A aprovacao atomica ainda nao esta instalada no banco. Aplique financial_import_atomic_approval.sql e recarregue; nenhum lancamento deste bloco foi criado.')
          }
          throw approved.error
        }
        // O estado local muda somente DEPOIS da transacao confirmar origem + linha do lote.
        // Esta funcao tambem incorpora as origens no baseline da sessao, impedindo que o autosave
        // as interprete como ausentes e tente arquiva-las.
        applyServerConfirmedData(current => mergeApprovedStatementRecords(current, chunk))
        const ids = chunk.map(item => item.line.id)
        completed += ids.length
        setApprovedIds(current => [...new Set([...current, ...ids])])
        setSelectedIds(current => current.filter(id => !ids.includes(id)))
        setImportProgress({ status:'running', completed, total:overallTotal })
      }
      // Lote sem nenhuma linha aguardando decisão vira histórico e para de ser oferecido.
      const decided = new Set([...approvedIds, ...rejectedIds, ...creations.map(item => item.line.id)])
      const stillOpen = reviewItems.some(item => item.reviewStatus !== 'existing' && !decided.has(item.line.id))
      if (batch && !stillOpen) {
        const closed = await closeBatch(batch.id)
        if (closed?.schemaMissing || closed?.error) throw new Error('Os lançamentos foram importados, mas o encerramento da revisão não foi confirmado. Recarregue a página para conferir o estado salvo.')
      }
      setImportProgress({ status:'complete', completed:overallTotal, total:overallTotal })
      refreshHistory().catch(() => {})
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

  async function confirmCancellation() {
    if (!cancelTarget || cancelReason.trim().length < 3 || !applyServerConfirmedData) return
    setBusy(true)
    setError('')
    const canceled = await cancelFinancialImportBatch(cancelTarget.id, cancelReason)
    setBusy(false)
    if (canceled.schemaMissing) {
      setError('O cancelamento seguro ainda não está instalado. Aplique financial_import_batch_cancellation.sql; nenhum lançamento foi alterado.')
      return
    }
    if (canceled.error) {
      setError(canceled.error.message || 'Não foi possível cancelar a importação. Nenhum lançamento foi alterado.')
      return
    }
    applyServerConfirmedData(current => removeCanceledImportSources(current, canceled.result.source_ids || []))
    if (batch?.id === cancelTarget.id) {
      setBatch(null)
      setParsed(null)
      setLines([])
      setApprovedIds([])
      setRejectedIds([])
    }
    // Um lote cancelado nunca volta a ser retomável: deixar a oferta de retomada na tela abriria
    // uma revisão que o banco recusa.
    if (resumable?.id === cancelTarget.id) { setResumable(null); setResumableProgress(null) }
    setCancelTarget(null)
    setCancelReason('')
    await refreshHistory()
    toast(`${canceled.result.approved_count} lançamento(s) retirado(s) do financeiro. O histórico foi preservado.`)
  }

  // Descartar NÃO toca no financeiro: o banco só aceita quando o lote não tem linha aprovada.
  // Por isso não há applyServerConfirmedData aqui — não existe lançamento para retirar da tela.
  async function confirmDiscard() {
    if (!discardTarget) return
    setBusy(true)
    setError('')
    const discarded = await discardFinancialImportBatch(discardTarget.id)
    setBusy(false)
    if (discarded.schemaMissing) {
      setError('O descarte seguro ainda não está instalado. Aplique financial_import_batch_discard.sql; nada foi alterado.')
      return
    }
    if (discarded.error) {
      setError(discarded.error.message || 'Não foi possível descartar a revisão. Nada foi alterado.')
      return
    }
    if (batch?.id === discardTarget.id) {
      setBatch(null)
      setParsed(null)
      setLines([])
      setApprovedIds([])
      setRejectedIds([])
    }
    if (resumable?.id === discardTarget.id) { setResumable(null); setResumableProgress(null) }
    if (incompleteBatch?.id === discardTarget.id) setIncompleteBatch(null)
    setDiscardTarget(null)
    await refreshHistory()
    toast('Revisão descartada. Nenhum lançamento foi afetado.')
  }

  // O banco exige motivo entre 3 e 500 caracteres; a tela espelha a mesma regra e explica a falta.
  const cancelReasonTooShort = cancelReason.trim().length < 3

  const selectedItems = selectedIds.map(id => reviewById.get(id)).filter(Boolean)

  return (
    <div style={s.stack} data-testid="financial-import-page">
      <style>{`@keyframes financialImportSpin { to { transform: rotate(360deg); } }`}</style>
      {error && <div role="alert" style={{ padding:'12px 14px', borderRadius:10, color:C.red, background:`${C.red}12`, border:`1px solid ${C.red}55`, fontSize:13 }}>{error}</div>}

      {!reviewPersisted && <div role="alert" data-testid="financial-import-persistence-blocked" style={{ padding:'12px 14px', borderRadius:10, color:C.red, background:`${C.red}12`, border:`1px solid ${C.red}55`, fontSize:13, lineHeight:1.5 }}>
        <strong>Importação bloqueada para proteger seu trabalho.</strong> A revisão não será aberta nem alterada enquanto o banco não confirmar a persistência. Aplique <code>financial_import_batches_schema.sql</code> e recarregue a página.
      </div>}

      {resumable && !parsed && !incompleteBatch && <Card data-testid="financial-import-resume">
        <div style={{ ...s.row, justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ color:C.text, fontSize:15, fontWeight:900 }}>Você tem uma revisão em andamento</div>
            <div style={{ ...s.muted, marginTop:5 }}><strong>{resumable.file_name}</strong> · {resumable.line_count} linha(s) · iniciada em {formatDateBR(String(resumable.created_at).slice(0, 10))}</div>
            <div style={{ ...s.muted, marginTop:4 }}>Continue de onde parou, sem precisar subir a planilha de novo.</div>
          </div>
          <Btn variant="success" onClick={() => resumeBatch(resumable)} disabled={busy}>Retomar revisão</Btn>
        </div>
      </Card>}

      <Card style={{ padding:10 }}>
        <div style={{ ...s.row, justifyContent:'space-between' }}>
          <div style={s.row}>
            <Btn variant={view === 'history' ? 'primary' : 'ghost'} onClick={() => { viewTouchedRef.current = true; setView('history') }}>Histórico de importações</Btn>
            <Btn variant={view === 'new' ? 'primary' : 'ghost'} onClick={() => { viewTouchedRef.current = true; setView('new') }}>+ Nova importação</Btn>
          </div>
          <div style={s.muted}>{history.length} importação(ões) registrada(s)</div>
        </div>
      </Card>

      {view === 'history' && <Card data-testid="financial-import-history">
        <div style={{ ...s.row, justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ color:C.text, fontSize:18, fontWeight:900 }}>Histórico de importações</div>
            <div style={{ ...s.muted, marginTop:5 }}>Consulte o que entrou no financeiro e cancele um lote inteiro com segurança. O cancelamento preserva a auditoria e não apaga os dados fisicamente.</div>
          </div>
          <Btn variant="ghost" onClick={refreshHistory} disabled={historyLoading}>{historyLoading ? 'Atualizando…' : 'Atualizar'}</Btn>
        </div>
        {historyError && <div role="alert" style={{ color:C.red, fontSize:12.5, marginTop:14 }}>{historyError}</div>}
        {!historyLoading && !historyError && history.length === 0 && <div style={{ ...s.muted, marginTop:18, padding:'24px 0', textAlign:'center' }}>Nenhuma importação registrada. Clique em “Nova importação” para começar.</div>}
        <div style={{ display:'grid', gap:10, marginTop:16 }}>
          {history.map(item => {
            const status = importHistoryStatus(item)
            const tone = status.tone === 'red' ? C.red : status.tone === 'green' ? C.green : status.tone === 'yellow' ? C.yellow : C.textDim
            const blocked = importCancelBlockedMessage(item)
            return <div key={item.id} data-testid={`financial-import-history-${item.id}`} style={{ border:`1px solid ${C.border}`, borderRadius:12, padding:14, background:C.surface }}>
              <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'minmax(0,1.4fr) minmax(230px,0.8fr) auto', gap:14, alignItems:'center' }}>
                <div>
                  <div style={{ ...s.row, gap:7 }}><strong style={{ color:C.text, overflowWrap:'anywhere' }}>{item.file_name}</strong><span style={{ color:tone, border:`1px solid ${tone}55`, background:`${tone}12`, borderRadius:999, padding:'3px 8px', fontSize:10.5, fontWeight:800 }}>{status.label}</span></div>
                  <div style={{ ...s.muted, marginTop:5 }}>{item.sheet_name ? `Aba ${item.sheet_name} · ` : ''}{formatDateBR(String(item.created_at).slice(0, 10))} · {item.line_count} linha(s)</div>
                  {item.cancellation_reason && <div style={{ color:C.red, fontSize:11.5, marginTop:5 }}>Motivo: {item.cancellation_reason}</div>}
                </div>
                <div style={{ ...s.muted, lineHeight:1.7 }}>
                  <div><strong style={{ color:C.green }}>{item.approved_count}</strong> importado(s) · {item.rejected_count} rejeitado(s)</div>
                  <div>Entradas {fmt(Number(item.imported_receipts || 0))} · Saídas {fmt(Number(item.imported_expenses || 0))}</div>
                  {Number(item.pending_count || 0) > 0 && <div>{item.pending_count} linha(s) ainda sem decisão</div>}
                </div>
                <div style={{ ...s.row, gap:8, justifyContent:isMobile ? 'flex-start' : 'flex-end' }}>
                  {canResumeImport(item) && <Btn variant="success" onClick={() => resumeBatch(item)} disabled={busy}>Retomar revisão</Btn>}
                  {canDiscardImport(item) && <Btn variant="ghost" onClick={() => setDiscardTarget(item)} disabled={busy}>Descartar</Btn>}
                  {canCancelImport(item) && <Btn variant="danger" onClick={() => { setCancelTarget(item); setCancelReason('') }}>Cancelar importação</Btn>}
                  {!canCancelImport(item) && blocked && Number(item.approved_count || 0) > 0 && <span style={{ ...s.muted, color:C.yellow, maxWidth:210 }}>{blocked}</span>}
                </div>
              </div>
            </div>
          })}
        </div>
      </Card>}

      {view === 'new' && <>

      {incompleteBatch && <Card data-testid="financial-import-incomplete">
        <div style={{ ...s.row, justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ color:C.red, fontSize:15, fontWeight:900 }}>Revisão salva incompleta</div>
            <div style={{ ...s.muted, marginTop:5 }}><strong>{incompleteBatch.file_name}</strong> · {incompleteBatch.loadedCount} de {incompleteBatch.line_count} linha(s) gravadas</div>
            <div style={{ ...s.muted, marginTop:4 }}>Nenhum lançamento foi criado. Descarte para subir a planilha novamente.</div>
          </div>
          <Btn variant="ghost" onClick={discardIncomplete} disabled={busy}>Descartar e começar de novo</Btn>
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
      <Modal open={Boolean(discardTarget)} onClose={() => { if (!busy) setDiscardTarget(null) }} closeOnBackdrop={!busy} title="Descartar revisão" width={560} trackDirty={false}>
        {discardTarget && <div style={s.stack}>
          <div style={{ color:C.text, fontWeight:900 }}>Esta revisão nunca entrou no financeiro.</div>
          <div style={s.muted}>Descartar tira a planilha da sua lista de trabalho e libera o arquivo para ser importado de novo. <strong>Nenhum lançamento é afetado</strong> — não há nenhum criado por este lote. O registro fica arquivado para auditoria, não é apagado.</div>
          <Card style={{ padding:14 }}>
            <strong style={{ color:C.text, overflowWrap:'anywhere' }}>{discardTarget.file_name}</strong>
            <div style={{ ...s.muted, marginTop:5 }}>{discardTarget.line_count} linha(s) · {discardTarget.rejected_count || 0} rejeitada(s) · {discardTarget.pending_count || 0} sem decisão</div>
          </Card>
          <div style={{ ...s.muted, color:C.yellow }}>As decisões de revisão desta planilha serão perdidas. Se quiser continuar de onde parou, use “Retomar revisão”.</div>
          <div style={{ ...s.row, justifyContent:'flex-end' }}>
            <Btn variant="ghost" onClick={() => setDiscardTarget(null)} disabled={busy}>Voltar</Btn>
            <Btn variant="danger" onClick={confirmDiscard} disabled={busy}>{busy ? 'Descartando…' : 'Descartar revisão'}</Btn>
          </div>
        </div>}
      </Modal>
      <Modal open={Boolean(cancelTarget)} onClose={() => { if (!busy) { setCancelTarget(null); setCancelReason('') } }} closeOnBackdrop={!busy} title="Cancelar importação" width={600} trackDirty={false}>
        {cancelTarget && <div style={s.stack}>
          <div style={{ color:C.red, fontWeight:900 }}>Todos os {cancelTarget.approved_count} lançamentos deste lote sairão do financeiro.</div>
          <div style={s.muted}>A operação é atômica: ou o lote inteiro é cancelado, ou nada muda. Os registros ficam arquivados para auditoria e o arquivo poderá ser importado novamente.</div>
          <Card style={{ padding:14 }}><strong style={{ color:C.text }}>{cancelTarget.file_name}</strong><div style={{ ...s.muted, marginTop:5 }}>Entradas {fmt(Number(cancelTarget.imported_receipts || 0))} · Saídas {fmt(Number(cancelTarget.imported_expenses || 0))}</div></Card>
          <label style={s.label} htmlFor="financial-import-cancel-reason">Motivo do cancelamento (mínimo 3 caracteres)</label>
          <textarea id="financial-import-cancel-reason" aria-label="Motivo do cancelamento da importação" aria-invalid={cancelReasonTooShort} aria-describedby="financial-import-cancel-reason-hint" value={cancelReason} onChange={event => setCancelReason(event.target.value)} maxLength={500} placeholder="Ex.: arquivo importado na clínica errada" style={{ ...s.input, minHeight:86, resize:'vertical', borderColor:cancelReasonTooShort ? `${C.yellow}88` : C.border }} />
          {/* O botão desabilitado precisa DIZER o que falta. Recusar em silêncio deixa a usuária
              clicando num botão morto sem saber que o problema é o tamanho do motivo. */}
          <div id="financial-import-cancel-reason-hint" style={{ ...s.muted, color:cancelReasonTooShort ? C.yellow : C.textSub, marginTop:-10 }}>
            {cancelReasonTooShort
              ? `Escreva o motivo para liberar o cancelamento — faltam ${3 - cancelReason.trim().length} caractere(s). Ele fica no histórico e na auditoria.`
              : 'O motivo fica registrado no histórico e na auditoria.'}
          </div>
          <div style={{ ...s.row, justifyContent:'flex-end' }}><Btn variant="ghost" onClick={() => { setCancelTarget(null); setCancelReason('') }} disabled={busy}>Voltar</Btn><Btn variant="danger" onClick={confirmCancellation} disabled={busy || cancelReasonTooShort}>{busy ? 'Cancelando…' : 'Confirmar cancelamento'}</Btn></div>
        </div>}
      </Modal>
    </div>
  )
}
