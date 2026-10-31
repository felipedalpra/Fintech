import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { C } from '../theme.js'
import { fmt, formatDateBR } from '../utils.js'
import { Btn, Card, Modal } from './UI.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { parseStatementFile } from '../lib/statementParser.js'
import { matchBankStatementLines, validateManualReconciliation } from '../lib/bankReconciliationMatch.js'
import { missingPersistedLedgerInstallments } from '../lib/bankReconciliationLedger.js'
import { evaluateStatementIntegrity, suggestStatementAccount, summarizeReconciliationCoverage } from '../lib/bankStatementIntegrity.js'
import { applyCompetenceChoice, buildStatementImportReview, mergeApprovedStatementRecords, proposalForStatementLine, summarizeStatementReview } from '../lib/statementImportReview.js'
import {
  archiveBankStatementImport,
  claimBankStatementLinesForCreation,
  confirmBankReconciliation,
  createFinancialAccount,
  fetchBankReconciliations,
  fetchBankStatementImports,
  fetchFinancialAccounts,
  fetchReconciliationInstallments,
  importBankStatement,
  isBankReconciliationSchemaMissing,
  recoverBankStatementLineClaim,
  releaseBankStatementLineClaims,
  reverseBankReconciliation,
  setBankStatementLinesReview,
} from '../lib/bankReconciliationStore.js'

const FINANCE_MODAL_DRAFT_KEY = 'surgimetrics_modal_draft_finance'
export const BANK_RECONCILIATION_RETURN_KEY = 'surgimetrics_bank_reconciliation_return'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_LINES = 50_000

function newClaimToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  throw new Error('Este navegador não oferece geração segura de identificadores. Atualize-o para criar lançamentos pela conciliação.')
}

function entryOf(installment) {
  return installment?.financial_entries || installment?.financial_entry || installment?.entry || {}
}

function installmentLabel(installment) {
  const entry = entryOf(installment)
  const party = entry.party_name_snapshot ? ` · ${entry.party_name_snapshot}` : ''
  const date = installment.settlement_date || installment.due_date
  return `${entry.description || entry.category || entry.source_type || 'Lançamento'}${party} · ${fmt(installment.amount)}${date ? ` · ${formatDateBR(date)}` : ''}`
}

function statusConfig(status) {
  if (status === 'reconciled') return { label:'Conciliado', color:C.green }
  if (status === 'existing') return { label:'Já existe', color:C.green }
  if (status === 'new') return { label:'Novo lançamento', color:C.blue || C.accentLight }
  if (status === 'possible_duplicate') return { label:'Possível duplicado', color:C.yellow }
  if (status === 'review') return { label:'Precisa revisar', color:C.yellow }
  if (status === 'ignored') return { label:'Ignorado', color:C.textDim }
  if (status === 'suggestion') return { label:'Sugestão', color:C.yellow }
  return { label:'Sem correspondência', color:C.textDim }
}

