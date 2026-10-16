import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { fmt, formatDateBR, getPeriodRange, inRange, isIsoDateString, today, uid } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge } from './UI.jsx'
import { PatientSelector } from './PatientSelector.jsx'
import { SupplierSelector } from './SupplierSelector.jsx'
import { ExportModal } from './ExportModal.jsx'
import { maskFinancialValue, useFinancialPrivacy } from '../context/FinancialPrivacyContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { supabase } from '../lib/supabase.js'
import { decodePaymentMethod } from '../lib/paymentMethodCodec.js'
import { ClinicalCostSettlementFields } from './ClinicalCostSettlementFields.jsx'
import { withClinicalCostSettlementDefaults } from '../lib/clinicalCosts.js'
import { syncRecurringLedger } from '../lib/ledgerPersistence.js'
import { FinancialDrilldownModal, useFinancialDrilldown } from './FinancialDrilldownModal.jsx'
import { findChartAccount, nextChildAccountCode, nextSiblingOrder, postingAccountOptions, postingGroupOptions } from '../lib/chartOfAccounts.js'
import { createChartAccount, ensureDefaultChartAccounts, fetchChartAccounts, isChartSchemaMissing } from '../lib/chartOfAccountsStore.js'
import { buildDrePresentation, flattenVisibleDreRows } from '../lib/drePresentation.js'
import { releaseBankStatementLineClaims } from '../lib/bankReconciliationStore.js'

const PAYMENT_METHODS = [
  { v:'pix', l:'PIX' },
  { v:'cartao', l:'Cartão' },
  { v:'dinheiro', l:'Dinheiro' },
  { v:'boleto', l:'Boleto' },
  { v:'transferencia', l:'Transferência' },
]
const SURGERY_PAYMENT_STATUS = [
  { v:'pago', l:'Pago' },
  { v:'pendente', l:'Pendente' },
  { v:'cancelado', l:'Cancelado' },
]

const DEFAULT_COST_CENTERS = [
  'Cirurgia Plástica',
  'Consultas',
  'Marketing',
  'Infraestrutura',
  'Administrativo',
  'Recursos Humanos',
  'Outros',
]
const EXTRA_REVENUE_EMPTY = { description:'', category:'outras_receitas', chartAccountId:'', value:0, patientId:'', patient:'', date:today(), competenceDate:today(), dueDate:today(), status:'recebido', costCenter:'', originLabel:'', launchType:'variavel', recurrenceFrequency:'mensal', recurrenceDay:5, recurrenceStartDate:today(), recurrenceEndDate:'', recurrenceAutoMarkAsPaid:false, recurrenceActive:true }
const EXPENSE_EMPTY = { description:'', category:'outros', chartAccountId:'', value:0, supplierId:'', supplier:'', dueDate:today(), competenceDate:today(), paymentDate:today(), status:'pago', costCenter:'', originLabel:'', launchType:'variavel', recurrenceFrequency:'mensal', recurrenceDay:5, recurrenceStartDate:today(), recurrenceEndDate:'', recurrenceAutoMarkAsPaid:false, recurrenceActive:true }

// Origem exibida: rótulo livre preenchido pelo usuário (ex: "Indicação") ou,
// na falta dele, a origem automática do sistema (ex: "cirurgia", "despesa").
const resolveOrigin = item => (String(item.originLabel || '').trim() || String(item.origin || item.source || ''))
const BALANCE_EMPTY = { name:'', category:'banco', value:0, notes:'' }
export const FINANCE_MODAL_DRAFT_KEY = 'surgimetrics_modal_draft_finance'
const BANK_RECONCILIATION_RETURN_KEY = 'surgimetrics_bank_reconciliation_return'
const FINANCE_MODAL_TYPES = new Set(['extra', 'expense', 'asset', 'liability'])
const QUICK_CATEGORY_EMPTY = { open:false, direction:'', name:'', parentId:'', saving:false, error:'' }

const EXPENSE_CATEGORIES = ['aluguel', 'salarios', 'marketing', 'marketing_vendas', 'hospital', 'anestesia', 'equipamentos', 'softwares', 'impostos', 'juros', 'depreciacao', 'amortizacao', 'fornecedores', 'variaveis', 'outros']

const PERIOD_PILLS = [
  { value:'day', label:'Hoje' },
  { value:'week', label:'Semana' },
  { value:'month', label:'Este mês' },
  { value:'quarter', label:'Trimestre' },
  { value:'year', label:'Este ano' },
  { value:'custom', label:'Personalizado' },
]

const EXPENSE_CATEGORY_LABELS = {
  aluguel:'Aluguel',
  salarios:'Salários',
  marketing:'Marketing',
  marketing_vendas:'Marketing e Vendas',
  hospital:'Hospital',
  anestesia:'Anestesia',
  equipamentos:'Equipamentos',
  softwares:'Softwares',
  impostos:'Impostos',
  juros:'Juros/Despesa Financeira',
  depreciacao:'Depreciação',
  amortizacao:'Amortização',
  fornecedores:'Fornecedores',
  variaveis:'Variáveis',
  outros:'Outros',
}

