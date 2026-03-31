import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { fmt, getPeriodRange, today, uid } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge } from './UI.jsx'
import { ExportModal } from './ExportModal.jsx'
import { maskFinancialValue, useFinancialPrivacy } from '../context/FinancialPrivacyContext.jsx'
import { useToast } from '../context/ToastContext.jsx'

const EXTRA_REVENUE_EMPTY = { description:'', category:'outras_receitas', value:0, date:today() }
const EXPENSE_EMPTY = { description:'', category:'outros', value:0, dueDate:today(), paymentDate:'', status:'aberto' }
const BALANCE_EMPTY = { name:'', category:'banco', value:0, notes:'' }

const EXPENSE_CATEGORIES = ['aluguel', 'salarios', 'marketing', 'hospital', 'anestesia', 'equipamentos', 'softwares', 'impostos', 'outros']
const SUMMARY_CARDS = [
  ['Caixa realizado', 'cashBalance', C.cyan],
  ['Lucro líquido', 'netProfit', 'dynamic-profit'],
  ['Contas a receber', 'receivablesOpenTotal', C.accent],
  ['Contas a pagar', 'payablesOpenTotal', C.yellow],
]

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
  const { financialPrivacyMode } = useFinancialPrivacy()
  const { toast } = useToast()
  const [tab, setTab] = useState(defaultTab)
  const [period, setPeriod] = useState('month')
  const [customRange, setCustomRange] = useState({ start:'', end:'' })
  const [modalType, setModalType] = useState(null)
  const [editing, setEditing] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmState, setConfirmState] = useState(null)
  const [form, setForm] = useState(EXTRA_REVENUE_EMPTY)
  const [showComparative, setShowComparative] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const range = getPeriodRange(period, customRange)
  const m = buildMetrics(data, { startDate:range.start, endDate:range.end, balanceDate:range.end || today() })
  const money = value => maskFinancialValue(value, financialPrivacyMode, fmt)

  const prevRange = useMemo(() => {
    if (!range.start) return { start:'', end:'' }
    return getPreviousPeriodRange(period, range)
  }, [period, range.start, range.end])

  const mPrev = useMemo(() => {
    if (!prevRange.start) return null
    return buildMetrics(data, { startDate: prevRange.start, endDate: prevRange.end, balanceDate: prevRange.end })
  }, [data, prevRange.start, prevRange.end])

  useEffect(() => {
    setTab(defaultTab)
  }, [defaultTab])

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
    setShowModal(true)
  }

  const openEdit = (type, item) => {
    setModalType(type)
    setForm({ ...item })
    setEditing(item.id)
    setShowModal(true)
  }

  const save = () => {
    if (modalType === 'extra') {
      if (!form.description) return
      setData(current => ({ ...current, extraRevenues: editing ? current.extraRevenues.map(item => item.id === editing ? { ...form, id:editing } : item) : [...current.extraRevenues, { ...form, id:uid() }] }))
    }
    if (modalType === 'expense') {
      if (!form.description) return
      setData(current => ({ ...current, expenses: editing ? current.expenses.map(item => item.id === editing ? { ...form, id:editing } : item) : [...current.expenses, { ...form, id:uid() }] }))
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
    if (item.source === 'cirurgia') {
      setData(current => ({ ...current, surgeries:current.surgeries.map(record => record.id === item.sourceId ? { ...record, paymentStatus:'pago', paymentDate:today() } : record) }))
    }
    if (item.source === 'consulta') {
      setData(current => ({ ...current, consultations:current.consultations.map(record => record.id === item.sourceId ? { ...record, paymentStatus:'pago', paymentDate:today() } : record) }))
    }
    toast('Marcado como recebido.')
  }

  const markExpenseAsPaid = item => {
    setData(current => ({ ...current, expenses:current.expenses.map(record => record.id === item.sourceId ? { ...record, status:'pago', paymentDate:today() } : record) }))
    toast('Despesa marcada como paga.')
  }

  const removeRecord = record => {
    const collection = { extra:'extraRevenues', expense:'expenses', asset:'assets', liability:'liabilities' }[record.type]
    setData(current => ({ ...current, [collection]:current[collection].filter(item => item.id !== record.id) }))
    toast('Registro removido.', 'warning')
  }

  const tabs = [
    ['entradas', 'Entradas'],
    ['saidas', 'Saídas'],
    ['receber', 'Contas a receber'],
    ['pagar', 'Contas a pagar'],
    ['dre', 'DRE'],
    ['balanco', 'Balanço'],
    ['fluxo', 'Fluxo de caixa'],
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

  // Revenue by origin totals for entradas tab
  const revenueOrigins = useMemo(() => {
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
  }, [m])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ position:'sticky', top:0, zIndex:5, marginBottom:2 }}>
        <div style={{ background:'linear-gradient(180deg, rgba(7,11,18,0.98), rgba(7,11,18,0.92))', border:`1px solid ${C.border}66`, borderRadius:18, padding:16, backdropFilter:'blur(12px)' }}>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
            <select value={period} onChange={e => setPeriod(e.target.value)} style={{ minWidth:isMobile ? '100%' : 180, flex:isMobile ? '1 1 100%' : '0 0 auto' }}>
              <option value="day">Dia</option>
              <option value="week">Semana</option>
              <option value="month">Mês</option>
              <option value="quarter">Trimestre</option>
              <option value="year">Ano</option>
              <option value="custom">Personalizado</option>
            </select>
            {period === 'custom' && <><input type="date" value={customRange.start} onChange={e => setCustomRange(current => ({ ...current, start:e.target.value }))} style={{ flex:isMobile ? '1 1 100%' : '0 0 auto' }} /><input type="date" value={customRange.end} onChange={e => setCustomRange(current => ({ ...current, end:e.target.value }))} style={{ flex:isMobile ? '1 1 100%' : '0 0 auto' }} /></>}
            <div style={{ marginLeft:isMobile ? 0 : 'auto', width:isMobile ? '100%' : 'auto', color:C.textDim, fontSize:12 }}>Período aplicado aos relatórios e demonstrativos.</div>
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

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:14 }}>
        {SUMMARY_CARDS.map(([label, key, color]) => {
          const value = m[key]
          const resolvedColor = color === 'dynamic-profit' ? (value >= 0 ? C.green : C.red) : color
          return <Card key={label} style={{ padding:18 }}><div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>{label}</div><div style={{ fontSize:22, fontWeight:800, color:resolvedColor }}>{money(value)}</div></Card>
        })}
      </div>

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

        <RecordTable columns={['Data', 'Categoria', 'Descrição', 'Origem', 'Valor']} sortableColumns={[0, 1, 3]} rows={m.entriesFinancial.map(item => ({ key:item.id, cells:[item.date, item.category, item.description, item.origin, <span style={{ color:C.green, fontWeight:700 }}>{money(item.value)}</span>], rawCells:[item.date, item.category, item.description, item.origin, item.value] }))} emptyMessage="Nenhuma entrada financeira no período." />
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

        <RecordTable columns={['Data', 'Categoria', 'Descrição', 'Origem', 'Valor']} sortableColumns={[0, 1, 3]} rows={m.exitsFinancial.map(item => ({ key:item.id, cells:[item.date, item.category, item.description, item.origin, <span style={{ color:C.red, fontWeight:700 }}>{money(item.value)}</span>], rawCells:[item.date, item.category, item.description, item.origin, item.value] }))} emptyMessage="Nenhuma saída financeira no período." />
      </>}

      {tab === 'receber' && <><SectionTitle title="Contas a receber" subtitle="Valores ainda não recebidos de cirurgias e consultas." /><RecordTable columns={['Origem', 'Paciente', 'Descrição', 'Vencimento', 'Valor', 'Status', 'Ações']} rows={m.accountsReceivable.map(item => ({ key:item.id, cells:[item.source, item.patient, item.description, item.dueDate, <span style={{ color:C.green, fontWeight:700 }}>{money(item.value)}</span>, <Badge color={item.status === 'pago' ? C.green : C.yellow} small>{item.status}</Badge>, <Btn onClick={() => markReceivableAsPaid(item)} style={{ padding:'5px 12px', fontSize:12 }}>Marcar recebido</Btn>] }))} emptyMessage="Nenhuma conta a receber em aberto." /></>}

      {tab === 'pagar' && <><SectionTitle title="Contas a pagar" subtitle="Despesas ainda não liquidadas pela clínica." /><RecordTable columns={['Categoria', 'Descrição', 'Vencimento', 'Valor', 'Status', 'Ações']} rows={m.accountsPayable.map(item => ({ key:item.id, cells:[item.category, item.supplier, item.dueDate, <span style={{ color:C.red, fontWeight:700 }}>{money(item.value)}</span>, <Badge color={item.status === 'pago' ? C.green : C.yellow} small>{item.status}</Badge>, <Btn onClick={() => markExpenseAsPaid(item)} style={{ padding:'5px 12px', fontSize:12 }}>Marcar pago</Btn>] }))} emptyMessage="Nenhuma conta a pagar em aberto." /></>}

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

      {tab === 'fluxo' && <><SectionTitle title="Fluxo de caixa" subtitle="Entradas e saídas efetivamente realizadas, agrupadas por data." /><RecordTable columns={['Data', 'Entradas', 'Saídas', 'Saldo']} rows={flowRows.map(item => ({ key:item.date, cells:[item.date, <span style={{ color:C.green, fontWeight:700 }}>{money(item.entradas)}</span>, <span style={{ color:C.red, fontWeight:700 }}>{money(item.saidas)}</span>, <span style={{ color:item.saldo >= 0 ? C.green : C.red, fontWeight:700 }}>{money(item.saldo)}</span>] }))} emptyMessage="Nenhuma movimentação de caixa realizada no período." /></>}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar registro' : 'Novo registro'}>
        {modalType === 'extra' && <div style={{ display:'flex', flexDirection:'column', gap:16 }}><FInput label="Descrição" required value={form.description} onChange={value => setForm(current => ({ ...current, description:value }))} placeholder="Ex: retorno pago" /><FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} placeholder="outras_receitas" /><FInput label="Valor" value={form.value} onChange={value => setForm(current => ({ ...current, value:value }))} type="number" /><FInput label="Data" value={form.date} onChange={value => setForm(current => ({ ...current, date:value }))} type="date" /><FormActions onCancel={() => setShowModal(false)} onSave={save} disabled={!form.description} /></div>}
        {modalType === 'expense' && <div style={{ display:'flex', flexDirection:'column', gap:16 }}><FInput label="Descrição" required value={form.description} onChange={value => setForm(current => ({ ...current, description:value }))} placeholder="Ex: aluguel do consultório" /><FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} options={EXPENSE_CATEGORIES.map(item => ({ v:item, l:item }))} /><FInput label="Valor" value={form.value} onChange={value => setForm(current => ({ ...current, value:value }))} type="number" /><FInput label="Data de vencimento" value={form.dueDate} onChange={value => setForm(current => ({ ...current, dueDate:value }))} type="date" /><FInput label="Status" value={form.status} onChange={value => setForm(current => ({ ...current, status:value }))} options={[{ v:'aberto', l:'Aberto' }, { v:'pago', l:'Pago' }]} /><FInput label="Data do pagamento" value={form.paymentDate} onChange={value => setForm(current => ({ ...current, paymentDate:value }))} type="date" /><FormActions onCancel={() => setShowModal(false)} onSave={save} disabled={!form.description} /></div>}
        {(modalType === 'asset' || modalType === 'liability') && <div style={{ display:'flex', flexDirection:'column', gap:16 }}><FInput label="Nome" required value={form.name} onChange={value => setForm(current => ({ ...current, name:value }))} placeholder="Banco / empréstimo" /><FInput label="Categoria" value={form.category} onChange={value => setForm(current => ({ ...current, category:value }))} placeholder="banco" /><FInput label="Valor" value={form.value} onChange={value => setForm(current => ({ ...current, value:value }))} type="number" /><FInput label="Observações" value={form.notes} onChange={value => setForm(current => ({ ...current, notes:value }))} /><FormActions onCancel={() => setShowModal(false)} onSave={save} disabled={!form.name} /></div>}
      </Modal>

      <ConfirmModal open={!!confirmState} onClose={() => setConfirmState(null)} onConfirm={() => removeRecord(confirmState)} />
      <ExportModal open={showExport} onClose={() => setShowExport(false)} data={data} />
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
                    <span style={{ color:C.textSub, fontSize:13, lineHeight:1.45 }}>{cell}</span>
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
                  <td key={index} style={{ padding:'13px 18px', color:C.textSub, fontSize:13 }}>{cell}</td>
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

function FormActions({ onCancel, onSave, disabled }) {
  return <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}><Btn variant="ghost" onClick={onCancel}>Cancelar</Btn><Btn onClick={onSave} disabled={disabled}>Salvar</Btn></div>
}

function SectionTitle({ title, subtitle, compact = false }) {
  return <div><div style={{ fontSize:compact ? 13 : 14, color:C.text, fontWeight:700 }}>{title}</div>{subtitle && <div style={{ color:C.textDim, fontSize:12, marginTop:4 }}>{subtitle}</div>}</div>
}
