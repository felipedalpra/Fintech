import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { C } from '../theme.js'
import { fmt, formatDateBR } from '../utils.js'
import { Btn, Card, Modal } from './UI.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { parseStatementFile } from '../lib/statementParser.js'
import { matchBankStatementLines, validateManualReconciliation } from '../lib/bankReconciliationMatch.js'
import { missingPersistedLedgerInstallments } from '../lib/bankReconciliationLedger.js'
import {
  archiveBankStatementImport,
  confirmBankReconciliation,
  createFinancialAccount,
  fetchBankReconciliations,
  fetchBankStatementImports,
  fetchFinancialAccounts,
  fetchReconciliationInstallments,
  importBankStatement,
  isBankReconciliationSchemaMissing,
  reverseBankReconciliation,
} from '../lib/bankReconciliationStore.js'

const FINANCE_MODAL_DRAFT_KEY = 'surgimetrics_modal_draft_finance'
export const BANK_RECONCILIATION_RETURN_KEY = 'surgimetrics_bank_reconciliation_return'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_LINES = 50_000

function entryOf(installment) {
  return installment?.financial_entries || installment?.financial_entry || installment?.entry || {}
}

function installmentLabel(installment) {
  const entry = entryOf(installment)
  const party = entry.party_name_snapshot ? ` · ${entry.party_name_snapshot}` : ''
  const date = installment.settlement_date || installment.due_date || entry.issue_date
  return `${entry.description || entry.category || entry.source_type || 'Lançamento'}${party} · ${fmt(installment.amount)}${date ? ` · ${formatDateBR(date)}` : ''}`
}

