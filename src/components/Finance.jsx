import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { fmt, formatDateBR, getPeriodRange, inRange, isIsoDateString, today, uid } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge } from './UI.jsx'
import { ExportModal } from './ExportModal.jsx'
import { maskFinancialValue, useFinancialPrivacy } from '../context/FinancialPrivacyContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { supabase } from '../lib/supabase.js'
import { decodePaymentMethod } from '../lib/paymentMethodCodec.js'

const EXTRA_REVENUE_EMPTY = { description:'', category:'outras_receitas', value:0, date:today(), launchType:'variavel', recurrenceFrequency:'mensal', recurrenceDay:5, recurrenceStartDate:today(), recurrenceEndDate:'', recurrenceAutoMarkAsPaid:false, recurrenceActive:true }
const EXPENSE_EMPTY = { description:'', category:'outros', value:0, dueDate:today(), paymentDate:today(), status:'pago', launchType:'variavel', recurrenceFrequency:'mensal', recurrenceDay:5, recurrenceStartDate:today(), recurrenceEndDate:'', recurrenceAutoMarkAsPaid:false, recurrenceActive:true }
const BALANCE_EMPTY = { name:'', category:'banco', value:0, notes:'' }

const EXPENSE_CATEGORIES = ['aluguel', 'salarios', 'marketing', 'hospital', 'anestesia', 'equipamentos', 'softwares', 'impostos', 'variaveis', 'outros']

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
  hospital:'Hospital',
  anestesia:'Anestesia',
  equipamentos:'Equipamentos',
  softwares:'Softwares',
  impostos:'Impostos',
  variaveis:'Variáveis',
  outros:'Outros',
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