function readModalDraft() {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(FINANCE_MODAL_DRAFT_KEY) || window.sessionStorage.getItem(FINANCE_MODAL_DRAFT_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!FINANCE_MODAL_TYPES.has(parsed.modalType)) return null
    if (!parsed.form || typeof parsed.form !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function formatFinancePeriodLabel(period, range) {
  if (!range.start) return ''
  const locale = 'pt-BR'
  const start = new Date(`${range.start}T00:00:00`)
  if (period === 'day') return start.toLocaleDateString(locale, { day:'numeric', month:'long', year:'numeric' })
  if (period === 'month') return start.toLocaleDateString(locale, { month:'long', year:'numeric' })
  if (period === 'week') {
    if (!range.end) return start.toLocaleDateString(locale, { day:'numeric', month:'short', year:'numeric' })
    const end = new Date(`${range.end}T00:00:00`)
    return `${start.toLocaleDateString(locale, { day:'numeric', month:'short' })} – ${end.toLocaleDateString(locale, { day:'numeric', month:'short', year:'numeric' })}`
  }
  if (!range.end) return start.toLocaleDateString(locale, { day:'numeric', month:'short', year:'numeric' })
  const end = new Date(`${range.end}T00:00:00`)
  const fmtShort = d => d.toLocaleDateString(locale, { day:'numeric', month:'short' })
  return `${fmtShort(start)} – ${fmtShort(end)} ${end.getFullYear()}`
}

function getPreviousPeriodRange(period, range) {
  if (period === 'month') {
    const start = new Date(`${range.start}T00:00:00`)
    const prevMonth = new Date(start.getFullYear(), start.getMonth() - 1, 1)
    const prevMonthEnd = new Date(start.getFullYear(), start.getMonth(), 0)
    const pad = n => String(n).padStart(2, '0')
    return {
      start: `${prevMonth.getFullYear()}-${pad(prevMonth.getMonth() + 1)}-${pad(prevMonth.getDate())}`,
      end: `${prevMonthEnd.getFullYear()}-${pad(prevMonthEnd.getMonth() + 1)}-${pad(prevMonthEnd.getDate())}`,
    }
  }
  if (period === 'year') {
    const year = parseInt(range.start.slice(0, 4), 10) - 1
    return { start: `${year}-01-01`, end: `${year}-12-31` }
  }
  if (period === 'quarter') {
    const start = new Date(`${range.start}T00:00:00`)
    const prevQuarterEnd = new Date(start.getFullYear(), start.getMonth(), 0)
    const prevQuarterStart = new Date(prevQuarterEnd.getFullYear(), Math.floor(prevQuarterEnd.getMonth() / 3) * 3, 1)
    const pad = n => String(n).padStart(2, '0')
    return {
      start: `${prevQuarterStart.getFullYear()}-${pad(prevQuarterStart.getMonth() + 1)}-${pad(prevQuarterStart.getDate())}`,
      end: `${prevQuarterEnd.getFullYear()}-${pad(prevQuarterEnd.getMonth() + 1)}-${pad(prevQuarterEnd.getDate())}`,
    }
  }
  // fallback: week / day / custom — shift by same duration
  if (range.start && range.end) {
    const startD = new Date(`${range.start}T00:00:00`)
    const endD = new Date(`${range.end}T00:00:00`)
    const diff = endD - startD
    const prevEnd = new Date(startD - 1)
    const prevStart = new Date(prevEnd - diff)
    const fmt2 = d => d.toISOString().split('T')[0]
    return { start: fmt2(prevStart), end: fmt2(prevEnd) }
  }
  return { start: '', end: '' }
}

function buildIndicatorPeriodKey(range) {
  if (range?.start && range?.end) return `${range.start}:${range.end}`
  if (range?.start) return `${range.start}:${range.start}`
  const t = today()
  return `${t}:${t}`
}

export function Finance({ data, setData, saveDataNow, defaultTab = 'entradas' }) {
  const navigate = useNavigate()
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false
  const SUMMARY_CARDS = [
    ['Resultado de caixa', 'cashBalance', C.cyan],
    ['Lucro líquido', 'netProfit', 'dynamic-profit'],
    ['A receber', 'receivablesOpenTotal', C.accent],
    ['A pagar', 'payablesOpenTotal', C.yellow],
  ]
  const { financialPrivacyMode } = useFinancialPrivacy()
  const { toast } = useToast()
  const { ownerId, role } = useUserRole()
  const [tab, setTab] = useState(defaultTab)
  const [period, setPeriod] = useState('month')
  const [customRange, setCustomRange] = useState({ start:'', end:'' })
  const [modalType, setModalType] = useState(() => readModalDraft()?.modalType || null)
  const [editing, setEditing] = useState(() => readModalDraft()?.editing || null)
  const [showModal, setShowModal] = useState(() => {
    const draft = readModalDraft()
    return Boolean(draft?.showModal && draft?.modalType && draft?.form)
  })
  const [reconciliationReturn, setReconciliationReturn] = useState(() => readModalDraft()?.reconciliationReturn || null)
  const [confirmState, setConfirmState] = useState(null)
  const [paymentConfirmState, setPaymentConfirmState] = useState(null)
  const [listFilters, setListFilters] = useState({ search:'', category:'all', origin:'all', status:'all', launchType:'all' })
  const [form, setForm] = useState(() => {
    const draft = readModalDraft()
    return draft?.form ? { ...EXTRA_REVENUE_EMPTY, ...draft.form } : EXTRA_REVENUE_EMPTY
  })
  const [recurrences, setRecurrences] = useState([])
  const [showComparative, setShowComparative] = useState(false)
  const [expandedDreKeys, setExpandedDreKeys] = useState(() => new Set([
    'section:gross_revenue',
    'section:revenue_deductions',
    'section:direct_costs',
    'section:operating_expenses',
    'section:financial_result',
    'section:income_taxes',
  ]))
  const [showExport, setShowExport] = useState(false)
  const { detail, openDrilldown, closeDrilldown } = useFinancialDrilldown()
  const [formError, setFormError] = useState('')
  const [savingLaunch, setSavingLaunch] = useState(false)
  const savingLaunchRef = useRef(false)
  const [quickCategory, setQuickCategory] = useState(QUICK_CATEGORY_EMPTY)
  const range = getPeriodRange(period, customRange)
  const indicatorPeriodKey = useMemo(() => buildIndicatorPeriodKey(range), [range.start, range.end])
  const periodLabel = useMemo(() => formatFinancePeriodLabel(period, range), [period, range])
  const mergedData = useMemo(() => ({ ...data, recurrences }), [data, recurrences])
  const m = useMemo(
    () => buildMetrics(mergedData, { startDate:range.start, endDate:range.end, balanceDate:range.end || today() }),
    [mergedData, range.start, range.end],
  )
  const money = value => maskFinancialValue(value, financialPrivacyMode, fmt)
  const revenueAccountOptions = useMemo(() => postingAccountOptions(data?.chartAccounts || [], 'receivable'), [data?.chartAccounts])
  const expenseAccountOptions = useMemo(() => postingAccountOptions(data?.chartAccounts || [], 'payable'), [data?.chartAccounts])
  const revenueGroupOptions = useMemo(() => postingGroupOptions(data?.chartAccounts || [], 'receivable'), [data?.chartAccounts])
  const expenseGroupOptions = useMemo(() => postingGroupOptions(data?.chartAccounts || [], 'payable'), [data?.chartAccounts])
  const canManageChartAccounts = role === 'admin' || role === 'gestao'

  const persistLaunch = async (updater, pendingOperation) => {
    if (savingLaunchRef.current) return false
    savingLaunchRef.current = true
    setSavingLaunch(true)
    try {
      if (saveDataNow) await saveDataNow(updater, pendingOperation)
      else setData(updater)
      return true
    } catch (error) {
      const message = error.message || 'Nao foi possivel salvar o lancamento no banco.'
      setFormError(message)
      toast(message, 'warning')
      return false
    } finally {
      savingLaunchRef.current = false
      setSavingLaunch(false)
    }
  }

  const cancelLaunchModal = async () => {
    if (savingLaunchRef.current) return
    if (reconciliationReturn && !editing) {
      savingLaunchRef.current = true
      setSavingLaunch(true)
      try {
        await releaseBankStatementLineClaims([reconciliationReturn.lineId], reconciliationReturn.claimToken)
      } catch (error) {
        const message = error.message || 'Não foi possível cancelar a criação com segurança.'
        setFormError(message)
        toast(message, 'warning')
        savingLaunchRef.current = false
        setSavingLaunch(false)
        return
      }
      setReconciliationReturn(null)
      savingLaunchRef.current = false
      setSavingLaunch(false)
    }
    setShowModal(false)
    setFormError('')
  }

  useEffect(() => {
    if (!ownerId || (data?.chartAccounts || []).length > 0) return
    let active = true
    ensureDefaultChartAccounts(ownerId)
      .then(accounts => {
        if (active) setData(current => ({ ...current, chartAccounts:accounts }))
      })
      .catch(error => {
        if (!isChartSchemaMissing(error)) toast(error.message || 'Não foi possível preparar o plano de contas.', 'warning')
      })
    return () => { active = false }
  }, [ownerId, data?.chartAccounts?.length, setData])

  const prevRange = useMemo(() => {
    if (!range.start) return { start:'', end:'' }
    return getPreviousPeriodRange(period, range)
  }, [period, range.start, range.end])

  const mPrev = useMemo(() => {
    if (!prevRange.start) return null
    return buildMetrics(mergedData, { startDate: prevRange.start, endDate: prevRange.end, balanceDate: prevRange.end })
  }, [mergedData, prevRange.start, prevRange.end])

  const allCostCenters = useMemo(() => {
    const defaults = new Set(DEFAULT_COST_CENTERS)
    const custom = new Set()
    for (const item of [...(data?.extraRevenues || []), ...(data?.expenses || [])]) {
      if (item.costCenter && !defaults.has(item.costCenter)) custom.add(item.costCenter)
    }
    return [
      { v:'', l:'Sem centro de custo' },
      ...DEFAULT_COST_CENTERS.map(l => ({ v:l, l })),
      ...[...custom].map(l => ({ v:l, l })),
    ]
  }, [data?.extraRevenues, data?.expenses])

  const allOrigins = useMemo(() => {
    const used = new Set()
    for (const item of [...(data?.extraRevenues || []), ...(data?.expenses || [])]) {
      const label = String(item.originLabel || '').trim()
      if (label) used.add(label)
    }
    return [{ v:'', l:'Sem origem definida' }, ...[...used].sort().map(l => ({ v:l, l }))]
  }, [data?.extraRevenues, data?.expenses])

  useEffect(() => {
    setTab(defaultTab)
  }, [defaultTab])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!showModal) {
      window.localStorage.removeItem(FINANCE_MODAL_DRAFT_KEY)
      window.sessionStorage.removeItem(FINANCE_MODAL_DRAFT_KEY)
      return
    }
    const payload = JSON.stringify({ showModal, modalType, editing, form, reconciliationReturn })
    window.localStorage.setItem(FINANCE_MODAL_DRAFT_KEY, payload)
    window.sessionStorage.setItem(FINANCE_MODAL_DRAFT_KEY, payload)
  }, [showModal, modalType, editing, form, reconciliationReturn])

  useEffect(() => {
    let active = true
    async function loadRecurrences() {
      const { data:rows, error } = await supabase
        .from('recorrencias')
        .select('*')
      if (!active) return
      if (error) {
        toast('Não foi possível carregar as recorrências. Tente recarregar a página.', 'warning')
        return
      }
      const normalizedRows = (rows || []).map(item => ({
        id:item.id,
        tipo:item.tipo || 'despesa',
        descricao:item.descricao || '',
        valor:Number(item.valor || 0),
        categoria:item.categoria || 'outros',
        frequencia:item.frequencia || 'mensal',
        diaExecucao:Number(item.dia_execucao || 1),
        dataInicio:item.data_inicio || '',
        dataFim:item.data_fim || '',
        autoMarkAsPaid:Boolean(item.auto_mark_as_paid),
        ativo:item.ativo !== false,
        chartAccountId:item.chart_account_id || null,
      }))
      setRecurrences(normalizedRows)
      if (ownerId) {
        const year = today().slice(0, 4)
        try {
          await syncRecurringLedger(supabase, ownerId, rows || [], `${year}-01-01`, today())
        } catch {
          toast('Recorrências carregadas, mas o razão persistido não foi atualizado.', 'warning')
        }
      }
    }
    loadRecurrences()
    return () => { active = false }
  }, [ownerId])

  // FAB quick-add events
  useEffect(() => {
    const onNewExpense = () => { setTab('saidas'); openAdd('expense') }
    const onNewRevenue = () => { setTab('entradas'); openAdd('extra') }
    window.addEventListener('new-expense', onNewExpense)
    window.addEventListener('new-extra-revenue', onNewRevenue)
    return () => {
      window.removeEventListener('new-expense', onNewExpense)
      window.removeEventListener('new-extra-revenue', onNewRevenue)
    }
  }, [])

  const flowRows = useMemo(() => {
    const grouped = {}
    m.cashFlowEntries.forEach(item => {
      const key = item.date
      if (!grouped[key]) grouped[key] = { date:key, entradas:0, saidas:0, saldo:0, items:[] }
      if (item.type === 'entrada') grouped[key].entradas += item.value
      if (item.type === 'saida') grouped[key].saidas += item.value
      grouped[key].items.push(item)
      grouped[key].saldo = grouped[key].entradas - grouped[key].saidas
    })
    return Object.values(grouped).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }, [m])

  const flowSummary = useMemo(() => {
    const totals = m.cashFlowEntries.reduce((acc, item) => {
      if (item.type === 'entrada') acc.entradas += Number(item.value || 0)
      if (item.type === 'saida') acc.saidas += Number(item.value || 0)
      return acc
    }, { entradas:0, saidas:0 })
    return {
      ...totals,
      resultado:totals.entradas - totals.saidas,
    }
  }, [m.cashFlowEntries])

  const openAdd = type => {
    const defaults = {
      extra:EXTRA_REVENUE_EMPTY,
      expense:EXPENSE_EMPTY,
      asset:BALANCE_EMPTY,
      liability:BALANCE_EMPTY,
    }[type]
    const defaultAccount = type === 'extra'
      ? findChartAccount(data?.chartAccounts || [], { systemKey:'revenue_other', direction:'receivable' })
      : type === 'expense'
        ? findChartAccount(data?.chartAccounts || [], { systemKey:'expense_other', direction:'payable' })
        : null
    setModalType(type)
    setForm(defaultAccount ? { ...defaults, chartAccountId:defaultAccount.id, category:defaultAccount.name } : defaults)
    setEditing(null)
    setReconciliationReturn(null)
    setFormError('')
    setQuickCategory(QUICK_CATEGORY_EMPTY)
    setShowModal(true)
  }

  const openEdit = (type, item) => {
    setModalType(type)
    setForm({ ...item })
    setEditing(item.id)
    setReconciliationReturn(null)
    setFormError('')
    setQuickCategory(QUICK_CATEGORY_EMPTY)
    setShowModal(true)
  }

  const returnToReconciliation = record => {
    if (!reconciliationReturn || editing || !record?.id) return
    window.localStorage.setItem(BANK_RECONCILIATION_RETURN_KEY, JSON.stringify({
      ...reconciliationReturn,
      sourceId:record.id,
      savedAt:new Date().toISOString(),
    }))
    setReconciliationReturn(null)
    navigate(`/app/bank-reconciliation?import=${encodeURIComponent(reconciliationReturn.importId)}`)
  }

  const openQuickCategory = direction => {
    const accountOptions = direction === 'receivable' ? revenueAccountOptions : expenseAccountOptions
    const groupOptions = direction === 'receivable' ? revenueGroupOptions : expenseGroupOptions
    const currentAccount = accountOptions.find(option => option.value === form.chartAccountId)?.account
    const preferredParent = groupOptions.find(option => option.value === currentAccount?.parentId)?.value || groupOptions[0]?.value || ''
    setQuickCategory({ ...QUICK_CATEGORY_EMPTY, open:true, direction, parentId:preferredParent })
  }

  const saveQuickCategory = async () => {
    const name = quickCategory.name.trim()
    if (!name || !quickCategory.parentId) {
      setQuickCategory(current => ({ ...current, error:'Informe o nome e o grupo da categoria.' }))
      return
    }
    if (!ownerId) {
      setQuickCategory(current => ({ ...current, error:'Não foi possível identificar a clínica ativa.' }))
      return
    }

    setQuickCategory(current => ({ ...current, saving:true, error:'' }))
    try {
      const accounts = await fetchChartAccounts(ownerId)
      const parent = accounts.find(item => item.id === quickCategory.parentId && item.nodeType === 'group' && item.isActive)
      const allowedParents = postingGroupOptions(accounts, quickCategory.direction)
      if (!parent || !allowedParents.some(option => option.value === parent.id)) throw new Error('O grupo escolhido não está mais disponível para este lançamento.')
      const code = nextChildAccountCode(accounts, parent.id)
      if (!code) throw new Error('Não foi possível gerar o código da categoria.')

      const saved = await createChartAccount(ownerId, {
        code,
        name,
        nodeType:'account',
        parentId:parent.id,
        nature:parent.nature,
        dreSection:parent.dreSection,
        description:'Criada durante um lançamento financeiro.',
        isActive:true,
        sortOrder:nextSiblingOrder(accounts, parent.id),
      })
      const nextAccounts = await fetchChartAccounts(ownerId)
      setData(current => ({ ...current, chartAccounts:nextAccounts }))
      setForm(current => ({ ...current, chartAccountId:saved.id, category:saved.name }))
      setQuickCategory(QUICK_CATEGORY_EMPTY)
      toast(`Categoria “${saved.name}” criada e selecionada.`)
    } catch (error) {
      const duplicate = String(error?.code || '') === '23505'
      setQuickCategory(current => ({ ...current, saving:false, error:duplicate ? 'Outra categoria foi criada ao mesmo tempo. Tente novamente.' : (error.message || 'Não foi possível criar a categoria.') }))
    }
  }

  const saveFixedRecurrence = async tipo => {
    const { data:userData, error:userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) throw new Error('Sessao invalida. Entre novamente.')

    const recurrenceDay = Math.max(1, Math.floor(Number(form.recurrenceDay || 1)))
    const safeDay = form.recurrenceFrequency === 'semanal' ? Math.min(7, recurrenceDay) : Math.min(31, recurrenceDay)

    const payload = {
      user_id: ownerId || userData.user.id,
      tipo,
      descricao:form.description,
      valor:Number(form.value || 0),
      categoria:form.category || (tipo === 'despesa' ? 'outros' : 'outras_receitas'),
      frequencia:form.recurrenceFrequency || 'mensal',
      dia_execucao:safeDay,
      data_inicio:form.recurrenceStartDate || today(),
      data_fim:form.recurrenceEndDate || null,
      auto_mark_as_paid:Boolean(form.recurrenceAutoMarkAsPaid),
      ativo:Boolean(form.recurrenceActive),
      ...(form.chartAccountId ? { chart_account_id:form.chartAccountId } : {}),
    }

    const { data:created, error } = await supabase.from('recorrencias').insert(payload).select('*').single()

    if (error) throw error

    if (created) {
      setRecurrences(current => [...current, {
        id:created.id,
        tipo:created.tipo || tipo,
        descricao:created.descricao || form.description,
        valor:Number(created.valor || form.value || 0),
        categoria:created.categoria || form.category || 'outros',
        frequencia:created.frequencia || form.recurrenceFrequency || 'mensal',
        diaExecucao:Number(created.dia_execucao || form.recurrenceDay || 1),
        dataInicio:created.data_inicio || form.recurrenceStartDate || today(),
        dataFim:created.data_fim || form.recurrenceEndDate || '',
        autoMarkAsPaid:Boolean(created.auto_mark_as_paid),
        ativo:created.ativo !== false,
        chartAccountId:created.chart_account_id || form.chartAccountId || null,
      }])
    }
  }

  const save = async () => {
    if (modalType === 'extra') {
      if (!form.description) {
        setFormError('Informe uma descrição para a receita.')
        return
      }
      setFormError('')
      if (reconciliationReturn && form.launchType === 'fixa') {
        setFormError('Linhas importadas devem gerar um lançamento único. Cancele e cadastre a recorrência separadamente.')
        return
      }
      if (!editing && form.launchType === 'fixa') {
        try {
          await saveFixedRecurrence('receita')
          toast('Receita fixa recorrente salva com sucesso.')
          setShowModal(false)
          return
        } catch (error) {
          toast(error.message || 'Nao foi possivel salvar a recorrencia.', 'warning')
          return
        }
      }
      const received = form.status !== 'pendente'
      const competenceDate = form.competenceDate || form.date || form.dueDate || today()
      const dueDate = form.dueDate || form.date || competenceDate
      const receiptDate = received ? (form.date || form.receivedDate || today()) : ''
      const normalizedRevenue = {
        ...form,
        originLabel:String(form.originLabel || '').trim(),
        status:received ? 'recebido' : 'pendente',
        competenceDate,
        dueDate,
        date:receiptDate,
        receivedDate:received ? receiptDate : null,
      }
      const revenueRecord = { ...normalizedRevenue, id:editing || reconciliationReturn?.sourceId || uid() }
      const saved = await persistLaunch(
        current => ({ ...current, extraRevenues:editing ? current.extraRevenues.map(item => item.id === editing ? revenueRecord : item) : [...current.extraRevenues, revenueRecord] }),
        { collection:'extraRevenues', record:revenueRecord },
      )
      if (!saved) return
      toast(editing ? 'Receita atualizada com sucesso.' : 'Receita salva com sucesso.')
      setShowModal(false)
      returnToReconciliation(revenueRecord)
      return
    }
    if (modalType === 'expense') {
      if (!form.description) {
        setFormError('Informe uma descrição para a despesa.')
        return
      }
      setFormError('')
      if (reconciliationReturn && form.launchType === 'fixa') {
        setFormError('Linhas importadas devem gerar um lançamento único. Cancele e cadastre a recorrência separadamente.')
        return
      }
      if (!editing && form.launchType === 'fixa') {
        try {
          await saveFixedRecurrence('despesa')
          toast('Despesa fixa recorrente salva com sucesso.')
          setShowModal(false)
          return
        } catch (error) {
          toast(error.message || 'Nao foi possivel salvar a recorrencia.', 'warning')
          return
        }
      }
      const isOpenExpense = form.status === 'aberto'
      const normalizedExpense = {
        ...form,
        dueDate: form.dueDate || form.paymentDate || today(),
        paymentDate: isOpenExpense ? null : (form.paymentDate || form.dueDate || today()),
        status: isOpenExpense ? 'aberto' : 'pago',
      }
      if (isOpenExpense) {
        const expenseRecord = { ...normalizedExpense, id:editing || reconciliationReturn?.sourceId || uid() }
        const saved = await persistLaunch(current => ({
          ...current,
          expenses: editing
            ? current.expenses.map(record => record.id === editing ? expenseRecord : record)
            : [...current.expenses, expenseRecord],
        }), { collection:'expenses', record:expenseRecord })
        if (!saved) return
        toast(editing ? 'Despesa atualizada.' : 'Despesa registrada como a pagar.')
        setShowModal(false)
        returnToReconciliation(expenseRecord)
        return
      }
      setConfirmState({
        action:'confirm-expense-save',
        title:editing ? 'Confirmar atualização da saída' : 'Confirmar lançamento da saída',
        message:`Confirma lançar ${money(Number(normalizedExpense.value || 0))} em "${normalizedExpense.description || 'despesa'}"?`,
        confirmLabel:editing ? 'Confirmar e atualizar' : 'Confirmar e lançar',
        confirmVariant:'success',
        payload:{ expense:{ ...normalizedExpense, id:editing || reconciliationReturn?.sourceId || uid() }, editing },
      })
      return
    }
    if (modalType === 'asset') {
      if (!form.name) return
      setData(current => ({ ...current, assets: editing ? current.assets.map(item => item.id === editing ? { ...form, id:editing } : item) : [...current.assets, { ...form, id:uid() }] }))
    }
    if (modalType === 'liability') {
      if (!form.name) return
      setData(current => ({ ...current, liabilities: editing ? current.liabilities.map(item => item.id === editing ? { ...form, id:editing } : item) : [...current.liabilities, { ...form, id:uid() }] }))
    }
    if (modalType === 'surgery') {
      if (!editing) return
      const normalized = withClinicalCostSettlementDefaults(form, 'surgery')
      setData(current => ({ ...current, surgeries: current.surgeries.map(item => item.id === editing ? { ...item, ...normalized, id:editing } : item) }))
      toast('Cirurgia atualizada com sucesso.')
      setShowModal(false)
      return
    }
    if (modalType === 'consultation') {
      if (!editing) return
      const normalized = withClinicalCostSettlementDefaults(form, 'consultation')
      setData(current => ({ ...current, consultations: current.consultations.map(item => item.id === editing ? { ...item, ...normalized, id:editing } : item) }))
      toast('Consulta atualizada com sucesso.')
      setShowModal(false)
      return
    }
    if (modalType === 'product-sale') {
      if (!editing) return
      if (form.paymentStatus === 'recebido' && !form.receivedDate) {
        setFormError('Informe a data real do recebimento.')
        return
      }
      if (form.paymentStatus === 'pendente' && !form.dueDate) {
        setFormError('Informe o vencimento da venda.')
        return
      }
      setFormError('')
      setData(current => ({ ...current, productSales: current.productSales.map(item => item.id === editing ? { ...item, ...form, id:editing } : item) }))
      toast('Venda atualizada com sucesso.')
      setShowModal(false)
      return
    }
    if (modalType === 'product-purchase') {
      if (!editing) return
      setData(current => ({ ...current, productPurchases: current.productPurchases.map(item => item.id === editing ? { ...item, ...form, id:editing } : item) }))
      toast('Compra atualizada com sucesso.')
      setShowModal(false)
      return
    }
    const labels = { extra: 'Receita salva', expense: 'Despesa salva', asset: 'Ativo salvo', liability: 'Passivo salvo' }
    toast(editing ? `${labels[modalType]} com sucesso.` : `${labels[modalType]} com sucesso.`)
    setShowModal(false)
  }

  const markReceivableAsPaid = item => {
    if (item.source === 'recorrencia') {
      const exists = data.extraRevenues.some(record => record.description === item.description && record.category === item.category && Number(record.value || 0) === Number(item.value || 0) && record.date === item.dueDate)
      if (!exists) {
        setData(current => ({
          ...current,
          extraRevenues:[...current.extraRevenues, { id:uid(), description:item.description, category:item.category || 'outras_receitas', chartAccountId:item.chartAccountId || null, value:item.value || 0, date:item.dueDate, receivedDate:item.dueDate, dueDate:item.dueDate, competenceDate:item.dueDate, status:'recebido' }],
        }))
      }
      toast('Recorrência marcada como recebida.')
      return
    }
    if (item.source === 'outra_receita') {
      setData(current => ({ ...current, extraRevenues:current.extraRevenues.map(record => record.id === item.sourceId ? { ...record, status:'recebido', date:today(), receivedDate:today() } : record) }))
      toast('Receita marcada como recebida.')
      return
    }
    if (item.source === 'venda_produto') {
      setData(current => ({ ...current, productSales:current.productSales.map(record => record.id === item.sourceId ? { ...record, paymentStatus:'recebido', receivedDate:today() } : record) }))
      toast('Venda de produto marcada como recebida.')
      return
    }
    if (item.source === 'cirurgia') {
      setData(current => ({
        ...current,
        surgeries:current.surgeries.map(record => {
          if (record.id !== item.sourceId) return record
          const decoded = decodePaymentMethod(record.paymentMethod)
          const scheduledPayments = Array.isArray(decoded.payments)
            ? decoded.payments
              .map(entry => ({ date:String(entry?.date || '').trim(), amount:Number(entry?.amount || 0) }))
              .filter(entry => entry.date && entry.amount > 0)
              .sort((a, b) => a.date.localeCompare(b.date))
            : []
          if (scheduledPayments.length <= 1) {
            return { ...record, paymentStatus:'pago', paymentDate:today() }
          }
          const currentCutoff = String(record.paymentDate || '').trim()
          const paidCount = currentCutoff ? scheduledPayments.filter(entry => entry.date <= currentCutoff).length : 0
          const installmentToReceive = scheduledPayments.find(entry => entry.date === item.dueDate) || scheduledPayments[Math.min(paidCount, scheduledPayments.length - 1)]
          if (!installmentToReceive) return record
          const nextPaymentDate = currentCutoff && currentCutoff > installmentToReceive.date ? currentCutoff : installmentToReceive.date
          const allPaid = scheduledPayments.every(entry => entry.date <= nextPaymentDate)
          return { ...record, paymentDate:nextPaymentDate, paymentStatus:allPaid ? 'pago' : 'pendente' }
        }),
      }))
      toast('Parcela marcada como recebida.')
      return
    }
    if (item.source === 'consulta') {
      setData(current => ({
        ...current,
        consultations:current.consultations.map(record => {
          if (record.id !== item.sourceId) return record
          const decoded = decodePaymentMethod(record.paymentMethod)
          const scheduledPayments = decoded.paymentScheduleMode === 'duas_datas'
            ? (decoded.payments || [])
              .map(entry => ({ date:String(entry?.date || '').trim(), amount:Number(entry?.amount || 0) }))
              .filter(entry => entry.date && entry.amount > 0)
              .sort((a, b) => a.date.localeCompare(b.date))
            : []
          if (scheduledPayments.length === 0) {
            return { ...record, paymentStatus:'pago', paymentDate:today() }
          }
          const currentCutoff = String(record.paymentDate || '').trim()
          const paidCount = currentCutoff
            ? scheduledPayments.filter(entry => entry.date <= currentCutoff).length
            : 0
          const installmentToReceive = scheduledPayments.find(entry => entry.date === item.dueDate) || scheduledPayments[Math.min(paidCount, scheduledPayments.length - 1)]
          if (!installmentToReceive) return record
          const nextPaymentDate = currentCutoff && currentCutoff > installmentToReceive.date ? currentCutoff : installmentToReceive.date
          const allPaid = scheduledPayments.every(entry => entry.date <= nextPaymentDate)
          return {
            ...record,
            paymentDate:nextPaymentDate,
            paymentStatus:allPaid ? 'pago' : 'pendente',
          }
        }),
      }))
      toast('Parcela marcada como recebida.')
      return
    }
    toast('Marcado como recebido.')
  }

  const markReceivableAsPending = item => {
    if (item.source === 'outra_receita') {
      setData(current => ({ ...current, extraRevenues:current.extraRevenues.map(record => record.id === item.sourceId ? { ...record, status:'pendente', receivedDate:null } : record) }))
      toast('Receita marcada como a receber.', 'warning')
      return
    }
    if (item.source !== 'recorrencia') return
    setData(current => ({
      ...current,
      extraRevenues:current.extraRevenues.filter(record => !(record.description === item.description && record.category === item.category && Number(record.value || 0) === Number(item.value || 0) && record.date === item.dueDate)),
    }))
    toast('Recorrência marcada como pendente.', 'warning')
  }

  const markExpenseAsPaid = item => {
    setPaymentConfirmState({
      item,
      paidToday:'sim',
      paymentDate:today(),
    })
  }

  const applyMarkExpenseAsPaid = (item, paidDate) => {
    if (item.source === 'recorrencia') {
      const exists = data.expenses.some(record => record.description === item.supplier && record.category === item.category && Number(record.value || 0) === Number(item.value || 0) && record.dueDate === item.dueDate)
      if (!exists) {
        setData(current => ({
          ...current,
          expenses:[...current.expenses, { id:uid(), description:item.supplier, category:item.category || 'outros', chartAccountId:item.chartAccountId || null, value:item.value || 0, dueDate:item.dueDate, paymentDate:paidDate, status:'pago' }],
        }))
      }
      toast('Recorrência marcada como paga.')
      return
    }
    if (item.source === 'compra_produto') {
      setData(current => ({ ...current, productPurchases:current.productPurchases.map(record => record.id === item.sourceId ? { ...record, status:'pago', paymentDate:paidDate } : record) }))
      toast('Compra de produto marcada como paga.')
      return
    }
    setData(current => ({ ...current, expenses:current.expenses.map(record => record.id === item.sourceId ? { ...record, status:'pago', paymentDate:paidDate } : record) }))
    toast('Despesa marcada como paga.')
  }

  const markExpenseAsPending = item => {
    if (item.source !== 'recorrencia') return
    setData(current => ({
      ...current,
      expenses:current.expenses.filter(record => !(record.description === item.supplier && record.category === item.category && Number(record.value || 0) === Number(item.value || 0) && record.dueDate === item.dueDate)),
    }))
    toast('Recorrência marcada como pendente.', 'warning')
  }

  const removeRecord = record => {
    const collection = { extra:'extraRevenues', expense:'expenses', asset:'assets', liability:'liabilities' }[record.type]
    setData(current => ({ ...current, [collection]:current[collection].filter(item => item.id !== record.id) }))
    toast('Registro removido.', 'warning')
  }

  const handleConfirmAction = async () => {
    if (!confirmState) return
    if (confirmState.action === 'delete-expense') {
      setData(current => ({ ...current, expenses:current.expenses.filter(record => record.id !== confirmState.id) }))
      toast('Saída removida.', 'warning')
      setConfirmState(null)
      return
    }
    if (confirmState.action === 'delete-entry') {
      const { origin, referenceId } = confirmState
      if (origin === 'cirurgia') {
        setData(current => ({ ...current, surgeries:current.surgeries.map(s => s.id === referenceId ? { ...s, paymentStatus:'pendente', paymentDate:null } : s) }))
        toast('Cirurgia marcada como pendente — saiu do financeiro.', 'warning')
      } else if (origin === 'consulta') {
        setData(current => ({ ...current, consultations:current.consultations.map(c => c.id === referenceId ? { ...c, paymentStatus:'pendente', paymentDate:null } : c) }))
        toast('Consulta marcada como pendente — saiu do financeiro.', 'warning')
      } else if (origin === 'outra_receita') {
        setData(current => ({ ...current, extraRevenues:current.extraRevenues.filter(r => r.id !== referenceId) }))
        toast('Receita removida.', 'warning')
      } else if (origin === 'venda_produto') {
        setData(current => ({ ...current, productSales:current.productSales.filter(r => r.id !== referenceId) }))
        toast('Venda de produto removida.', 'warning')
      }
      setConfirmState(null)
      return
    }
    if (confirmState.action === 'delete-exit') {
      const { origin, referenceId } = confirmState
      if (origin === 'compra_produto') {
        setData(current => ({ ...current, productPurchases:current.productPurchases.filter(r => r.id !== referenceId) }))
        toast('Compra de produto removida.', 'warning')
      }
      setConfirmState(null)
      return
    }
    if (confirmState.action === 'confirm-expense-save') {
      const payload = confirmState.payload?.expense
      if (!payload) {
        setConfirmState(null)
        return
      }
      const editingId = confirmState.payload?.editing
      const saved = await persistLaunch(current => ({
        ...current,
        expenses:editingId
          ? current.expenses.map(record => record.id === editingId ? { ...payload, id:editingId } : record)
          : [...current.expenses, payload],
      }), { collection:'expenses', record:payload })
      if (!saved) return
      toast(editingId ? 'Saída atualizada com sucesso.' : 'Saída lançada com sucesso.')
      setShowModal(false)
      setConfirmState(null)
      returnToReconciliation(payload)
      return
    }
    removeRecord(confirmState)
    setConfirmState(null)
  }

  const confirmExpensePayment = () => {
    if (!paymentConfirmState?.item) return
    const paidDate = paymentConfirmState.paidToday === 'sim' ? today() : paymentConfirmState.paymentDate
    if (!paidDate) {
      toast('Informe a data de pagamento.', 'warning')
      return
    }
    applyMarkExpenseAsPaid(paymentConfirmState.item, paidDate)
    setPaymentConfirmState(null)
  }

  const tabs = [
    ['entradas', 'Entradas'],
    ['saidas', 'Saídas'],
    ['receber', 'A receber'],
    ['pagar', 'A pagar'],
    ['inadimplencia', 'Inadimplência'],
    ['pacientes', 'Por paciente'],
    ['dre', 'DRE'],
    ['balanco', 'Balanço'],
    ['fluxo', 'Fluxo de caixa'],
    ['indicadores', 'Indicadores'],
  ]

  // Compatibilidade visual quando o schema/plano de contas ainda não estiver disponível.
  const legacyDreRows = [
    { label: 'Receita bruta total', getValue: mx => mx.grossRevenue, detailsKey:'grossRevenue', color: C.green, bold: false },
    { label: '(-) Deduções da receita', getValue: mx => mx.revenueDeductions || 0, detailsKey:'revenueDeductions', color: C.red, bold: false },
    { label: '= Receita líquida', getValue: mx => mx.netRevenue ?? mx.grossRevenue, detailsKey:'netRevenue', color: C.accent, bold: true },
    { label: '(-) Custos de cirurgias', getValue: mx => mx.surgeryCostTotal, detailsKey:'surgeryCostTotal', color: C.red, bold: false },
    { label: 'Receita líquida de cirurgias', getValue: mx => mx.surgeryRevenue - mx.surgeryCostTotal, detailsKey:'surgeryNetRevenue', color: null, bold: false },
    { label: 'Receita de consultas', getValue: mx => mx.consultationRevenue, detailsKey:'consultationRevenue', color: C.green, bold: false },
    { label: '(-) Custos de consultas (NF)', getValue: mx => mx.consultationCostTotal, detailsKey:'consultationCostTotal', color: C.red, bold: false },
    { label: 'Receita líquida de consultas', getValue: mx => mx.consultationRevenue - mx.consultationCostTotal, detailsKey:'consultationNetRevenue', color: null, bold: false },
    { label: 'Receita de produtos', getValue: mx => mx.productSalesRevenue, detailsKey:'productSalesRevenue', color: C.green, bold: false },
    { label: '(-) CMV de produtos', getValue: mx => mx.productCostOfSales, detailsKey:'productCostOfSales', color: C.red, bold: false },
    { label: '(-) Outros custos diretos', getValue: mx => mx.additionalDirectCosts || 0, detailsKey:'additionalDirectCosts', color: C.red, bold: false },
    { label: 'Outras receitas', getValue: mx => mx.extraRevenueTotal, detailsKey:'extraRevenueTotal', color: C.green, bold: false },
    { label: '= Receita operacional total', getValue: mx => mx.grossRevenue, detailsKey:'grossRevenue', color: C.accent, bold: true },
    { label: '(-) Despesas operacionais', getValue: mx => mx.operationalExpenses, detailsKey:'operationalExpenses', color: C.red, bold: false },
    { label: '= Lucro operacional', getValue: mx => mx.operatingProfit, detailsKey:'operatingProfit', color: mx => mx.operatingProfit >= 0 ? C.accent : C.red, bold: true },
    { label: '(+) Receitas financeiras', getValue: mx => mx.financialRevenue || 0, detailsKey:'financialRevenue', color: C.green, bold: false },
    { label: '(-) Despesas financeiras', getValue: mx => mx.financialExpenses || 0, detailsKey:'financialExpenses', color: C.red, bold: false },
    { label: '= Lucro antes dos tributos', getValue: mx => mx.profitBeforeTax ?? mx.operatingProfit, detailsKey:'profitBeforeTax', color: C.accent, bold: true },
    { label: '(-) Tributos sobre o lucro', getValue: mx => mx.taxExpenses, detailsKey:'taxExpenses', color: C.red, bold: false },
    { label: '= Lucro líquido', getValue: mx => mx.netProfit, detailsKey:'netProfit', color: mx => mx.netProfit >= 0 ? C.green : C.red, bold: true },
    { label: 'Margem operacional %', getValue: mx => mx.grossRevenue > 0 ? (mx.operatingProfit / mx.grossRevenue * 100) : 0, isPercent: true, color: mx => mx.operatingProfit >= 0 ? C.green : C.red, bold: false },
  ]

  const dynamicDreTree = useMemo(
    () => buildDrePresentation(data?.chartAccounts || [], m),
    [data?.chartAccounts, m],
  )
  const dynamicPreviousDreTree = useMemo(
    () => mPrev ? buildDrePresentation(data?.chartAccounts || [], mPrev) : [],
    [data?.chartAccounts, mPrev],
  )
  const visibleDynamicDreRows = useMemo(
    () => flattenVisibleDreRows(dynamicDreTree, expandedDreKeys),
    [dynamicDreTree, expandedDreKeys],
  )
  const previousDynamicDreByKey = useMemo(() => new Map(
    flattenVisibleDreRows(dynamicPreviousDreTree, expandedDreKeys).map(row => [row.key, row]),
  ), [dynamicPreviousDreTree, expandedDreKeys])
  const usingDynamicDre = dynamicDreTree.length > 0

  const toggleDreRow = key => {
    setExpandedDreKeys(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Expense categories for top-5 chart in saidas tab
  const topExpenseCategories = useMemo(() => {
    const cats = Object.entries(m.expensesByCategory)
      .map(([cat, total]) => ({ cat, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
    return cats
  }, [m.expensesByCategory])

  const maxExpense = topExpenseCategories.length > 0 ? topExpenseCategories[0].total : 1
  const dueAlerts = useMemo(() => buildDueAlerts(m.accountsPayable, m.accountsReceivable), [m.accountsPayable, m.accountsReceivable])

  const filteredEntriesFinancial = useMemo(() => {
    const search = String(listFilters.search || '').toLowerCase().trim()
    return m.entriesFinancial.filter(item => {
      const launchType = item.origin === 'recorrencia_receita' ? 'fixa' : 'variavel'
      if (listFilters.launchType !== 'all' && launchType !== listFilters.launchType) return false
      if (listFilters.category !== 'all' && item.category !== listFilters.category) return false
      if (listFilters.origin !== 'all' && resolveOrigin(item) !== listFilters.origin) return false
      if (!search) return true
      const haystack = `${item.date || ''} ${item.category || ''} ${item.description || ''} ${resolveOrigin(item)}`.toLowerCase()
      return haystack.includes(search)
    })
  }, [m.entriesFinancial, listFilters])

  const filteredExitsFinancial = useMemo(() => {
    const search = String(listFilters.search || '').toLowerCase().trim()
    return m.exitsFinancial.filter(item => {
      const launchType = item.origin === 'recorrencia_despesa' ? 'fixa' : 'variavel'
      if (listFilters.launchType !== 'all' && launchType !== listFilters.launchType) return false
      if (listFilters.category !== 'all' && item.category !== listFilters.category) return false
      if (listFilters.origin !== 'all' && resolveOrigin(item) !== listFilters.origin) return false
      if (!search) return true
      const haystack = `${item.date || ''} ${item.category || ''} ${item.description || ''} ${item.origin || ''}`.toLowerCase()
      return haystack.includes(search)
    })
  }, [m.exitsFinancial, listFilters])

  const filteredAccountsReceivable = useMemo(() => {
    const search = String(listFilters.search || '').toLowerCase().trim()
    return m.accountsReceivable.filter(item => {
      const launchType = item.source === 'recorrencia' ? 'fixa' : 'variavel'
      if (listFilters.launchType !== 'all' && launchType !== listFilters.launchType) return false
      if (listFilters.category !== 'all' && item.category !== listFilters.category) return false
      if (listFilters.origin !== 'all' && resolveOrigin(item) !== listFilters.origin) return false
      if (listFilters.status !== 'all' && item.status !== listFilters.status) return false
      if (!search) return true
      const haystack = `${item.patient || ''} ${item.description || ''} ${item.category || ''} ${resolveOrigin(item)} ${item.dueDate || ''}`.toLowerCase()
      return haystack.includes(search)
    })
  }, [m.accountsReceivable, listFilters])

  const filteredAccountsPayable = useMemo(() => {
    const search = String(listFilters.search || '').toLowerCase().trim()
    return m.accountsPayable.filter(item => {
      const launchType = item.source === 'recorrencia' ? 'fixa' : 'variavel'
      if (listFilters.launchType !== 'all' && launchType !== listFilters.launchType) return false
      if (listFilters.category !== 'all' && item.category !== listFilters.category) return false
      if (listFilters.origin !== 'all' && resolveOrigin(item) !== listFilters.origin) return false
      if (listFilters.status !== 'all' && item.status !== listFilters.status) return false
      if (!search) return true
      const haystack = `${item.supplier || ''} ${item.category || ''} ${resolveOrigin(item)} ${item.dueDate || ''}`.toLowerCase()
      return haystack.includes(search)
    })
  }, [m.accountsPayable, listFilters])

  const activeListFilterConfig = useMemo(() => {
    if (tab === 'entradas') {
      const categories = [...new Set(m.entriesFinancial.map(item => item.category).filter(Boolean))].sort()
      const origins = [...new Set(m.entriesFinancial.map(item => resolveOrigin(item)).filter(Boolean))].sort()
      return { show:true, showStatus:false, categories, origins, statuses:[] }
    }
    if (tab === 'saidas') {
      const categories = [...new Set(m.exitsFinancial.map(item => item.category).filter(Boolean))].sort()
      const origins = [...new Set(m.exitsFinancial.map(item => resolveOrigin(item)).filter(Boolean))].sort()
      return { show:true, showStatus:false, categories, origins, statuses:[] }
    }
    if (tab === 'receber') {
      const categories = [...new Set(m.accountsReceivable.map(item => item.category).filter(Boolean))].sort()
      const origins = [...new Set(m.accountsReceivable.map(item => resolveOrigin(item)).filter(Boolean))].sort()
      const statuses = [...new Set(m.accountsReceivable.map(item => item.status).filter(Boolean))].sort()
      return { show:true, showStatus:true, categories, origins, statuses }
    }
    if (tab === 'pagar') {
      const categories = [...new Set(m.accountsPayable.map(item => item.category).filter(Boolean))].sort()
      const origins = [...new Set(m.accountsPayable.map(item => resolveOrigin(item)).filter(Boolean))].sort()
      const statuses = [...new Set(m.accountsPayable.map(item => item.status).filter(Boolean))].sort()
      return { show:true, showStatus:true, categories, origins, statuses }
    }
    return { show:false, showStatus:false, categories:[], origins:[], statuses:[] }
  }, [tab, m.entriesFinancial, m.exitsFinancial, m.accountsReceivable, m.accountsPayable])

  const overdueReceivables = useMemo(() => {
    const todayStr = today()
    return m.accountsReceivable
      .filter(item => item.status !== 'pago' && item.dueDate && item.dueDate < todayStr)
      .map(item => {
        const diff = Math.floor((new Date() - new Date(`${item.dueDate}T00:00:00`)) / (1000 * 60 * 60 * 24))
        return { ...item, daysOverdue:diff }
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
  }, [m.accountsReceivable])

  const patientSummaries = useMemo(() => {
    const map = new Map()
    data.surgeries
      .filter(s => inRange(s.date, range.start, range.end))
      .forEach(s => {
        const name = s.patient || 'Não informado'
        if (!map.has(name)) map.set(name, { name, surgeries:0, consultations:0, totalRevenue:0, totalPaid:0, totalPending:0 })
        const p = map.get(name)
        p.surgeries++
        p.totalRevenue += s.totalValue || 0
        if (s.paymentStatus === 'pago') p.totalPaid += s.totalValue || 0
        else p.totalPending += s.totalValue || 0
      })
    data.consultations
      .filter(c => inRange(c.date, range.start, range.end))
      .forEach(c => {
        const name = c.patient || 'Não informado'
        if (!map.has(name)) map.set(name, { name, surgeries:0, consultations:0, totalRevenue:0, totalPaid:0, totalPending:0 })
        const p = map.get(name)
        p.consultations++
        p.totalRevenue += c.value || 0
        if (c.paymentStatus === 'pago') p.totalPaid += c.value || 0
        else p.totalPending += c.value || 0
      })
    return [...map.values()].sort((a, b) => b.totalRevenue - a.totalRevenue)
  }, [data.surgeries, data.consultations, range.start, range.end])

  const cashFlowProjection = useMemo(() => {
    const base = new Date()
    return [1, 2, 3].map(offset => {
      const d = new Date(base.getFullYear(), base.getMonth() + offset, 1)
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      const mx = buildMetrics(mergedData, { startDate:start, endDate:end, balanceDate:end })
      const label = d.toLocaleDateString('pt-BR', { month:'long', year:'numeric' })
      const expectedRevenue = mx.grossRevenue
      const expectedExpenses = mx.totalExpenses ?? (mx.operationalExpenses + mx.taxExpenses + mx.surgeryCostTotal + mx.productPurchaseTotal)
      return { label, expectedRevenue, expectedExpenses, net:expectedRevenue - expectedExpenses }
    })
  }, [mergedData])

  const nextDueItem = useMemo(() => {
    const todayStr = today()
    return [...m.accountsReceivable, ...m.accountsPayable]
      .filter(item => item.status !== 'pago' && item.dueDate && item.dueDate >= todayStr)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
      [0] || null
  }, [m.accountsReceivable, m.accountsPayable])

  // Revenue by origin totals for entradas tab
  const revenueOrigins = (() => {
    const cirurgias = m.surgeryRevenue
    const consultas = m.consultationRevenue
    const produtos = m.productSalesRevenue
    const outras = m.extraRevenueTotal
    const total = cirurgias + consultas + produtos + outras || 1
    return [
      { label: 'Cirurgias', value: cirurgias, detailsKey:'surgeryRevenue', color: C.accent },
      { label: 'Consultas', value: consultas, detailsKey:'consultationRevenue', color: C.cyan },
      { label: 'Produtos', value: produtos, detailsKey:'productSalesRevenue', color: C.yellow },
      { label: 'Outras receitas', value: outras, detailsKey:'extraRevenueTotal', color: C.purple },
    ].map(item => ({ ...item, pct: total > 0 ? item.value / total * 100 : 0, total }))
  })()

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <FinancialDrilldownModal detail={detail} onClose={closeDrilldown} />
      <div style={{ position:'sticky', top:0, zIndex:5, marginBottom:2 }}>
        <div style={{ background:`linear-gradient(180deg, ${C.bg}FA, ${C.bg}EB)`, border:`1px solid ${C.border}66`, borderRadius:18, padding:16, backdropFilter:'blur(12px)' }}>
          <div style={{ marginBottom:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:8 }}>
              <div style={{ fontSize:12, fontWeight:700, color:C.textSub }}>
                Período{periodLabel ? <span style={{ fontWeight:400, color:C.textDim, marginLeft:6 }}>{periodLabel}</span> : ''}
              </div>
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {PERIOD_PILLS.map(option => {
                const active = period === option.value
                return (
                  <button
                    key={option.value}
                    onClick={() => setPeriod(option.value)}
                    style={{
                      padding:'7px 13px', borderRadius:999, cursor:'pointer',
                      fontFamily:'inherit', fontSize:12, fontWeight:active ? 700 : 500,
                      border: active ? `1px solid ${C.accent}66` : `1px solid ${C.border}`,
                      background: active ? C.accent + '20' : 'transparent',
                      color: active ? C.accentLight : C.textSub,
                      transition:'all 0.15s',
                    }}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            {period === 'custom' && (
              <div style={{ display:'flex', gap:10, marginTop:10, flexWrap:'wrap', alignItems:'center' }}>
                <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                  <label style={{ fontSize:11, color:C.textDim, fontWeight:600 }}>Data inicial</label>
                  <input type="date" value={customRange.start} onChange={e => setCustomRange(current => ({ ...current, start:e.target.value }))} style={{ padding:'7px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', color:C.text, fontFamily:'inherit', fontSize:13 }} />
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                  <label style={{ fontSize:11, color:C.textDim, fontWeight:600 }}>Data final</label>
                  <input type="date" value={customRange.end} onChange={e => setCustomRange(current => ({ ...current, end:e.target.value }))} style={{ padding:'7px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', color:C.text, fontFamily:'inherit', fontSize:13 }} />
                </div>
              </div>
            )}
          </div>

          <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:2, alignItems:'center' }}>
            {tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} style={{ background:tab === id ? C.card : 'transparent', color:tab === id ? C.text : C.textSub, border:tab === id ? `1px solid ${C.border}` : '1px solid transparent', borderRadius:999, padding:'9px 14px', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'all 0.2s', whiteSpace:'nowrap' }}>{label}</button>)}
            <div style={{ marginLeft:'auto', flexShrink:0 }}>
              <Btn variant="ghost" onClick={() => setShowExport(true)} style={{ fontSize:12, padding:'8px 14px', display:'flex', alignItems:'center', gap:6 }}>
                <span>↓</span> Exportar para Contador
              </Btn>
            </div>
          </div>
        </div>
      </div>

      {/* Resumo rápido */}
      <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:12 }}>
        {SUMMARY_CARDS.map(([label, key, color]) => {
          const value = m[key]
          const resolvedColor = color === 'dynamic-profit' ? (value >= 0 ? C.green : C.red) : color
          return (
            <Card key={label} onClick={() => openDrilldown(label, m.drilldowns?.[key] || [], value, 'Lançamentos considerados no período e regime deste indicador.')} title="Clique para ver os lançamentos" style={{ padding:isMobile ? 14 : 18, background:`linear-gradient(135deg, ${resolvedColor}0A, transparent)`, border:`1px solid ${resolvedColor}22` }}>
              <div style={{ fontSize:10, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{label}</div>
              <div style={{ fontSize:isMobile ? 18 : 22, fontWeight:800, color:resolvedColor, letterSpacing:'-0.02em' }}>{money(value)}</div>
              <div style={{ fontSize:10, color:C.accentLight, marginTop:7, fontWeight:700 }}>Ver lançamentos →</div>
            </Card>
          )
        })}
      </div>

      {nextDueItem && (
        <Card style={{ padding:'12px 18px', border:`1px solid ${C.yellow}44`, background:`${C.yellow}08`, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <span style={{ fontSize:16 }}>⏰</span>
            <div>
              <div style={{ fontSize:11, color:C.yellow, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>Próximo vencimento</div>
              <div style={{ fontSize:13, color:C.text, fontWeight:600, marginTop:2 }}>
                {nextDueItem.patient || nextDueItem.supplier || nextDueItem.description || '—'} · {formatDateBR(nextDueItem.dueDate)}
              </div>
            </div>
          </div>
          <div style={{ fontSize:16, fontWeight:800, color:C.yellow }}>{money(nextDueItem.value)}</div>
        </Card>
      )}

      {(dueAlerts.overdue.length > 0 || dueAlerts.dueSoon.length > 0) && (
        <Card style={{ padding:16, border:`1px solid ${C.yellow}55` }}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:8 }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Alertas de vencimento</div>
            <div style={{ color:C.textSub, fontSize:12 }}>
              {dueAlerts.overdue.length} vencida(s) · {dueAlerts.dueSoon.length} vencendo em até 3 dias
            </div>
          </div>
          <div style={{ display:'grid', gap:8 }}>
            {dueAlerts.overdue.slice(0, 4).map(item => (
              <div key={`overdue-${item.id}`} style={{ display:'flex', justifyContent:'space-between', gap:12, borderTop:`1px solid ${C.border}33`, paddingTop:8 }}>
                <span style={{ color:C.red, fontSize:12 }}>Vencida: {item.label} · {formatDateBR(item.dueDate)}</span>
                <span style={{ color:C.red, fontWeight:700, fontSize:12 }}>{money(item.value)}</span>
              </div>
            ))}
            {dueAlerts.dueSoon.slice(0, 4).map(item => (
              <div key={`soon-${item.id}`} style={{ display:'flex', justifyContent:'space-between', gap:12, borderTop:`1px solid ${C.border}33`, paddingTop:8 }}>
                <span style={{ color:C.yellow, fontSize:12 }}>A vencer: {item.label} · {formatDateBR(item.dueDate)} ({item.days} dia(s))</span>
                <span style={{ color:C.yellow, fontWeight:700, fontSize:12 }}>{money(item.value)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeListFilterConfig.show && (
        <Card style={{ padding:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10, alignItems:'end' }}>
            <FInput label="Buscar" value={listFilters.search} onChange={value => setListFilters(current => ({ ...current, search:value }))} placeholder="Paciente, descrição, categoria..." />
            <FInput label="Categoria" value={listFilters.category} onChange={value => setListFilters(current => ({ ...current, category:value }))} options={[{ v:'all', l:'Todas' }, ...activeListFilterConfig.categories.map(value => ({ v:value, l:value.replaceAll('_', ' ') }))]} />
            <FInput label="Origem" value={listFilters.origin} onChange={value => setListFilters(current => ({ ...current, origin:value }))} options={[{ v:'all', l:'Todas' }, ...activeListFilterConfig.origins.map(value => ({ v:value, l:value.replaceAll('_', ' ') }))]} />
            <FInput label="Tipo" value={listFilters.launchType} onChange={value => setListFilters(current => ({ ...current, launchType:value }))} options={[{ v:'all', l:'Todos' }, { v:'fixa', l:'Fixa' }, { v:'variavel', l:'Variável' }]} />
            {activeListFilterConfig.showStatus && <FInput label="Status" value={listFilters.status} onChange={value => setListFilters(current => ({ ...current, status:value }))} options={[{ v:'all', l:'Todos' }, ...activeListFilterConfig.statuses.map(value => ({ v:value, l:value }))]} />}
            <Btn variant="ghost" onClick={() => setListFilters({ search:'', category:'all', origin:'all', status:'all', launchType:'all' })}>Limpar filtros</Btn>
          </div>
        </Card>
      )}

      {tab === 'entradas' && <>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <SectionTitle title="Entradas automáticas e receitas adicionais" subtitle="Cirurgias pagas, consultas recebidas, vendas de produtos e outras receitas." />
          <Btn onClick={() => openAdd('extra')}>+ Outra receita</Btn>
        </div>

        <Card style={{ padding:20 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:16 }}>Receita por origem</div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {revenueOrigins.map(item => (
              <div key={item.label} role="button" tabIndex={0} onClick={() => openDrilldown(`Receita de ${item.label.toLowerCase()}`, m.drilldowns?.[item.detailsKey] || [], item.value)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openDrilldown(`Receita de ${item.label.toLowerCase()}`, m.drilldowns?.[item.detailsKey] || [], item.value) }} title="Clique para ver os lançamentos" style={{ cursor:'pointer' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                  <span style={{ fontSize:12, color:C.textSub, fontWeight:600 }}>{item.label}</span>
                  <span style={{ fontSize:12, color:C.textSub }}>
                    <span style={{ color:item.color, fontWeight:700, marginRight:8 }}>{item.pct.toFixed(1)}%</span>
                    {money(item.value)}
                  </span>
                </div>
                <div style={{ height:8, borderRadius:999, background:`${C.border}44`, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${item.pct}%`, borderRadius:999, background:item.color, transition:'width 0.4s ease' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <RecordTable columns={['Data', 'Categoria', 'Descrição', 'Origem', 'Valor', 'Ações']} sortableColumns={[0, 1, 3]} rows={filteredEntriesFinancial.map(item => {
          const removable = ['cirurgia', 'consulta', 'outra_receita', 'venda_produto'].includes(item.origin)
          const removeLabels = { cirurgia:'Cancelar pgto', consulta:'Cancelar pgto', outra_receita:'Remover', venda_produto:'Remover' }
          const messages = {
            cirurgia:'Cancelar pagamento marca a cirurgia como pendente e a remove do financeiro. Ela continua cadastrada em Cirurgias.',
            consulta:'Cancelar pagamento marca a consulta como pendente e a remove do financeiro. Ela continua cadastrada em Consultas.',
            outra_receita:'Remover esta receita adicional? Ela será excluída permanentemente.',
            venda_produto:'Remover esta venda de produto? Ela será excluída permanentemente.',
          }
          const editTypeMap = { cirurgia:'surgery', consulta:'consultation', outra_receita:'extra', venda_produto:'product-sale' }
          const sourceMap = { cirurgia:data.surgeries, consulta:data.consultations, outra_receita:data.extraRevenues, venda_produto:data.productSales }
          const editType = editTypeMap[item.origin]
          const sourceRecord = editType ? (sourceMap[item.origin] || []).find(r => r.id === item.referenceId) : null
          return {
            key:item.id,
            cells:[
              formatDateBR(item.date), item.category, item.description, resolveOrigin(item),
              <span style={{ color:C.green, fontWeight:700 }}>{money(item.value)}</span>,
              <div style={{ display:'flex', gap:6 }}>
                {sourceRecord && <Btn variant="ghost" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => openEdit(editType, sourceRecord)}>Editar</Btn>}
                {removable
                  ? <Btn variant="danger" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => setConfirmState({ action:'delete-entry', origin:item.origin, referenceId:item.referenceId, title:removeLabels[item.origin], message:messages[item.origin], confirmLabel:'Confirmar', confirmVariant:'danger' })}>{removeLabels[item.origin]}</Btn>
                  : <span style={{ color:C.textDim, fontSize:11 }}>—</span>}
              </div>,
            ],
            rawCells:[item.date, item.category, item.description, resolveOrigin(item), item.value, removable ? 1 : 0],
          }
        })} emptyMessage="Nenhuma entrada financeira no período." />
      </>}

      {tab === 'saidas' && <>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <SectionTitle title="Saídas do período" subtitle="Custos cirúrgicos, compras de produtos e despesas administrativas pagas." />
          <Btn onClick={() => openAdd('expense')}>+ Nova despesa</Btn>
        </div>

        {topExpenseCategories.length > 0 && (
          <Card style={{ padding:20 }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:16 }}>Top categorias de despesa</div>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {topExpenseCategories.map((item, idx) => {
                const pct = maxExpense > 0 ? item.total / maxExpense * 100 : 0
                const barColors = [C.red, C.yellow, C.purple, C.cyan, C.accent]
                const barColor = barColors[idx % barColors.length]
                return (
                  <div key={item.cat} role="button" tabIndex={0} onClick={() => openDrilldown(`Despesas — ${item.cat.replaceAll('_', ' ')}`, m.drilldowns?.byExpenseCategory?.[item.cat] || [], item.total)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.currentTarget.click() }} title="Clique para ver os lançamentos" style={{ cursor:'pointer' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                      <span style={{ fontSize:12, color:C.textSub, fontWeight:600, textTransform:'capitalize' }}>{item.cat}</span>
                      <span style={{ fontSize:12, color:barColor, fontWeight:700 }}>{money(item.total)}</span>
                    </div>
                    <div style={{ height:8, borderRadius:999, background:`${C.border}44`, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${pct}%`, borderRadius:999, background:barColor, transition:'width 0.4s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        <RecordTable columns={['Data', 'Categoria', 'Descrição', 'Origem', 'Valor', 'Ações']} sortableColumns={[0, 1, 3]} rows={filteredExitsFinancial.map(item => {
          const editSourceMap = { despesa:data.expenses, compra_produto:data.productPurchases }
          const editTypeMap = { despesa:'expense', compra_produto:'product-purchase' }
          const sourceRecord = (editSourceMap[item.origin] || []).find(r => r.id === item.referenceId)
          const editType = editTypeMap[item.origin]
          let removeBtn = null
          if (item.origin === 'despesa') {
            removeBtn = <Btn variant="danger" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => setConfirmState({ action:'delete-expense', id:item.referenceId, title:'Excluir despesa', message:'Deseja excluir esta despesa? O lançamento será removido permanentemente.', confirmLabel:'Excluir', confirmVariant:'danger' })}>Remover</Btn>
          } else if (item.origin === 'compra_produto') {
            removeBtn = <Btn variant="danger" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => setConfirmState({ action:'delete-exit', origin:'compra_produto', referenceId:item.referenceId, title:'Remover compra de produto', message:'Deseja remover esta compra de produto? Ela será excluída permanentemente.', confirmLabel:'Remover', confirmVariant:'danger' })}>Remover</Btn>
          }
          const actionCell = (
            <div style={{ display:'flex', gap:6 }}>
              {sourceRecord && editType && <Btn variant="ghost" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => openEdit(editType, sourceRecord)}>Editar</Btn>}
              {removeBtn || <span style={{ color:C.textDim, fontSize:11 }}>—</span>}
            </div>
          )
          return { key:item.id, cells:[formatDateBR(item.date), item.category, item.description, resolveOrigin(item), <span style={{ color:C.red, fontWeight:700 }}>{money(item.value)}</span>, actionCell], rawCells:[item.date, item.category, item.description, resolveOrigin(item), item.value, ['despesa','compra_produto'].includes(item.origin) ? 1 : 0] }
        })} emptyMessage="Nenhuma saída financeira no período." />
      </>}

      {tab === 'receber' && <>
        <SectionTitle title="Contas a receber" subtitle="Títulos ainda não recebidos de cirurgias, consultas, produtos, receitas extras e recorrências." />
        <MonthlyAccountsSummary
          title="Recebíveis por mês"
          color={C.green}
          rows={groupAccountsByMonth(filteredAccountsReceivable)}
          money={money}
          onOpen={item => openDrilldown(`Recebíveis de ${item.month}`, item.items.map(row => ({ ...row, date:row.dueDate, party:row.patient || '', origin:resolveOrigin(row), description:row.description || row.patient || 'Conta a receber' })), item.total)}
          emptyMessage="Sem recebíveis agrupados por mês."
        />
        <RecordTable columns={['Origem', 'Paciente', 'Descrição', 'Competência', 'Vencimento', 'Valor', 'Status', 'Ações']} rows={filteredAccountsReceivable.map(item => ({ key:item.id, cells:[resolveOrigin(item), item.patient, item.description, formatDateBR(item.competenceDate || item.dueDate), formatDateBR(item.dueDate), <span style={{ color:C.green, fontWeight:700 }}>{money(item.value)}</span>, <Badge color={item.status === 'pago' ? C.green : C.yellow} small>{item.status}</Badge>, ['recorrencia','outra_receita'].includes(item.source) ? <div style={{ display:'flex', gap:6 }}><Btn onClick={() => markReceivableAsPaid(item)} style={{ padding:'5px 10px', fontSize:12 }}>Recebido</Btn><Btn variant="ghost" onClick={() => markReceivableAsPending(item)} style={{ padding:'5px 10px', fontSize:12 }}>Pendente</Btn></div> : <Btn onClick={() => markReceivableAsPaid(item)} style={{ padding:'5px 12px', fontSize:12 }}>Marcar recebido</Btn>] }))} emptyMessage="Nenhuma conta a receber em aberto." />
      </>}

      {tab === 'pagar' && <>
        <SectionTitle title="Contas a pagar" subtitle="Despesas e compras ainda não liquidadas, incluindo recorrências fixas." />
        <MonthlyAccountsSummary
          title="Pagáveis por mês"
          color={C.red}
          rows={groupAccountsByMonth(filteredAccountsPayable)}
          money={money}
          onOpen={item => openDrilldown(`Contas a pagar de ${item.month}`, item.items.map(row => ({ ...row, date:row.dueDate, party:row.supplier || '', origin:row.source, description:row.description || row.supplier || 'Conta a pagar' })), item.total)}
          emptyMessage="Sem contas a pagar agrupadas por mês."
        />
        <RecordTable columns={['Categoria', 'Descrição', 'Competência', 'Vencimento', 'Valor', 'Status', 'Ações']} rows={filteredAccountsPayable.map(item => ({ key:item.id, cells:[item.category, item.supplier, formatDateBR(item.competenceDate || item.dueDate), formatDateBR(item.dueDate), <span style={{ color:C.red, fontWeight:700 }}>{money(item.value)}</span>, <Badge color={item.status === 'pago' ? C.green : C.yellow} small>{item.status}</Badge>, item.source === 'recorrencia' ? <div style={{ display:'flex', gap:6 }}><Btn onClick={() => markExpenseAsPaid(item)} style={{ padding:'5px 10px', fontSize:12 }}>Pago</Btn><Btn variant="ghost" onClick={() => markExpenseAsPending(item)} style={{ padding:'5px 10px', fontSize:12 }}>Pendente</Btn></div> : <Btn onClick={() => markExpenseAsPaid(item)} style={{ padding:'5px 12px', fontSize:12 }}>Marcar pago</Btn>] }))} emptyMessage="Nenhuma conta a pagar em aberto." />
      </>}

      {tab === 'dre' && (
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12, marginBottom:4 }}>
            <SectionTitle title="Demonstração do resultado" subtitle="Resultado por competência para o período selecionado." />
            {['month', 'quarter', 'year'].includes(period) && (
              <button
                onClick={() => setShowComparative(prev => !prev)}
                style={{
                  background: showComparative ? C.accent : 'transparent',
                  color: showComparative ? '#fff' : C.textSub,
                  border: `1px solid ${showComparative ? C.accent : C.border}`,
                  borderRadius: 999,
                  padding: '7px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.2s',
                }}
              >
                Comparar com período anterior
              </button>
            )}
          </div>

          <div style={{ marginTop:8, overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              {showComparative && mPrev && (
                <thead>
                  <tr>
                    <th style={{ padding:'10px 0', textAlign:'left', fontSize:11, color:C.textDim, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', width:'40%' }}>Item</th>
                    <th style={{ padding:'10px 12px', textAlign:'right', fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Período atual</th>
                    <th style={{ padding:'10px 12px', textAlign:'right', fontSize:11, color:C.textDim, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Período anterior</th>
                    <th style={{ padding:'10px 12px', textAlign:'right', fontSize:11, color:C.textDim, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Var.</th>
                  </tr>
                </thead>
              )}
              <tbody>
                {(usingDynamicDre ? visibleDynamicDreRows : legacyDreRows).map(row => {
                  const currentVal = usingDynamicDre ? Number(row.value || 0) : row.getValue(m)
                  const prevVal = mPrev
                    ? (usingDynamicDre ? Number(previousDynamicDreByKey.get(row.key)?.value || 0) : row.getValue(mPrev))
                    : null
                  const details = usingDynamicDre ? (row.details || []) : (m.drilldowns?.[row.detailsKey] || [])
                  const canDrillDown = usingDynamicDre ? details.length > 0 : Boolean(row.detailsKey)
                  const canExpand = usingDynamicDre && row.children?.length > 0
                  const isExpanded = canExpand && expandedDreKeys.has(row.key)
                  const isEmphasized = usingDynamicDre
                    ? ['section', 'subtotal'].includes(row.type) || row.type === 'group'
                    : row.bold
                  const resolveColor = (val, colorProp) => {
                    if (usingDynamicDre) {
                      if (row.tone === 'expense') return C.red
                      if (row.tone === 'revenue') return C.green
                      if (row.tone === 'net') return val >= 0 ? C.green : C.red
                      return val >= 0 ? C.accent : C.red
                    }
                    if (typeof colorProp === 'function') return colorProp({ operatingProfit: val })
                    if (colorProp) return colorProp
                    return val >= 0 ? C.green : C.red
                  }
                  const currentColor = resolveColor(currentVal, row.color)

                  let delta = null
                  if (showComparative && mPrev && prevVal !== null) {
                    if (prevVal !== 0) {
                      delta = ((currentVal - prevVal) / Math.abs(prevVal)) * 100
                    } else if (currentVal !== 0) {
                      delta = 100
                    } else {
                      delta = 0
                    }
                  }

                  const formatVal = (val) => {
                    if (row.isPercent) return `${val.toFixed(1)}%`
                    return money(val)
                  }

                  const rowLabel = usingDynamicDre && row.type === 'section' && row.tone === 'expense'
                    ? `(-) ${row.label}`
                    : row.label
                  const openRowDetails = canDrillDown
                    ? () => openDrilldown(rowLabel.replace(/^\W+/, ''), details, currentVal, 'Composição por competência do período selecionado.')
                    : undefined
                  const deltaColor = row.tone === 'expense'
                    ? (delta > 0 ? C.red : delta < 0 ? C.green : C.textDim)
                    : (delta > 0 ? C.green : delta < 0 ? C.red : C.textDim)

                  return (
                    <tr
                      key={row.key || row.label}
                      onClick={openRowDetails}
                      onKeyDown={event => { if (openRowDetails && (event.key === 'Enter' || event.key === ' ')) openRowDetails() }}
                      tabIndex={canDrillDown ? 0 : undefined}
                      title={canDrillDown ? 'Clique para ver os lançamentos' : undefined}
                      style={{
                        borderTop:`1px solid ${C.border}${row.type === 'subtotal' ? '55' : '22'}`,
                        background:row.type === 'subtotal' ? `${C.accent}08` : 'transparent',
                        cursor:canDrillDown ? 'pointer' : undefined,
                      }}
                    >
                      <td style={{ padding:'12px 0', color:row.type === 'subtotal' ? C.text : C.textSub, fontSize:13, fontWeight:isEmphasized ? 700 : 400 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:7, paddingLeft:usingDynamicDre ? Math.min(Number(row.depth || 0), 4) * 20 : 0 }}>
                          {canExpand ? (
                            <button
                              type="button"
                              aria-label={`${isExpanded ? 'Recolher' : 'Expandir'} ${row.label}`}
                              aria-expanded={isExpanded}
                              onClick={event => { event.stopPropagation(); toggleDreRow(row.key) }}
                              style={{ width:20, height:20, border:0, background:'transparent', color:C.textDim, cursor:'pointer', padding:0, fontSize:12 }}
                            >
                              {isExpanded ? '▾' : '▸'}
                            </button>
                          ) : usingDynamicDre && row.depth > 0 ? <span style={{ width:20 }} /> : null}
                          {usingDynamicDre && row.code && <span style={{ color:C.textDim, fontSize:11, fontVariantNumeric:'tabular-nums', minWidth:48 }}>{row.code}</span>}
                          <span>{rowLabel}</span>
                          {usingDynamicDre && row.isActive === false && <Badge color={C.textDim} small>inativa</Badge>}
                        </div>
                      </td>
                      <td style={{ padding:'12px 12px', textAlign:'right', color:currentColor, fontWeight:isEmphasized ? 800 : 700, fontSize:13 }}>
                        {formatVal(currentVal)}
                      </td>
                      {showComparative && mPrev && (
                        <>
                          <td style={{ padding:'12px 12px', textAlign:'right', color:C.textDim, fontWeight:600, fontSize:13 }}>
                            {formatVal(prevVal)}
                          </td>
                          <td style={{ padding:'12px 12px', textAlign:'right', fontSize:12, fontWeight:700, whiteSpace:'nowrap' }}>
                            {delta !== null && (
                              <span style={{ color:deltaColor }}>
                                {delta > 0 ? '▲' : delta < 0 ? '▼' : '—'} {Math.abs(delta).toFixed(1)}%
                              </span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'balanco' && <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:16 }}><Card><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, gap:12, flexWrap:'wrap' }}><SectionTitle title="Ativos complementares" subtitle="Banco, aplicações e outros ativos fora do caixa operacional." compact /><Btn onClick={() => openAdd('asset')} style={{ padding:'7px 12px' }}>+ Ativo</Btn></div><BalanceList items={data.assets} color={C.green} onEdit={item => openEdit('asset', item)} onDelete={item => setConfirmState({ type:'asset', id:item.id })} emptyMessage="Nenhum ativo complementar." hidden={financialPrivacyMode} /></Card><Card><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, gap:12, flexWrap:'wrap' }}><SectionTitle title="Passivos complementares" subtitle="Empréstimos, obrigações e passivos extras." compact /><Btn onClick={() => openAdd('liability')} style={{ padding:'7px 12px' }}>+ Passivo</Btn></div><BalanceList items={data.liabilities} color={C.red} onEdit={item => openEdit('liability', item)} onDelete={item => setConfirmState({ type:'liability', id:item.id })} emptyMessage="Nenhum passivo complementar." hidden={financialPrivacyMode} /></Card><Card style={{ gridColumn:'1 / -1' }}><SectionTitle title="Balanço patrimonial automático" subtitle="Posição financeira consolidada na data selecionada." /><div style={{ marginTop:8 }}>{[['Caixa', m.cashBalance, C.cyan, 'cashBalance'], ['Contas a receber', m.receivablesOpenTotal, C.green, 'receivablesOpenTotal'], ['Banco e outros ativos', data.assets.reduce((acc, item) => acc + (item.value || 0), 0), C.accent, 'bankAssets'], ['Contas a pagar', m.payablesOpenTotal, C.red, 'payablesOpenTotal'], ['Passivos complementares', data.liabilities.reduce((acc, item) => acc + (item.value || 0), 0), C.red, 'complementaryLiabilities'], ['Lucros acumulados / patrimônio', m.equity, m.equity >= 0 ? C.green : C.red, 'equity']].map(([label, value, color, detailsKey]) => <div key={label} role="button" tabIndex={0} onClick={() => openDrilldown(label, m.drilldowns?.[detailsKey] || [], value, 'Composição da posição financeira na data selecionada.')} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openDrilldown(label, m.drilldowns?.[detailsKey] || [], value) }} title="Clique para ver os lançamentos" style={{ display:'flex', justifyContent:'space-between', gap:16, padding:'12px 0', borderTop:`1px solid ${C.border}22`, alignItems:'center', flexWrap:'wrap', cursor:'pointer' }}><span style={{ color:C.textSub }}>{label}</span><span style={{ color, fontWeight:700 }}>{money(value)}</span></div>)}</div></Card></div>}

      {tab === 'inadimplencia' && <>
        <SectionTitle
          title="Inadimplência"
          subtitle="Recebimentos com vencimento passado e pagamento pendente."
        />
        {overdueReceivables.length === 0 ? (
          <Card><p style={{ textAlign:'center', color:C.green, padding:'32px 0', fontSize:14 }}>Nenhuma inadimplência registrada. 🎉</p></Card>
        ) : (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:12 }}>
              <Card style={{ padding:16, border:`1px solid ${C.red}33`, background:`${C.red}08` }}>
                <div style={{ fontSize:11, color:C.red, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Total em atraso</div>
                <div style={{ fontSize:22, fontWeight:800, color:C.red }}>{money(overdueReceivables.reduce((acc, item) => acc + item.value, 0))}</div>
              </Card>
              <Card style={{ padding:16, border:`1px solid ${C.yellow}33` }}>
                <div style={{ fontSize:11, color:C.yellow, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Registros em atraso</div>
                <div style={{ fontSize:22, fontWeight:800, color:C.yellow }}>{overdueReceivables.length}</div>
              </Card>
            </div>
            <RecordTable
              columns={['Paciente', 'Descrição', 'Vencimento', 'Dias em atraso', 'Valor', 'Ações']}
              rows={overdueReceivables.map(item => ({
                key:item.id,
                cells:[
                  item.patient,
                  item.description,
                  formatDateBR(item.dueDate),
                  <span style={{ color:C.red, fontWeight:700 }}>{item.daysOverdue}d</span>,
                  <span style={{ color:C.red, fontWeight:700 }}>{money(item.value)}</span>,
                  <Btn onClick={() => markReceivableAsPaid(item)} style={{ padding:'5px 12px', fontSize:12 }}>Marcar recebido</Btn>,
                ],
                rawCells:[item.patient, item.description, item.dueDate, item.daysOverdue, item.value, 0],
              }))}
              sortableColumns={[0, 3, 4]}
              emptyMessage="Nenhuma inadimplência."
            />
          </>
        )}
      </>}

      {tab === 'pacientes' && <>
        <SectionTitle
          title="Histórico por paciente"
          subtitle="Visão consolidada de cirurgias, consultas e valores por paciente."
        />
        {patientSummaries.length === 0 ? (
          <Card><p style={{ textAlign:'center', color:C.textDim, padding:'32px 0', fontSize:14 }}>Nenhum paciente cadastrado ainda.</p></Card>
        ) : (
          <Card style={{ padding:0, overflow:'hidden' }}>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                    {['Paciente', 'Cirurgias', 'Consultas', 'Total faturado', 'Recebido', 'Pendente'].map(h => (
                      <th key={h} style={{ padding:'12px 16px', textAlign:'left', fontSize:11, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {patientSummaries.map((p, idx) => (
                    <tr key={p.name} style={{ borderBottom:`1px solid ${C.border}22`, background:idx % 2 === 0 ? 'transparent' : `${C.border}08` }}>
                      <td style={{ padding:'12px 16px', fontSize:13, color:C.text, fontWeight:600 }}>{p.name}</td>
                      <td style={{ padding:'12px 16px', fontSize:13, color:C.textSub }}>{p.surgeries}</td>
                      <td style={{ padding:'12px 16px', fontSize:13, color:C.textSub }}>{p.consultations}</td>
                      <td style={{ padding:'12px 16px', fontSize:13, color:C.text, fontWeight:700 }}>{money(p.totalRevenue)}</td>
                      <td style={{ padding:'12px 16px', fontSize:13, color:C.green, fontWeight:700 }}>{money(p.totalPaid)}</td>
                      <td style={{ padding:'12px 16px', fontSize:13, color:p.totalPending > 0 ? C.yellow : C.textDim, fontWeight:700 }}>{money(p.totalPending)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </>}

      {tab === 'fluxo' && <>
        <SectionTitle title="Fluxo de caixa" subtitle="Entradas e saídas efetivamente realizadas, agrupadas por data." />
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12, marginBottom:12 }}>
          <Card onClick={() => openDrilldown('Entradas no período', m.drilldowns?.cashIn || [], flowSummary.entradas)} title="Clique para ver os lançamentos" style={{ padding:16 }}>
            <div style={{ color:C.textSub, fontSize:12, marginBottom:4 }}>Entradas no período</div>
            <div style={{ color:C.green, fontSize:20, fontWeight:700 }}>{money(flowSummary.entradas)}</div>
          </Card>
          <Card onClick={() => openDrilldown('Saídas no período', m.drilldowns?.cashOut || [], flowSummary.saidas)} title="Clique para ver os lançamentos" style={{ padding:16 }}>
            <div style={{ color:C.textSub, fontSize:12, marginBottom:4 }}>Saídas no período</div>
            <div style={{ color:C.red, fontSize:20, fontWeight:700 }}>{money(flowSummary.saidas)}</div>
          </Card>
          <Card onClick={() => openDrilldown('Resultado de caixa do período', m.drilldowns?.cashBalance || [], flowSummary.resultado)} title="Clique para ver os lançamentos" style={{ padding:16 }}>
            <div style={{ color:C.textSub, fontSize:12, marginBottom:4 }}>Resultado de caixa do período</div>
            <div style={{ color:flowSummary.resultado >= 0 ? C.green : C.red, fontSize:20, fontWeight:700 }}>{money(flowSummary.resultado)}</div>
          </Card>
        </div>
        <RecordTable columns={['Data', 'Entradas', 'Saídas', 'Saldo']} rows={flowRows.map(item => { const openDay = () => openDrilldown(`Movimentações de ${formatDateBR(item.date)}`, item.items.map(row => ({ ...row, party:'', status:'liquidado', value:Number(row.value || 0) * (row.type === 'entrada' ? 1 : -1) })), item.saldo); return { key:item.date, cells:[formatDateBR(item.date), <span role="button" tabIndex={0} onClick={openDay} style={{ color:C.green, fontWeight:700, cursor:'pointer' }}>{money(item.entradas)}</span>, <span role="button" tabIndex={0} onClick={openDay} style={{ color:C.red, fontWeight:700, cursor:'pointer' }}>{money(item.saidas)}</span>, <span role="button" tabIndex={0} onClick={openDay} style={{ color:item.saldo >= 0 ? C.green : C.red, fontWeight:700, cursor:'pointer' }}>{money(item.saldo)}</span>] } })} emptyMessage="Nenhuma movimentação de caixa realizada no período." />

        <div style={{ marginTop:8 }}>
          <SectionTitle title="Projeção — próximos 3 meses" subtitle="Estimativa baseada nas recorrências cadastradas e cirurgias/consultas agendadas." />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12, marginTop:12 }}>
            {cashFlowProjection.map(month => (
              <Card key={month.label} style={{ padding:18 }}>
                <div style={{ fontSize:12, fontWeight:700, color:C.textSub, textTransform:'capitalize', marginBottom:10 }}>{month.label}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:12, color:C.textDim }}>Entradas prev.</span>
                    <span style={{ fontSize:13, color:C.green, fontWeight:700 }}>{money(month.expectedRevenue)}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:12, color:C.textDim }}>Saídas prev.</span>
                    <span style={{ fontSize:13, color:C.red, fontWeight:700 }}>{money(month.expectedExpenses)}</span>
                  </div>
                  <div style={{ borderTop:`1px solid ${C.border}44`, paddingTop:8, display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:12, color:C.textDim, fontWeight:700 }}>Resultado prev.</span>
                    <span style={{ fontSize:14, color:month.net >= 0 ? C.green : C.red, fontWeight:800 }}>{money(month.net)}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div style={{ marginTop:8, fontSize:11, color:C.textDim }}>* Projeção baseada em recorrências ativas. Valores reais podem variar.</div>
        </div>
      </>}

      {tab === 'indicadores' && <IndicadoresTab m={m} data={data} money={money} setData={setData} indicatorPeriodKey={indicatorPeriodKey} />}

      <Modal open={showModal} onClose={cancelLaunchModal} title={(() => { const t = { surgery:'Editar cirurgia', consultation:'Editar consulta', 'product-sale':'Editar venda', 'product-purchase':'Editar compra' }; return t[modalType] || (editing ? 'Editar registro' : 'Novo registro') })()}>
        {modalType === 'extra' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {!editing && !reconciliationReturn && (
              <FInput
                label="Como é esse lançamento?"
                value={form.launchType || 'variavel'}
                onChange={value => setForm(current => ({ ...current, launchType:value }))}
                options={[{ v:'variavel', l:'Única vez' }, { v:'fixa', l:'Todo mês (recorrente)' }]}
              />
            )}
            <div>
              <FInput label="Descrição" required value={form.description} onChange={value => { setFormError(''); setForm(current => ({ ...current, description:value })) }} placeholder="Ex: contrato mensal de consultoria" />
              {formError && modalType === 'extra' && <div style={{ color:C.red, fontSize:12, marginTop:4 }}>{formError}</div>}
            </div>
            {revenueAccountOptions.length > 0
              ? <ChartAccountPicker
                  value={form.chartAccountId || ''}
                  accountOptions={revenueAccountOptions}
                  groupOptions={revenueGroupOptions}
                  quickCategory={quickCategory}
                  canCreate={canManageChartAccounts}
                  onChange={value => {
                    const selectedAccount = revenueAccountOptions.find(option => option.value === value)?.account
                    setForm(current => ({ ...current, chartAccountId:value, category:selectedAccount?.name || current.category }))
                  }}
                  onOpen={() => openQuickCategory('receivable')}
                  onQuickChange={updates => setQuickCategory(current => ({ ...current, ...updates, error:'' }))}
                  onQuickSave={saveQuickCategory}
                  onQuickCancel={() => setQuickCategory(QUICK_CATEGORY_EMPTY)} />
              : <FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} placeholder="Ex: outras_receitas" />}
            <FInput label="Centro de custo" value={form.costCenter || ''} onChange={value => setForm(current => ({ ...current, costCenter:value }))} options={allCostCenters} creatable placeholder="Ex: Farmácia" />
            <FInput label="Origem" value={form.originLabel || ''} onChange={value => setForm(current => ({ ...current, originLabel:value }))} options={allOrigins} creatable placeholder="Ex: Indicação, Instagram, Convênio X" />
            <PatientSelector label="Cliente (opcional)" value={form.patientId} onChange={(id, name) => setForm(current => ({ ...current, patientId:id, patient:name }))} />
            <FInput label="Valor (R$)" value={form.value} onChange={value => setForm(current => ({ ...current, value:value }))} type="number" />

            {(!editing && form.launchType === 'fixa') ? (
              <>
                <FInput label="Frequência" value={form.recurrenceFrequency || 'mensal'} onChange={value => setForm(current => ({ ...current, recurrenceFrequency:value }))} options={[{ v:'mensal', l:'Mensal' }, { v:'semanal', l:'Semanal' }, { v:'anual', l:'Anual' }]} />
                <FInput label={form.recurrenceFrequency === 'semanal' ? 'Dia da semana (1=seg, 7=dom)' : 'Dia do mês (1–31)'} type="number" value={form.recurrenceDay || 1} onChange={value => setForm(current => ({ ...current, recurrenceDay:value }))} />
                <FInput label="A partir de" type="date" value={form.recurrenceStartDate || today()} onChange={value => setForm(current => ({ ...current, recurrenceStartDate:value }))} />
                <FInput label="Encerrar em (opcional)" type="date" value={form.recurrenceEndDate || ''} onChange={value => setForm(current => ({ ...current, recurrenceEndDate:value }))} />
                <FInput label="Marcar como recebido automaticamente?" value={form.recurrenceAutoMarkAsPaid ? 'sim' : 'nao'} onChange={value => setForm(current => ({ ...current, recurrenceAutoMarkAsPaid:value === 'sim' }))} options={[{ v:'nao', l:'Não' }, { v:'sim', l:'Sim' }]} />
              </>
            ) : (
              <>
                <FInput label="Data de competência" required value={form.competenceDate || ''} onChange={value => setForm(current => ({ ...current, competenceDate:value }))} type="date" />
                <div style={{ fontSize:11, color:C.textDim, marginTop:-10 }}>Mês a que a receita pertence na DRE (regime de competência), mesmo que o dinheiro entre em outra data.</div>
                <FInput label="Situação" value={form.status || 'recebido'} onChange={value => setForm(current => ({ ...current, status:value, ...(value === 'pendente' ? { date:'', receivedDate:null } : { date:current.receivedDate || '' }) }))} options={[{ v:'recebido', l:'Já recebi' }, { v:'pendente', l:'A receber' }]} />
                {form.status === 'pendente' ? (
                  <>
                    <FInput label="Vencimento (previsão de recebimento)" required value={form.dueDate || ''} onChange={value => setForm(current => ({ ...current, dueDate:value, date:'' }))} type="date" />
                    {form.dueDate && form.dueDate < today() ? (
                      <div style={{ fontSize:12, color:C.red, background:`${C.red}12`, border:`1px solid ${C.red}33`, borderRadius:8, padding:'8px 12px' }}>
                        Vencimento <strong>em atraso</strong> (anterior a hoje). Será registrada como a receber e aparece em "A receber" e na Inadimplência até você marcar como recebida.
                      </div>
                    ) : (
                      <div style={{ fontSize:12, color:C.yellow, background:`${C.yellow}12`, border:`1px solid ${C.yellow}33`, borderRadius:8, padding:'8px 12px' }}>
                        Será registrada como <strong>a receber</strong> (aparece em "A receber") e só entra no caixa quando você marcar como recebida. Na DRE já conta pela competência.
                      </div>
                    )}
                  </>
                ) : (
                  <FInput label="Data do recebimento (caixa)" required value={form.date} onChange={value => setForm(current => ({ ...current, date:value, dueDate:current.dueDate || value }))} type="date" />
                )}
              </>
            )}

            <FormActions onCancel={cancelLaunchModal} onSave={save} disabled={savingLaunch || isSaveDisabled(modalType, form, editing)} saving={savingLaunch} />
          </div>
        )}
        {modalType === 'expense' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {!editing && !reconciliationReturn && (
              <FInput
                label="Como é essa despesa?"
                value={form.launchType || 'variavel'}
                onChange={value => setForm(current => ({ ...current, launchType:value, category:value === 'variavel' ? 'variaveis' : current.category }))}
                options={[{ v:'variavel', l:'Única vez' }, { v:'fixa', l:'Todo mês (recorrente)' }]}
              />
            )}
            <div>
              <FInput label="Descrição" required value={form.description} onChange={value => { setFormError(''); setForm(current => ({ ...current, description:value })) }} placeholder="Ex: aluguel do consultório" />
              {formError && modalType === 'expense' && <div style={{ color:C.red, fontSize:12, marginTop:4 }}>{formError}</div>}
            </div>
            {expenseAccountOptions.length > 0
              ? <ChartAccountPicker
                  value={form.chartAccountId || ''}
                  accountOptions={expenseAccountOptions}
                  groupOptions={expenseGroupOptions}
                  quickCategory={quickCategory}
                  canCreate={canManageChartAccounts}
                  onChange={value => {
                    const selectedAccount = expenseAccountOptions.find(option => option.value === value)?.account
                    setForm(current => ({ ...current, chartAccountId:value, category:selectedAccount?.name || current.category }))
                  }}
                  onOpen={() => openQuickCategory('payable')}
                  onQuickChange={updates => setQuickCategory(current => ({ ...current, ...updates, error:'' }))}
                  onQuickSave={saveQuickCategory}
                  onQuickCancel={() => setQuickCategory(QUICK_CATEGORY_EMPTY)} />
              : <FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} options={EXPENSE_CATEGORIES.map(item => ({ v:item, l:EXPENSE_CATEGORY_LABELS[item] || item }))} />}
            <FInput label="Centro de custo" value={form.costCenter || ''} onChange={value => setForm(current => ({ ...current, costCenter:value }))} options={allCostCenters} creatable placeholder="Ex: Farmácia" />
            <FInput label="Origem" value={form.originLabel || ''} onChange={value => setForm(current => ({ ...current, originLabel:value }))} options={allOrigins} creatable placeholder="Ex: Indicação, Instagram, Convênio X" />
            <SupplierSelector value={form.supplierId} onChange={(id, name) => setForm(current => ({ ...current, supplierId:id, supplier:name }))} />
            <FInput label="Valor (R$)" value={form.value} onChange={value => setForm(current => ({ ...current, value:value }))} type="number" />

            {(!editing && form.launchType === 'fixa') ? (
              <>
                <FInput label="Frequência" value={form.recurrenceFrequency || 'mensal'} onChange={value => setForm(current => ({ ...current, recurrenceFrequency:value }))} options={[{ v:'mensal', l:'Mensal' }, { v:'semanal', l:'Semanal' }, { v:'anual', l:'Anual' }]} />
                <FInput label={form.recurrenceFrequency === 'semanal' ? 'Dia da semana (1=seg, 7=dom)' : 'Dia do mês (1–31)'} type="number" value={form.recurrenceDay || 1} onChange={value => setForm(current => ({ ...current, recurrenceDay:value }))} />
                <FInput label="A partir de" type="date" value={form.recurrenceStartDate || today()} onChange={value => setForm(current => ({ ...current, recurrenceStartDate:value }))} />
                <FInput label="Encerrar em (opcional)" type="date" value={form.recurrenceEndDate || ''} onChange={value => setForm(current => ({ ...current, recurrenceEndDate:value }))} />
                <FInput label="Marcar como pago automaticamente?" value={form.recurrenceAutoMarkAsPaid ? 'sim' : 'nao'} onChange={value => setForm(current => ({ ...current, recurrenceAutoMarkAsPaid:value === 'sim' }))} options={[{ v:'nao', l:'Não' }, { v:'sim', l:'Sim' }]} />
              </>
            ) : (
              <>
                <FInput label="Data de competência" required value={form.competenceDate || ''} onChange={value => setForm(current => ({ ...current, competenceDate:value }))} type="date" />
                <div style={{ fontSize:11, color:C.textDim, marginTop:-10 }}>Mês a que a despesa pertence na DRE (regime de competência), mesmo que vença ou seja paga em outra data.</div>
                <FInput label="Situação" value={form.status === 'aberto' ? 'aberto' : 'pago'} onChange={value => setForm(current => ({ ...current, status:value }))} options={[{ v:'pago', l:'Já paguei' }, { v:'aberto', l:'A pagar' }]} />
                {form.status === 'aberto' ? (
                  <>
                    <FInput label="Vencimento" required value={form.dueDate || ''} onChange={value => setForm(current => ({ ...current, dueDate:value }))} type="date" />
                    {form.dueDate && form.dueDate < today() ? (
                      <div style={{ fontSize:12, color:C.red, background:`${C.red}12`, border:`1px solid ${C.red}33`, borderRadius:8, padding:'8px 12px' }}>
                        Vencimento <strong>em atraso</strong> (anterior a hoje). Será registrada como a pagar e aparece em "A pagar" e na Inadimplência até você marcar como paga.
                      </div>
                    ) : (
                      <div style={{ fontSize:12, color:C.yellow, background:`${C.yellow}12`, border:`1px solid ${C.yellow}33`, borderRadius:8, padding:'8px 12px' }}>
                        Será registrada como <strong>a pagar</strong> (aparece em "A pagar") e só sai do caixa quando você marcar como paga. Na DRE já conta pela competência.
                      </div>
                    )}
                  </>
                ) : (
                  <FInput label="Data do pagamento (caixa)" required value={form.paymentDate || ''} onChange={value => setForm(current => ({ ...current, paymentDate:value, dueDate:current.dueDate || value }))} type="date" />
                )}
              </>
            )}

            <FormActions onCancel={cancelLaunchModal} onSave={save} disabled={savingLaunch || isSaveDisabled(modalType, form, editing)} saving={savingLaunch} />
          </div>
        )}
        {(modalType === 'asset' || modalType === 'liability') && <div style={{ display:'flex', flexDirection:'column', gap:16 }}><FInput label="Nome" required value={form.name} onChange={value => setForm(current => ({ ...current, name:value }))} placeholder="Banco / empréstimo" /><FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} placeholder="banco" /><FInput label="Valor" value={form.value} onChange={value => setForm(current => ({ ...current, value:value }))} type="number" /><FInput label="Observações" value={form.notes} onChange={value => setForm(current => ({ ...current, notes:value }))} /><FormActions onCancel={() => setShowModal(false)} onSave={save} disabled={!form.name} /></div>}

        {modalType === 'surgery' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <FInput label="Paciente" value={form.patient || ''} onChange={value => setForm(c => ({ ...c, patient:value }))} placeholder="Nome do paciente" />
            <FInput label="Data da cirurgia (competência)" required value={form.competenceDate || form.date || ''} onChange={value => setForm(c => ({ ...c, competenceDate:value, date:c.date || value }))} type="date" />
            <FInput label="Data da cirurgia (agenda)" value={form.date || ''} onChange={value => setForm(c => ({ ...c, date:value }))} type="date" />
            <FInput label="Vencimento (previsão de recebimento)" value={form.dueDate || ''} onChange={value => setForm(c => ({ ...c, dueDate:value }))} type="date" />
            <FInput label="Status de pagamento" value={form.paymentStatus || 'pendente'} onChange={value => setForm(c => ({ ...c, paymentStatus:value }))} options={SURGERY_PAYMENT_STATUS} />
            {form.paymentStatus === 'pago' && <FInput label="Data de pagamento" value={form.paymentDate || ''} onChange={value => setForm(c => ({ ...c, paymentDate:value }))} type="date" />}
            <FInput label="Valor total (R$)" value={form.totalValue || 0} onChange={value => setForm(c => ({ ...c, totalValue:value }))} type="number" />
            <FInput label="Forma de pagamento" value={form.paymentMethod || 'pix'} onChange={value => setForm(c => ({ ...c, paymentMethod:value }))} options={PAYMENT_METHODS} />
            <div style={{ fontSize:12, color:C.textSub, fontWeight:600, marginBottom:-8 }}>Custos cirúrgicos</div>
            <FInput label="Custo hospital (R$)" value={form.hospitalCost || 0} onChange={value => setForm(c => ({ ...c, hospitalCost:value }))} type="number" />
            <FInput label="Custo anestesia (R$)" value={form.anesthesiaCost || 0} onChange={value => setForm(c => ({ ...c, anesthesiaCost:value }))} type="number" />
            <FInput label="Custo material (R$)" value={form.materialCost || 0} onChange={value => setForm(c => ({ ...c, materialCost:value }))} type="number" />
            <FInput label="Outros custos (R$)" value={form.otherCosts || 0} onChange={value => setForm(c => ({ ...c, otherCosts:value }))} type="number" />
            <FInput label="NF / ISSQN (%)" value={form.invoiceIssuancePercent || 0} onChange={value => setForm(c => ({ ...c, invoiceIssuancePercent:value }))} type="number" />
            <ClinicalCostSettlementFields sourceType="surgery" form={form} setForm={setForm} />
            <FInput label="Observações" value={form.notes || ''} onChange={value => setForm(c => ({ ...c, notes:value }))} placeholder="Observações opcionais" />
            <FormActions onCancel={() => setShowModal(false)} onSave={save} />
          </div>
        )}

        {modalType === 'consultation' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <FInput label="Paciente" value={form.patient || ''} onChange={value => setForm(c => ({ ...c, patient:value }))} placeholder="Nome do paciente" />
            <FInput label="Data da consulta (competência)" required value={form.competenceDate || form.date || ''} onChange={value => setForm(c => ({ ...c, competenceDate:value, date:c.date || value }))} type="date" />
            <FInput label="Data da consulta (agenda)" value={form.date || ''} onChange={value => setForm(c => ({ ...c, date:value }))} type="date" />
            <FInput label="Vencimento (previsão de recebimento)" value={form.dueDate || ''} onChange={value => setForm(c => ({ ...c, dueDate:value }))} type="date" />
            <FInput label="Status de pagamento" value={form.paymentStatus || 'pendente'} onChange={value => setForm(c => ({ ...c, paymentStatus:value }))} options={SURGERY_PAYMENT_STATUS} />
            {form.paymentStatus === 'pago' && <FInput label="Data de pagamento" value={form.paymentDate || ''} onChange={value => setForm(c => ({ ...c, paymentDate:value }))} type="date" />}
            <FInput label="Valor (R$)" value={form.value || 0} onChange={value => setForm(c => ({ ...c, value:value }))} type="number" />
            <ClinicalCostSettlementFields sourceType="consultation" form={form} setForm={setForm} />
            <FInput label="Forma de pagamento" value={form.paymentMethod || 'pix'} onChange={value => setForm(c => ({ ...c, paymentMethod:value }))} options={PAYMENT_METHODS} />
            <FInput label="Observações" value={form.notes || ''} onChange={value => setForm(c => ({ ...c, notes:value }))} placeholder="Observações opcionais" />
            <FormActions onCancel={() => setShowModal(false)} onSave={save} />
          </div>
        )}

        {modalType === 'product-sale' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <FInput label="Data da venda (competência)" required value={form.competenceDate || form.saleDate || ''} onChange={value => setForm(c => ({ ...c, saleDate:value, competenceDate:value, dueDate:c.dueDate || value }))} type="date" />
            <FInput label="Situação" value={form.paymentStatus || 'pendente'} onChange={value => setForm(c => ({ ...c, paymentStatus:value, receivedDate:value === 'recebido' ? (c.receivedDate || today()) : '' }))} options={[{ v:'recebido', l:'Recebido' }, { v:'pendente', l:'A receber' }, { v:'cancelado', l:'Cancelado' }]} />
            {form.paymentStatus === 'recebido' && <FInput label="Data real do recebimento (caixa)" required value={form.receivedDate || ''} onChange={value => setForm(c => ({ ...c, receivedDate:value }))} type="date" />}
            {form.paymentStatus === 'pendente' && <FInput label="Vencimento" required value={form.dueDate || ''} onChange={value => setForm(c => ({ ...c, dueDate:value }))} type="date" />}
            <FInput label="Valor total (R$)" value={form.totalValue || 0} onChange={value => setForm(c => ({ ...c, totalValue:value }))} type="number" />
            <FInput label="Quantidade" value={form.quantity || 1} onChange={value => setForm(c => ({ ...c, quantity:value }))} type="number" />
            <FormActions onCancel={() => setShowModal(false)} onSave={save} disabled={form.paymentStatus === 'recebido' ? !form.receivedDate : form.paymentStatus === 'pendente' ? !form.dueDate : false} />
          </div>
        )}

        {modalType === 'product-purchase' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <FInput label="Data da compra (competência / caixa)" required value={form.competenceDate || form.purchaseDate || ''} onChange={value => setForm(c => ({ ...c, purchaseDate:value, competenceDate:value }))} type="date" />
            <FInput label="Vencimento" value={form.dueDate || ''} onChange={value => setForm(c => ({ ...c, dueDate:value }))} type="date" />
            <FInput label="Valor total (R$)" value={form.totalValue || 0} onChange={value => setForm(c => ({ ...c, totalValue:value }))} type="number" />
            <FInput label="Quantidade" value={form.quantity || 1} onChange={value => setForm(c => ({ ...c, quantity:value }))} type="number" />
            <FInput label="Fornecedor" value={form.supplier || ''} onChange={value => setForm(c => ({ ...c, supplier:value }))} placeholder="Nome do fornecedor" />
            <FormActions onCancel={() => setShowModal(false)} onSave={save} />
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={handleConfirmAction}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        confirmVariant={confirmState?.confirmVariant}
        busy={savingLaunch}
        closeOnConfirm={false}
      />
      <Modal open={!!paymentConfirmState} onClose={() => setPaymentConfirmState(null)} title="Confirmar pagamento da despesa" width={460}>
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ color:C.textSub, fontSize:13 }}>
            {paymentConfirmState?.item ? `Pagamento de ${money(paymentConfirmState.item.value || 0)} em "${paymentConfirmState.item.supplier || paymentConfirmState.item.description || 'despesa'}".` : ''}
          </div>
          <FInput
            label="A despesa foi paga hoje?"
            value={paymentConfirmState?.paidToday || 'sim'}
            onChange={value => setPaymentConfirmState(current => ({ ...(current || {}), paidToday:value, paymentDate:value === 'sim' ? today() : '' }))}
            options={[{ v:'sim', l:'Sim' }, { v:'nao', l:'Não' }]}
          />
          {paymentConfirmState?.paidToday === 'nao' && (
            <FInput
              label="Data real do pagamento"
              type="date"
              value={paymentConfirmState?.paymentDate || ''}
              onChange={value => setPaymentConfirmState(current => ({ ...(current || {}), paymentDate:value }))}
            />
          )}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
            <Btn variant="ghost" onClick={() => setPaymentConfirmState(null)}>Cancelar</Btn>
            <Btn variant="success" onClick={confirmExpensePayment}>Confirmar pagamento</Btn>
          </div>
        </div>
      </Modal>
      <ExportModal open={showExport} onClose={() => setShowExport(false)} data={data} />
    </div>
  )
}

function IndicadoresTab({ m, data, money, setData, indicatorPeriodKey }) {
  const [periodStart, periodEnd] = String(indicatorPeriodKey || '').split(':')
  const periodLabel = periodStart && periodEnd
    ? `${formatDateBR(periodStart)} — ${formatDateBR(periodEnd)}`
    : 'Período atual'
  const indicatorInputsByPeriod = data.indicatorInputsByPeriod || {}
  const indicatorInputs = indicatorInputsByPeriod[indicatorPeriodKey] || data.indicatorInputs || {}
  const inputNumber = key => {
    const value = Number(indicatorInputs[key] || 0)
    return Number.isFinite(value) ? value : 0
  }
  const setIndicatorInput = (key, value) => {
    const parsed = Number(value || 0)
    setData(current => ({
      ...current,
      indicatorInputsByPeriod:{
        ...(current.indicatorInputsByPeriod || {}),
        [indicatorPeriodKey]:{
          ...((current.indicatorInputsByPeriod || {})[indicatorPeriodKey] || {}),
          [key]:Number.isFinite(parsed) ? parsed : 0,
        },
      },
      indicatorInputs:{
        ...(current.indicatorInputs || {}),
        [key]:Number.isFinite(parsed) ? parsed : 0,
      },
    }))
  }

  const assetsExtra = (data.assets || []).reduce((acc, x) => acc + (x.value || 0), 0)
  const liabExtra = (data.liabilities || []).reduce((acc, x) => acc + (x.value || 0), 0)
  const directCosts = m.surgeryCostTotal + m.consultationCostTotal + m.productPurchaseTotal + (m.additionalDirectCosts || 0)
  const grossProfit = m.grossRevenue - directCosts
  const depreciation = inputNumber('depreciation')
  const amortization = inputNumber('amortization')
  const financialExpense = inputNumber('financialExpense')
  const investment = inputNumber('investment')
  const profitObtained = inputNumber('profitObtained') || m.netProfit
  const cogs = inputNumber('cogs') || m.productPurchaseTotal
  const inventoryAvg = inputNumber('inventoryAvg')
  const receivablesOperational = inputNumber('receivablesOperational') || m.receivablesOpenTotal
  const suppliers = inputNumber('suppliers')
  const purchases = inputNumber('purchases') || m.productPurchasesTotal
  const availableFunds = inputNumber('availableFunds') || (m.cashBalance + assetsExtra)
  const currentCash = inputNumber('currentCash') || availableFunds
  const burnRateManual = inputNumber('burnRateManual')
  const totalCosts = m.totalExpenses ?? (directCosts + m.operationalExpenses + m.taxExpenses)
  const totalAtivo = m.assetsTotal
  const ativoCirculante = m.assetsTotal - assetsExtra
  const passivoCirculante = m.payablesOpenTotal
  const totalPassivo = passivoCirculante + liabExtra

  const estoqueValor = m.inventoryAsset

  const pct = (n, d) => (d !== 0 ? (n / d) * 100 : null)
  const rat = (n, d) => (d !== 0 ? n / d : null)

  const margemBruta = pct(grossProfit, m.grossRevenue)
  const margemLiquida = pct(m.netProfit, m.grossRevenue)
  const margemOperacional = pct(m.operatingProfit, m.grossRevenue)
  const ebitda = m.operatingProfit + depreciation + amortization
  const roi = pct(profitObtained, investment || totalCosts)
  const roe = m.equity !== 0 ? pct(m.netProfit, m.equity) : null
  const roa = pct(m.netProfit, totalAtivo)

  const cgl = ativoCirculante - passivoCirculante
  const liquidezCorrente = rat(ativoCirculante, passivoCirculante)
  const liquidezSeca = rat(ativoCirculante - estoqueValor, passivoCirculante)
  const liquidezImediata = rat(availableFunds, passivoCirculante)
  const ncg = receivablesOperational + estoqueValor - suppliers
  const saldoTesouraria = cgl - ncg

  const endividamentoGeral = pct(totalPassivo, totalAtivo)
  const composicaoEndividamento = pct(passivoCirculante, totalPassivo)
  const gaf = rat(roe, roa)
  const coberturaJuros = rat(m.operatingProfit, financialExpense)

  const giroAtivo = rat(m.grossRevenue, totalAtivo)
  const giroEstoque = rat(cogs, inventoryAvg)
  const pme = inventoryAvg > 0 ? (inventoryAvg / Math.max(cogs, 1)) * 360 : null
  const pmr = receivablesOperational > 0 ? (receivablesOperational / Math.max(m.grossRevenue, 1)) * 360 : null
  const pmp = suppliers > 0 ? (suppliers / Math.max(purchases, 1)) * 360 : null
  const cicloOperacional = pme !== null && pmr !== null ? pme + pmr : null
  const cicloFinanceiro = pme !== null && pmr !== null && pmp !== null ? pme + pmr - pmp : null

  const fco = m.cashIn - m.cashOut
  const burnRate = burnRateManual > 0 ? burnRateManual : Math.max(0, -fco)
  const runway = burnRate > 0 ? currentCash / burnRate : null

  function statusPct(value, goodThreshold, warnThreshold, invertedScale = false) {
    if (value === null || value === undefined) return 'dim'
    if (!invertedScale) {
      if (value >= goodThreshold) return 'green'
      if (value >= warnThreshold) return 'yellow'
      return 'red'
    }
    if (value <= goodThreshold) return 'green'
    if (value <= warnThreshold) return 'yellow'
    return 'red'
  }

  function statusRat(value, goodThreshold, warnThreshold, invertedScale = false) {
    if (value === null || value === undefined) return 'dim'
    if (!invertedScale) {
      if (value >= goodThreshold) return 'green'
      if (value >= warnThreshold) return 'yellow'
      return 'red'
    }
    if (value <= goodThreshold) return 'green'
    if (value <= warnThreshold) return 'yellow'
    return 'red'
  }

  const statusColor = s => s === 'green' ? C.green : s === 'yellow' ? C.yellow : s === 'red' ? C.red : C.textDim

  function IndRow({ label, value, status, hint, format = 'pct' }) {
    const color = statusColor(status)
    const display = value === null || value === undefined
      ? <span style={{ color:C.textDim, fontSize:12 }}>—</span>
      : format === 'pct'
        ? <span style={{ color, fontWeight:700, fontSize:14 }}>{value.toFixed(1)}%</span>
        : format === 'ratio'
          ? <span style={{ color, fontWeight:700, fontSize:14 }}>{value.toFixed(2)}x</span>
          : format === 'days'
            ? <span style={{ color, fontWeight:700, fontSize:14 }}>{value.toFixed(1)} dias</span>
            : <span style={{ color, fontWeight:700, fontSize:14 }}>{money(value)}</span>

    return (
      <div
        title={hint}
        style={{
          display:'flex',
          justifyContent:'space-between',
          alignItems:'center',
          padding:'9px 0',
          borderTop:`1px solid ${C.border}22`,
          gap:8,
          cursor: hint ? 'help' : 'default',
        }}
      >
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ width:6, height:6, borderRadius:99, background:color, flexShrink:0, display:'inline-block' }} />
          <span style={{ fontSize:12, color:C.textSub }}>{label}</span>
        </div>
        {display}
      </div>
    )
  }

  function IndCard({ title, icon, children }) {
    return (
      <Card style={{ padding:'16px 20px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:4 }}>
          <span style={{ fontSize:15 }}>{icon}</span>
          <span style={{ fontSize:12, fontWeight:700, color:C.textSub, textTransform:'uppercase', letterSpacing:'0.09em' }}>{title}</span>
        </div>
        {children}
      </Card>
    )
  }

  const noRevenue = m.grossRevenue === 0

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <SectionTitle
        title="Indicadores financeiros"
        subtitle={`Métricas calculadas automaticamente para o período selecionado.${noRevenue ? ' Sem receita no período — adicione cirurgias, consultas ou entradas para ver os indicadores.' : ''}`}
      />
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:12 }}>

        <IndCard title="Liquidez e Giro" icon="💧">
          <IndRow label="Capital de Giro Líquido (CGL)" value={cgl} status={cgl >= 0 ? 'green' : 'red'} format="money" hint="Ativo circulante − Passivo circulante" />
          <IndRow label="Liquidez Corrente" value={liquidezCorrente} status={statusRat(liquidezCorrente, 1.5, 1)} format="ratio" hint="Ativo circulante / Passivo circulante" />
          <IndRow label="Liquidez Seca" value={liquidezSeca} status={statusRat(liquidezSeca, 1, 0.5)} format="ratio" hint="(Ativo circulante − Estoques) / Passivo circulante" />
          <IndRow label="Liquidez Imediata" value={liquidezImediata} status={statusRat(liquidezImediata, 0.5, 0.2)} format="ratio" hint="Disponibilidades / Passivo circulante" />
          <IndRow label="Necessidade de Capital de Giro (NCG)" value={ncg} status={ncg <= cgl ? 'green' : 'yellow'} format="money" hint="Contas a receber + estoques − fornecedores" />
          <IndRow label="Saldo de Tesouraria" value={saldoTesouraria} status={saldoTesouraria >= 0 ? 'green' : 'red'} format="money" hint="CGL − NCG" />
        </IndCard>

        <IndCard title="Rentabilidade" icon="📈">
          <IndRow label="Margem Bruta" value={margemBruta} status={statusPct(margemBruta, 40, 20)} hint="(Receita − Custos diretos) / Receita × 100" />
          <IndRow label="Margem Operacional" value={margemOperacional} status={statusPct(margemOperacional, 20, 5)} hint="Lucro operacional / Receita × 100" />
          <IndRow label="Margem Líquida" value={margemLiquida} status={statusPct(margemLiquida, 15, 5)} hint="Lucro líquido / Receita × 100" />
          <IndRow label="EBITDA" value={ebitda} status={ebitda >= 0 ? 'green' : 'red'} format="money" hint="Lucro operacional + depreciação + amortização" />
          <IndRow label="ROI" value={roi} status={statusPct(roi, 20, 5)} hint="Lucro líquido / Total de custos × 100" />
          <IndRow label="ROE" value={roe} status={statusPct(roe, 15, 5)} hint="Lucro líquido / Patrimônio líquido × 100" />
          <IndRow label="ROA" value={roa} status={statusPct(roa, 10, 3)} hint="Lucro líquido / Total de ativos × 100" />
        </IndCard>

        <IndCard title="Endividamento" icon="⚖️">
          <IndRow label="Endividamento Geral" value={endividamentoGeral} status={statusPct(endividamentoGeral, 50, 70, true)} hint="Passivo total / Ativo total × 100 — menor é melhor" />
          <IndRow label="Comp. do Endividamento" value={composicaoEndividamento} status={statusPct(composicaoEndividamento, 50, 70, true)} hint="Passivo circulante / Passivo total × 100 — menor é melhor" />
          <IndRow label="GAF" value={gaf} status={statusRat(gaf, 2, 3, true)} format="ratio" hint="ROE / ROA" />
          <IndRow label="Cobertura de Juros" value={coberturaJuros} status={statusRat(coberturaJuros, 3, 1.5)} format="ratio" hint="EBIT / Despesa financeira" />
        </IndCard>

        <IndCard title="Eficiência" icon="⚙️">
          <IndRow label="Giro do Ativo" value={giroAtivo} status={statusRat(giroAtivo, 1, 0.5)} format="ratio" hint="Receita líquida / Ativo total" />
          <IndRow label="Giro de Estoque" value={giroEstoque} status={statusRat(giroEstoque, 4, 2)} format="ratio" hint="CMV / Estoque médio" />
          <IndRow label="PME" value={pme} status={statusRat(pme, 45, 75, true)} format="days" hint="Estoque médio / CMV × 360" />
          <IndRow label="PMR" value={pmr} status={statusRat(pmr, 45, 75, true)} format="days" hint="Contas a receber / Receita líquida × 360" />
          <IndRow label="PMP" value={pmp} status={statusRat(pmp, 60, 45)} format="days" hint="Fornecedores / Compras × 360" />
        </IndCard>

        <IndCard title="Ciclos e Caixa" icon="🔁">
          <IndRow label="Ciclo Operacional" value={cicloOperacional} status={statusRat(cicloOperacional, 70, 110, true)} format="days" hint="PME + PMR" />
          <IndRow label="Ciclo Financeiro" value={cicloFinanceiro} status={statusRat(cicloFinanceiro, 30, 60, true)} format="days" hint="PME + PMR − PMP" />
          <IndRow label="Fluxo de Caixa Operacional" value={fco} status={fco >= 0 ? 'green' : 'red'} format="money" hint="Entradas operacionais − saídas operacionais" />
          <IndRow label="Burn Rate" value={burnRate} status={burnRate <= 0 ? 'green' : 'yellow'} format="money" hint="Caixa consumido por mês" />
          <IndRow label="Runway (meses)" value={runway} status={statusRat(runway, 12, 6)} format="ratio" hint="Caixa atual / Burn rate" />
        </IndCard>

      </div>
      <Card style={{ padding:'16px 20px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap' }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.textSub, textTransform:'uppercase', letterSpacing:'0.09em' }}>
            Insumos para cálculos avançados
          </div>
          <div style={{ fontSize:11, color:C.textDim }}>
            Insumos do período: <strong style={{ color:C.textSub }}>{periodLabel}</strong>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10 }}>
          <FInput label="Disponibilidades" type="number" value={inputNumber('availableFunds')} onChange={v => setIndicatorInput('availableFunds', v)} />
          <FInput label="Fornecedores" type="number" value={inputNumber('suppliers')} onChange={v => setIndicatorInput('suppliers', v)} />
          <FInput label="Compras do período" type="number" value={inputNumber('purchases')} onChange={v => setIndicatorInput('purchases', v)} />
          <FInput label="Estoque médio" type="number" value={inputNumber('inventoryAvg')} onChange={v => setIndicatorInput('inventoryAvg', v)} />
          <FInput label="Depreciação" type="number" value={inputNumber('depreciation')} onChange={v => setIndicatorInput('depreciation', v)} />
          <FInput label="Amortização" type="number" value={inputNumber('amortization')} onChange={v => setIndicatorInput('amortization', v)} />
          <FInput label="Despesa financeira" type="number" value={inputNumber('financialExpense')} onChange={v => setIndicatorInput('financialExpense', v)} />
          <FInput label="Investimento (ROI)" type="number" value={inputNumber('investment')} onChange={v => setIndicatorInput('investment', v)} />
          <FInput label="Caixa atual" type="number" value={inputNumber('currentCash')} onChange={v => setIndicatorInput('currentCash', v)} />
          <FInput label="Burn rate manual" type="number" value={inputNumber('burnRateManual')} onChange={v => setIndicatorInput('burnRateManual', v)} />
        </div>
      </Card>
      <div style={{ fontSize:11, color:C.textDim, lineHeight:1.6 }}>
        Passe o cursor sobre o nome de cada indicador para ver a fórmula. Pontos verdes = saudável · amarelos = atenção · vermelhos = crítico. Benchmarks baseados em médias de clínicas de serviços.
      </div>
    </div>
  )
}

function RecordTable({ columns, rows, emptyMessage, sortableColumns = [] }) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false
  const isNarrow = typeof window !== 'undefined' ? window.innerWidth < 380 : false
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const handleSort = colIdx => {
    if (!sortableColumns.includes(colIdx)) return
    if (sortCol === colIdx) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(colIdx)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    if (sortCol === null) return rows
    return [...rows].sort((a, b) => {
      const av = typeof a.cells[sortCol] === 'string' ? a.cells[sortCol] : (a.rawCells?.[sortCol] ?? '')
      const bv = typeof b.cells[sortCol] === 'string' ? b.cells[sortCol] : (b.rawCells?.[sortCol] ?? '')
      const cmp = String(av).localeCompare(String(bv), 'pt-BR', { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortCol, sortDir])

  if (isMobile) {
    const activeSortCol = sortCol ?? (sortableColumns[0] ?? null)
    const mobileSorted = activeSortCol === null
      ? rows
      : [...rows].sort((a, b) => {
        const av = typeof a.cells[activeSortCol] === 'string' ? a.cells[activeSortCol] : (a.rawCells?.[activeSortCol] ?? '')
        const bv = typeof b.cells[activeSortCol] === 'string' ? b.cells[activeSortCol] : (b.rawCells?.[activeSortCol] ?? '')
        const cmp = String(av).localeCompare(String(bv), 'pt-BR', { numeric:true })
        return sortDir === 'asc' ? cmp : -cmp
      })

    return (
      <Card style={{ padding:14 }}>
        {sortableColumns.length > 0 && (
          <div style={{ display:'flex', flexDirection:isNarrow ? 'column' : 'row', gap:8, marginBottom:12, alignItems:isNarrow ? 'stretch' : 'center' }}>
            <select
              value={activeSortCol ?? ''}
              onChange={e => setSortCol(e.target.value === '' ? null : Number(e.target.value))}
              style={{ flex:1, minHeight:38 }}
            >
              {sortableColumns.map(idx => (
                <option key={idx} value={idx}>{`Ordenar por ${columns[idx]}`}</option>
              ))}
            </select>
            <Btn
              variant="ghost"
              onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              style={{ padding:'8px 12px', fontSize:12, width:isNarrow ? '100%' : 'auto' }}
            >
              {sortDir === 'asc' ? 'Crescente' : 'Decrescente'}
            </Btn>
          </div>
        )}

        {mobileSorted.length === 0 && (
          <div style={{ padding:'20px 8px', textAlign:'center', color:C.textDim, fontSize:13 }}>{emptyMessage}</div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {mobileSorted.map(row => (
            <div key={row.key} style={{ border:`1px solid ${C.border}`, borderRadius:12, padding:'12px 12px 10px', background:C.surface }}>
              <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
                {row.cells.map((cell, index) => (
                  <div key={index} style={{ display:'flex', flexDirection:'column', gap:4, borderTop:index === 0 ? 'none' : `1px solid ${C.border}33`, paddingTop:index === 0 ? 0 : 8 }}>
                    <span style={{ fontSize:10, color:C.textDim, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' }}>{columns[index]}</span>
                    <span style={{ color:C.textSub, fontSize:13, lineHeight:1.45 }}>{formatRecordTableCell(cell)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    )
  }

  return (
    <Card style={{ padding:0, overflow:'hidden' }}>
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${C.border}` }}>
              {columns.map((header, i) => {
                const sortable = sortableColumns.includes(i)
                const active = sortCol === i
                return (
                  <th
                    key={header}
                    onClick={() => handleSort(i)}
                    style={{
                      padding:'14px 18px',
                      textAlign:'left',
                      fontSize:11,
                      color: active ? C.accent : C.textSub,
                      fontWeight:700,
                      letterSpacing:'0.08em',
                      textTransform:'uppercase',
                      cursor: sortable ? 'pointer' : 'default',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {header}
                    {sortable && (
                      <span style={{ marginLeft:4, opacity: active ? 1 : 0.3, fontSize:10 }}>
                        {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={columns.length} style={{ padding:40, textAlign:'center', color:C.textDim, fontSize:13 }}>{emptyMessage}</td></tr>
            )}
            {sorted.map(row => (
              <tr key={row.key} style={{ borderBottom:`1px solid ${C.border}`, transition:'background 0.1s' }}
                onMouseEnter={e => { e.currentTarget.style.background = C.surface }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {row.cells.map((cell, index) => (
                  <td key={index} style={{ padding:'13px 18px', color:C.textSub, fontSize:13 }}>{formatRecordTableCell(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function BalanceList({ items, color, onEdit, onDelete, emptyMessage, hidden }) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false
  if (items.length === 0) return <p style={{ color:C.textDim, fontSize:13 }}>{emptyMessage}</p>
  return items.map(item => (
    <div key={item.id} style={{ padding:'14px 0', borderTop:`1px solid ${C.border}22`, display:'flex', flexDirection:isMobile ? 'column' : 'row', justifyContent:'space-between', gap:12 }}>
      <div>
        <div style={{ color:C.text, fontWeight:600 }}>{item.name}</div>
        <div style={{ color:C.textDim, fontSize:12 }}>{item.category || 'Sem categoria'}{item.notes ? ` · ${item.notes}` : ''}</div>
      </div>
      <div style={{ display:'flex', flexDirection:isMobile ? 'column' : 'row', gap:10, alignItems:isMobile ? 'flex-start' : 'center' }}>
        <span style={{ color, fontWeight:700 }}>{hidden ? 'R$ XXXXX' : fmt(item.value)}</span>
        <div style={{ display:'flex', gap:8 }}>
          <Btn variant="ghost" onClick={() => onEdit(item)} style={{ padding:'5px 12px', fontSize:12 }}>Editar</Btn>
          <Btn variant="danger" onClick={() => onDelete(item)} style={{ padding:'5px 12px', fontSize:12 }}>Excluir</Btn>
        </div>
      </div>
    </div>
  ))
}

function groupAccountsByMonth(items) {
  const grouped = {}
  items.forEach(item => {
    const dueDate = String(item.dueDate || '')
    const key = dueDate.length >= 7 ? dueDate.slice(0, 7) : dueDate
    if (!key) return
    if (!grouped[key]) grouped[key] = { month:key, total:0, count:0, items:[] }
    grouped[key].total += Number(item.value || 0)
    grouped[key].count += 1
    grouped[key].items.push(item)
  })
  return Object.values(grouped).sort((a, b) => a.month.localeCompare(b.month))
}

function MonthlyAccountsSummary({ title, color, rows, money, emptyMessage, onOpen }) {
  return (
    <Card style={{ padding:16 }}>
      <div style={{ fontSize:12, color:C.textSub, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:700, marginBottom:10 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ color:C.textDim, fontSize:13 }}>{emptyMessage}</div>
      ) : (
        <div style={{ display:'grid', gap:8 }}>
          {rows.map(item => (
            <div key={item.month} role="button" tabIndex={0} onClick={() => onOpen?.(item)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onOpen?.(item) }} title="Clique para ver os lançamentos" style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'center', borderTop:`1px solid ${C.border}33`, paddingTop:8, cursor:onOpen ? 'pointer' : undefined }}>
              <span style={{ color:C.textSub }}>{item.month} · {item.count} lançamento(s)</span>
              <span style={{ color, fontWeight:700 }}>{money(item.total)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function buildDueAlerts(accountsPayable, accountsReceivable) {
  const todayDate = new Date(`${today()}T00:00:00`)
  const openItems = [
    ...(accountsPayable || []).map(item => ({ id:`p-${item.id}`, dueDate:item.dueDate, value:item.value || 0, label:item.supplier || 'Conta a pagar' })),
    ...(accountsReceivable || []).map(item => ({ id:`r-${item.id}`, dueDate:item.dueDate, value:item.value || 0, label:item.description || 'Conta a receber' })),
  ].filter(item => item.dueDate)

  const overdue = []
  const dueSoon = []

  openItems.forEach(item => {
    const due = new Date(`${item.dueDate}T00:00:00`)
    if (Number.isNaN(due.getTime())) return
    const days = Math.ceil((due.getTime() - todayDate.getTime()) / 86400000)
    if (days < 0) overdue.push({ ...item, days })
    if (days >= 0 && days <= 3) dueSoon.push({ ...item, days })
  })

  overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  dueSoon.sort((a, b) => a.days - b.days)
  return { overdue, dueSoon }
}

function FormActions({ onCancel, onSave, disabled, saving = false }) {
  return <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}><Btn variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Btn><Btn onClick={onSave} disabled={disabled}>{saving ? 'Salvando…' : 'Salvar'}</Btn></div>
}

function ChartAccountPicker({ value, accountOptions, groupOptions, quickCategory, canCreate, onChange, onOpen, onQuickChange, onQuickSave, onQuickCancel }) {
  return <div>
    <FInput label="Categoria do plano de contas" required value={value} onChange={onChange} options={[{ v:'', l:'Selecione uma categoria' }, ...accountOptions.map(option => ({ v:option.value, l:option.label }))]} />
    {canCreate && !quickCategory.open && groupOptions.length > 0 && (
      <button type="button" onClick={onOpen} style={{ marginTop:7, padding:0, border:'none', background:'transparent', color:C.accent, fontSize:12, fontWeight:750, cursor:'pointer' }}>
        + Criar nova categoria
      </button>
    )}
    {quickCategory.open && (
      <div role="group" aria-label="Criar nova categoria" style={{ marginTop:10, padding:12, borderRadius:12, border:`1px solid ${C.accent}44`, background:`${C.accent}0D` }}>
        <div style={{ color:C.text, fontSize:13, fontWeight:750, marginBottom:10 }}>Nova categoria neste lançamento</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10 }}>
          <FInput label="Nome da categoria" required value={quickCategory.name} onChange={name => onQuickChange({ name })} placeholder="Ex: Cursos e congressos" />
          <FInput label="Grupo" required value={quickCategory.parentId} onChange={parentId => onQuickChange({ parentId })} options={[{ v:'', l:'Selecione o grupo' }, ...groupOptions.map(option => ({ v:option.value, l:option.label }))]} />
        </div>
        <div style={{ color:C.textDim, fontSize:11, lineHeight:1.5, marginTop:8 }}>O código e a classificação na DRE serão definidos automaticamente pelo grupo escolhido.</div>
        {quickCategory.error && <div role="alert" style={{ color:C.red, fontSize:12, marginTop:8 }}>{quickCategory.error}</div>}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12 }}>
          <Btn variant="ghost" onClick={onQuickCancel} style={{ padding:'7px 11px', fontSize:12 }}>Cancelar categoria</Btn>
          <Btn onClick={onQuickSave} disabled={quickCategory.saving || !quickCategory.name.trim() || !quickCategory.parentId} style={{ padding:'7px 11px', fontSize:12 }}>{quickCategory.saving ? 'Criando…' : 'Criar e selecionar'}</Btn>
        </div>
      </div>
    )}
  </div>
}

function formatRecordTableCell(cell) {
  if (!isIsoDateString(cell)) return cell
  return formatDateBR(cell)
}

function isSaveDisabled(modalType, form, editing) {
  if (modalType === 'extra') {
    if (!form.description) return true
    if (!editing && form.launchType === 'fixa') return !form.recurrenceStartDate
    if (!form.competenceDate) return true
    return form.status === 'pendente' ? !form.dueDate : !form.date
  }
  if (modalType === 'expense') {
    if (!form.description || !form.category) return true
    if (!editing && form.launchType === 'fixa') return !form.recurrenceStartDate
    if (!form.competenceDate) return true
    return form.status === 'aberto' ? !form.dueDate : !form.paymentDate
  }
  return false
}

function SectionTitle({ title, subtitle, compact = false }) {
  return <div><div style={{ fontSize:compact ? 13 : 14, color:C.text, fontWeight:700 }}>{title}</div>{subtitle && <div style={{ color:C.textDim, fontSize:12, marginTop:4 }}>{subtitle}</div>}</div>
}
