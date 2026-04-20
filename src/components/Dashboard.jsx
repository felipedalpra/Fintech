import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { fmt, fmtN, today, getPeriodRange } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Progress } from './UI.jsx'
import { maskFinancialValue, useFinancialPrivacy } from '../context/FinancialPrivacyContext.jsx'

const PERIOD_OPTIONS = [
  { value:'day', label:'Hoje' },
  { value:'month', label:'Este mês' },
  { value:'quarter', label:'Trimestre' },
  { value:'semester', label:'Semestre' },
  { value:'year', label:'Este ano' },
  { value:'custom', label:'Personalizado' },
]

function formatDateInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDashboardPeriodRange(period, customRange = { start:'', end:'' }) {
  if (period === 'custom') return { start:customRange.start || '', end:customRange.end || '' }

  const base = new Date(`${today()}T00:00:00`)
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate())

  if (period === 'day') {
    const date = formatDateInput(end)
    return { start:date, end:date }
  }

  if (period === 'month') {
    const start = new Date(end.getFullYear(), end.getMonth(), 1)
    return { start:formatDateInput(start), end:formatDateInput(end) }
  }

  if (period === 'quarter') {
    const start = new Date(end.getFullYear(), end.getMonth() - 2, 1)
    return { start:formatDateInput(start), end:formatDateInput(end) }
  }

  if (period === 'semester') {
    const start = new Date(end.getFullYear(), end.getMonth() - 5, 1)
    return { start:formatDateInput(start), end:formatDateInput(end) }
  }

  if (period === 'year') {
    const start = new Date(end.getFullYear(), end.getMonth() - 11, 1)
    return { start:formatDateInput(start), end:formatDateInput(end) }
  }

  return { start:'', end:'' }
}

function formatPeriodLabel(period, range) {
  if (!range.start) return ''
  const locale = 'pt-BR'
  const start = new Date(`${range.start}T00:00:00`)
  if (period === 'day') return start.toLocaleDateString(locale, { day:'numeric', month:'long', year:'numeric' })
  if (period === 'month') return start.toLocaleDateString(locale, { month:'long', year:'numeric' })
  if (!range.end) return start.toLocaleDateString(locale, { day:'numeric', month:'short', year:'numeric' })
  const end = new Date(`${range.end}T00:00:00`)
  const fmtShort = d => d.toLocaleDateString(locale, { day:'numeric', month:'short' })
  const sameYear = start.getFullYear() === end.getFullYear()
  return `${fmtShort(start)} – ${fmtShort(end)}${sameYear ? ` ${end.getFullYear()}` : ` ${end.getFullYear()}`}`
}

function getPreviousPeriodRange(period, range) {
  if (!range.start || !range.end) return { start:'', end:'' }
  if (period === 'custom') {
    const startD = new Date(`${range.start}T00:00:00`)
    const endD = new Date(`${range.end}T00:00:00`)
    const diff = endD.getTime() - startD.getTime()
    const prevEnd = new Date(startD.getTime() - 24 * 60 * 60 * 1000)
    const prevStart = new Date(prevEnd.getTime() - diff)
    const f = d => d.toISOString().split('T')[0]
    return { start:f(prevStart), end:f(prevEnd) }
  }
  const start = new Date(`${range.start}T00:00:00`)
  const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000)

  if (period === 'day') {
    const date = formatDateInput(prevEnd)
    return { start:date, end:date }
  }

  if (period === 'month') {
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1)
    return { start:formatDateInput(prevStart), end:formatDateInput(prevEnd) }
  }

  if (period === 'quarter') {
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth() - 2, 1)
    return { start:formatDateInput(prevStart), end:formatDateInput(prevEnd) }
  }

  if (period === 'semester') {
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth() - 5, 1)
    return { start:formatDateInput(prevStart), end:formatDateInput(prevEnd) }
  }

  if (period === 'year') {
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth() - 11, 1)
    return { start:formatDateInput(prevStart), end:formatDateInput(prevEnd) }
  }

  return { start:'', end:'' }
}

