import { useState } from 'react'
import { C } from '../theme.js'
import { fmt, fmtN, today } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Progress } from './UI.jsx'
import { maskFinancialValue, useFinancialPrivacy } from '../context/FinancialPrivacyContext.jsx'

const PERIOD_OPTIONS = [
  { value:'day', label:'Dia' },
  { value:'month', label:'Mês' },
  { value:'quarter', label:'Trimestre' },
  { value:'semester', label:'Semestre' },
  { value:'year', label:'Ano' },
]

function formatDateInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDashboardPeriodRange(period) {
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

function getPreviousPeriodRange(period, range) {
  if (!range.start || !range.end) return { start:'', end:'' }
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

export function Dashboard({ data, saveError }) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false
  const isNarrow = typeof window !== 'undefined' ? window.innerWidth < 380 : false
  const { financialPrivacyMode, toggleFinancialPrivacy } = useFinancialPrivacy()
  const [showComparison, setShowComparison] = useState(false)
  const [period, setPeriod] = useState('month')

  const periodRange = getDashboardPeriodRange(period)
  const m = buildMetrics(data, { startDate: periodRange.start, endDate: periodRange.end, balanceDate: periodRange.end })

  const prevRange = getPreviousPeriodRange(period, periodRange)
  const pm = buildMetrics(data, { startDate: prevRange.start, endDate: prevRange.end, balanceDate: prevRange.end })

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
      label: 'Fluxo de caixa',
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
      label: 'Contas em aberto',
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

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>

      {/* Top bar: privacy toggle + comparison toggle + sync status */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Privacidade financeira</div>
            {!isMobile && <div style={{ color:C.textDim, fontSize:13, marginTop:4 }}>Oculte valores ao compartilhar a tela ou usar o sistema em público.</div>}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', width:isMobile ? '100%' : 'auto' }}>
          <select
            value={period}
            onChange={event => setPeriod(event.target.value)}
            style={{
              minWidth:136,
              borderRadius:999,
              border:`1px solid ${C.border}`,
              background:'transparent',
              color:C.textSub,
              padding:'9px 12px',
              fontFamily:'inherit',
              fontSize:12,
              fontWeight:700,
              textTransform:'uppercase',
              letterSpacing:'0.06em',
            }}
          >
            {PERIOD_OPTIONS.map(option => (
              <option key={option.value} value={option.value} style={{ color:'#0B1020' }}>
                {option.label}
              </option>
            ))}
          </select>

          {/* Comparison toggle */}
          <button
            onClick={() => setShowComparison(v => !v)}
            aria-pressed={showComparison}
            title="Comparar com o período anterior"
            style={{
              display:'inline-flex',
              alignItems:'center',
              gap:8,
              padding:'10px 14px',
              borderRadius:999,
              border:`1px solid ${showComparison ? C.cyan + '55' : C.border}`,
              background: showComparison ? C.cyan + '14' : 'transparent',
              color: showComparison ? C.cyan : C.textSub,
              cursor:'pointer',
              fontFamily:'inherit',
              fontSize:13,
              fontWeight:700,
            }}
          >
            vs. período anterior
          </button>

          {/* Privacy toggle */}
          <button
            onClick={toggleFinancialPrivacy}
            aria-label={financialPrivacyMode ? 'Mostrar valores financeiros' : 'Ocultar valores financeiros'}
            title={financialPrivacyMode ? 'Mostrar valores financeiros' : 'Ocultar valores financeiros'}
            style={{
              display:'inline-flex',
              alignItems:'center',
              gap:8,
              padding:'10px 14px',
              borderRadius:999,
              border:`1px solid ${financialPrivacyMode ? C.accent + '55' : C.border}`,
              background: financialPrivacyMode ? C.accent + '14' : 'transparent',
              color: financialPrivacyMode ? C.accentLight : C.textSub,
              cursor:'pointer',
              fontFamily:'inherit',
              fontSize:13,
              fontWeight:700,
            }}
          >
            <EyeIcon off={financialPrivacyMode} />
            {financialPrivacyMode ? 'Mostrar valores' : 'Ocultar valores'}
          </button>

          {/* Sync status pill */}
          <span style={{
            display:'inline-flex',
            alignItems:'center',
            gap:6,
            padding:'6px 12px',
            borderRadius:999,
            fontSize:12,
            fontWeight:700,
            background: saveError ? C.red + '18' : C.green + '18',
            color: saveError ? C.red : C.green,
            border: `1px solid ${saveError ? C.red + '44' : C.green + '44'}`,
            userSelect:'none',
          }}>
            {saveError ? '⚠ Erro ao salvar' : '● Dados atualizados'}
          </span>
        </div>
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