export function Finance({ data, setData, defaultTab = 'entradas' }) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false
  const SUMMARY_CARDS = [
    ['Recebido no período', 'cashBalance', C.cyan],
    ['Lucro líquido', 'netProfit', 'dynamic-profit'],
    ['A receber', 'receivablesOpenTotal', C.accent],
    ['A pagar', 'payablesOpenTotal', C.yellow],
  ]
  const { financialPrivacyMode } = useFinancialPrivacy()
  const { toast } = useToast()
  const [tab, setTab] = useState(defaultTab)
  const [period, setPeriod] = useState('month')
  const [customRange, setCustomRange] = useState({ start:'', end:'' })
  const [modalType, setModalType] = useState(null)
  const [editing, setEditing] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmState, setConfirmState] = useState(null)
  const [paymentConfirmState, setPaymentConfirmState] = useState(null)
  const [listFilters, setListFilters] = useState({ search:'', category:'all', origin:'all', status:'all', launchType:'all' })
  const [form, setForm] = useState(EXTRA_REVENUE_EMPTY)
  const [recurrences, setRecurrences] = useState([])
  const [showComparative, setShowComparative] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [formError, setFormError] = useState('')
  const range = getPeriodRange(period, customRange)
  const periodLabel = useMemo(() => formatFinancePeriodLabel(period, range), [period, range])
  const mergedData = useMemo(() => ({ ...data, recurrences }), [data, recurrences])
  const m = useMemo(
    () => buildMetrics(mergedData, { startDate:range.start, endDate:range.end, balanceDate:range.end || today() }),
    [mergedData, range.start, range.end],
  )
  const money = value => maskFinancialValue(value, financialPrivacyMode, fmt)

  const prevRange = useMemo(() => {
    if (!range.start) return { start:'', end:'' }
    return getPreviousPeriodRange(period, range)
  }, [period, range.start, range.end])

  const mPrev = useMemo(() => {
    if (!prevRange.start) return null
    return buildMetrics(mergedData, { startDate: prevRange.start, endDate: prevRange.end, balanceDate: prevRange.end })
  }, [mergedData, prevRange.start, prevRange.end])

  useEffect(() => {
    setTab(defaultTab)
  }, [defaultTab])

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
      setRecurrences((rows || []).map(item => ({
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
      })))
    }
    loadRecurrences()
    return () => { active = false }
  }, [])

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
      if (!grouped[key]) grouped[key] = { date:key, entradas:0, saidas:0, saldo:0 }
      if (item.type === 'entrada') grouped[key].entradas += item.value
      if (item.type === 'saida') grouped[key].saidas += item.value
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
    setModalType(type)
    setForm(defaults)
    setEditing(null)
    setFormError('')
    setShowModal(true)
  }

  const openEdit = (type, item) => {
    setModalType(type)
    setForm({ ...item })
    setEditing(item.id)
    setFormError('')
    setShowModal(true)
  }

  const saveFixedRecurrence = async tipo => {
    const { data:userData, error:userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) throw new Error('Sessao invalida. Entre novamente.')

    const recurrenceDay = Math.max(1, Math.floor(Number(form.recurrenceDay || 1)))
    const safeDay = form.recurrenceFrequency === 'semanal' ? Math.min(7, recurrenceDay) : Math.min(31, recurrenceDay)

    const payload = {
      user_id:userData.user.id,
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
      setData(current => ({ ...current, extraRevenues: editing ? current.extraRevenues.map(item => item.id === editing ? { ...form, id:editing } : item) : [...current.extraRevenues, { ...form, id:uid() }] }))
    }
    if (modalType === 'expense') {
      if (!form.description) {
        setFormError('Informe uma descrição para a despesa.')
        return
      }
      setFormError('')
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
      const expenseDate = form.dueDate || form.paymentDate || today()
      const normalizedExpense = {
        ...form,
        dueDate:expenseDate,
        paymentDate:expenseDate,
        status:'pago',
      }
      setConfirmState({
        action:'confirm-expense-save',
        title:editing ? 'Confirmar atualização da saída' : 'Confirmar lançamento da saída',
        message:`Confirma lançar ${money(Number(normalizedExpense.value || 0))} em "${normalizedExpense.description || 'despesa'}"?`,
        confirmLabel:editing ? 'Confirmar e atualizar' : 'Confirmar e lançar',
        confirmVariant:'success',
        payload:{ expense:normalizedExpense, editing },
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
          extraRevenues:[...current.extraRevenues, { id:uid(), description:item.description, category:item.category || 'outras_receitas', value:item.value || 0, date:item.dueDate }],
        }))
      }
      toast('Recorrência marcada como recebida.')
      return
    }
    if (item.source === 'cirurgia') {
      setData(current => ({ ...current, surgeries:current.surgeries.map(record => record.id === item.sourceId ? { ...record, paymentStatus:'pago', paymentDate:today() } : record) }))
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
          expenses:[...current.expenses, { id:uid(), description:item.supplier, category:item.category || 'outros', value:item.value || 0, dueDate:item.dueDate, paymentDate:paidDate, status:'pago' }],
        }))
      }
      toast('Recorrência marcada como paga.')
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

  const handleConfirmAction = () => {
    if (!confirmState) return
    if (confirmState.action === 'delete-expense') {
      setData(current => ({ ...current, expenses:current.expenses.filter(record => record.id !== confirmState.id) }))
      toast('Saída removida.', 'warning')
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
      setData(current => ({
        ...current,
        expenses:editingId
          ? current.expenses.map(record => record.id === editingId ? { ...payload, id:editingId } : record)
          : [...current.expenses, { ...payload, id:uid() }],
      }))
      toast(editingId ? 'Saída atualizada com sucesso.' : 'Saída lançada com sucesso.')
      setShowModal(false)
      setConfirmState(null)
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

  // DRE rows definition
  const dreRows = [
    { label: 'Receita bruta total', getValue: mx => mx.surgeryRevenue + mx.consultationRevenue + mx.productSalesRevenue + mx.extraRevenueTotal, color: C.green, bold: false },
    { label: '(-) Custos de cirurgias', getValue: mx => mx.surgeryCostTotal, color: C.red, bold: false },
    { label: 'Receita líquida de cirurgias', getValue: mx => mx.surgeryRevenue - mx.surgeryCostTotal, color: null, bold: false },
    { label: 'Receita de consultas', getValue: mx => mx.consultationRevenue, color: C.green, bold: false },
    { label: '(-) Custos de consultas (NF)', getValue: mx => mx.consultationCostTotal, color: C.red, bold: false },
    { label: 'Receita líquida de consultas', getValue: mx => mx.consultationRevenue - mx.consultationCostTotal, color: null, bold: false },
    { label: 'Receita de produtos', getValue: mx => mx.productSalesRevenue, color: C.green, bold: false },
    { label: 'Outras receitas', getValue: mx => mx.extraRevenueTotal, color: C.green, bold: false },
    { label: '= Receita operacional total', getValue: mx => mx.grossRevenue, color: C.accent, bold: true },
    { label: '(-) Despesas operacionais', getValue: mx => mx.operationalExpenses, color: C.red, bold: false },
    { label: '= Lucro operacional', getValue: mx => mx.operatingProfit, color: mx => mx.operatingProfit >= 0 ? C.accent : C.red, bold: true },
    { label: 'Margem operacional %', getValue: mx => mx.grossRevenue > 0 ? (mx.operatingProfit / mx.grossRevenue * 100) : 0, isPercent: true, color: mx => mx.operatingProfit >= 0 ? C.green : C.red, bold: false },
  ]

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
      if (listFilters.origin !== 'all' && item.origin !== listFilters.origin) return false
      if (!search) return true
      const haystack = `${item.date || ''} ${item.category || ''} ${item.description || ''} ${item.origin || ''}`.toLowerCase()
      return haystack.includes(search)
    })
  }, [m.entriesFinancial, listFilters])

  const filteredExitsFinancial = useMemo(() => {
    const search = String(listFilters.search || '').toLowerCase().trim()
    return m.exitsFinancial.filter(item => {
      const launchType = item.origin === 'recorrencia_despesa' ? 'fixa' : 'variavel'
      if (listFilters.launchType !== 'all' && launchType !== listFilters.launchType) return false
      if (listFilters.category !== 'all' && item.category !== listFilters.category) return false
      if (listFilters.origin !== 'all' && item.origin !== listFilters.origin) return false
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
      if (listFilters.origin !== 'all' && item.source !== listFilters.origin) return false
      if (listFilters.status !== 'all' && item.status !== listFilters.status) return false
      if (!search) return true
      const haystack = `${item.patient || ''} ${item.description || ''} ${item.category || ''} ${item.source || ''} ${item.dueDate || ''}`.toLowerCase()
      return haystack.includes(search)
    })
  }, [m.accountsReceivable, listFilters])

  const filteredAccountsPayable = useMemo(() => {
    const search = String(listFilters.search || '').toLowerCase().trim()
    return m.accountsPayable.filter(item => {
      const launchType = item.source === 'recorrencia' ? 'fixa' : 'variavel'
      if (listFilters.launchType !== 'all' && launchType !== listFilters.launchType) return false
      if (listFilters.category !== 'all' && item.category !== listFilters.category) return false
      if (listFilters.origin !== 'all' && item.source !== listFilters.origin) return false
      if (listFilters.status !== 'all' && item.status !== listFilters.status) return false
      if (!search) return true
      const haystack = `${item.supplier || ''} ${item.category || ''} ${item.source || ''} ${item.dueDate || ''}`.toLowerCase()
      return haystack.includes(search)
    })
  }, [m.accountsPayable, listFilters])

  const activeListFilterConfig = useMemo(() => {
    if (tab === 'entradas') {
      const categories = [...new Set(m.entriesFinancial.map(item => item.category).filter(Boolean))].sort()
      const origins = [...new Set(m.entriesFinancial.map(item => item.origin).filter(Boolean))].sort()
      return { show:true, showStatus:false, categories, origins, statuses:[] }
    }
    if (tab === 'saidas') {
      const categories = [...new Set(m.exitsFinancial.map(item => item.category).filter(Boolean))].sort()
      const origins = [...new Set(m.exitsFinancial.map(item => item.origin).filter(Boolean))].sort()
      return { show:true, showStatus:false, categories, origins, statuses:[] }
    }
    if (tab === 'receber') {
      const categories = [...new Set(m.accountsReceivable.map(item => item.category).filter(Boolean))].sort()
      const origins = [...new Set(m.accountsReceivable.map(item => item.source).filter(Boolean))].sort()
      const statuses = [...new Set(m.accountsReceivable.map(item => item.status).filter(Boolean))].sort()
      return { show:true, showStatus:true, categories, origins, statuses }
    }
    if (tab === 'pagar') {
      const categories = [...new Set(m.accountsPayable.map(item => item.category).filter(Boolean))].sort()
      const origins = [...new Set(m.accountsPayable.map(item => item.source).filter(Boolean))].sort()
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
      const expectedExpenses = mx.operationalExpenses + mx.taxExpenses + mx.surgeryCostTotal + mx.productPurchaseTotal
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
      { label: 'Cirurgias', value: cirurgias, color: C.accent },
      { label: 'Consultas', value: consultas, color: C.cyan },
      { label: 'Produtos', value: produtos, color: C.yellow },
      { label: 'Outras receitas', value: outras, color: C.purple },
    ].map(item => ({ ...item, pct: total > 0 ? item.value / total * 100 : 0, total }))
  })()

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
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
            <Card key={label} style={{ padding:isMobile ? 14 : 18, background:`linear-gradient(135deg, ${resolvedColor}0A, transparent)`, border:`1px solid ${resolvedColor}22` }}>
              <div style={{ fontSize:10, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{label}</div>
              <div style={{ fontSize:isMobile ? 18 : 22, fontWeight:800, color:resolvedColor, letterSpacing:'-0.02em' }}>{money(value)}</div>
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
              <div key={item.label}>
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

        <RecordTable columns={['Data', 'Categoria', 'Descrição', 'Origem', 'Valor']} sortableColumns={[0, 1, 3]} rows={filteredEntriesFinancial.map(item => ({ key:item.id, cells:[formatDateBR(item.date), item.category, item.description, item.origin, <span style={{ color:C.green, fontWeight:700 }}>{money(item.value)}</span>], rawCells:[item.date, item.category, item.description, item.origin, item.value] }))} emptyMessage="Nenhuma entrada financeira no período." />
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
                  <div key={item.cat}>
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

        <RecordTable columns={['Data', 'Categoria', 'Descrição', 'Origem', 'Valor', 'Ações']} sortableColumns={[0, 1, 3]} rows={filteredExitsFinancial.map(item => ({ key:item.id, cells:[formatDateBR(item.date), item.category, item.description, item.origin, <span style={{ color:C.red, fontWeight:700 }}>{money(item.value)}</span>, item.origin === 'despesa' ? <Btn variant="danger" style={{ padding:'5px 12px', fontSize:12 }} onClick={() => setConfirmState({ action:'delete-expense', id:item.referenceId, title:'Excluir saída', message:'Deseja excluir esta saída paga? Essa ação remove o lançamento de despesa vinculado.', confirmLabel:'Excluir', confirmVariant:'danger' })}>Excluir</Btn> : <span style={{ color:C.textSub, fontSize:12 }}>-</span>], rawCells:[item.date, item.category, item.description, item.origin, item.value, item.origin === 'despesa' ? 1 : 0] }))} emptyMessage="Nenhuma saída financeira no período." />
      </>}

      {tab === 'receber' && <>
        <SectionTitle title="Contas a receber" subtitle="Valores ainda não recebidos de cirurgias, consultas e recorrências." />
        <MonthlyAccountsSummary
          title="Recebíveis por mês"
          color={C.green}
          rows={groupAccountsByMonth(filteredAccountsReceivable)}
          money={money}
          emptyMessage="Sem recebíveis agrupados por mês."
        />
        <RecordTable columns={['Origem', 'Paciente', 'Descrição', 'Vencimento', 'Valor', 'Status', 'Ações']} rows={filteredAccountsReceivable.map(item => ({ key:item.id, cells:[item.source, item.patient, item.description, formatDateBR(item.dueDate), <span style={{ color:C.green, fontWeight:700 }}>{money(item.value)}</span>, <Badge color={item.status === 'pago' ? C.green : C.yellow} small>{item.status}</Badge>, item.source === 'recorrencia' ? <div style={{ display:'flex', gap:6 }}><Btn onClick={() => markReceivableAsPaid(item)} style={{ padding:'5px 10px', fontSize:12 }}>Recebido</Btn><Btn variant="ghost" onClick={() => markReceivableAsPending(item)} style={{ padding:'5px 10px', fontSize:12 }}>Pendente</Btn></div> : <Btn onClick={() => markReceivableAsPaid(item)} style={{ padding:'5px 12px', fontSize:12 }}>Marcar recebido</Btn>] }))} emptyMessage="Nenhuma conta a receber em aberto." />
      </>}

      {tab === 'pagar' && <>
        <SectionTitle title="Contas a pagar" subtitle="Despesas ainda não liquidadas da clínica, incluindo recorrências fixas." />
        <MonthlyAccountsSummary
          title="Pagáveis por mês"
          color={C.red}
          rows={groupAccountsByMonth(filteredAccountsPayable)}
          money={money}
          emptyMessage="Sem contas a pagar agrupadas por mês."
        />
        <RecordTable columns={['Categoria', 'Descrição', 'Vencimento', 'Valor', 'Status', 'Ações']} rows={filteredAccountsPayable.map(item => ({ key:item.id, cells:[item.category, item.supplier, formatDateBR(item.dueDate), <span style={{ color:C.red, fontWeight:700 }}>{money(item.value)}</span>, <Badge color={item.status === 'pago' ? C.green : C.yellow} small>{item.status}</Badge>, item.source === 'recorrencia' ? <div style={{ display:'flex', gap:6 }}><Btn onClick={() => markExpenseAsPaid(item)} style={{ padding:'5px 10px', fontSize:12 }}>Pago</Btn><Btn variant="ghost" onClick={() => markExpenseAsPending(item)} style={{ padding:'5px 10px', fontSize:12 }}>Pendente</Btn></div> : <Btn onClick={() => markExpenseAsPaid(item)} style={{ padding:'5px 12px', fontSize:12 }}>Marcar pago</Btn>] }))} emptyMessage="Nenhuma conta a pagar em aberto." />
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
                {dreRows.map(row => {
                  const currentVal = row.getValue(m)
                  const prevVal = mPrev ? row.getValue(mPrev) : null
                  const resolveColor = (val, colorProp) => {
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

                  return (
                    <tr key={row.label} style={{ borderTop:`1px solid ${C.border}22` }}>
                      <td style={{ padding:'12px 0', color:C.textSub, fontSize:13, fontWeight: row.bold ? 700 : 400 }}>{row.label}</td>
                      <td style={{ padding:'12px 12px', textAlign:'right', color:currentColor, fontWeight: row.bold ? 800 : 700, fontSize:13 }}>
                        {formatVal(currentVal)}
                      </td>
                      {showComparative && mPrev && (
                        <>
                          <td style={{ padding:'12px 12px', textAlign:'right', color:C.textDim, fontWeight:600, fontSize:13 }}>
                            {formatVal(prevVal)}
                          </td>
                          <td style={{ padding:'12px 12px', textAlign:'right', fontSize:12, fontWeight:700, whiteSpace:'nowrap' }}>
                            {delta !== null && (
                              <span style={{ color: delta > 0 ? C.green : delta < 0 ? C.red : C.textDim }}>
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

      {tab === 'balanco' && <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:16 }}><Card><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, gap:12, flexWrap:'wrap' }}><SectionTitle title="Ativos complementares" subtitle="Banco, aplicações e outros ativos fora do caixa operacional." compact /><Btn onClick={() => openAdd('asset')} style={{ padding:'7px 12px' }}>+ Ativo</Btn></div><BalanceList items={data.assets} color={C.green} onEdit={item => openEdit('asset', item)} onDelete={item => setConfirmState({ type:'asset', id:item.id })} emptyMessage="Nenhum ativo complementar." hidden={financialPrivacyMode} /></Card><Card><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, gap:12, flexWrap:'wrap' }}><SectionTitle title="Passivos complementares" subtitle="Empréstimos, obrigações e passivos extras." compact /><Btn onClick={() => openAdd('liability')} style={{ padding:'7px 12px' }}>+ Passivo</Btn></div><BalanceList items={data.liabilities} color={C.red} onEdit={item => openEdit('liability', item)} onDelete={item => setConfirmState({ type:'liability', id:item.id })} emptyMessage="Nenhum passivo complementar." hidden={financialPrivacyMode} /></Card><Card style={{ gridColumn:'1 / -1' }}><SectionTitle title="Balanço patrimonial automático" subtitle="Posição financeira consolidada na data selecionada." /><div style={{ marginTop:8 }}>{[['Caixa', m.cashBalance, C.cyan], ['Contas a receber', m.receivablesOpenTotal, C.green], ['Banco e outros ativos', data.assets.reduce((acc, item) => acc + (item.value || 0), 0), C.accent], ['Contas a pagar', m.payablesOpenTotal, C.red], ['Passivos complementares', data.liabilities.reduce((acc, item) => acc + (item.value || 0), 0), C.red], ['Lucros acumulados / patrimônio', m.equity, m.equity >= 0 ? C.green : C.red]].map(([label, value, color]) => <div key={label} style={{ display:'flex', justifyContent:'space-between', gap:16, padding:'12px 0', borderTop:`1px solid ${C.border}22`, alignItems:'center', flexWrap:'wrap' }}><span style={{ color:C.textSub }}>{label}</span><span style={{ color, fontWeight:700 }}>{money(value)}</span></div>)}</div></Card></div>}

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
          <Card style={{ padding:16 }}>
            <div style={{ color:C.textSub, fontSize:12, marginBottom:4 }}>Entradas no período</div>
            <div style={{ color:C.green, fontSize:20, fontWeight:700 }}>{money(flowSummary.entradas)}</div>
          </Card>
          <Card style={{ padding:16 }}>
            <div style={{ color:C.textSub, fontSize:12, marginBottom:4 }}>Saídas no período</div>
            <div style={{ color:C.red, fontSize:20, fontWeight:700 }}>{money(flowSummary.saidas)}</div>
          </Card>
          <Card style={{ padding:16 }}>
            <div style={{ color:C.textSub, fontSize:12, marginBottom:4 }}>Resultado de caixa do período</div>
            <div style={{ color:flowSummary.resultado >= 0 ? C.green : C.red, fontSize:20, fontWeight:700 }}>{money(flowSummary.resultado)}</div>
          </Card>
        </div>
        <RecordTable columns={['Data', 'Entradas', 'Saídas', 'Saldo']} rows={flowRows.map(item => ({ key:item.date, cells:[formatDateBR(item.date), <span style={{ color:C.green, fontWeight:700 }}>{money(item.entradas)}</span>, <span style={{ color:C.red, fontWeight:700 }}>{money(item.saidas)}</span>, <span style={{ color:item.saldo >= 0 ? C.green : C.red, fontWeight:700 }}>{money(item.saldo)}</span>] }))} emptyMessage="Nenhuma movimentação de caixa realizada no período." />

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

      {tab === 'indicadores' && <IndicadoresTab m={m} data={data} money={money} />}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar registro' : 'Novo registro'}>
        {modalType === 'extra' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {!editing && (
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
            <FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} placeholder="Ex: outras_receitas" />
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
              <FInput label="Data do recebimento" value={form.date} onChange={value => setForm(current => ({ ...current, date:value }))} type="date" />
            )}

            <FormActions onCancel={() => { setShowModal(false); setFormError('') }} onSave={save} disabled={isSaveDisabled(modalType, form, editing)} />
          </div>
        )}
        {modalType === 'expense' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {!editing && (
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
            <FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} options={EXPENSE_CATEGORIES.map(item => ({ v:item, l:EXPENSE_CATEGORY_LABELS[item] || item }))} />
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
              <FInput
                label="Data do pagamento"
                value={form.dueDate}
                onChange={value => setForm(current => ({ ...current, dueDate:value, paymentDate:value, status:'pago' }))}
                type="date"
              />
            )}

            <FormActions onCancel={() => { setShowModal(false); setFormError('') }} onSave={save} disabled={isSaveDisabled(modalType, form, editing)} />
          </div>
        )}
        {(modalType === 'asset' || modalType === 'liability') && <div style={{ display:'flex', flexDirection:'column', gap:16 }}><FInput label="Nome" required value={form.name} onChange={value => setForm(current => ({ ...current, name:value }))} placeholder="Banco / empréstimo" /><FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} placeholder="banco" /><FInput label="Valor" value={form.value} onChange={value => setForm(current => ({ ...current, value:value }))} type="number" /><FInput label="Observações" value={form.notes} onChange={value => setForm(current => ({ ...current, notes:value }))} /><FormActions onCancel={() => setShowModal(false)} onSave={save} disabled={!form.name} /></div>}
      </Modal>

      <ConfirmModal
        open={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={handleConfirmAction}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        confirmVariant={confirmState?.confirmVariant}
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

function IndicadoresTab({ m, data, money }) {
  const assetsExtra = (data.assets || []).reduce((acc, x) => acc + (x.value || 0), 0)
  const liabExtra = (data.liabilities || []).reduce((acc, x) => acc + (x.value || 0), 0)

  const directCosts = m.surgeryCostTotal + m.consultationCostTotal + m.productPurchaseTotal
  const grossProfit = m.grossRevenue - directCosts
  const totalCosts = directCosts + m.operationalExpenses + m.taxExpenses
  const totalAtivo = m.cashBalance + m.receivablesOpenTotal + assetsExtra
  const ativoCirculante = m.cashBalance + m.receivablesOpenTotal
  const passivoCirculante = m.payablesOpenTotal
  const totalPassivo = passivoCirculante + liabExtra

  const estoqueValor = (m.productsByPerformance || []).reduce((acc, p) => {
    const prod = (data.products || []).find(x => x.id === p.id)
    return acc + (p.stock > 0 ? p.stock * (prod?.purchasePrice || 0) : 0)
  }, 0)

  const pct = (n, d) => (d !== 0 ? (n / d) * 100 : null)
  const rat = (n, d) => (d !== 0 ? n / d : null)

  const margemBruta = pct(grossProfit, m.grossRevenue)
  const margemLiquida = pct(m.netProfit, m.grossRevenue)
  const margemOperacional = pct(m.operatingProfit, m.grossRevenue)
  const roi = pct(m.netProfit, totalCosts)
  const roe = m.equity !== 0 ? pct(m.netProfit, m.equity) : null
  const roa = pct(m.netProfit, totalAtivo)

  const liquidezCorrente = rat(ativoCirculante, passivoCirculante)
  const liquidezSeca = rat(ativoCirculante - estoqueValor, passivoCirculante)
  const liquidezGeral = rat(ativoCirculante + assetsExtra, totalPassivo)

  const composicaoEndividamento = pct(passivoCirculante, totalPassivo)
  const dividaLiquida = totalPassivo - m.cashBalance
  const alavancagem = m.operatingProfit > 0 ? rat(dividaLiquida, m.operatingProfit) : null

  const margemContribuicao = m.grossRevenue - directCosts
  const margemContribuicaoPct = pct(margemContribuicao, m.grossRevenue)
  const custosFixos = m.operationalExpenses + m.taxExpenses
  const pontoEquilibrio = margemContribuicao > 0 ? custosFixos / (margemContribuicao / m.grossRevenue) : null

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

        <IndCard title="Rentabilidade" icon="📈">
          <IndRow label="Margem Bruta" value={margemBruta} status={statusPct(margemBruta, 40, 20)} hint="(Receita − Custos diretos) / Receita × 100" />
          <IndRow label="Margem Operacional" value={margemOperacional} status={statusPct(margemOperacional, 20, 5)} hint="Lucro operacional / Receita × 100" />
          <IndRow label="Margem Líquida" value={margemLiquida} status={statusPct(margemLiquida, 15, 5)} hint="Lucro líquido / Receita × 100" />
          <IndRow label="ROI" value={roi} status={statusPct(roi, 20, 5)} hint="Lucro líquido / Total de custos × 100" />
          <IndRow label="ROE" value={roe} status={statusPct(roe, 15, 5)} hint="Lucro líquido / Patrimônio líquido × 100" />
          <IndRow label="ROA" value={roa} status={statusPct(roa, 10, 3)} hint="Lucro líquido / Total de ativos × 100" />
        </IndCard>

        <IndCard title="Liquidez" icon="💧">
          <IndRow label="Liquidez Corrente" value={liquidezCorrente} status={statusRat(liquidezCorrente, 1.5, 1)} format="ratio" hint="Ativo circulante / Passivo circulante" />
          <IndRow label="Liquidez Seca" value={liquidezSeca} status={statusRat(liquidezSeca, 1, 0.5)} format="ratio" hint="(Ativo circulante − Estoques) / Passivo circulante" />
          <IndRow label="Liquidez Geral" value={liquidezGeral} status={statusRat(liquidezGeral, 1, 0.5)} format="ratio" hint="(Ativo circ. + Realizável LP) / (Passivo circ. + Não circulante)" />
          <div style={{ marginTop:10, padding:'8px 10px', background:`${C.accent}08`, borderRadius:8 }}>
            <div style={{ fontSize:11, color:C.textDim, lineHeight:1.6 }}>
              <strong style={{ color:C.textSub }}>Ativo circ.:</strong> {money(ativoCirculante)} &nbsp;|&nbsp;
              <strong style={{ color:C.textSub }}>Passivo circ.:</strong> {money(passivoCirculante)}
            </div>
          </div>
        </IndCard>

        <IndCard title="Endividamento" icon="⚖️">
          <IndRow label="Comp. do Endividamento" value={composicaoEndividamento} status={statusPct(composicaoEndividamento, 50, 70, true)} hint="Passivo circulante / Passivo total × 100 — menor é melhor" />
          <IndRow
            label="Alavancagem (Dív.Líq/EBITDA)"
            value={alavancagem}
            status={statusRat(alavancagem, 2, 4, true)}
            format="ratio"
            hint="Dívida líquida / EBITDA — menor é melhor"
          />
          <div style={{ marginTop:10, padding:'8px 10px', background:`${C.accent}08`, borderRadius:8 }}>
            <div style={{ fontSize:11, color:C.textDim, lineHeight:1.6 }}>
              <strong style={{ color:C.textSub }}>Dívida líquida:</strong> {money(dividaLiquida)} &nbsp;|&nbsp;
              <strong style={{ color:C.textSub }}>Patrimônio:</strong> {money(m.equity)}
            </div>
          </div>
        </IndCard>

        <IndCard title="Eficiência" icon="⚙️">
          <IndRow label="Margem de Contribuição %" value={margemContribuicaoPct} status={statusPct(margemContribuicaoPct, 40, 20)} hint="(Receita − Custos variáveis) / Receita × 100" />
          <IndRow label="Margem de Contribuição R$" value={margemContribuicao} status={margemContribuicao >= 0 ? 'green' : 'red'} format="money" hint="Receita total − (Custos variáveis + Despesas variáveis)" />
          <IndRow label="Ponto de Equilíbrio" value={pontoEquilibrio} status={pontoEquilibrio !== null && m.grossRevenue >= pontoEquilibrio ? 'green' : pontoEquilibrio !== null ? 'red' : 'dim'} format="money" hint="Custos fixos / Margem de contribuição % — faturamento mínimo para cobrir os custos" />
          <div style={{ marginTop:10, padding:'8px 10px', background:`${C.accent}08`, borderRadius:8 }}>
            <div style={{ fontSize:11, color:C.textDim, lineHeight:1.6 }}>
              <strong style={{ color:C.textSub }}>Custos fixos:</strong> {money(custosFixos)} &nbsp;|&nbsp;
              <strong style={{ color:C.textSub }}>Receita bruta:</strong> {money(m.grossRevenue)}
            </div>
          </div>
        </IndCard>

      </div>
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
    if (!grouped[key]) grouped[key] = { month:key, total:0, count:0 }
    grouped[key].total += Number(item.value || 0)
    grouped[key].count += 1
  })
  return Object.values(grouped).sort((a, b) => a.month.localeCompare(b.month))
}