function Sparkline({ values, color }) {
  if (!values || values.length < 2) return null
  const W = 80, H = 28, pad = 2
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2)
    const y = pad + (1 - (v - min) / range) * (H - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display:'block', overflow:'visible' }} aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.75"
      />
    </svg>
  )
}

function DeltaBadge({ current, previous, isPositiveGood = true }) {
  if (previous === undefined || previous === null || previous === 0) return null
  const delta = ((current - previous) / Math.abs(previous)) * 100
  const isImprovement = isPositiveGood ? delta >= 0 : delta <= 0
  const color = isImprovement ? C.green : C.red
  const arrow = delta >= 0 ? '▲' : '▼'
  const abs = Math.abs(delta)
  const label = abs >= 10 ? `${Math.round(abs)}%` : `${abs.toFixed(1)}%`
  return (
    <span style={{ fontSize:11, fontWeight:700, color, marginLeft:6, display:'inline-flex', alignItems:'center', gap:2 }}>
      {arrow}{label}
    </span>
  )
}

function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  useEffect(() => {
    function handleResize() { setWidth(window.innerWidth) }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  return width
}

export function Dashboard({ data, saveError }) {
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 900
  const isNarrow = windowWidth < 380
  const { financialPrivacyMode, toggleFinancialPrivacy } = useFinancialPrivacy()
  const [showComparison, setShowComparison] = useState(false)
  const [period, setPeriod] = useState('month')
  const [customRange, setCustomRange] = useState({ start:'', end:'' })

  const periodRange = useMemo(() => getDashboardPeriodRange(period, customRange), [period, customRange])
  const prevRange = useMemo(() => getPreviousPeriodRange(period, periodRange), [period, periodRange])
  const periodLabel = useMemo(() => formatPeriodLabel(period, periodRange), [period, periodRange])

  const m = useMemo(
    () => buildMetrics(data, { startDate: periodRange.start, endDate: periodRange.end, balanceDate: periodRange.end }),
    [data, periodRange]
  )
  const pm = useMemo(
    () => buildMetrics(data, { startDate: prevRange.start, endDate: prevRange.end, balanceDate: prevRange.end }),
    [data, prevRange]
  )

  const monthKeys = Object.keys({ ...m.revenueByMonth, ...m.expenseByMonth }).sort().slice(-6)
  const maxBar = Math.max(...monthKeys.map(key => Math.max(m.revenueByMonth[key] || 0, m.expenseByMonth[key] || 0)), 1)
  const topProcedure = m.byProcedure[0]
  const topProduct = m.productsByPerformance[0]
  const formatMoney = value => maskFinancialValue(value, financialPrivacyMode, fmt)

  // Build sparkline data from last 6 months of revenue and expense keys
  const allMonthKeys = Object.keys({ ...m.revenueByMonth, ...m.expenseByMonth }).sort().slice(-6)
  const revenueSparkValues = allMonthKeys.map(k => m.revenueByMonth[k] || 0)
  const cashSparkKeys = Object.keys({ ...m.revenueByMonth, ...m.expenseByMonth }).sort().slice(-6)
  const cashSparkValues = cashSparkKeys.map(k => (m.revenueByMonth[k] || 0) - (m.expenseByMonth[k] || 0))

  const kpis = [
    {
      label: 'Receita do mês',
      value: m.grossRevenue,
      prevValue: pm.grossRevenue,
      isPositiveGood: true,
      isCurrency: true,
      subLabel: 'Lucro líquido',
      subValue: m.netProfit,
      subIsCurrency: true,
      color: C.green,
      glow: C.green + '22',
      sparkline: revenueSparkValues,
      sparkColor: C.green,
    },
    {
      label: 'Cirurgias realizadas',
      value: m.surgeriesCompleted,
      prevValue: pm.surgeriesCompleted,
      isPositiveGood: true,
      isCurrency: false,
      subLabel: 'Ticket médio',
      subValue: m.averageTicket,
      subIsCurrency: true,
      color: C.accent,
      glow: C.accent + '22',
      sparkline: null,
      sparkColor: C.accent,
    },
    {
      label: 'Consultas realizadas',
      value: m.consultationsCompleted,
      prevValue: pm.consultationsCompleted,
      isPositiveGood: true,
      isCurrency: false,
      subLabel: 'Receita de consultas',
      subValue: m.consultationRevenue,
      subIsCurrency: true,
      color: C.cyan,
      glow: C.cyan + '22',
      sparkline: null,
      sparkColor: C.cyan,
    },
    {
      label: 'Produtos vendidos',
      value: m.productSalesRevenue,
      prevValue: pm.productSalesRevenue,
      isPositiveGood: true,
      isCurrency: true,
      subLabel: 'Compras de estoque',
      subValue: m.productPurchaseTotal,
      subIsCurrency: true,
      color: C.yellow,
      glow: C.yellow + '22',
      sparkline: null,
      sparkColor: C.yellow,
    },
    {
      label: 'Saldo do caixa',
      value: m.cashBalance,
      prevValue: pm.cashBalance,
      isPositiveGood: true,
      isCurrency: true,
      subLabel: 'Previsão',
      subValue: m.prediction,
      subIsCurrency: true,
      color: m.cashBalance >= 0 ? C.green : C.red,
      glow: (m.cashBalance >= 0 ? C.green : C.red) + '22',
      sparkline: cashSparkValues,
      sparkColor: m.cashBalance >= 0 ? C.green : C.red,
    },
    {
      label: 'A receber',
      value: m.receivablesOpenTotal,
      prevValue: pm.receivablesOpenTotal,
      isPositiveGood: true,
      isCurrency: true,
      subLabel: 'A pagar',
      subValue: m.payablesOpenTotal,
      subIsCurrency: true,
      color: C.purple,
      glow: C.purple + '22',
      sparkline: null,
      sparkColor: C.purple,
    },
  ]

  const computedGoals = useMemo(() => (data.goals || []).map(goal => {
    if (goal.metric === 'reducao_custo') {
      const currentRange = getPeriodRange('month')
      const nowDate = new Date()
      const prevMonthDate = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1)
      const prevYear = prevMonthDate.getFullYear()
      const prevMonth = String(prevMonthDate.getMonth() + 1).padStart(2, '0')
      const prevStart = `${prevYear}-${prevMonth}-01`
      const lastDay = new Date(prevYear, prevMonthDate.getMonth() + 1, 0).getDate()
      const prevEnd = `${prevYear}-${prevMonth}-${String(lastDay).padStart(2, '0')}`
      const curM = buildMetrics(data, { startDate:currentRange.start, endDate:currentRange.end, balanceDate:currentRange.end })
      const preM = buildMetrics(data, { startDate:prevStart, endDate:prevEnd, balanceDate:prevEnd })
      const reduction = (preM.operationalExpenses + preM.taxExpenses + preM.surgeryCostTotal + preM.productPurchaseTotal) - (curM.operationalExpenses + curM.taxExpenses + curM.surgeryCostTotal + curM.productPurchaseTotal)
      return { ...goal, current:reduction }
    }
    const range = getPeriodRange(
      goal.period === 'mensal' ? 'month' : goal.period === 'trimestral' ? 'quarter' : goal.period === 'anual' ? 'year' : 'custom',
      goal.period === 'personalizado' ? { start:today().slice(0, 7) + '-01', end:goal.dueDate } : {}
    )
    const metrics = buildMetrics(data, { startDate:range.start, endDate:range.end || goal.dueDate, balanceDate:goal.dueDate })
    const current = { faturamento:metrics.grossRevenue, cirurgias:metrics.surgeriesCompleted, consultas:metrics.consultationsCompleted, lucro:metrics.netProfit, ticket_medio:metrics.averageTicket, fluxo_caixa:metrics.cashBalance }[goal.metric] || 0
    return { ...goal, current }
  }), [data])

  const topGoals = useMemo(() => [...computedGoals].sort((a, b) => {
    const pctA = a.target > 0 ? a.current / a.target : 0
    const pctB = b.target > 0 ? b.current / b.target : 0
    return pctB - pctA
  }).slice(0, 4), [computedGoals])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>

      {/* Seletor de período */}
      <div style={{ background:'linear-gradient(180deg, rgba(7,11,18,0.98), rgba(7,11,18,0.92))', border:`1px solid ${C.border}66`, borderRadius:18, padding:isMobile ? 14 : 18, backdropFilter:'blur(12px)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:12 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Período analisado</div>
            {periodLabel && <div style={{ fontSize:12, color:C.textSub, marginTop:2 }}>{periodLabel}</div>}
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            {/* Comparison toggle */}
            <button
              onClick={() => setShowComparison(v => !v)}
              aria-pressed={showComparison}
              title="Comparar com o período anterior"
              style={{
                display:'inline-flex', alignItems:'center', gap:6,
                padding:'8px 12px', borderRadius:999,
                border:`1px solid ${showComparison ? C.cyan + '55' : C.border}`,
                background: showComparison ? C.cyan + '14' : 'transparent',
                color: showComparison ? C.cyan : C.textSub,
                cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:700,
              }}
            >
              ↕ Comparar períodos
            </button>
            {/* Privacy toggle */}
            <button
              onClick={toggleFinancialPrivacy}
              aria-label={financialPrivacyMode ? 'Mostrar valores financeiros' : 'Ocultar valores financeiros'}
              style={{
                display:'inline-flex', alignItems:'center', gap:6,
                padding:'8px 12px', borderRadius:999,
                border:`1px solid ${financialPrivacyMode ? C.accent + '55' : C.border}`,
                background: financialPrivacyMode ? C.accent + '14' : 'transparent',
                color: financialPrivacyMode ? C.accentLight : C.textSub,
                cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:700,
              }}
            >
              <EyeIcon off={financialPrivacyMode} />
              {financialPrivacyMode ? 'Mostrar' : 'Ocultar'}
            </button>
            {/* Sync status */}
            <span style={{
              display:'inline-flex', alignItems:'center', gap:5,
              padding:'6px 10px', borderRadius:999, fontSize:11, fontWeight:700,
              background: saveError ? C.red + '18' : C.green + '18',
              color: saveError ? C.red : C.green,
              border: `1px solid ${saveError ? C.red + '44' : C.green + '44'}`,
              userSelect:'none',
            }}>
              {saveError ? '⚠ Erro' : '● Atualizado'}
            </span>
          </div>
        </div>

        {/* Period pills */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {PERIOD_OPTIONS.map(option => {
            const active = period === option.value
            return (
              <button
                key={option.value}
                onClick={() => setPeriod(option.value)}
                style={{
                  padding:'8px 14px', borderRadius:999, cursor:'pointer',
                  fontFamily:'inherit', fontSize:12, fontWeight:active ? 700 : 600,
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

        {/* Custom date range inputs */}
        {period === 'custom' && (
          <div style={{ display:'flex', gap:10, marginTop:12, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <label style={{ fontSize:11, color:C.textDim, fontWeight:600 }}>Data inicial</label>
              <input
                type="date"
                value={customRange.start}
                onChange={e => setCustomRange(current => ({ ...current, start:e.target.value }))}
                style={{ padding:'8px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', color:C.text, fontFamily:'inherit', fontSize:13 }}
              />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <label style={{ fontSize:11, color:C.textDim, fontWeight:600 }}>Data final</label>
              <input
                type="date"
                value={customRange.end}
                onChange={e => setCustomRange(current => ({ ...current, end:e.target.value }))}
                style={{ padding:'8px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', color:C.text, fontFamily:'inherit', fontSize:13 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div style={{ display:'grid', gridTemplateColumns:isMobile ? (isNarrow ? '1fr' : 'repeat(2,minmax(0,1fr))') : 'repeat(auto-fill,minmax(240px,1fr))', gap:isMobile ? 10 : 16 }}>
        {kpis.map(item => (
          <Card key={item.label} glow={item.glow} style={{ padding:isMobile ? 14 : 20 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ fontSize:isMobile ? 10 : 11, color:C.textSub, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:8, lineHeight:1.35 }}>{item.label}</div>
              {item.sparkline && item.sparkline.length >= 2 && (
                <Sparkline values={item.sparkline} color={item.sparkColor} />
              )}
            </div>
            <div style={{ fontSize:isMobile ? 20 : 26, fontWeight:800, color:item.color, letterSpacing:'-0.02em', display:'flex', alignItems:'baseline', flexWrap:'wrap', lineHeight:1.2 }}>
              {item.isCurrency ? formatMoney(item.value) : fmtN(item.value)}
              {showComparison && !financialPrivacyMode && (
                <DeltaBadge current={item.value} previous={item.prevValue} isPositiveGood={item.isPositiveGood} />
              )}
            </div>
            <div style={{ fontSize:isMobile ? 11 : 12, color:C.textDim, marginTop:4, lineHeight:1.4 }}>
              {item.subLabel}: {item.subIsCurrency ? formatMoney(item.subValue) : fmtN(item.subValue)}
            </div>
          </Card>
        ))}
      </div>

      {/* Goals widget */}
      {topGoals.length > 0 && (
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <h3 style={{ margin:0, fontSize:13, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>Progresso das metas</h3>
            <span style={{ fontSize:11, color:C.textDim }}>{topGoals.length} de {computedGoals.length} meta{computedGoals.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))', gap:16 }}>
            {topGoals.map(goal => {
              const pct = goal.target > 0 ? Math.min(100, (goal.current / goal.target) * 100) : 0
              const done = goal.current >= goal.target
              const color = done ? C.green : pct >= 70 ? C.cyan : pct >= 40 ? C.accent : C.yellow
              const isCountMetric = goal.metric === 'cirurgias' || goal.metric === 'consultas'
              const displayVal = v => maskFinancialValue(v, financialPrivacyMode, isCountMetric ? fmtN : fmt)
              const dueDate = goal.dueDate ? new Date(`${goal.dueDate}T00:00:00`) : null
              const nowMidnight = new Date(); nowMidnight.setHours(0,0,0,0)
              const daysLeft = dueDate ? Math.floor((dueDate.getTime() - nowMidnight.getTime()) / (1000*60*60*24)) : null
              const daysColor = daysLeft === null ? C.textDim : daysLeft < 0 ? C.red : daysLeft <= 7 ? C.yellow : C.textDim
              const daysLabel = daysLeft === null ? '' : daysLeft < 0 ? 'Vencida' : daysLeft === 0 ? 'Vence hoje' : `${daysLeft}d restantes`
              return (
                <div key={goal.id} style={{ padding:'14px 16px', borderRadius:12, background:color+'0d', border:`1px solid ${color}33` }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:C.text, flex:1, paddingRight:8, lineHeight:1.35 }}>{goal.name}</div>
                    {done && <span style={{ fontSize:11, fontWeight:700, color:C.green, whiteSpace:'nowrap' }}>🎯 Atingida</span>}
                  </div>
                  <Progress val={pct} max={100} color={color} h={8} />
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:8, alignItems:'center' }}>
                    <div>
                      <span style={{ fontSize:13, fontWeight:800, color }}>{displayVal(goal.current)}</span>
                      <span style={{ fontSize:11, color:C.textDim }}> / {displayVal(goal.target)}</span>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <span style={{ fontSize:12, fontWeight:700, color }}>{pct.toFixed(0)}%</span>
                      {daysLabel && <div style={{ fontSize:10, color:daysColor, fontWeight:600 }}>{daysLabel}</div>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1.25fr 1fr', gap:16 }}>
        <Card>
          <h3 style={{ margin:'0 0 20px', fontSize:13, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>Entradas x saídas no período</h3>
          {monthKeys.length === 0 ? <p style={{ color:C.textDim, fontSize:13 }}>Ainda não há movimentações suficientes para montar o fluxo.</p> : (
            <>
              <div style={{ display:'flex', gap:isMobile ? 4 : 8, alignItems:'flex-end', height:160, overflowX:isMobile ? 'auto' : 'visible', paddingBottom:isMobile ? 8 : 0 }}>
                {monthKeys.map(key => {
                  const rec = m.revenueByMonth[key] || 0
                  const exp = m.expenseByMonth[key] || 0
                  const recH = Math.max((rec / maxBar) * 140, 2)
                  const expH = Math.max((exp / maxBar) * 140, 2)
                  const label = new Date(`${key}-01T00:00:00`).toLocaleDateString('pt-BR', { month:'short' })
                  return <div key={key} style={{ flex:isMobile ? '0 0 42px' : 1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}><div style={{ display:'flex', gap:3, alignItems:'flex-end', height:140 }}><div style={{ width:16, height:recH, background:`linear-gradient(0deg,${C.green},${C.cyan})`, borderRadius:'3px 3px 0 0' }} /><div style={{ width:16, height:expH, background:`linear-gradient(0deg,${C.red}88,${C.red})`, borderRadius:'3px 3px 0 0' }} /></div><span style={{ fontSize:10, color:C.textDim }}>{label}</span></div>
                })}
              </div>
              <div style={{ display:'flex', gap:16, marginTop:14 }}><span style={{ fontSize:11, color:C.textSub, display:'flex', alignItems:'center', gap:6 }}><span style={{ width:10, height:10, background:C.green, borderRadius:2, display:'inline-block' }} />Entradas</span><span style={{ fontSize:11, color:C.textSub, display:'flex', alignItems:'center', gap:6 }}><span style={{ width:10, height:10, background:C.red, borderRadius:2, display:'inline-block' }} />Saídas</span></div>
            </>
          )}
        </Card>

        <Card>
          <h3 style={{ margin:'0 0 16px', fontSize:13, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>Ranking de rentabilidade</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}><span style={{ fontSize:13, color:C.text, fontWeight:600 }}>Procedimento líder</span><span style={{ fontSize:13, color:C.textSub }}>{topProcedure ? formatMoney(topProcedure.profit) : 'Sem dados'}</span></div>
              <Progress val={topProcedure?.profit || 0} max={Math.max(topProcedure?.profit || 1, 1)} color={C.accent} h={8} />
              <span style={{ fontSize:11, color:C.textDim, marginTop:3, display:'block' }}>{topProcedure ? topProcedure.name : 'Cadastre cirurgias para ranquear procedimentos.'}</span>
            </div>
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}><span style={{ fontSize:13, color:C.text, fontWeight:600 }}>Produto líder</span><span style={{ fontSize:13, color:C.textSub }}>{topProduct ? formatMoney(topProduct.profit) : 'Sem dados'}</span></div>
              <Progress val={topProduct?.profit || 0} max={Math.max(topProduct?.profit || 1, 1)} color={C.yellow} h={8} />
              <span style={{ fontSize:11, color:C.textDim, marginTop:3, display:'block' }}>{topProduct ? `${topProduct.name} · ${fmtN(topProduct.soldQty)} vendido(s)` : 'Cadastre produtos e registre vendas.'}</span>
            </div>
            <div style={{ padding:'14px 0', borderTop:`1px solid ${C.border}22` }}>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:8 }}>Composição do faturamento</div>
              <Stack label="Cirurgias" value={m.surgeryRevenue} total={m.grossRevenue} color={C.accent} hidden={financialPrivacyMode} />
              <Stack label="Consultas" value={m.consultationRevenue} total={m.grossRevenue} color={C.cyan} hidden={financialPrivacyMode} />
              <Stack label="Produtos" value={m.productSalesRevenue} total={m.grossRevenue} color={C.yellow} hidden={financialPrivacyMode} />
              <Stack label="Outras receitas" value={m.extraRevenueTotal} total={m.grossRevenue} color={C.green} hidden={financialPrivacyMode} />
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Stack({ label, value, total, color, hidden }) {
  return <div style={{ marginBottom:10 }}><div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span style={{ color:C.textSub, fontSize:12 }}>{label}</span><span style={{ color, fontSize:12, fontWeight:700 }}>{hidden ? 'R$ XXXXX' : fmt(value)}</span></div><Progress val={value} max={Math.max(total || 1, 1)} color={color} h={7} /></div>
}

function EyeIcon({ off }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 12C4.8 7.6 8.1 5.4 12 5.4C15.9 5.4 19.2 7.6 22 12C19.2 16.4 15.9 18.6 12 18.6C8.1 18.6 4.8 16.4 2 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      {off ? <path d="M4 4L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : null}
    </svg>
  )
}
