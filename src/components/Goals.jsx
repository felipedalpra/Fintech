import { useMemo, useState } from 'react'
import { C } from '../theme.js'
import { getPeriodRange, today, uid, fmt, fmtN } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge, Progress } from './UI.jsx'
import { maskFinancialValue, useFinancialPrivacy } from '../context/FinancialPrivacyContext.jsx'

const GOAL_PULSE_STYLE = `
@keyframes goalPulse {
  0%   { box-shadow: 0 0 0 0 rgba(245,158,11,0.45), 0 0 0 0 rgba(16,185,129,0.3); }
  50%  { box-shadow: 0 0 0 8px rgba(245,158,11,0.08), 0 0 0 4px rgba(16,185,129,0.08); }
  100% { box-shadow: 0 0 0 0 rgba(245,158,11,0), 0 0 0 0 rgba(16,185,129,0); }
}
.goal-achieved-card {
  animation: goalPulse 2.4s ease-in-out infinite;
}
`

let styleInjected = false
function injectGoalStyle() {
  if (styleInjected || typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = GOAL_PULSE_STYLE
  document.head.appendChild(el)
  styleInjected = true
}

const METRICS = [
  { v:'faturamento', l:'Faturamento' },
  { v:'cirurgias', l:'Número de cirurgias' },
  { v:'consultas', l:'Número de consultas' },
  { v:'lucro', l:'Lucro líquido' },
  { v:'ticket_medio', l:'Ticket médio' },
  { v:'fluxo_caixa', l:'Fluxo de caixa' },
  { v:'reducao_custo', l:'Redução de custos' },
]

function computeDaysRemaining(dueDate) {
  if (!dueDate) return null
  const due = new Date(`${dueDate}T00:00:00`)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export function Goals({ data, setData }) {
  injectGoalStyle()
  const { financialPrivacyMode } = useFinancialPrivacy()
  const empty = { name:'', metric:'faturamento', target:0, period:'mensal', dueDate:today(), isLower:false }
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmId, setConfirmId] = useState(null)

  const isCountMetric = metric => metric === 'cirurgias' || metric === 'consultas'
  const displayValue = (metric, value) => isCountMetric(metric) ? fmtN(value) : maskFinancialValue(value, financialPrivacyMode, fmt)

  const computedGoals = useMemo(() => data.goals.map(goal => {
    const range = getPeriodRange(goal.period === 'mensal' ? 'month' : goal.period === 'trimestral' ? 'quarter' : goal.period === 'anual' ? 'year' : 'custom', goal.period === 'personalizado' ? { start:today().slice(0, 7) + '-01', end:goal.dueDate } : {})

    // For reducao_custo we compare previous month vs current month
    if (goal.metric === 'reducao_custo') {
      const currentRange = getPeriodRange('month')
      const nowDate = new Date()
      const prevMonthDate = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1)
      const prevYear = prevMonthDate.getFullYear()
      const prevMonth = String(prevMonthDate.getMonth() + 1).padStart(2, '0')
      const prevStart = `${prevYear}-${prevMonth}-01`
      const lastDay = new Date(prevYear, prevMonthDate.getMonth() + 1, 0).getDate()
      const prevEnd = `${prevYear}-${prevMonth}-${String(lastDay).padStart(2, '0')}`

      const currentMetrics = buildMetrics(data, { startDate:currentRange.start, endDate:currentRange.end, balanceDate:currentRange.end })
      const prevMetrics = buildMetrics(data, { startDate:prevStart, endDate:prevEnd, balanceDate:prevEnd })

      const currentTotalExpenses = currentMetrics.operationalExpenses + currentMetrics.taxExpenses + currentMetrics.surgeryCostTotal + currentMetrics.productPurchaseTotal
      const prevTotalExpenses = prevMetrics.operationalExpenses + prevMetrics.taxExpenses + prevMetrics.surgeryCostTotal + prevMetrics.productPurchaseTotal
      const reduction = prevTotalExpenses - currentTotalExpenses

      return { ...goal, current: reduction }
    }

    const metrics = buildMetrics(data, { startDate:range.start, endDate:range.end || goal.dueDate, balanceDate:goal.dueDate })
    const current = {
      faturamento:metrics.grossRevenue,
      cirurgias:metrics.surgeriesCompleted,
      consultas:metrics.consultationsCompleted,
      lucro:metrics.netProfit,
      ticket_medio:metrics.averageTicket,
      fluxo_caixa:metrics.cashBalance,
    }[goal.metric] || 0
    return { ...goal, current }
  }), [data])

  const openAdd = () => { setForm(empty); setEditing(null); setShowModal(true) }
  const openEdit = goal => { setForm({ ...goal }); setEditing(goal.id); setShowModal(true) }
  const save = () => {
    if (!form.name) return
    setData(current => ({
      ...current,
      goals: editing ? current.goals.map(goal => goal.id === editing ? { ...form, id:editing } : goal) : [...current.goals, { ...form, id:uid() }],
    }))
    setShowModal(false)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
      <div style={{ display:'flex', justifyContent:'flex-end' }}><Btn onClick={openAdd}>+ Nova Meta</Btn></div>
      {computedGoals.length === 0 && <Card><p style={{ color:C.textDim, textAlign:'center', padding:'32px 0', fontSize:14 }}>Nenhuma meta cadastrada. Clique em "+ Nova Meta".</p></Card>}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:16 }}>
        {computedGoals.map(goal => {
          const pct = goal.target > 0 ? Math.min(100, (goal.current / goal.target) * 100) : 0
          const done = goal.current >= goal.target
          const color = done ? C.green : C.accent
          const daysRemaining = computeDaysRemaining(goal.dueDate)
          const isOverdue = daysRemaining !== null && daysRemaining < 0
          const isUrgent = daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 7
          const daysColor = isOverdue ? C.red : isUrgent ? C.yellow : C.textDim
          const daysLabel = isOverdue ? 'Vencida' : daysRemaining === 0 ? 'Vence hoje' : `${daysRemaining} dia${daysRemaining !== 1 ? 's' : ''} restante${daysRemaining !== 1 ? 's' : ''}`

          return (
            <Card
              key={goal.id}
              glow={done ? C.green+'28' : color+'18'}
              style={done ? { borderColor: C.green+'44' } : {}}
            >
              <div className={done ? 'goal-achieved-card' : undefined}>
                {done && (
                  <div style={{
                    background:`linear-gradient(90deg, ${C.yellow}22, ${C.green}22, ${C.yellow}22)`,
                    border:`1px solid ${C.yellow}44`,
                    borderRadius:10,
                    padding:'8px 14px',
                    marginBottom:14,
                    display:'flex',
                    alignItems:'center',
                    gap:8,
                    fontSize:13,
                    fontWeight:700,
                    color:C.yellow,
                  }}>
                    <span style={{ fontSize:16 }}>🎯</span>
                    Meta atingida!
                    <span style={{ color:C.green, marginLeft:4 }}>✓</span>
                  </div>
                )}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
                      <Badge color={C.cyan} small>{goal.metric.replace('_', ' ')}</Badge>
                      {done && <Badge color={C.green} small>Atingida</Badge>}
                    </div>
                    <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:C.text }}>{goal.name}</h3>
                  </div>
                  <div style={{ display:'flex', gap:6, marginLeft:12 }}>
                    <Btn variant="ghost" onClick={() => openEdit(goal)} style={{ padding:'4px 10px', fontSize:12 }}>Editar</Btn>
                    <Btn variant="danger" onClick={() => setConfirmId(goal.id)} style={{ padding:'4px 10px', fontSize:12 }}>Excluir</Btn>
                  </div>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                  <div>
                    <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:3 }}>Atual</div>
                    <div style={{ fontSize:22, fontWeight:800, color }}>{displayValue(goal.metric, goal.current)}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:3 }}>Meta</div>
                    <div style={{ fontSize:22, fontWeight:800, color:C.textSub }}>{displayValue(goal.metric, goal.target)}</div>
                  </div>
                </div>
                <Progress val={pct} max={100} color={color} h={10} />
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:10 }}>
                  <span style={{ fontSize:13, fontWeight:700, color }}>{done ? 'Meta atingida' : `${pct.toFixed(1)}% concluído`}</span>
                  <div style={{ textAlign:'right' }}>
                    <span style={{ fontSize:11, color:C.textDim }}>até {goal.dueDate}</span>
                    {daysRemaining !== null && (
                      <div style={{ fontSize:11, fontWeight:600, color:daysColor, marginTop:2 }}>{daysLabel}</div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar Meta' : 'Nova Meta'}>
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <FInput label="Nome da meta" required value={form.name} onChange={value => setForm(current => ({ ...current, name:value }))} placeholder="Ex: Faturamento mensal" />
          <FInput label="Indicador" value={form.metric} onChange={value => setForm(current => ({ ...current, metric:value }))} options={METRICS} />
          <FInput label="Valor alvo" value={form.target} onChange={value => setForm(current => ({ ...current, target:value }))} type="number" placeholder="0" />
          <FInput label="Período" value={form.period} onChange={value => setForm(current => ({ ...current, period:value }))} options={[{ v:'mensal', l:'Mensal' }, { v:'trimestral', l:'Trimestral' }, { v:'anual', l:'Anual' }]} />
          <FInput label="Data limite" value={form.dueDate} onChange={value => setForm(current => ({ ...current, dueDate:value }))} type="date" />
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
            <Btn variant="ghost" onClick={() => setShowModal(false)}>Cancelar</Btn>
            <Btn onClick={save} disabled={!form.name}>Salvar meta</Btn>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={!!confirmId} onClose={() => setConfirmId(null)} onConfirm={() => setData(current => ({ ...current, goals:current.goals.filter(goal => goal.id !== confirmId) }))} />
    </div>
  )
}