function MonthlyAccountsSummary({ title, color, rows, money, emptyMessage }) {
  return (
    <Card style={{ padding:16 }}>
      <div style={{ fontSize:12, color:C.textSub, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:700, marginBottom:10 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ color:C.textDim, fontSize:13 }}>{emptyMessage}</div>
      ) : (
        <div style={{ display:'grid', gap:8 }}>
          {rows.map(item => (
            <div key={item.month} style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'center', borderTop:`1px solid ${C.border}33`, paddingTop:8 }}>
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

function FormActions({ onCancel, onSave, disabled }) {
  return <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}><Btn variant="ghost" onClick={onCancel}>Cancelar</Btn><Btn onClick={onSave} disabled={disabled}>Salvar</Btn></div>
}

function formatRecordTableCell(cell) {
  if (!isIsoDateString(cell)) return cell
  return formatDateBR(cell)
}

function isSaveDisabled(modalType, form, editing) {
  if (modalType === 'extra') {
    if (!form.description) return true
    if (!editing && form.launchType === 'fixa') return !form.recurrenceStartDate
    return !form.date
  }
  if (modalType === 'expense') {
    if (!form.description || !form.category) return true
    if (!editing && form.launchType === 'fixa') return !form.recurrenceStartDate
    return !form.dueDate
  }
  return false
}

function SectionTitle({ title, subtitle, compact = false }) {
  return <div><div style={{ fontSize:compact ? 13 : 14, color:C.text, fontWeight:700 }}>{title}</div>{subtitle && <div style={{ color:C.textDim, fontSize:12, marginTop:4 }}>{subtitle}</div>}</div>
}