function readReturnContext() {
  try {
    const value = JSON.parse(window.localStorage.getItem(BANK_RECONCILIATION_RETURN_KEY) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

export function BankReconciliation({ data, saveDataNow }) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 900
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast } = useToast()
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const fileRef = useRef(null)
  const [accounts, setAccounts] = useState([])
  const [imports, setImports] = useState([])
  const [accountId, setAccountId] = useState('')
  const [selectedImportId, setSelectedImportId] = useState(searchParams.get('import') || '')
  const [parsed, setParsed] = useState(null)
  const [sourceFile, setSourceFile] = useState(null)
  const [mapping, setMapping] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [lines, setLines] = useState([])
  const [reconciliations, setReconciliations] = useState([])
  const [reservedInstallmentIds, setReservedInstallmentIds] = useState([])
  const [overlappingFingerprints, setOverlappingFingerprints] = useState([])
  const [installments, setInstallments] = useState([])
  const [windowDays, setWindowDays] = useState(3)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selections, setSelections] = useState({})
  const [confirming, setConfirming] = useState(null)
  const [reversing, setReversing] = useState(null)
  const [reason, setReason] = useState('')
  const [newAccount, setNewAccount] = useState({ name:'', accountType:'checking', institutionCode:'', institutionName:'', branchCode:'', accountNumberSuffix:'', holderName:'', holderDocumentSuffix:'' })
  const [showAccountForm, setShowAccountForm] = useState(false)
  const [createdContext, setCreatedContext] = useState(() => readReturnContext())
  const [selectedLineIds, setSelectedLineIds] = useState([])
  const [bulkConfirm, setBulkConfirm] = useState(null)
  // O extrato e data de CAIXA; a competencia manda no DRE. Por padrao ela
  // assume a data bancaria, e quem aprova pode informar outra.
  const [competenceMode, setCompetenceMode] = useState('line')
  const [competenceDate, setCompetenceDate] = useState('')
  const [ignoreReason, setIgnoreReason] = useState('Transferência interna')

  const s = {
    stack:{ display:'flex', flexDirection:'column', gap:18 },
    row:{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' },
    label:{ display:'block', fontSize:11, fontWeight:800, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 },
    input:{ width:'100%', background:C.input || C.surface, border:`1px solid ${C.border}`, color:C.text, borderRadius:10, padding:'10px 12px', fontFamily:'inherit', fontSize:13, boxSizing:'border-box' },
    muted:{ color:C.textSub, fontSize:12.5, lineHeight:1.5 },
    lineCard:{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'minmax(230px,0.9fr) minmax(300px,1.3fr)', gap:18, padding:16, border:`1px solid ${C.border}`, borderRadius:14, background:C.surface },
    amount:positive => ({ fontSize:16, fontWeight:900, color:positive ? C.green : C.red, fontVariantNumeric:'tabular-nums' }),
    badge:status => { const config = statusConfig(status); return { color:config.color, background:`${config.color}18`, border:`1px solid ${config.color}44`, borderRadius:999, padding:'4px 9px', fontSize:10.5, fontWeight:800 } },
  }

  async function refreshBase(preferredImportId) {
    if (!ownerId) return
    setLoading(true)
    setError('')
    try {
      const [nextAccounts, nextImports] = await Promise.all([
        fetchFinancialAccounts(ownerId),
        fetchBankStatementImports(ownerId),
      ])
      setAccounts(nextAccounts)
      setImports(nextImports)
      setAccountId(current => current || nextAccounts[0]?.id || '')
      const desired = preferredImportId || selectedImportId || nextImports.find(item => item.status === 'ready')?.id || ''
      setSelectedImportId(desired)
      setSchemaMissing(false)
    } catch (caught) {
      if (isBankReconciliationSchemaMissing(caught)) setSchemaMissing(true)
      else setError(caught.message || 'Não foi possível carregar a conciliação bancária.')
    } finally {
      setLoading(false)
    }
  }

  async function refreshImport(importId) {
    if (!ownerId || !importId) {
      setLines([])
      setReconciliations([])
      setReservedInstallmentIds([])
      setOverlappingFingerprints([])
      setInstallments([])
      return
    }
    setBusy(true)
    setError('')
    try {
      const [{ lines:nextLines, reconciliations:nextReconciliations, reservedInstallmentIds:nextReservedIds, overlappingFingerprints:nextOverlaps }, nextInstallments] = await Promise.all([
        fetchBankReconciliations(ownerId, importId),
        fetchReconciliationInstallments(ownerId),
      ])
      setLines(nextLines.map(item => ({
        ...item,
        postedDate:item.posted_date,
        normalizedDescription:item.normalized_description,
      })))
      setReconciliations(nextReconciliations)
      setReservedInstallmentIds(nextReservedIds)
      setOverlappingFingerprints(nextOverlaps)
      setInstallments(nextInstallments)
      const returned = readReturnContext()
      if (returned?.importId === importId) {
        const createdInstallment = nextInstallments.find(item => entryOf(item).source_id === returned.sourceId)
        if (createdInstallment) {
          setSelections(current => ({ ...current, [returned.lineId]:createdInstallment.id }))
          toast('Lançamento salvo. Confira e confirme o vínculo com o extrato.')
          window.localStorage.removeItem(BANK_RECONCILIATION_RETURN_KEY)
        }
      }
    } catch (caught) {
      if (isBankReconciliationSchemaMissing(caught)) setSchemaMissing(true)
      else setError(caught.message || 'Não foi possível carregar as linhas da importação.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { refreshBase(searchParams.get('import') || '') }, [ownerId])
  useEffect(() => {
    if (!selectedImportId) return
    setSearchParams({ import:selectedImportId }, { replace:true })
    refreshImport(selectedImportId)
  }, [selectedImportId, ownerId])
  useEffect(() => {
    if (!reservedInstallmentIds.length) return
    const reserved = new Set(reservedInstallmentIds)
    setSelections(current => Object.fromEntries(
      Object.entries(current).filter(([, installmentId]) => !reserved.has(installmentId)),
    ))
  }, [reservedInstallmentIds])
  useEffect(() => { setSelectedLineIds([]) }, [selectedImportId])

  const activeReconciliations = useMemo(() => reconciliations.filter(item => !item.reversed_at), [reconciliations])
  const missingLedgerInstallments = useMemo(() => missingPersistedLedgerInstallments(data, installments), [data, installments])
  const ledgerReady = missingLedgerInstallments.length === 0
  const matches = useMemo(
    () => matchBankStatementLines(lines, ledgerReady ? installments : [], activeReconciliations, { windowDays, reservedInstallmentIds }),
    [lines, installments, activeReconciliations, windowDays, ledgerReady, reservedInstallmentIds],
  )
  const selectedImport = imports.find(item => item.id === selectedImportId)
  const reviewItems = useMemo(
    () => buildStatementImportReview(matches, data?.chartAccounts || [], { fileName:selectedImport?.file_name || '', matchingUnavailable:!ledgerReady, overlappingFingerprints:new Set(overlappingFingerprints) }),
    [matches, data?.chartAccounts, selectedImport?.file_name, ledgerReady, overlappingFingerprints],
  )
  const visibleMatches = useMemo(() => reviewItems.filter(item => {
    if (filter !== 'all' && item.reviewStatus !== filter) return false
    const query = search.trim().toLowerCase()
    if (!query) return true
    const metadata = item.line.source_metadata || {}
    return `${item.line.description} ${item.line.amount} ${item.line.postedDate} ${metadata.category || ''} ${metadata.costCenter || ''} ${metadata.reference || ''}`.toLowerCase().includes(query)
  }), [reviewItems, filter, search])
  const summary = useMemo(() => summarizeStatementReview(reviewItems), [reviewItems])
  const coverage = useMemo(() => summarizeReconciliationCoverage(lines, reconciliations), [lines, reconciliations])
  const selectedAccount = accounts.find(account => account.id === accountId) || null
  const integrity = useMemo(() => parsed ? evaluateStatementIntegrity(parsed, selectedAccount, imports) : null, [parsed, selectedAccount, imports])
  const selectedReviews = useMemo(() => reviewItems.filter(item => selectedLineIds.includes(item.line.id)), [reviewItems, selectedLineIds])
  const selectableVisibleIds = useMemo(() => visibleMatches.filter(item => item.safeForBulk).map(item => item.line.id), [visibleMatches])

  async function onFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setParsed(null)
    setSourceFile(file)
    setMapping({})
    if (/\.xlsx?$/i.test(file.name || '')) {
      setError('Planilhas de lançamentos devem ser enviadas em Financeiro → Importar lançamentos. Aqui use apenas um extrato OFX ou CSV.')
      if (fileRef.current) fileRef.current.value = ''
      setSourceFile(null)
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('O arquivo excede o limite de 10 MB.')
      return
    }
    setBusy(true)
    try {
      const result = await parseStatementFile(file)
      if (result.lines.length > MAX_LINES) throw new Error('O arquivo excede o limite de 50.000 linhas.')
      setParsed(result)
      setMapping(result.mapping || {})
      const suggestedAccount = suggestStatementAccount(accounts, result.statementMetadata)
      if (suggestedAccount) setAccountId(suggestedAccount.id)
    } catch (caught) {
      setError(caught.message || 'Não foi possível interpretar o arquivo.')
    } finally {
      setBusy(false)
    }
  }

  async function applyMapping() {
    if (!sourceFile) return
    setBusy(true)
    setError('')
    try {
      const result = await parseStatementFile(sourceFile, { mapping, delimiter:parsed?.delimiter, sheetName:parsed?.sheetName, headerRow:parsed?.headerRow })
      setParsed(result)
      const suggestedAccount = suggestStatementAccount(accounts, result.statementMetadata)
      if (suggestedAccount) setAccountId(suggestedAccount.id)
    } catch (caught) {
      setError(caught.message || 'Não foi possível aplicar o mapeamento.')
    } finally {
      setBusy(false)
    }
  }

  async function changeSheet(sheetName) {
    if (!sourceFile || !sheetName) return
    setBusy(true)
    setError('')
    try {
      const result = await parseStatementFile(sourceFile, { sheetName })
      if (result.lines.length > MAX_LINES) throw new Error('A aba excede o limite de 50.000 linhas.')
      setParsed(result)
      setMapping(result.mapping || {})
    } catch (caught) {
      setError(caught.message || 'Não foi possível interpretar a aba selecionada.')
    } finally {
      setBusy(false)
    }
  }

  async function persistImport() {
    if (!parsed || !accountId) return
    if (!integrity?.canImport) {
      setError(integrity?.errors.join(' ') || 'Confira a identidade do extrato antes de importar.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const saved = await importBankStatement({ ownerId, accountId, parsed })
      toast(`${saved.line_count} linha(s) importadas e confirmadas no sistema.`)
      setParsed(null)
      setSourceFile(null)
      if (fileRef.current) fileRef.current.value = ''
      await refreshBase(saved.id)
      setSelectedImportId(saved.id)
    } catch (caught) {
      setError(caught.message || 'Não foi possível salvar o extrato.')
    } finally {
      setBusy(false)
    }
  }

  async function addAccount() {
    setBusy(true)
    setError('')
    try {
      const account = await createFinancialAccount(ownerId, newAccount)
      setAccounts(current => [...current, account].sort((a, b) => a.name.localeCompare(b.name)))
      setAccountId(account.id)
      setNewAccount({ name:'', accountType:'checking', institutionCode:'', institutionName:'', branchCode:'', accountNumberSuffix:'', holderName:'', holderDocumentSuffix:'' })
      setShowAccountForm(false)
      toast('Conta financeira criada.')
    } catch (caught) {
      setError(caught.message || 'Não foi possível criar a conta.')
    } finally {
      setBusy(false)
    }
  }

  function openAccountForm() {
    const metadata = parsed?.statementMetadata || {}
    setNewAccount(current => ({
      ...current,
      name:current.name || metadata.institutionName || '',
      institutionCode:current.institutionCode || metadata.institutionCode || '',
      institutionName:current.institutionName || metadata.institutionName || '',
      branchCode:current.branchCode || metadata.agencyCode || '',
      accountNumberSuffix:current.accountNumberSuffix || metadata.accountNumberSuffix || '',
      accountType:String(metadata.accountType || '').toLowerCase().includes('saving') ? 'savings' : current.accountType,
    }))
    setShowAccountForm(true)
  }

  function chooseForConfirmation(match, installmentId) {
    if (selectedImport?.verification_status === 'mismatch') {
      setError('Este extrato possui divergência de integridade e não pode ser conciliado.')
      return
    }
    if (reservedInstallmentIds.includes(installmentId)) {
      setSelections(current => ({ ...current, [match.line.id]:'' }))
      setError('Esta parcela acabou de ser conciliada em outra linha. Escolha outro lançamento.')
      return
    }
    const candidate = installments.find(item => item.id === installmentId)
    if (!candidate) return
    const validation = validateManualReconciliation(match.line, candidate, { windowDays })
    if (!validation.valid) {
      setError(validation.errors.join(' '))
      return
    }
    const ranked = match.candidates.find(item => item.installmentId === installmentId)
    setReason('')
    setConfirming({ match, candidate, validation, ranked })
  }

  async function doConfirm() {
    if (!confirming) return
    if (confirming.validation.requiresJustification && reason.trim().length < 3) {
      setError('Explique a divergência antes de confirmar o vínculo.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const createdFromLine = entryOf(confirming.candidate).source_id === confirming.match.line.id
      await confirmBankReconciliation({
        lineId:confirming.match.line.id,
        installmentId:confirming.candidate.id,
        method:createdFromLine || createdContext?.lineId === confirming.match.line.id ? 'created_from_line' : (confirming.ranked ? 'suggested' : 'manual'),
        score:confirming.ranked?.score,
        reasons:confirming.ranked?.reasons || confirming.validation.warnings,
        justification:reason || (createdFromLine ? 'Retomada do vínculo do lançamento criado por esta linha.' : ''),
        windowDays,
      })
      toast('Conciliação confirmada. Nenhum valor ou status financeiro foi alterado.')
      setConfirming(null)
      setReason('')
      if (createdContext?.lineId === confirming.match.line.id) setCreatedContext(null)
      await refreshImport(selectedImportId)
    } catch (caught) {
      setError(caught.message || 'Não foi possível confirmar a conciliação.')
    } finally {
      setBusy(false)
    }
  }

  async function doReverse() {
    if (!reversing || reason.trim().length < 3) {
      setError('Informe o motivo da desconciliação.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await reverseBankReconciliation(reversing.id, reason)
      toast('Conciliação desfeita e preservada no histórico.', 'warning')
      setReversing(null)
      setReason('')
      await refreshImport(selectedImportId)
    } catch (caught) {
      setError(caught.message || 'Não foi possível desfazer a conciliação.')
    } finally {
      setBusy(false)
    }
  }

  function requestApprove(items) {
    if (selectedImport?.verification_status === 'mismatch') {
      setError('Resolva a divergência do extrato antes de aprovar vínculos ou lançamentos.')
      return
    }
    if (!ledgerReady) {
      setError('A aprovação está bloqueada até o razão confirmar todas as parcelas carregadas. Isso evita criar lançamentos duplicados.')
      return
    }
    const eligible = items.filter(item => item.safeForBulk)
    if (!eligible.length) {
      setError('Selecione sugestões seguras. Duplicidades, transferências e linhas sem classificação exigem revisão individual.')
      return
    }
    setCompetenceMode('line')
    setCompetenceDate('')
    setBulkConfirm({ type:'approve', items:eligible })
  }

  function requestIgnore(items) {
    const eligible = items.filter(item => !item.processing && !['reconciled', 'ignored'].includes(item.reviewStatus))
    if (!eligible.length) {
      setError('Nenhuma linha pendente está visível para ignorar.')
      return
    }
    setIgnoreReason('Transferência interna')
    setBulkConfirm({ type:'ignore', items:eligible })
  }

  async function approveReviewItems(rawItems) {
    if (!ledgerReady) {
      setError('A aprovação está bloqueada até o razão terminar de persistir.')
      return
    }
    // A competencia escolhida vale so para os lancamentos NOVOS, e nao toca nas
    // datas de caixa. Linhas apenas vinculadas passam intactas.
    let items
    try {
      items = applyCompetenceChoice(rawItems, { mode:competenceMode, competenceDate })
    } catch (caught) {
      setError(caught.message)
      return
    }
    setBusy(true)
    setError('')
    let creationClaim = null
    try {
      const newItems = items.filter(item => item.reviewStatus === 'new')
      if (newItems.length) {
        const persist = saveDataNow
        if (!persist) throw new Error('O salvamento confirmado não está disponível nesta tela.')
        creationClaim = { lineIds:newItems.map(item => item.line.id), token:newClaimToken() }
        await claimBankStatementLinesForCreation(creationClaim.lineIds, creationClaim.token)
        let persistedCount = 0
        try {
          for (const item of newItems) {
            const result = persist(
              current => mergeApprovedStatementRecords(current, [item]),
              { collection:item.proposal.collection, record:item.proposal.record },
            )
            const persisted = result?.then ? await result : result
            if (persisted === false) throw new Error('O lançamento financeiro não foi confirmado pelo sistema.')
            persistedCount += 1
          }
        } catch (persistenceError) {
          // A linha que falhou fica reservada: sua operação durável será retomada no próximo
          // carregamento. Somente linhas ainda não iniciadas são liberadas para nova revisão.
          const untouchedIds = newItems.slice(persistedCount + 1).map(item => item.line.id)
          await Promise.allSettled(untouchedIds.map(lineId => releaseBankStatementLineClaims([lineId], creationClaim.token)))
          throw persistenceError
        }
      }

      const latestInstallments = newItems.length ? await fetchReconciliationInstallments(ownerId) : installments
      const operations = items.map(item => {
        if (item.reviewStatus === 'existing') {
          const candidate = item.recommendedCandidate
          return candidate ? confirmBankReconciliation({
            lineId:item.line.id,
            installmentId:candidate.installmentId,
            method:item.createdCandidate ? 'created_from_line' : 'suggested',
            score:candidate.score,
            reasons:candidate.reasons,
            justification:item.createdCandidate ? 'Retomada do vínculo do lançamento criado por esta linha.' : null,
            windowDays,
          }) : Promise.reject(new Error('Correspondência existente não encontrada.'))
        }
        const createdInstallment = latestInstallments.find(installment => {
          const entry = entryOf(installment)
          return entry.source_id === item.line.id && entry.source_type === (item.line.amount > 0 ? 'extra_revenue' : 'expense')
        })
        return createdInstallment ? confirmBankReconciliation({
          lineId:item.line.id,
          installmentId:createdInstallment.id,
          method:'created_from_line',
          reasons:['lançamento criado após aprovação da prévia XLSX'],
          justification:'Lançamento criado e aprovado a partir da linha importada.',
          windowDays,
        }) : Promise.reject(new Error(`O lançamento da linha ${item.line.line_index} foi salvo, mas o razão ainda não confirmou a parcela.`))
      })
      const results = await Promise.allSettled(operations)
      const failures = results.filter(result => result.status === 'rejected')
      setBulkConfirm(null)
      setSelectedLineIds([])
      await refreshImport(selectedImportId)
      if (failures.length) throw new Error(`${failures.length} de ${items.length} linha(s) não tiveram o vínculo confirmado. Os lançamentos já salvos foram preservados e podem ser conciliados novamente.`)
      toast(`${items.length} linha(s) aprovadas e confirmadas.`)
    } catch (caught) {
      if (isBankReconciliationSchemaMissing(caught)) setSchemaMissing(true)
      else setError(caught.message || 'Não foi possível aprovar as linhas selecionadas.')
    } finally {
      setBusy(false)
    }
  }

  async function ignoreReviewItems(items) {
    setBusy(true)
    setError('')
    try {
      await setBankStatementLinesReview({
        lineIds:items.map(item => item.line.id),
        status:'ignored',
        reason:ignoreReason,
      })
      setBulkConfirm(null)
      setSelectedLineIds([])
      await refreshImport(selectedImportId)
      toast(`${items.length} linha(s) ignoradas sem alterar o financeiro.`, 'warning')
    } catch (caught) {
      if (isBankReconciliationSchemaMissing(caught)) setSchemaMissing(true)
      else setError(caught.message || 'Não foi possível ignorar as linhas selecionadas.')
    } finally {
      setBusy(false)
    }
  }

  async function reopenLine(item) {
    setBusy(true)
    setError('')
    try {
      await setBankStatementLinesReview({ lineIds:[item.line.id], status:'pending' })
      await refreshImport(selectedImportId)
      toast('Linha reaberta para revisão.')
    } catch (caught) {
      if (isBankReconciliationSchemaMissing(caught)) setSchemaMissing(true)
      else setError(caught.message || 'Não foi possível reabrir a linha.')
    } finally {
      setBusy(false)
    }
  }

  async function createFromLine(item, allowOverlap = false) {
    const line = item.line
    if (selectedImport?.verification_status === 'mismatch') {
      setError('Resolva a divergência do extrato antes de criar lançamentos.')
      return
    }
    if (!ledgerReady) {
      setError('A criação está bloqueada até o razão confirmar os lançamentos carregados, evitando duplicidades.')
      return
    }
    setBusy(true)
    setError('')
    let claimToken = null
    try {
      claimToken = newClaimToken()
      await claimBankStatementLinesForCreation([line.id], claimToken, { allowOverlap })
      const isRevenue = Number(line.amount) > 0
      const proposal = proposalForStatementLine(line, data?.chartAccounts || [], selectedImport?.file_name || '')
      const form = selectedImport?.source_format === 'xlsx'
        ? { ...proposal.record, launchType:'variavel' }
        : isRevenue
          ? { description:line.description || 'Receita do extrato', value:Math.abs(Number(line.amount)), competenceDate:'', dueDate:line.postedDate, date:line.postedDate, receivedDate:line.postedDate, status:'recebido', launchType:'variavel', originLabel:'Extrato bancário' }
          : { description:line.description || 'Despesa do extrato', value:Math.abs(Number(line.amount)), competenceDate:'', dueDate:line.postedDate, paymentDate:line.postedDate, status:'pago', launchType:'variavel', originLabel:'Extrato bancário' }
      const reconciliationReturn = { importId:selectedImportId, lineId:line.id, sourceId:line.id, claimToken }
      window.localStorage.setItem(FINANCE_MODAL_DRAFT_KEY, JSON.stringify({ showModal:true, modalType:isRevenue ? 'extra' : 'expense', editing:null, form, reconciliationReturn }))
      navigate('/app/finance')
    } catch (caught) {
      if (claimToken) await releaseBankStatementLineClaims([line.id], claimToken).catch(() => null)
      if (isBankReconciliationSchemaMissing(caught)) setSchemaMissing(true)
      else setError(caught.message || 'Não foi possível reservar esta linha para criação.')
      setBusy(false)
    }
  }

  function requestCreateFromLine(item) {
    if (item.reviewStatus === 'possible_duplicate') {
      setBulkConfirm({ type:'create_duplicate', items:[item] })
      return
    }
    createFromLine(item)
  }

  async function recoverProcessingLine(item) {
    setBusy(true)
    setError('')
    try {
      await recoverBankStatementLineClaim(item.line.id)
      await refreshImport(selectedImportId)
      toast('Reserva antiga liberada. Revise a linha antes de criar novamente.', 'warning')
    } catch (caught) {
      if (isBankReconciliationSchemaMissing(caught)) setSchemaMissing(true)
      else setError(caught.message || 'Esta reserva ainda não pode ser recuperada.')
    } finally {
      setBusy(false)
    }
  }

  async function archiveImport() {
    if (!selectedImportId) return
    setBusy(true)
    setError('')
    try {
      await archiveBankStatementImport(selectedImportId)
      toast('Importação arquivada sem apagar o histórico.', 'warning')
      setSelectedImportId('')
      await refreshBase('')
    } catch (caught) {
      setError(caught.message || 'Não foi possível arquivar a importação.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Card><div style={s.muted}>Carregando conciliação bancária…</div></Card>

  if (schemaMissing) return (
    <Card style={{ border:`1px solid ${C.yellow}55` }}>
      <div style={{ color:C.yellow, fontWeight:800, marginBottom:8 }}>Migração necessária</div>
      <div style={s.muted}>Execute os schemas base da conciliação e depois <code>supabase/bank_reconciliation_robustness_schema.sql</code>. Nenhuma função serverless será criada.</div>
    </Card>
  )

  return (
    <div style={s.stack} data-testid="bank-reconciliation-page">
      {error && <div role="alert" style={{ padding:'12px 14px', borderRadius:10, border:`1px solid ${C.red}55`, background:`${C.red}12`, color:C.red, fontSize:13 }}>{error}</div>}
      {selectedImportId && !busy && !ledgerReady && <div role="alert" style={{ padding:'12px 14px', borderRadius:10, border:`1px solid ${C.yellow}55`, background:`${C.yellow}12`, color:C.yellow, fontSize:13 }}>
        O razão persistido ainda não confirmou {missingLedgerInstallments.length} parcela(s) dos lançamentos carregados. As sugestões estão bloqueadas para evitar vínculos incorretos. Volte ao Financeiro, aguarde “Salvo” e tente novamente.
      </div>}

      <Card>
        <div style={{ ...s.row, justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ fontSize:18, fontWeight:900, color:C.text }}>Importar extrato</div>
            <div style={{ ...s.muted, marginTop:5 }}>O extrato é interpretado no navegador e cruzado com os lançamentos já existentes. Para importar uma planilha retroativa, use “Importar lançamentos”.</div>
          </div>
          <span style={{ ...s.badge('reconciled'), color:C.green }}>OFX · CSV · PDF do BRB · sem Open Finance</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'minmax(220px,0.7fr) minmax(280px,1.3fr)', gap:14, marginTop:18 }}>
          <div>
            <label style={s.label}>Conta financeira</label>
            <select aria-label="Conta financeira" value={accountId} onChange={event => setAccountId(event.target.value)} style={s.input}>
              <option value="">Selecione…</option>
              {accounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.account_number_suffix ? ` · ••••${account.account_number_suffix}` : ''}</option>)}
            </select>
            {selectedAccount && <div style={{ ...s.muted, marginTop:6 }}>
              {selectedAccount.institution_name || 'Instituição não informada'}{selectedAccount.branch_code ? ` · ag. ${selectedAccount.branch_code}` : ''}{selectedAccount.account_number_suffix ? ` · conta ••••${selectedAccount.account_number_suffix}` : ''}
              {' · '}{selectedAccount.verification_status === 'verified' ? 'verificada' : 'aguardando verificação por extrato/conexão'}
            </div>}
            {!showAccountForm ? (
              <button type="button" onClick={openAccountForm} style={{ border:0, background:'transparent', color:C.accentLight, padding:'7px 0', cursor:'pointer', fontSize:12 }}>+ Criar conta bancária</button>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'repeat(2,minmax(0,1fr))', gap:8, marginTop:8, padding:12, border:`1px solid ${C.border}`, borderRadius:12 }}>
                <input aria-label="Nome da nova conta" value={newAccount.name} onChange={event => setNewAccount(current => ({ ...current, name:event.target.value }))} placeholder="Nome interno (ex.: Itaú principal)" style={s.input} />
                <input aria-label="Instituição financeira" value={newAccount.institutionName} onChange={event => setNewAccount(current => ({ ...current, institutionName:event.target.value }))} placeholder="Instituição (ex.: Itaú)" style={s.input} />
                <input aria-label="Código da instituição" value={newAccount.institutionCode} onChange={event => setNewAccount(current => ({ ...current, institutionCode:event.target.value }))} placeholder="ISPB/COMPE (opcional)" style={s.input} />
                <input aria-label="Agência bancária" value={newAccount.branchCode} onChange={event => setNewAccount(current => ({ ...current, branchCode:event.target.value }))} placeholder="Agência (opcional)" style={s.input} />
                <input aria-label="Final da conta bancária" inputMode="numeric" maxLength={4} value={newAccount.accountNumberSuffix} onChange={event => setNewAccount(current => ({ ...current, accountNumberSuffix:event.target.value.replace(/\D/g, '').slice(0, 4) }))} placeholder="4 últimos dígitos da conta" style={s.input} />
                <select aria-label="Tipo da nova conta" value={newAccount.accountType} onChange={event => setNewAccount(current => ({ ...current, accountType:event.target.value }))} style={s.input}>
                  <option value="checking">Conta corrente</option><option value="savings">Poupança</option><option value="card">Cartão</option><option value="other">Outra</option>
                </select>
                <input aria-label="Titular da conta" value={newAccount.holderName} onChange={event => setNewAccount(current => ({ ...current, holderName:event.target.value }))} placeholder="Titular (opcional)" style={s.input} />
                <input aria-label="Final do documento do titular" inputMode="numeric" maxLength={4} value={newAccount.holderDocumentSuffix} onChange={event => setNewAccount(current => ({ ...current, holderDocumentSuffix:event.target.value.replace(/\D/g, '').slice(0, 4) }))} placeholder="4 últimos do CPF/CNPJ (opcional)" style={s.input} />
                <div style={{ ...s.row, gridColumn:'1 / -1', justifyContent:'flex-end' }}>
                  <Btn variant="ghost" onClick={() => setShowAccountForm(false)}>Cancelar</Btn>
                  <Btn onClick={addAccount} disabled={busy || !newAccount.name.trim() || !newAccount.institutionName.trim() || newAccount.accountNumberSuffix.length !== 4}>Salvar conta</Btn>
                </div>
              </div>
            )}
          </div>
          <div>
            <label style={s.label}>Arquivo bancário</label>
            <input ref={fileRef} aria-label="Arquivo OFX, CSV ou extrato do BRB" type="file" accept=".ofx,.csv,.txt,.pdf,text/csv,application/pdf,application/x-ofx" onChange={onFileChange} style={{ ...s.input, cursor:'pointer' }} />
            <div style={{ ...s.muted, marginTop:6 }}>
              OFX, CSV ou o extrato do BRB em PDF. Até 10 MB e 50.000 linhas.
              O arquivo bruto não é enviado nem guardado.
            </div>
            {/* O PDF não traz identificador de transação; o OFX traz. */}
            <div style={{ ...s.muted, marginTop:4 }}>
              Prefira <strong>OFX</strong> quando o banco oferecer: ele tem identificador por
              transação. No PDF não existe, então linhas iguais no mesmo dia são separadas
              pela ordem em que aparecem.
            </div>
          </div>
        </div>

        {parsed?.format === 'xlsx' && parsed.sheetNames?.length > 1 && (
          <label style={{ ...s.label, marginTop:14, maxWidth:320 }}>Aba da planilha
            <select aria-label="Aba da planilha" value={parsed.sheetName || ''} onChange={event => changeSheet(event.target.value)} disabled={busy} style={{ ...s.input, marginTop:6, textTransform:'none', letterSpacing:'normal' }}>
              {parsed.sheetNames.map(sheetName => <option key={sheetName} value={sheetName}>{sheetName}</option>)}
            </select>
          </label>
        )}

        {parsed?.requiresMapping && (
          <div style={{ marginTop:18, padding:14, borderRadius:12, background:`${C.yellow}0D`, border:`1px solid ${C.yellow}44` }}>
            <div style={{ fontWeight:800, color:C.yellow, marginBottom:10 }}>Mapeie as colunas do {parsed.format === 'xlsx' ? 'Excel' : 'CSV'}</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10 }}>
              {[['date','Data'], ['description','Descrição'], ['amount','Valor assinado'], ['credit','Receita/crédito'], ['debit','Despesa/débito'], ['externalId','Identificador'], ['category','Categoria'], ['costCenter','Centro de custo'], ['reference','Paciente/contrato'], ['observation','Observação/serviço']].map(([key, label]) => (
                <label key={key} style={{ fontSize:12, color:C.textSub }}>{label}
                  <select value={mapping[key] ?? -1} onChange={event => setMapping(current => ({ ...current, [key]:Number(event.target.value) }))} style={{ ...s.input, marginTop:5 }}>
                    <option value={-1}>Não usar</option>
                    {parsed.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `Coluna ${index + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div style={{ marginTop:12 }}><Btn onClick={applyMapping} disabled={busy}>Aplicar mapeamento</Btn></div>
          </div>
        )}

        {parsed && !parsed.requiresMapping && (
          <div style={{ marginTop:18, display:'grid', gap:12 }} data-testid="statement-preview">
            <div style={{ ...s.row, justifyContent:'space-between' }}>
              <div>
                <strong style={{ color:C.text }}>{parsed.fileName}</strong>
                <div style={s.muted}>{parsed.lines.length} linha(s) válida(s) · {parsed.format.toUpperCase()}{parsed.sheetName ? ` · aba ${parsed.sheetName}` : ''}</div>
                {parsed.totals && <div style={{ ...s.muted, marginTop:4 }}>Entradas {fmt(parsed.totals.receipts)} · saídas {fmt(parsed.totals.expenses)} · líquido {fmt(parsed.totals.net)}</div>}
              </div>
              <Btn onClick={persistImport} disabled={busy || !accountId || parsed.errors.length > 0 || parsed.lines.length === 0 || !integrity?.canImport}>Confirmar importação</Btn>
            </div>
            {integrity && <div data-testid="statement-integrity" style={{ padding:12, borderRadius:10, border:`1px solid ${integrity.canImport ? C.green : C.red}55`, background:`${integrity.canImport ? C.green : C.red}0D` }}>
              <div style={{ fontWeight:900, color:integrity.verificationStatus === 'verified' ? C.green : integrity.verificationStatus === 'mismatch' ? C.red : C.yellow }}>
                {integrity.verificationStatus === 'verified' ? 'Extrato verificado' : integrity.verificationStatus === 'partially_verified' ? 'Extrato parcialmente verificado' : integrity.verificationStatus === 'mismatch' ? 'Extrato incompatível' : 'Origem ainda não verificada'}
              </div>
              {parsed.statementMetadata?.institutionCode && <div style={{ ...s.muted, marginTop:5 }}>Banco {parsed.statementMetadata.institutionName || parsed.statementMetadata.institutionCode} · conta {parsed.statementMetadata.accountNumberMasked || 'não identificada'} · {parsed.statementMetadata.currency || 'BRL'}</div>}
              <div style={{ ...s.muted, marginTop:4 }}>Período {integrity.periodStart ? formatDateBR(integrity.periodStart) : 'não declarado'} a {integrity.periodEnd ? formatDateBR(integrity.periodEnd) : 'não declarado'} · movimento líquido {fmt(integrity.net)}</div>
              {integrity.evidence.map(item => <div key={item} style={{ color:C.green, fontSize:12, marginTop:4 }}>✓ {item}</div>)}
              {integrity.warnings.map(item => <div key={item} style={{ color:C.yellow, fontSize:12, marginTop:4 }}>⚠ {item}</div>)}
              {integrity.errors.map(item => <div key={item} style={{ color:C.red, fontSize:12, marginTop:4 }}>✕ {item}</div>)}
            </div>}
            {parsed.errors.length > 0 && (
              <div style={{ color:C.red, fontSize:12, lineHeight:1.6 }}>
                <strong>{parsed.errors.length} erro(s) impedem a importação:</strong>
                {parsed.errors.slice(0, 10).map(item => <div key={`${item.line}-${item.reason}`}>Linha {item.line}: {item.reason}</div>)}
              </div>
            )}
            {parsed.lines.length > 0 && (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead><tr>{['Data','Descrição','Valor'].map(title => <th key={title} style={{ textAlign:title === 'Valor' ? 'right' : 'left', color:C.textDim, padding:'8px 6px', borderBottom:`1px solid ${C.border}` }}>{title}</th>)}</tr></thead>
                  <tbody>{parsed.lines.slice(0, 8).map(line => <tr key={line.sourceLineKey}><td style={{ padding:'8px 6px', color:C.textSub }}>{formatDateBR(line.postedDate)}</td><td style={{ padding:'8px 6px', color:C.text }}>{line.description || 'Sem descrição'}</td><td style={{ padding:'8px 6px', textAlign:'right', fontWeight:800, color:line.amount > 0 ? C.green : C.red }}>{fmt(line.amount)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div style={{ display:'grid', gridTemplateColumns:'minmax(220px,1fr) auto', gap:14, alignItems:'end' }}>
          <div>
            <label style={s.label}>Importação para revisar</label>
            <select aria-label="Importação bancária" value={selectedImportId} onChange={event => setSelectedImportId(event.target.value)} style={s.input}>
              <option value="">Selecione uma importação…</option>
              {imports.filter(item => item.status === 'ready').map(item => (
                <option key={item.id} value={item.id}>{item.file_name} · {item.period_start ? formatDateBR(item.period_start) : 'sem período'} · {item.line_count} linhas</option>
              ))}
            </select>
          </div>
          {selectedImport && <Btn variant="danger" onClick={archiveImport} disabled={busy || summary.reconciled > 0 || reviewItems.some(item => item.processing)}>Arquivar importação</Btn>}
        </div>

        {selectedImportId && (
          <>
            <div data-testid="reconciliation-coverage" style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'minmax(220px,1fr) repeat(3,minmax(110px,0.45fr))', gap:10, marginTop:16, padding:14, border:`1px solid ${selectedImport?.verification_status === 'mismatch' ? C.red : C.border}`, borderRadius:12, background:C.bg }}>
              <div>
                <div style={{ fontSize:11, fontWeight:900, color:selectedImport?.verification_status === 'verified' ? C.green : selectedImport?.verification_status === 'mismatch' ? C.red : C.yellow, textTransform:'uppercase' }}>
                  {selectedImport?.verification_status === 'verified' ? 'Extrato verificado' : selectedImport?.verification_status === 'mismatch' ? 'Divergência no extrato' : selectedImport?.verification_status === 'partially_verified' ? 'Verificação parcial' : 'Origem não verificada'}
                </div>
                <div style={{ ...s.muted, marginTop:5 }}>{coverage.decidedPercent}% das linhas decididas · {coverage.pending} pendente(s)</div>
                {selectedImport?.control_difference != null && <div style={{ ...s.muted, marginTop:3 }}>Diferença de controle: {fmt(selectedImport.control_difference)}</div>}
                {(selectedImport?.verification_notes || []).map(note => <div key={note} style={{ color:C.yellow, fontSize:11.5, marginTop:3 }}>⚠ {note}</div>)}
              </div>
              {[['Entradas',coverage.credits,C.green], ['Saídas',coverage.debits,C.red], ['Líquido',coverage.net,coverage.net >= 0 ? C.green : C.red]].map(([label, value, color]) => <div key={label}>
                <div style={{ fontSize:10.5, color:C.textDim, textTransform:'uppercase', fontWeight:800 }}>{label}</div><div style={{ color, fontSize:17, fontWeight:900, marginTop:4 }}>{fmt(value)}</div>
              </div>)}
            </div>
            {selectedImport?.verification_status === 'mismatch' && <div role="alert" style={{ color:C.red, fontSize:12, marginTop:10 }}>Este extrato possui inconsistência de período ou saldo. Revise/arquive a importação antes de usar seus vínculos como comprovação financeira.</div>}
            <div style={{ display:'grid', gridTemplateColumns:isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(6,minmax(110px,1fr))', gap:10, marginTop:16 }}>
              {[['reconciled','Conciliadas',summary.reconciled,C.green], ['existing','Sugestões',summary.existing,C.green], ['new','Novos',summary.new,C.accentLight], ['possible_duplicate','Duplicados',summary.possible_duplicate,C.yellow], ['review','Revisar',summary.review,C.yellow], ['ignored','Ignorados',summary.ignored,C.textDim]].map(([key, label, value, color]) => (
                <button key={key} type="button" onClick={() => setFilter(filter === key ? 'all' : key)} style={{ border:`1px solid ${filter === key ? color : C.border}`, background:filter === key ? `${color}12` : 'transparent', borderRadius:12, padding:12, color:C.text, cursor:'pointer', textAlign:'left' }}>
                  <div style={{ fontSize:11, color, fontWeight:800, textTransform:'uppercase' }}>{label}</div>
                  <div style={{ fontSize:22, fontWeight:900, marginTop:4 }}>{value}</div>
                </button>
              ))}
            </div>
            <div style={{ ...s.row, marginTop:14 }}>
              <input aria-label="Buscar no extrato" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar descrição, data ou valor…" style={{ ...s.input, flex:'1 1 240px' }} />
              <label style={{ color:C.textSub, fontSize:12 }}>Janela de datas
                <select value={windowDays} onChange={event => setWindowDays(Number(event.target.value))} style={{ ...s.input, width:'auto', marginLeft:8 }}>
                  {[0,1,2,3,5,7].map(value => <option key={value} value={value}>± {value} dia(s)</option>)}
                </select>
              </label>
            </div>
            <div style={{ ...s.row, marginTop:12, justifyContent:'space-between', paddingTop:12, borderTop:`1px solid ${C.border}` }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, color:C.textSub, fontSize:12, cursor:selectableVisibleIds.length ? 'pointer' : 'default' }}>
                <input type="checkbox" aria-label="Selecionar todas as sugestões seguras visíveis" disabled={!selectableVisibleIds.length} checked={selectableVisibleIds.length > 0 && selectableVisibleIds.every(id => selectedLineIds.includes(id))} onChange={event => setSelectedLineIds(current => event.target.checked ? [...new Set([...current, ...selectableVisibleIds])] : current.filter(id => !selectableVisibleIds.includes(id)))} />
                Selecionar sugestões seguras visíveis ({selectableVisibleIds.length})
              </label>
              <div style={s.row}>
                <Btn variant="ghost" onClick={() => requestIgnore(visibleMatches)} disabled={busy || !visibleMatches.some(item => !item.processing && !['reconciled', 'ignored'].includes(item.reviewStatus))}>Ignorar visíveis</Btn>
                <Btn variant="success" onClick={() => requestApprove(selectedReviews)} disabled={busy || !ledgerReady || selectedReviews.length === 0}>Aprovar selecionados ({selectedReviews.length})</Btn>
              </div>
            </div>
            {summary.new > 0 && <div style={{ ...s.muted, marginTop:10 }}>Impacto dos novos sugeridos: entradas {fmt(summary.newReceipts)} · saídas {fmt(summary.newExpenses)}. Nada entra no financeiro antes da aprovação.</div>}
          </>
        )}
      </Card>

      {busy && selectedImportId && <div style={s.muted}>Atualizando dados confirmados no sistema…</div>}

      {selectedImportId && !busy && visibleMatches.length === 0 && <Card><div style={s.muted}>Nenhuma linha encontrada para este filtro.</div></Card>}

      {visibleMatches.map(match => {
        const config = statusConfig(match.reviewStatus)
        const reconciliation = match.reconciliation
        const linkedInstallment = reconciliation ? installments.find(item => item.id === reconciliation.financial_installment_id) : null
        const recommended = match.recommendedCandidate
        const selectedId = selections[match.line.id] || recommended?.installmentId || ''
        const directionInstallments = installments.filter(item => entryOf(item).direction === (match.line.amount > 0 ? 'receivable' : 'payable')
          && !item.archived_at
          && !reservedInstallmentIds.includes(item.id)
          && (!match.line.financial_account_id || !item.financial_account_id || match.line.financial_account_id === item.financial_account_id))
        const recoverableClaim = match.processing
          && match.line.reviewed_by === user?.id
          && Date.now() - new Date(match.line.reviewed_at || 0).getTime() >= 30 * 60 * 1000
        return (
          <div key={match.line.id} style={s.lineCard} data-testid={`statement-line-${match.status}`} data-review-status={match.reviewStatus}>
            <div>
              <div style={{ ...s.row, justifyContent:'space-between' }}>
                <div style={s.row}>
                  {match.safeForBulk && <input type="checkbox" aria-label={`Selecionar linha ${match.line.line_index || match.line.id}`} checked={selectedLineIds.includes(match.line.id)} onChange={event => setSelectedLineIds(current => event.target.checked ? [...new Set([...current, match.line.id])] : current.filter(id => id !== match.line.id))} />}
                  <span style={s.badge(match.reviewStatus)}>{config.label}</span>
                </div>
                <span style={s.muted}>{formatDateBR(match.line.postedDate)}</span>
              </div>
              <div style={{ color:C.text, fontWeight:800, marginTop:12, overflowWrap:'anywhere' }}>{match.line.description || 'Sem descrição'}</div>
              <div style={{ ...s.amount(match.line.amount > 0), marginTop:7 }}>{fmt(match.line.amount)}</div>
              {match.line.external_id && <div style={{ ...s.muted, marginTop:5 }}>ID bancário: {match.line.external_id}</div>}
              {(match.line.source_metadata?.category || match.line.source_metadata?.costCenter) && <div style={{ ...s.muted, marginTop:8 }}>{match.line.source_metadata?.category || 'Sem categoria'} · {match.line.source_metadata?.costCenter || 'Sem centro de custo'}</div>}
              {match.line.source_metadata?.reference && <div style={{ ...s.muted, marginTop:4 }}>Referência: {match.line.source_metadata.reference}</div>}
            </div>
            <div style={isMobile ? { borderTop:`1px solid ${C.border}`, paddingTop:16 } : { borderLeft:`1px solid ${C.border}`, paddingLeft:18 }}>
              {match.reviewStatus === 'reconciled' ? (
                <>
                  <div style={{ color:C.green, fontWeight:900 }}>Vínculo confirmado</div>
                  <div style={{ color:C.text, marginTop:7 }}>{linkedInstallment ? installmentLabel(linkedInstallment) : 'A parcela vinculada foi alterada ou arquivada — revise a origem.'}</div>
                  {linkedInstallment?.status === 'pending' && <div style={{ color:C.yellow, fontSize:12, marginTop:7 }}>Conciliação confirmada; baixa financeira ainda pendente.</div>}
                  <div style={{ ...s.row, marginTop:12 }}><Btn variant="ghost" onClick={() => { setReason(''); setReversing(reconciliation) }}>Desconciliar</Btn></div>
                </>
              ) : match.reviewStatus === 'ignored' ? (
                <>
                  <div style={{ color:C.textSub, fontWeight:900 }}>Linha ignorada</div>
                  <div style={{ ...s.muted, marginTop:7 }}>Ela permanece no histórico e não altera DRE, caixa ou contas.</div>
                  {match.line.review_reason && <div style={{ ...s.muted, marginTop:5 }}>Motivo: {match.line.review_reason}</div>}
                  <div style={{ ...s.row, marginTop:12 }}><Btn variant="ghost" onClick={() => reopenLine(match)} disabled={busy}>Reabrir revisão</Btn></div>
                </>
              ) : (
                <>
                  {recommended ? (
                    <>
                      <div style={{ color:C.text, fontWeight:900 }}>{installmentLabel(recommended.installment)}</div>
                      <div style={{ ...s.muted, marginTop:6 }}>{recommended.reasons.join(' · ')} · score {recommended.score}</div>
                    </>
                  ) : (
                    <div style={{ color:match.reviewStatus === 'possible_duplicate' || match.reviewStatus === 'review' ? C.yellow : C.textSub, fontWeight:800 }}>
                      {match.status === 'reserved_match' ? 'Este valor já corresponde a uma parcela conciliada em outro extrato. Revise para não duplicar.' : match.processing ? 'Esta linha foi reservada para criação. Verifique o lançamento salvo antes de reabri-la.' : match.reviewStatus === 'possible_duplicate' ? 'Há repetição ou mais de uma correspondência possível.' : match.reviewStatus === 'review' ? 'Esta linha precisa de classificação antes de criar.' : 'Nenhum lançamento existente foi encontrado.'}
                    </div>
                  )}
                  {['new', 'review'].includes(match.reviewStatus) && <div style={{ marginTop:10, padding:12, border:`1px solid ${C.border}`, borderRadius:10, background:C.bg }}>
                    <div style={{ color:C.text, fontWeight:800 }}>Modelo sugerido na plataforma</div>
                    <div style={{ ...s.muted, marginTop:6 }}>{match.line.amount > 0 ? 'Receita recebida' : 'Despesa paga'} · {match.proposal.accountName}</div>
                    <div style={{ ...s.muted, marginTop:3 }}>Competência, vencimento e caixa: {formatDateBR(match.line.postedDate)} <span style={{ color:C.yellow }}>(data bancária assumida)</span></div>
                    <div style={{ ...s.muted, marginTop:3 }}>{match.proposal.category} · {match.proposal.costCenter}</div>
                    <div style={{ ...s.muted, marginTop:3 }}>Competência {formatDateBR(match.proposal.record.competenceDate)} · caixa {formatDateBR(match.line.postedDate)}</div>
                    {match.proposal.reasons.map(item => <div key={item} style={{ color:C.yellow, fontSize:11.5, marginTop:4 }}>⚠ {item}</div>)}
                  </div>}
                  <select aria-label={`Lançamento para ${match.line.description || match.line.id}`} value={selectedId} onChange={event => setSelections(current => ({ ...current, [match.line.id]:event.target.value }))} style={{ ...s.input, marginTop:10 }}>
                    <option value="">Procurar outro lançamento…</option>
                    {directionInstallments.map(item => <option key={item.id} value={item.id}>{installmentLabel(item)}</option>)}
                  </select>
                  <div style={{ ...s.row, marginTop:12 }}>
                    <Btn variant="success" disabled={!selectedId || busy || !ledgerReady} onClick={() => chooseForConfirmation(match, selectedId)}>Conferir e vincular</Btn>
                    {match.safeForBulk && <Btn variant="success" onClick={() => requestApprove([match])} disabled={busy || !ledgerReady}>{match.reviewStatus === 'existing' ? 'Aprovar vínculo' : 'Aprovar lançamento'}</Btn>}
                    {match.reviewStatus !== 'existing' && !match.processing && match.status !== 'reserved_match' && <Btn variant="ghost" onClick={() => requestCreateFromLine(match)} disabled={!ledgerReady}>Criar {match.line.amount > 0 ? 'receita' : 'despesa'}</Btn>}
                    {match.processing ? <>
                      <span style={s.muted}>Criação reservada. Conclua ou cancele pelo formulário financeiro aberto nesta sessão.</span>
                      {recoverableClaim && <Btn variant="ghost" onClick={() => recoverProcessingLine(match)} disabled={busy}>Liberar reserva antiga</Btn>}
                    </> : <Btn variant="ghost" onClick={() => requestIgnore([match])} disabled={busy}>Ignorar</Btn>}
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })}

      <Modal open={Boolean(bulkConfirm)} onClose={() => setBulkConfirm(null)} title={bulkConfirm?.type === 'approve' ? 'Aprovar sugestões' : bulkConfirm?.type === 'create_duplicate' ? 'Confirmar possível duplicidade' : 'Ignorar linhas'} width={620} trackDirty={false}>
        {bulkConfirm && <div style={s.stack}>
          <div style={s.muted}>{bulkConfirm.type === 'approve'
            ? 'Correspondências existentes serão apenas vinculadas. Novas sugestões criarão lançamentos canônicos e depois serão conciliadas.'
            : bulkConfirm.type === 'create_duplicate'
              ? 'Existe outra linha com a mesma data, valor e descrição nesta conta. Só continue se forem movimentações realmente distintas.'
            : 'As linhas continuarão no histórico e poderão ser reabertas. Nenhum lançamento será apagado.'}</div>
          <Card style={{ padding:14 }}>
            <div style={{ color:C.text, fontWeight:900 }}>{bulkConfirm.items.length} linha(s)</div>
            <div style={{ ...s.muted, marginTop:5 }}>Entradas {fmt(bulkConfirm.items.filter(item => item.line.amount > 0).reduce((total, item) => total + Number(item.line.amount), 0))} · saídas {fmt(bulkConfirm.items.filter(item => item.line.amount < 0).reduce((total, item) => total + Math.abs(Number(item.line.amount)), 0))}</div>
          </Card>
          {bulkConfirm.type === 'approve' && bulkConfirm.items.some(item => item.reviewStatus === 'new') && (
            <Card style={{ padding:14 }}>
              <div style={{ color:C.text, fontWeight:900, fontSize:13 }}>Competência dos novos lançamentos</div>
              <div style={{ ...s.muted, marginTop:5 }}>
                A data do extrato é a data de <strong>caixa</strong> e alimenta o fluxo. A competência é o que entra no DRE — por padrão assume a mesma data. O vencimento e as datas de caixa não mudam.
              </div>
              <label style={{ ...s.row, marginTop:10, gap:8, cursor:'pointer' }}>
                <input type="radio" name="competencia" checked={competenceMode === 'line'} onChange={() => setCompetenceMode('line')} />
                <span style={{ color:C.textSub, fontSize:12.5 }}>Usar a data do extrato de cada linha (padrão)</span>
              </label>
              <label style={{ ...s.row, marginTop:7, gap:8, cursor:'pointer' }}>
                <input type="radio" name="competencia" checked={competenceMode === 'fixed'} onChange={() => setCompetenceMode('fixed')} />
                <span style={{ color:C.textSub, fontSize:12.5 }}>Usar uma competência única para todas</span>
              </label>
              {competenceMode === 'fixed' && (
                <input
                  type="date"
                  aria-label="Competência dos novos lançamentos"
                  value={competenceDate}
                  onChange={event => setCompetenceDate(event.target.value)}
                  style={{ ...s.input, marginTop:9, maxWidth:220 }}
                />
              )}
              {competenceMode === 'fixed' && !competenceDate && (
                <div style={{ color:C.yellow, fontSize:12, marginTop:7 }}>Informe a competência para continuar.</div>
              )}
            </Card>
          )}
          {bulkConfirm.type === 'create_duplicate' && <div style={{ color:C.yellow, fontSize:12 }}>A confirmação permite criar somente esta linha e ficará registrada pela origem UUID. Nenhum valor existente será alterado.</div>}
          {bulkConfirm.type === 'ignore' && <label style={{ color:C.textSub, fontSize:12 }}>Motivo para ignorar
            <select aria-label="Motivo para ignorar" value={ignoreReason} onChange={event => setIgnoreReason(event.target.value)} style={{ ...s.input, marginTop:6 }}>
              <option>Transferência interna</option><option>Movimento pessoal</option><option>Duplicidade confirmada</option><option>Tarifa já contabilizada</option><option>Artefato bancário</option><option>Outro motivo revisado</option>
            </select>
          </label>}
          <div style={{ ...s.row, justifyContent:'flex-end' }}>
            <Btn variant="ghost" onClick={() => setBulkConfirm(null)}>Cancelar</Btn>
            <Btn variant={bulkConfirm.type === 'approve' ? 'success' : bulkConfirm.type === 'create_duplicate' ? 'warn' : 'danger'} disabled={busy || (bulkConfirm.type === 'approve' && competenceMode === 'fixed' && !competenceDate)} onClick={() => {
              if (bulkConfirm.type === 'approve') approveReviewItems(bulkConfirm.items)
              else if (bulkConfirm.type === 'create_duplicate') { const item = bulkConfirm.items[0]; setBulkConfirm(null); createFromLine(item, true) }
              else ignoreReviewItems(bulkConfirm.items)
            }} disabled={busy}>{bulkConfirm.type === 'approve' ? 'Confirmar aprovação' : bulkConfirm.type === 'create_duplicate' ? 'Criar mesmo assim' : 'Confirmar que deseja ignorar'}</Btn>
          </div>
        </div>}
      </Modal>

      <Modal open={Boolean(confirming)} onClose={() => { setConfirming(null); setReason('') }} title="Confirmar vínculo" width={580} trackDirty={false}>
        {confirming && <div style={s.stack}>
          <div style={s.muted}>Esta ação apenas registra o vínculo. Não altera valor, data, status, baixa, DRE ou fluxo de caixa.</div>
          <Card style={{ padding:14 }}><div style={{ color:C.text, fontWeight:800 }}>{confirming.match.line.description || 'Linha do extrato'} · {fmt(confirming.match.line.amount)}</div><div style={{ ...s.muted, marginTop:4 }}>{installmentLabel(confirming.candidate)}</div></Card>
          {confirming.validation.warnings.length > 0 && <div style={{ color:C.yellow, fontSize:12 }}>{confirming.validation.warnings.map(item => <div key={item}>⚠ {item}</div>)}</div>}
          {confirming.validation.requiresJustification && <label style={{ color:C.textSub, fontSize:12 }}>Justificativa da divergência<textarea value={reason} onChange={event => setReason(event.target.value)} style={{ ...s.input, minHeight:80, marginTop:6, resize:'vertical' }} /></label>}
          <div style={{ ...s.row, justifyContent:'flex-end' }}><Btn variant="ghost" onClick={() => setConfirming(null)}>Cancelar</Btn><Btn variant="success" onClick={doConfirm} disabled={busy}>Confirmar vínculo</Btn></div>
        </div>}
      </Modal>

      <Modal open={Boolean(reversing)} onClose={() => { setReversing(null); setReason('') }} title="Desconciliar" width={500} trackDirty={false}>
        <div style={s.stack}>
          <div style={s.muted}>O vínculo será desativado, mas continuará no histórico de auditoria.</div>
          <label style={{ color:C.textSub, fontSize:12 }}>Motivo<textarea value={reason} onChange={event => setReason(event.target.value)} style={{ ...s.input, minHeight:80, marginTop:6, resize:'vertical' }} /></label>
          <div style={{ ...s.row, justifyContent:'flex-end' }}><Btn variant="ghost" onClick={() => setReversing(null)}>Cancelar</Btn><Btn variant="danger" onClick={doReverse} disabled={busy || reason.trim().length < 3}>Desconciliar</Btn></div>
        </div>
      </Modal>
    </div>
  )
}
