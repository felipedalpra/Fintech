import { useMemo, useState } from 'react'
import { C } from '../theme.js'
import { fmt, today } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { maskFinancialValue, useFinancialPrivacy } from '../context/FinancialPrivacyContext.jsx'

const PERIOD_OPTIONS = [
  { value: 'month', label: 'Este mês' },
  { value: 'prev_month', label: 'Mês anterior' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'semester', label: 'Semestre' },
  { value: 'year', label: 'Este ano' },
  { value: 'custom', label: 'Personalizado' },
]

const VIEWS = [
  { value: 'dre', label: 'DRE' },
  { value: 'cashflow', label: 'Fluxo de Caixa' },
  { value: 'revenue', label: 'Faturamento' },
  { value: 'expenses', label: 'Despesas' },
]

function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getPeriodRange(period, custom = { start: '', end: '' }) {
  if (period === 'custom') return { start: custom.start || '', end: custom.end || '' }
  const now = new Date(`${today()}T00:00:00`)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'month') {
    return { start: formatDateInput(new Date(end.getFullYear(), end.getMonth(), 1)), end: formatDateInput(end) }
  }
  if (period === 'prev_month') {
    const prevEnd = new Date(end.getFullYear(), end.getMonth(), 0)
    return { start: formatDateInput(new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1)), end: formatDateInput(prevEnd) }
  }
  if (period === 'quarter') {
    return { start: formatDateInput(new Date(end.getFullYear(), end.getMonth() - 2, 1)), end: formatDateInput(end) }
  }
  if (period === 'semester') {
    return { start: formatDateInput(new Date(end.getFullYear(), end.getMonth() - 5, 1)), end: formatDateInput(end) }
  }
  if (period === 'year') {
    return { start: formatDateInput(new Date(end.getFullYear(), end.getMonth() - 11, 1)), end: formatDateInput(end) }
  }
  return { start: '', end: '' }
}

function formatPeriodLabel(period, range) {
  if (!range.start) return '—'
  const locale = 'pt-BR'
  const start = new Date(`${range.start}T00:00:00`)
  if (period === 'month' || period === 'prev_month')
    return start.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  if (!range.end) return start.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const end = new Date(`${range.end}T00:00:00`)
  const s = d => d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  return `${s(start)} – ${s(end)} ${end.getFullYear()}`
}