function statusConfig(status) {
  if (status === 'reconciled') return { label:'Conciliado', color:C.green }
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

export function BankReconciliation({ data }) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 900
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast } = useToast()
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
  const [installments, setInstallments] = useState([])
  const [windowDays, setWindowDays] = useState(3)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selections, setSelections] = useState({})
  const [confirming, setConfirming] = useState(null)
  const [reversing, setReversing] = useState(null)
  const [reason, setReason] = useState('')
  const [newAccountName, setNewAccountName] = useState('')
  const [showAccountForm, setShowAccountForm] = useState(false)
  const [createdContext, setCreatedContext] = useState(() => readReturnContext())

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
      setInstallments([])
      return
    }
    setBusy(true)
    setError('')
    try {
      const [{ lines:nextLines, reconciliations:nextReconciliations }, nextInstallments] = await Promise.all([
        fetchBankReconciliations(ownerId, importId),
        fetchReconciliationInstallments(ownerId),
      ])
      setLines(nextLines.map(item => ({
        ...item,
        postedDate:item.posted_date,
        normalizedDescription:item.normalized_description,
      })))
      setReconciliations(nextReconciliations)
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
      setError(caught.message || 'Não foi possível carregar as linhas da importação.')
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

  const activeReconciliations = useMemo(() => reconciliations.filter(item => !item.reversed_at), [reconciliations])
  const missingLedgerInstallments = useMemo(() => missingPersistedLedgerInstallments(data, installments), [data, installments])
  const ledgerReady = missingLedgerInstallments.length === 0
  const matches = useMemo(
    () => matchBankStatementLines(lines, ledgerReady ? installments : [], activeReconciliations, { windowDays }),
    [lines, installments, activeReconciliations, windowDays, ledgerReady],
  )
  const visibleMatches = useMemo(() => matches.filter(item => {
    if (filter !== 'all' && item.status !== filter) return false
    const query = search.trim().toLowerCase()
    if (!query) return true
    return `${item.line.description} ${item.line.amount} ${item.line.postedDate}`.toLowerCase().includes(query)
  }), [matches, filter, search])
  const summary = useMemo(() => matches.reduce((acc, item) => {
    acc[item.status] += 1
    return acc
  }, { reconciled:0, suggestion:0, unmatched:0 }), [matches])
  const selectedImport = imports.find(item => item.id === selectedImportId)

  async function onFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setParsed(null)
    setSourceFile(file)
    setMapping({})
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
      const result = await parseStatementFile(sourceFile, { mapping, delimiter:parsed?.delimiter })
      setParsed(result)
    } catch (caught) {
      setError(caught.message || 'Não foi possível aplicar o mapeamento.')
    } finally {
      setBusy(false)
    }
  }

  async function persistImport() {
    if (!parsed || !accountId) return
    setBusy(true)
    setError('')
    try {
      const saved = await importBankStatement({ ownerId, accountId, parsed })
      toast(`${saved.line_count} linha(s) importadas e confirmadas no banco.`)
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
      const account = await createFinancialAccount(ownerId, { name:newAccountName })
      setAccounts(current => [...current, account].sort((a, b) => a.name.localeCompare(b.name)))
      setAccountId(account.id)
      setNewAccountName('')
      setShowAccountForm(false)
      toast('Conta financeira criada.')
    } catch (caught) {
      setError(caught.message || 'Não foi possível criar a conta.')
    } finally {
      setBusy(false)
    }
  }

  function chooseForConfirmation(match, installmentId) {
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
      await confirmBankReconciliation({
        lineId:confirming.match.line.id,
        installmentId:confirming.candidate.id,
        method:confirming.ranked ? 'suggested' : (createdContext?.lineId === confirming.match.line.id ? 'created_from_line' : 'manual'),
        score:confirming.ranked?.score,
        reasons:confirming.ranked?.reasons || confirming.validation.warnings,
        justification:reason,
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

  function createFromLine(line) {
    const isRevenue = Number(line.amount) > 0
    const value = Math.abs(Number(line.amount))
    const form = isRevenue
      ? { description:line.description || 'Receita do extrato', value, competenceDate:'', dueDate:line.postedDate, date:line.postedDate, receivedDate:line.postedDate, status:'recebido', launchType:'variavel', originLabel:'Extrato bancário' }
      : { description:line.description || 'Despesa do extrato', value, competenceDate:'', dueDate:line.postedDate, paymentDate:line.postedDate, status:'pago', launchType:'variavel', originLabel:'Extrato bancário' }
    const reconciliationReturn = { importId:selectedImportId, lineId:line.id }
    window.localStorage.setItem(FINANCE_MODAL_DRAFT_KEY, JSON.stringify({ showModal:true, modalType:isRevenue ? 'extra' : 'expense', editing:null, form, reconciliationReturn }))
    navigate('/app/finance')
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
      <div style={s.muted}>Execute manualmente <code>supabase/bank_reconciliation_schema.sql</code> no Supabase antes de usar esta tela. Nenhuma função serverless será criada.</div>
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
            <div style={{ ...s.muted, marginTop:5 }}>O arquivo é interpretado no navegador. Depois da sua confirmação, somente as linhas normalizadas são salvas.</div>
          </div>
          <span style={{ ...s.badge('reconciled'), color:C.green }}>OFX / CSV · sem Open Finance</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'minmax(220px,0.7fr) minmax(280px,1.3fr)', gap:14, marginTop:18 }}>
          <div>
            <label style={s.label}>Conta financeira</label>
            <select aria-label="Conta financeira" value={accountId} onChange={event => setAccountId(event.target.value)} style={s.input}>
              <option value="">Selecione…</option>
              {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            {!showAccountForm ? (
              <button type="button" onClick={() => setShowAccountForm(true)} style={{ border:0, background:'transparent', color:C.accentLight, padding:'7px 0', cursor:'pointer', fontSize:12 }}>+ Criar conta bancária</button>
            ) : (
              <div style={{ ...s.row, marginTop:8 }}>
                <input aria-label="Nome da nova conta" value={newAccountName} onChange={event => setNewAccountName(event.target.value)} placeholder="Ex.: Itaú principal" style={{ ...s.input, flex:1 }} />
                <Btn onClick={addAccount} disabled={busy || !newAccountName.trim()}>Salvar</Btn>
              </div>
            )}
          </div>
          <div>
            <label style={s.label}>Arquivo bancário</label>
            <input ref={fileRef} aria-label="Arquivo OFX ou CSV" type="file" accept=".ofx,.csv,.txt,text/csv,application/x-ofx" onChange={onFileChange} style={{ ...s.input, cursor:'pointer' }} />
            <div style={{ ...s.muted, marginTop:6 }}>Até 10 MB e 50.000 linhas. O arquivo bruto não é enviado nem guardado.</div>
          </div>
        </div>

        {parsed?.requiresMapping && (
          <div style={{ marginTop:18, padding:14, borderRadius:12, background:`${C.yellow}0D`, border:`1px solid ${C.yellow}44` }}>
            <div style={{ fontWeight:800, color:C.yellow, marginBottom:10 }}>Mapeie as colunas do CSV</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10 }}>
              {[['date','Data'], ['description','Descrição'], ['amount','Valor assinado'], ['credit','Crédito'], ['debit','Débito'], ['externalId','Identificador']].map(([key, label]) => (
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
                <div style={s.muted}>{parsed.lines.length} linha(s) válida(s) · {parsed.format.toUpperCase()}</div>
              </div>
              <Btn onClick={persistImport} disabled={busy || !accountId || parsed.errors.length > 0 || parsed.lines.length === 0}>Confirmar importação</Btn>
            </div>
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
          {selectedImport && <Btn variant="danger" onClick={archiveImport} disabled={busy || summary.reconciled > 0}>Arquivar importação</Btn>}
        </div>

        {selectedImportId && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'repeat(3,minmax(130px,1fr))', gap:10, marginTop:16 }}>
              {[['reconciled','Conciliadas',summary.reconciled,C.green], ['suggestion','Sugestões',summary.suggestion,C.yellow], ['unmatched','Sem correspondência',summary.unmatched,C.textDim]].map(([key, label, value, color]) => (
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
          </>
        )}
      </Card>

      {busy && selectedImportId && <div style={s.muted}>Atualizando dados confirmados no banco…</div>}

      {selectedImportId && !busy && visibleMatches.length === 0 && <Card><div style={s.muted}>Nenhuma linha encontrada para este filtro.</div></Card>}

      {visibleMatches.map(match => {
        const config = statusConfig(match.status)
        const reconciliation = match.reconciliation
        const linkedInstallment = reconciliation ? installments.find(item => item.id === reconciliation.financial_installment_id) : null
        const recommended = match.recommendedCandidate
        const selectedId = selections[match.line.id] || recommended?.installmentId || ''
        const directionInstallments = installments.filter(item => entryOf(item).direction === (match.line.amount > 0 ? 'receivable' : 'payable') && !item.archived_at)
        return (
          <div key={match.line.id} style={s.lineCard} data-testid={`statement-line-${match.status}`}>
            <div>
              <div style={{ ...s.row, justifyContent:'space-between' }}>
                <span style={s.badge(match.status)}>{config.label}</span>
                <span style={s.muted}>{formatDateBR(match.line.postedDate)}</span>
              </div>
              <div style={{ color:C.text, fontWeight:800, marginTop:12, overflowWrap:'anywhere' }}>{match.line.description || 'Sem descrição'}</div>
              <div style={{ ...s.amount(match.line.amount > 0), marginTop:7 }}>{fmt(match.line.amount)}</div>
              {match.line.external_id && <div style={{ ...s.muted, marginTop:5 }}>ID bancário: {match.line.external_id}</div>}
            </div>
            <div style={isMobile ? { borderTop:`1px solid ${C.border}`, paddingTop:16 } : { borderLeft:`1px solid ${C.border}`, paddingLeft:18 }}>
              {match.status === 'reconciled' ? (
                <>
                  <div style={{ color:C.green, fontWeight:900 }}>Vínculo confirmado</div>
                  <div style={{ color:C.text, marginTop:7 }}>{linkedInstallment ? installmentLabel(linkedInstallment) : 'A parcela vinculada foi alterada ou arquivada — revise a origem.'}</div>
                  {linkedInstallment?.status === 'pending' && <div style={{ color:C.yellow, fontSize:12, marginTop:7 }}>Conciliação confirmada; baixa financeira ainda pendente.</div>}
                  <div style={{ ...s.row, marginTop:12 }}><Btn variant="ghost" onClick={() => { setReason(''); setReversing(reconciliation) }}>Desconciliar</Btn></div>
                </>
              ) : (
                <>
                  {recommended ? (
                    <>
                      <div style={{ color:C.text, fontWeight:900 }}>{installmentLabel(recommended.installment)}</div>
                      <div style={{ ...s.muted, marginTop:6 }}>{recommended.reasons.join(' · ')} · score {recommended.score}</div>
                    </>
                  ) : (
                    <div style={{ color:match.status === 'suggestion' ? C.yellow : C.textSub, fontWeight:800 }}>
                      {match.status === 'suggestion' ? 'Há candidatos, mas a sugestão é ambígua.' : 'Nenhum candidato exato na janela selecionada.'}
                    </div>
                  )}
                  <select aria-label={`Lançamento para ${match.line.description || match.line.id}`} value={selectedId} onChange={event => setSelections(current => ({ ...current, [match.line.id]:event.target.value }))} style={{ ...s.input, marginTop:10 }}>
                    <option value="">Procurar outro lançamento…</option>
                    {directionInstallments.map(item => <option key={item.id} value={item.id}>{installmentLabel(item)}</option>)}
                  </select>
                  <div style={{ ...s.row, marginTop:12 }}>
                    <Btn variant="success" disabled={!selectedId || busy || !ledgerReady} onClick={() => chooseForConfirmation(match, selectedId)}>Conferir e vincular</Btn>
                    <Btn variant="ghost" onClick={() => createFromLine(match.line)}>Criar {match.line.amount > 0 ? 'receita' : 'despesa'}</Btn>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })}

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
