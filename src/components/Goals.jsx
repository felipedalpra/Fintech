import { useMemo, useState } from 'react'
import { C } from '../theme.js'
import { getPeriodRange, today, uid, fmt, fmtN } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge, Progress } from './UI.jsx'

const METRICS = [
  { v:'faturamento', l:'Faturamento' },
  { v:'cirurgias', l:'Número de cirurgias' },
  { v:'consultas', l:'Número de consultas' },
  { v:'lucro', l:'Lucro líquido' },
  { v:'ticket_medio', l:'Ticket médio' },
  { v:'fluxo_caixa', l:'Fluxo de caixa' },
]

export function Goals({ data, setData }) {
  const empty = { name:'', metric:'faturamento', target:0, period:'mensal', dueDate:today(), isLower:false }
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmId, setConfirmId] = useState(null)

  const computedGoals = useMemo(() => data.goals.map(goal => {
    const range = getPeriodRange(goal.period === 'mensal' ? 'month' : goal.period === 'trimestral' ? 'quarter' : goal.period === 'anual' ? 'year' : 'custom', goal.period === 'personalizado' ? { start:today().slice(0, 7) + '-01', end:goal.dueDate } : {})
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
          return (
            <Card key={goal.id} glow={color+'18'}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
                    <Badge color={C.cyan} small>{goal.metric.replace('_', ' ')}</Badge>
                    {done && <Badge color={C.green} small>Atingida</Badge>}
                  </div>
                  <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:C.text }}>{goal.name}</h3>
                </div>
                <div style={{ display:'flex', gap:6, marginLeft:12 }}><Btn variant="ghost" onClick={() => openEdit(goal)} style={{ padding:'4px 10px', fontSize:12 }}>Editar</Btn><Btn variant="danger" onClick={() => setConfirmId(goal.id)} style={{ padding:'4px 10px', fontSize:12 }}>Excluir</Btn></div>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                <div><div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:3 }}>Atual</div><div style={{ fontSize:22, fontWeight:800, color }}>{goal.metric === 'cirurgias' || goal.metric === 'consultas' ? fmtN(goal.current) : fmt(goal.current)}</div></div>
                <div style={{ textAlign:'right' }}><div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:3 }}>Meta</div><div style={{ fontSize:22, fontWeight:800, color:C.textSub }}>{goal.metric === 'cirurgias' || goal.metric === 'consultas' ? fmtN(goal.target) : fmt(goal.target)}</div></div>
              </div>
              <Progress val={pct} max={100} color={color} h={10} />
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:10 }}><span style={{ fontSize:13, fontWeight:700, color }}>{done ? 'Meta atingida' : `${pct.toFixed(1)}% concluído`}</span><span style={{ fontSize:11, color:C.textDim }}>até {goal.dueDate}</span></div>
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
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}><Btn variant="ghost" onClick={() => setShowModal(false)}>Cancelar</Btn><Btn onClick={save} disabled={!form.name}>Salvar meta</Btn></div>
        </div>
      </Modal>

      <ConfirmModal open={!!confirmId} onClose={() => setConfirmId(null)} onConfirm={() => setData(current => ({ ...current, goals:current.goals.filter(goal => goal.id !== confirmId) }))} />
    </div>
  )
}