function PeriodSelector({ label, period, setPeriod, custom, setCustom, accent }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PERIOD_OPTIONS.map(opt => {
          const active = period === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              style={{
                padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 700 : 500,
                border: active ? `1px solid ${accent}66` : `1px solid ${C.border}`,
                background: active ? accent + '20' : 'transparent',
                color: active ? accent : C.textSub,
                transition: 'all 0.12s',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      {period === 'custom' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>Início</label>
            <input
              type="date"
              value={custom.start}
              onChange={e => setCustom(c => ({ ...c, start: e.target.value }))}
              style={{ padding: '6px 10px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontFamily: 'inherit', fontSize: 12 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>Fim</label>
            <input
              type="date"
              value={custom.end}
              onChange={e => setCustom(c => ({ ...c, end: e.target.value }))}
              style={{ padding: '6px 10px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontFamily: 'inherit', fontSize: 12 }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Delta({ a, b, isPositiveGood = true }) {
  if (b === 0 && a === 0) return null
  if (b === 0) return <span style={{ fontSize: 11, fontWeight: 700, color: isPositiveGood ? C.green : C.red, marginLeft: 4 }}>Novo</span>
  const pct = ((a - b) / Math.abs(b)) * 100
  const isGood = isPositiveGood ? pct >= 0 : pct <= 0
  const color = isGood ? C.green : C.red
  const arrow = pct >= 0 ? '▲' : '▼'
  const label = Math.abs(pct) >= 10 ? `${Math.round(Math.abs(pct))}%` : `${Math.abs(pct).toFixed(1)}%`
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, marginLeft: 4, whiteSpace: 'nowrap' }}>
      {arrow}{label}
    </span>
  )
}

function Row({ label, a, b, formatMoney, isPositiveGood = true, isSubtotal = false, isTotal = false, indent = false, isExpense = false }) {
  const style = isTotal
    ? { fontWeight: 800, fontSize: 14, color: C.text, borderTop: `1px solid ${C.border}55`, paddingTop: 10, marginTop: 4 }
    : isSubtotal
    ? { fontWeight: 700, fontSize: 13, color: C.textSub, borderTop: `1px solid ${C.border}33`, paddingTop: 8, marginTop: 2 }
    : { fontWeight: 500, fontSize: 13, color: indent ? C.textDim : C.textSub }

  const valueColor = isTotal
    ? (isPositiveGood ? (a >= 0 ? C.green : C.red) : (a <= 0 ? C.green : C.red))
    : isSubtotal ? C.text : C.text

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px 90px', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${C.border}11` }}>
      <div style={{ ...style, paddingLeft: indent ? 16 : 0 }}>
        {isExpense && !isSubtotal && !isTotal && <span style={{ color: C.red, marginRight: 4, fontSize: 11 }}>—</span>}
        {label}
      </div>
      <div style={{ textAlign: 'right', ...style, color: valueColor, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(a)}</div>
      <div style={{ textAlign: 'right', ...style, color: C.textDim, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(b)}</div>
      <div style={{ textAlign: 'right' }}>
        <Delta a={a} b={b} isPositiveGood={isPositiveGood} />
      </div>
    </div>
  )
}

function TableHeader({ labelA, labelB }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px 90px', gap: 8, padding: '0 0 10px', borderBottom: `1px solid ${C.border}44`, marginBottom: 4 }}>
      <div style={{ fontSize: 11, color: C.textDim, fontWeight: 600 }}>Indicador</div>
      <div style={{ textAlign: 'right', fontSize: 11, color: C.accent, fontWeight: 700 }}>{labelA}</div>
      <div style={{ textAlign: 'right', fontSize: 11, color: C.cyan, fontWeight: 700 }}>{labelB}</div>
      <div style={{ textAlign: 'right', fontSize: 11, color: C.textDim, fontWeight: 600 }}>Variação</div>
    </div>
  )
}

function DreView({ mA, mB, formatMoney }) {
  const totExpA = mA.surgeryCostTotal + mA.consultationCostTotal + mA.productPurchaseTotal + mA.operationalExpenses + mA.taxExpenses
  const totExpB = mB.surgeryCostTotal + mB.consultationCostTotal + mB.productPurchaseTotal + mB.operationalExpenses + mB.taxExpenses
  return (
    <>
      <Row label="Receita de Cirurgias"     a={mA.surgeryRevenue}        b={mB.surgeryRevenue}        formatMoney={formatMoney} indent />
      <Row label="Receita de Consultas"     a={mA.consultationRevenue}   b={mB.consultationRevenue}   formatMoney={formatMoney} indent />
      <Row label="Receita de Produtos"      a={mA.productSalesRevenue}   b={mB.productSalesRevenue}   formatMoney={formatMoney} indent />
      <Row label="Outras Receitas"          a={mA.extraRevenueTotal}     b={mB.extraRevenueTotal}     formatMoney={formatMoney} indent />
      <Row label="= Faturamento Bruto"      a={mA.grossRevenue}          b={mB.grossRevenue}          formatMoney={formatMoney} isSubtotal />
      <Row label="Custos de Cirurgias"      a={mA.surgeryCostTotal}      b={mB.surgeryCostTotal}      formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="Custos de Consultas"      a={mA.consultationCostTotal} b={mB.consultationCostTotal} formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="Custo de Produtos"        a={mA.productPurchaseTotal}  b={mB.productPurchaseTotal}  formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="Despesas Operacionais"    a={mA.operationalExpenses}   b={mB.operationalExpenses}   formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="= Lucro Operacional"      a={mA.operatingProfit}       b={mB.operatingProfit}       formatMoney={formatMoney} isSubtotal />
      <Row label="Impostos"                 a={mA.taxExpenses}           b={mB.taxExpenses}           formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="= Lucro Líquido"          a={mA.netProfit}             b={mB.netProfit}             formatMoney={formatMoney} isTotal />
      <Row label="Total de Despesas"        a={totExpA}                  b={totExpB}                  formatMoney={formatMoney} isPositiveGood={false} isTotal />
    </>
  )
}

function CashflowView({ mA, mB, formatMoney }) {
  return (
    <>
      <Row label="Entradas no Caixa"    a={mA.cashIn}               b={mB.cashIn}               formatMoney={formatMoney} indent />
      <Row label="Saídas no Caixa"      a={mA.cashOut}              b={mB.cashOut}              formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="= Saldo do Caixa"     a={mA.cashBalance}          b={mB.cashBalance}          formatMoney={formatMoney} isTotal />
      <Row label="A Receber"            a={mA.receivablesOpenTotal} b={mB.receivablesOpenTotal} formatMoney={formatMoney} indent />
      <Row label="A Pagar"              a={mA.payablesOpenTotal}    b={mB.payablesOpenTotal}    formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="= Previsão de Caixa"  a={mA.prediction}          b={mB.prediction}           formatMoney={formatMoney} isTotal />
    </>
  )
}

function RevenueView({ mA, mB, formatMoney }) {
  return (
    <>
      <Row label="Cirurgias"       a={mA.surgeryRevenue}      b={mB.surgeryRevenue}      formatMoney={formatMoney} indent />
      <Row label="Consultas"       a={mA.consultationRevenue} b={mB.consultationRevenue} formatMoney={formatMoney} indent />
      <Row label="Produtos"        a={mA.productSalesRevenue} b={mB.productSalesRevenue} formatMoney={formatMoney} indent />
      <Row label="Outras Receitas" a={mA.extraRevenueTotal}   b={mB.extraRevenueTotal}   formatMoney={formatMoney} indent />
      <Row label="= Total"         a={mA.grossRevenue}        b={mB.grossRevenue}        formatMoney={formatMoney} isTotal />
    </>
  )
}

function ExpensesView({ mA, mB, formatMoney }) {
  const totA = mA.surgeryCostTotal + mA.consultationCostTotal + mA.productPurchaseTotal + mA.operationalExpenses + mA.taxExpenses
  const totB = mB.surgeryCostTotal + mB.consultationCostTotal + mB.productPurchaseTotal + mB.operationalExpenses + mB.taxExpenses
  return (
    <>
      <Row label="Custos de Cirurgias"   a={mA.surgeryCostTotal}      b={mB.surgeryCostTotal}      formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="Custos de Consultas"   a={mA.consultationCostTotal} b={mB.consultationCostTotal} formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="Custo de Produtos"     a={mA.productPurchaseTotal}  b={mB.productPurchaseTotal}  formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="Despesas Operacionais" a={mA.operationalExpenses}   b={mB.operationalExpenses}   formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="Impostos"              a={mA.taxExpenses}           b={mB.taxExpenses}           formatMoney={formatMoney} isPositiveGood={false} isExpense indent />
      <Row label="= Total de Despesas"   a={totA}                     b={totB}                     formatMoney={formatMoney} isPositiveGood={false} isTotal />
    </>
  )
}

export function CompareModal({ data, onClose }) {
  const { financialPrivacyMode } = useFinancialPrivacy()
  const [view, setView] = useState('dre')
  const [periodA, setPeriodA] = useState('month')
  const [customA, setCustomA] = useState({ start: '', end: '' })
  const [periodB, setPeriodB] = useState('prev_month')
  const [customB, setCustomB] = useState({ start: '', end: '' })

  const rangeA = useMemo(() => getPeriodRange(periodA, customA), [periodA, customA])
  const rangeB = useMemo(() => getPeriodRange(periodB, customB), [periodB, customB])

  const mA = useMemo(() => buildMetrics(data, { startDate: rangeA.start, endDate: rangeA.end, balanceDate: rangeA.end }), [data, rangeA])
  const mB = useMemo(() => buildMetrics(data, { startDate: rangeB.start, endDate: rangeB.end, balanceDate: rangeB.end }), [data, rangeB])

  const labelA = formatPeriodLabel(periodA, rangeA)
  const labelB = formatPeriodLabel(periodB, rangeB)

  const formatMoney = v => maskFinancialValue(v, financialPrivacyMode, fmt)

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: C.bg, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
      role="dialog"
      aria-modal="true"
      aria-label="Análise Comparativa"
    >
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: C.bg + 'F2', backdropFilter: 'blur(14px)',
        borderBottom: `1px solid ${C.border}44`,
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <button
          onClick={onClose}
          aria-label="Fechar"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: `1px solid ${C.border}`,
            borderRadius: 999, padding: '7px 14px', cursor: 'pointer',
            color: C.textSub, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          }}
        >
          ← Voltar
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>Análise Comparativa</div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 1 }}>
            <span style={{ color: C.accent }}>{labelA}</span>
            <span style={{ margin: '0 6px', color: C.textDim }}>vs</span>
            <span style={{ color: C.cyan }}>{labelB}</span>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: '24px', maxWidth: 1100, width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Period selectors */}
        <div style={{ background: C.bg, border: `1px solid ${C.border}55`, borderRadius: 16, padding: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <PeriodSelector
            label="Período A"
            period={periodA}
            setPeriod={setPeriodA}
            custom={customA}
            setCustom={setCustomA}
            accent={C.accent}
          />
          <div style={{ width: 1, background: C.border + '44', alignSelf: 'stretch', flexShrink: 0 }} />
          <PeriodSelector
            label="Período B"
            period={periodB}
            setPeriod={setPeriodB}
            custom={customB}
            setCustom={setCustomB}
            accent={C.cyan}
          />
        </div>

        {/* View selector */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {VIEWS.map(v => {
            const active = view === v.value
            return (
              <button
                key={v.value}
                onClick={() => setView(v.value)}
                style={{
                  padding: '9px 20px', borderRadius: 999, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 700 : 600,
                  border: active ? `1px solid ${C.accent}66` : `1px solid ${C.border}`,
                  background: active ? C.accent + '18' : 'transparent',
                  color: active ? C.accentLight : C.textSub,
                  transition: 'all 0.12s',
                }}
              >
                {v.label}
              </button>
            )
          })}
        </div>

        {/* Comparison table */}
        <div style={{ background: C.bg, border: `1px solid ${C.border}44`, borderRadius: 16, padding: '20px 24px', overflowX: 'auto' }}>
          <div style={{ minWidth: 540 }}>
            <TableHeader labelA={labelA} labelB={labelB} />
            {view === 'dre'      && <DreView      mA={mA} mB={mB} formatMoney={formatMoney} />}
            {view === 'cashflow' && <CashflowView mA={mA} mB={mB} formatMoney={formatMoney} />}
            {view === 'revenue'  && <RevenueView  mA={mA} mB={mB} formatMoney={formatMoney} />}
            {view === 'expenses' && <ExpensesView mA={mA} mB={mB} formatMoney={formatMoney} />}
          </div>
        </div>

      </div>
    </div>
  )
}
