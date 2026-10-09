import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { fmt, formatDateBR, today, uid } from '../utils.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge } from './UI.jsx'
import { decodePaymentMethod, encodePaymentMethod } from '../lib/paymentMethodCodec.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { PatientSelector } from './PatientSelector.jsx'

const PAYMENT_METHODS = [
  { v:'pix', l:'PIX' },
  { v:'cartao', l:'Cartão' },
  { v:'dinheiro', l:'Dinheiro' },
  { v:'boleto', l:'Boleto' },
  { v:'transferencia', l:'Transferência' },
]
const PAYMENT_MODES = [
  { v:'unico', l:'Único' },
  { v:'misto', l:'Misto (2 formas)' },
]
const PAYMENT_SCHEDULE_MODES = [
  { v:'unica', l:'Pagamento em 1 data' },
  { v:'duas_datas', l:'Pagamento em 2 datas' },
  { v:'parcelas', l:'Parcelado (cronograma)' },
]
const INSTALLMENT_FREQUENCIES = [
  { v:'mensal', l:'Mensal' },
  { v:'quinzenal', l:'Quinzenal' },
  { v:'semanal', l:'Semanal' },
]

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function shiftDate(dateStr, periods, frequency) {
  const raw = String(dateStr || '').trim()
  const base = raw ? new Date(`${raw}T00:00:00`) : new Date()
  if (Number.isNaN(base.getTime())) return raw
  if (frequency === 'semanal') base.setDate(base.getDate() + periods * 7)
  else if (frequency === 'quinzenal') base.setDate(base.getDate() + periods * 14)
  else base.setMonth(base.getMonth() + periods)
  const y = base.getFullYear()
  const m = String(base.getMonth() + 1).padStart(2, '0')
  const d = String(base.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function generateInstallments({ total, count, firstDate, frequency, method }) {
  const n = Math.max(1, Math.min(60, Math.floor(Number(count) || 1)))
  const totalValue = Math.max(0, Number(total) || 0)
  const base = Math.floor((totalValue / n) * 100) / 100
  const rows = []
  let accumulated = 0
  for (let i = 0; i < n; i += 1) {
    const amount = i === n - 1 ? round2(totalValue - accumulated) : base
    accumulated = round2(accumulated + amount)
    rows.push({ date:shiftDate(firstDate, i, frequency), amount, method:method || 'pix' })
  }
  return rows
}
const PAYMENT_METHOD_LABEL = {
  pix:'PIX',
  cartao:'Cartão',
  dinheiro:'Dinheiro',
  boleto:'Boleto',
  transferencia:'Transferência',
}

const PAYMENT_STATUS = [
  { v:'pago', l:'Pago' },
  { v:'pendente', l:'Pendente' },
  { v:'parcelado', l:'Parcelado' },
  { v:'cancelado', l:'Cancelado' },
]
const SALES_MODAL_DRAFT_KEY = 'surgimetrics_modal_draft_sales'

function readDraft() {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(SALES_MODAL_DRAFT_KEY) || window.sessionStorage.getItem(SALES_MODAL_DRAFT_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.form || typeof parsed.form !== 'object') return null
    return parsed
  } catch { return null }
}

export function Sales({ data, setData }) {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false
  const isNarrow = typeof window !== 'undefined' ? window.innerWidth < 380 : false
  const STATUS_COLORS = {
    pago: C.green,
    pendente: C.yellow,
    parcelado: C.cyan,
    cancelado: C.red,
  }
  const empty = {
    patient:'',
    patientId:'',
    procedureId:data.procedures[0]?.id || '',
    totalValue:0,
    date:today(),
    competenceDate:today(),
    dueDate:today(),
    startTime:'',
    durationMinutes:180,
    paymentMethod:'pix',
    paymentMode:'unico',
    paymentScheduleMode:'unica',
    payment1Date:today(),
    payment1Amount:0,
    payment1Method:'pix',
    payment2Date:today(),
    payment2Amount:0,
    payment2Method:'cartao',
    mixMethodA:'pix',
    mixMethodB:'cartao',
    mixAmountA:0,
    mixAmountB:0,
    paymentStatus:'pendente',
    surgeon:'',
    hospitalCost:0,
    anesthesiaCost:0,
    materialCost:0,
    otherCosts:0,
    invoiceIssuancePercent:0,
    paymentDate:'',
    notes:'',
    referredBy:'',
    installmentCount:2,
    installmentValue:0,
    firstInstallmentDate:'',
    schedulePayments:[],
  }

  const [form, setForm] = useState(() => {
    const draft = readDraft()
    return draft?.form ? { ...empty, ...draft.form } : empty
  })
  const [editing, setEditing] = useState(() => readDraft()?.editing || null)
  const [showModal, setShowModal] = useState(() => Boolean(readDraft()?.showModal))
  const [confirmId, setConfirmId] = useState(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('todos')
  const [installmentModal, setInstallmentModal] = useState(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!showModal) {
      window.localStorage.removeItem(SALES_MODAL_DRAFT_KEY)
      window.sessionStorage.removeItem(SALES_MODAL_DRAFT_KEY)
      return
    }
    const payload = JSON.stringify({ showModal, editing, form })
    window.localStorage.setItem(SALES_MODAL_DRAFT_KEY, payload)
    window.sessionStorage.setItem(SALES_MODAL_DRAFT_KEY, payload)
  }, [showModal, editing, form])

  useEffect(() => {
    if (editing !== null) return
    const proc = data.procedures.find(p => p.id === form.procedureId)
    if (!proc) return
    setForm(cur => cur.totalValue === 0 ? { ...cur, totalValue: proc.price } : cur)
  }, [form.procedureId, editing, data.procedures])

  const openAdd = () => {
    setForm({ ...empty, procedureId:data.procedures[0]?.id || '' })
    setEditing(null)
    setShowModal(true)
  }

  const openEdit = item => {
    const payment = decodePaymentMethod(item.paymentMethod)
    const payment1 = payment.payments?.[0]
    const payment2 = payment.payments?.[1]
    const scheduledPayments = Array.isArray(payment.payments) ? payment.payments : []
    const isScheduled = scheduledPayments.length > 2
    setForm({
      ...item,
      patientId: item.patientId || '',
      ...payment,
      paymentScheduleMode: isScheduled ? 'parcelas' : payment.paymentScheduleMode,
      schedulePayments: isScheduled ? scheduledPayments.map(p => ({ date:p.date, amount:p.amount, method:p.method })) : [],
      startTime:item.startTime || '',
      durationMinutes:item.durationMinutes || 180,
      payment1Date:payment1?.date || item.paymentDate || item.date || today(),
      payment1Amount:payment1?.amount || 0,
      payment1Method:payment1?.method || 'pix',
      payment2Date:payment2?.date || item.paymentDate || item.date || today(),
      payment2Amount:payment2?.amount || 0,
      payment2Method:payment2?.method || 'cartao',
    })
    setEditing(item.id)
    setShowModal(true)
  }

  const save = () => {
    if ((!form.patient && !form.patientId) || !form.date) return
    const procedureValue = data.procedures.find(item => item.id === form.procedureId)?.price || 0
    const resolvedTotal = form.totalValue || procedureValue
    const invoiceIssuancePercent = Math.max(0, Math.min(100, Number(form.invoiceIssuancePercent || 0)))
    const invoiceIssuanceCost = resolvedTotal * (invoiceIssuancePercent / 100)
    const totalCosts = (form.hospitalCost || 0) + (form.anesthesiaCost || 0) + (form.materialCost || 0) + (form.otherCosts || 0) + invoiceIssuanceCost
    const installmentValue = form.paymentStatus === 'parcelado' && form.installmentCount >= 2
      ? resolvedTotal / form.installmentCount
      : 0
    const payments = form.paymentScheduleMode === 'parcelas'
      ? (form.schedulePayments || []).map(p => ({ date:p.date, amount:p.amount, method:p.method || 'pix' }))
      : form.paymentScheduleMode === 'duas_datas'
        ? [
          { date:form.payment1Date, amount:form.payment1Amount, method:form.payment1Method },
          { date:form.payment2Date, amount:form.payment2Amount, method:form.payment2Method },
        ]
        : []
    const paymentMethod = encodePaymentMethod({
      paymentMode:form.paymentMode,
      paymentMethod:form.paymentMethod,
      mixMethodA:form.mixMethodA,
      mixMethodB:form.mixMethodB,
      mixAmountA:form.mixAmountA,
      mixAmountB:form.mixAmountB,
      payments,
    })
    const scheduledTotal = (form.payment1Amount || 0) + (form.payment2Amount || 0)
    if (form.paymentScheduleMode === 'duas_datas' && (
      !form.payment1Date
      || !form.payment2Date
      || !form.payment1Method
      || !form.payment2Method
      || scheduledTotal <= 0
    )) return
    if (form.paymentScheduleMode === 'parcelas' && (payments.length < 2 || payments.some(p => !p.date || !(p.amount > 0)))) return
    const mixedTotal = (form.mixAmountA || 0) + (form.mixAmountB || 0)
    if (form.paymentScheduleMode !== 'duas_datas' && form.paymentScheduleMode !== 'parcelas' && form.paymentMode === 'misto' && (!form.mixMethodA || !form.mixMethodB || form.mixMethodA === form.mixMethodB || mixedTotal <= 0)) return
    const {
      paymentMode,
      paymentScheduleMode,
      payment1Date,
      payment1Amount,
      payment1Method,
      payment2Date,
      payment2Amount,
      payment2Method,
      mixMethodA,
      mixMethodB,
      mixAmountA,
      mixAmountB,
      schedulePayments,
      ...baseForm
    } = form
    const nextRecord = {
      ...baseForm,
      patientId: form.patientId || null,
      totalValue:resolvedTotal,
      invoiceIssuancePercent,
      paymentMethod,
      paymentDate:form.paymentStatus === 'pago' ? (form.paymentDate || form.date) : '',
      netRevenue:resolvedTotal - totalCosts,
      installmentValue,
    }

    setData(current => ({
      ...current,
      surgeries: editing
        ? current.surgeries.map(item => item.id === editing ? { ...nextRecord, id:editing } : item)
        : [...current.surgeries, { ...nextRecord, id:uid() }],
    }))
    setShowModal(false)
  }

  const filtered = data.surgeries
    .filter(item => item.patient.toLowerCase().includes(search.toLowerCase()) && (filterStatus === 'todos' || item.paymentStatus === filterStatus))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  // Summary stats
  const totalAReceber = data.surgeries
    .filter(item => item.paymentStatus === 'pendente' || item.paymentStatus === 'parcelado')
    .reduce((sum, item) => sum + (item.totalValue || 0), 0)

  const totalRecebido = data.surgeries
    .filter(item => item.paymentStatus === 'pago')
    .reduce((sum, item) => sum + (item.totalValue || 0), 0)

  const surgeriesWithRevenue = data.surgeries.filter(item => item.totalValue > 0)
  const margemMedia = surgeriesWithRevenue.length > 0
    ? surgeriesWithRevenue.reduce((sum, item) => {
        const costs = (item.hospitalCost || 0) + (item.anesthesiaCost || 0) + (item.materialCost || 0) + (item.otherCosts || 0) + ((item.totalValue || 0) * ((item.invoiceIssuancePercent || 0) / 100))
        const net = (item.totalValue || 0) - costs
        return sum + (net / item.totalValue) * 100
      }, 0) / surgeriesWithRevenue.length
    : 0

  const installmentValueCalc = form.paymentStatus === 'parcelado' && form.installmentCount >= 2
    ? (form.totalValue || 0) / form.installmentCount
    : 0
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
        <input placeholder="Buscar paciente ou ID interno..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...base.input, maxWidth:isMobile ? '100%' : 280, width:isMobile ? '100%' : 'auto' }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...base.input, width:'auto' }}>
          <option value="todos">Todos</option>
          {PAYMENT_STATUS.map(s => (
            <option key={s.v} value={s.v}>{s.l}</option>
          ))}
        </select>
        <span style={{ marginLeft:isMobile ? 0 : 'auto', fontSize:13, color:C.textDim, width:isMobile ? '100%' : 'auto' }}>{filtered.length} cirurgia{filtered.length !== 1 ? 's' : ''}</span>
        <Btn onClick={openAdd}>+ Nova Cirurgia</Btn>
      </div>

      {/* Summary stats bar */}
      <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'repeat(3,minmax(0,1fr))', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, background:C.yellow+'18', border:`1px solid ${C.yellow}33`, borderRadius:12, padding:'10px 18px', flex:1, minWidth:160 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:C.yellow, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:2 }}>Total a receber</div>
            <div style={{ fontSize:18, fontWeight:700, color:C.text }}>{fmt(totalAReceber)}</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, background:C.green+'18', border:`1px solid ${C.green}33`, borderRadius:12, padding:'10px 18px', flex:1, minWidth:160 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:C.green, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:2 }}>Total recebido</div>
            <div style={{ fontSize:18, fontWeight:700, color:C.text }}>{fmt(totalRecebido)}</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, background:C.accent+'18', border:`1px solid ${C.accent}33`, borderRadius:12, padding:'10px 18px', flex:1, minWidth:160 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:C.accent, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:2 }}>Margem média</div>
            <div style={{ fontSize:18, fontWeight:700, color:C.text }}>{margemMedia.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {!isMobile && <Card style={{ padding:0, overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                {['Paciente', 'Procedimento', 'Data', 'Valor total', 'Receita líquida', 'Pagamento', 'Ações'].map(header => (
                  <th key={header} style={{ padding:'14px 18px', textAlign:'left', fontSize:11, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ padding:40, textAlign:'center', color:C.textDim, fontSize:13 }}>Nenhuma cirurgia cadastrada.</td></tr>}
              {filtered.map(item => {
                const procedure = data.procedures.find(procedureItem => procedureItem.id === item.procedureId)
                const netRevenue = (item.totalValue || 0) - ((item.hospitalCost || 0) + (item.anesthesiaCost || 0) + (item.materialCost || 0) + (item.otherCosts || 0) + ((item.totalValue || 0) * ((item.invoiceIssuancePercent || 0) / 100)))
                const statusColor = STATUS_COLORS[item.paymentStatus] || C.textDim
                const payment = decodePaymentMethod(item.paymentMethod)
                const paymentLabel = payment.paymentScheduleMode === 'duas_datas' && payment.payments.length > 0
                  ? payment.payments.map(entry => `${formatDateBR(entry.date)} · ${PAYMENT_METHOD_LABEL[entry.method] || entry.method} ${fmt(entry.amount)}`).join(' | ')
                  : payment.paymentMode === 'misto'
                    ? `${PAYMENT_METHOD_LABEL[payment.mixMethodA] || payment.mixMethodA} ${fmt(payment.mixAmountA)} + ${PAYMENT_METHOD_LABEL[payment.mixMethodB] || payment.mixMethodB} ${fmt(payment.mixAmountB)}`
                    : (PAYMENT_METHOD_LABEL[payment.paymentMethod] || payment.paymentMethod || 'Nao informado')
                const instValue = item.paymentStatus === 'parcelado' && item.installmentCount >= 2
                  ? (item.installmentValue || (item.totalValue / item.installmentCount))
                  : null
                return (
                  <tr key={item.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                    <td style={{ padding:'13px 18px' }}>
                      <div style={{ color:C.text, fontWeight:600 }}>{item.patient}</div>
                      {item.referredBy && (
                        <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>via {item.referredBy}</div>
                      )}
                    </td>
                    <td style={{ padding:'13px 18px' }}><Badge color={procedure?.color || C.textDim} small>{procedure?.name || 'Sem procedimento'}</Badge></td>
                    <td style={{ padding:'13px 18px', color:C.textSub }}>{formatDateBR(item.date)}</td>
                    <td style={{ padding:'13px 18px', color:C.green, fontWeight:700 }}>{fmt(item.totalValue)}</td>
                    <td style={{ padding:'13px 18px', color:netRevenue >= 0 ? C.accent : C.red, fontWeight:700 }}>{fmt(netRevenue)}</td>
                    <td style={{ padding:'13px 18px' }}>
                      <Badge color={statusColor} small>{item.paymentStatus}</Badge>
                      <div style={{ fontSize:11, color:C.textDim, marginTop:3 }}>
                        {paymentLabel}
                      </div>
                      {item.paymentStatus === 'parcelado' && item.installmentCount >= 2 && instValue !== null && (
                        <div style={{ fontSize:11, color:C.textDim, marginTop:3 }}>{item.installmentCount}x de {fmt(instValue)}</div>
                      )}
                    </td>
                    <td style={{ padding:'13px 18px' }}><div style={{ display:'flex', gap:8 }}><Btn variant="ghost" onClick={() => openEdit(item)} style={{ padding:'5px 12px', fontSize:12 }}>Editar</Btn><Btn variant="danger" onClick={() => setConfirmId(item.id)} style={{ padding:'5px 12px', fontSize:12 }}>Excluir</Btn></div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>}

      {isMobile && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.length === 0 && <Card><div style={{ color:C.textDim, fontSize:13, textAlign:'center' }}>Nenhuma cirurgia cadastrada.</div></Card>}
          {filtered.map(item => {
            const procedure = data.procedures.find(procedureItem => procedureItem.id === item.procedureId)
            const netRevenue = (item.totalValue || 0) - ((item.hospitalCost || 0) + (item.anesthesiaCost || 0) + (item.materialCost || 0) + (item.otherCosts || 0) + ((item.totalValue || 0) * ((item.invoiceIssuancePercent || 0) / 100)))
            const statusColor = STATUS_COLORS[item.paymentStatus] || C.textDim
            const payment = decodePaymentMethod(item.paymentMethod)
            const paymentLabel = payment.paymentScheduleMode === 'duas_datas' && payment.payments.length > 0
              ? payment.payments.map(entry => `${formatDateBR(entry.date)} · ${PAYMENT_METHOD_LABEL[entry.method] || entry.method} ${fmt(entry.amount)}`).join(' | ')
              : payment.paymentMode === 'misto'
                ? `${PAYMENT_METHOD_LABEL[payment.mixMethodA] || payment.mixMethodA} ${fmt(payment.mixAmountA)} + ${PAYMENT_METHOD_LABEL[payment.mixMethodB] || payment.mixMethodB} ${fmt(payment.mixAmountB)}`
                : (PAYMENT_METHOD_LABEL[payment.paymentMethod] || payment.paymentMethod || 'Nao informado')
            const instValue = item.paymentStatus === 'parcelado' && item.installmentCount >= 2
              ? (item.installmentValue || (item.totalValue / item.installmentCount))
              : null

            return (
              <Card key={item.id} style={{ padding:14 }}>
                <div style={{ color:C.text, fontWeight:700 }}>{item.patient}</div>
                {item.referredBy && <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>via {item.referredBy}</div>}
                <div style={{ display:'grid', gridTemplateColumns:isNarrow ? '1fr' : '1fr 1fr', gap:8, marginTop:10 }}>
                  <MetricPill label="Procedimento" value={procedure?.name || 'Sem procedimento'} color={procedure?.color || C.textSub} />
                  <MetricPill label="Data" value={formatDateBR(item.date)} color={C.textSub} />
                  <MetricPill label="Valor total" value={fmt(item.totalValue)} color={C.green} />
                  <MetricPill label="Receita líquida" value={fmt(netRevenue)} color={netRevenue >= 0 ? C.accent : C.red} />
                  <MetricPill label="Pagamento" value={item.paymentStatus} color={statusColor} />
                  <MetricPill label="Forma" value={paymentLabel} color={C.textSub} />
                  {instValue !== null && <MetricPill label="Parcelas" value={`${item.installmentCount}x de ${fmt(instValue)}`} color={C.cyan} />}
                </div>
                <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
                  <Btn variant="ghost" onClick={() => openEdit(item)} style={{ padding:'5px 12px', fontSize:12, width:isNarrow ? '100%' : 'auto' }}>Editar</Btn>
                  <Btn variant="danger" onClick={() => setConfirmId(item.id)} style={{ padding:'5px 12px', fontSize:12, width:isNarrow ? '100%' : 'auto' }}>Excluir</Btn>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar Cirurgia' : 'Nova Cirurgia'} width={720}>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1fr 1fr', gap:16 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <PatientSelector
              userId={ownerId || user?.id}
              value={form.patientId}
              onChange={(id, name) => setForm(current => ({ ...current, patientId: id, patient: name || current.patient }))}
            />
          </div>
          <FInput label="Identificador interno (opcional)" value={form.patient} onChange={value => setForm(current => ({ ...current, patient:value }))} placeholder="Apelido, código ou observação" />
          <FInput label="Cirurgião" value={form.surgeon} onChange={value => setForm(current => ({ ...current, surgeon:value }))} placeholder="Nome do cirurgião responsável" />
          <FInput label="Procedimento" value={form.procedureId} onChange={value => setForm(current => ({ ...current, procedureId:value, totalValue:0 }))} options={data.procedures.length > 0 ? data.procedures.map(item => ({ v:item.id, l:item.name })) : [{ v:'', l:'Nenhum procedimento cadastrado' }]} />
          <FInput label="Data da cirurgia (competência)" value={form.date} onChange={value => setForm(current => ({ ...current, date:value, competenceDate:value, dueDate:current.dueDate || value }))} type="date" />
          <FInput label="Vencimento (previsão de recebimento)" value={form.dueDate || form.date} onChange={value => setForm(current => ({ ...current, dueDate:value }))} type="date" />
          <FInput label="Horário (opcional)" value={form.startTime} onChange={value => setForm(current => ({ ...current, startTime:value }))} type="time" />
          <FInput label="Duração (min)" value={form.durationMinutes} onChange={value => setForm(current => ({ ...current, durationMinutes:value }))} type="number" placeholder="180" />
          <FInput label="Valor total" value={form.totalValue} onChange={value => setForm(current => ({ ...current, totalValue:value }))} type="number" placeholder="0" />
          <FInput label="Configuração de pagamento" value={form.paymentScheduleMode} onChange={value => setForm(current => ({ ...current, paymentScheduleMode:value }))} options={PAYMENT_SCHEDULE_MODES} />
          {form.paymentScheduleMode === 'duas_datas' && (
            <>
              <FInput label="Data pagamento 1" value={form.payment1Date} onChange={value => setForm(current => ({ ...current, payment1Date:value }))} type="date" />
              <FInput label="Forma pagamento 1" value={form.payment1Method} onChange={value => setForm(current => ({ ...current, payment1Method:value }))} options={PAYMENT_METHODS} />
              <FInput label="Valor pago 1" value={form.payment1Amount} onChange={value => setForm(current => ({ ...current, payment1Amount:value }))} type="number" placeholder="0" />
              <div />
              <FInput label="Data pagamento 2" value={form.payment2Date} onChange={value => setForm(current => ({ ...current, payment2Date:value }))} type="date" />
              <FInput label="Forma pagamento 2" value={form.payment2Method} onChange={value => setForm(current => ({ ...current, payment2Method:value }))} options={PAYMENT_METHODS} />
              <FInput label="Valor pago 2" value={form.payment2Amount} onChange={value => setForm(current => ({ ...current, payment2Amount:value }))} type="number" placeholder="0" />
              <div />
            </>
          )}
          {form.paymentScheduleMode === 'parcelas' && (
            <div style={{ gridColumn:'1 / -1', border:`1px solid ${C.border}`, borderRadius:12, padding:14, background:C.surface }}>
              {(form.schedulePayments || []).length > 0 ? (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:8 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{form.schedulePayments.length} parcelas · {fmt(form.schedulePayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0))}</div>
                    <Btn variant="ghost" style={{ padding:'5px 12px', fontSize:12 }} onClick={() => setInstallmentModal({ rows:form.schedulePayments.map(p => ({ ...p })), count:form.schedulePayments.length, frequency:'mensal', firstDate:form.schedulePayments[0]?.date || form.date, method:form.schedulePayments[0]?.method || 'pix' })}>Editar parcelas</Btn>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:140, overflowY:'auto' }}>
                    {form.schedulePayments.map((p, i) => (
                      <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:C.textSub, borderTop:i ? `1px solid ${C.border}44` : 'none', paddingTop:i ? 4 : 0 }}>
                        <span>{i + 1}ª · {formatDateBR(p.date)} · {PAYMENT_METHOD_LABEL[p.method] || p.method}</span>
                        <span style={{ fontWeight:700, color:C.text }}>{fmt(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                  {Math.abs(form.schedulePayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0) - (Number(form.totalValue) || 0)) > 0.01 && (
                    <div style={{ fontSize:12, color:C.yellow, marginTop:8 }}>Soma das parcelas difere do valor total ({fmt(form.totalValue)}).</div>
                  )}
                </>
              ) : (
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <span style={{ fontSize:13, color:C.textSub }}>Nenhuma parcela configurada ainda.</span>
                  <Btn style={{ padding:'6px 14px', fontSize:12 }} onClick={() => setInstallmentModal({ rows:[], count:3, frequency:'mensal', firstDate:form.date || today(), method:'pix' })}>Configurar parcelas</Btn>
                </div>
              )}
            </div>
          )}
          {form.paymentScheduleMode !== 'duas_datas' && form.paymentScheduleMode !== 'parcelas' && <FInput label="Recebimento" value={form.paymentMode} onChange={value => setForm(current => ({ ...current, paymentMode:value }))} options={PAYMENT_MODES} />}
          {form.paymentScheduleMode !== 'duas_datas' && form.paymentScheduleMode !== 'parcelas' && form.paymentMode !== 'misto' && <FInput label="Forma de pagamento" value={form.paymentMethod} onChange={value => setForm(current => ({ ...current, paymentMethod:value }))} options={PAYMENT_METHODS} />}
          {form.paymentScheduleMode !== 'duas_datas' && form.paymentScheduleMode !== 'parcelas' && form.paymentMode === 'misto' && (
            <>
              <FInput label="Forma 1" value={form.mixMethodA} onChange={value => setForm(current => ({ ...current, mixMethodA:value }))} options={PAYMENT_METHODS} />
              <FInput label="Valor 1" value={form.mixAmountA} onChange={value => setForm(current => ({ ...current, mixAmountA:value }))} type="number" placeholder="0" />
              <FInput label="Forma 2" value={form.mixMethodB} onChange={value => setForm(current => ({ ...current, mixMethodB:value }))} options={PAYMENT_METHODS} />
              <FInput label="Valor 2" value={form.mixAmountB} onChange={value => setForm(current => ({ ...current, mixAmountB:value }))} type="number" placeholder="0" />
              <div style={{ gridColumn:'1 / -1', marginTop:-6, color:C.textDim, fontSize:12 }}>
                Preencha manualmente os dois valores (ex.: metade PIX e metade Cartão).
              </div>
            </>
          )}
          <FInput label="Status do pagamento" value={form.paymentStatus} onChange={value => setForm(current => ({ ...current, paymentStatus:value }))} options={PAYMENT_STATUS} />
          <FInput label="Data do recebimento" value={form.paymentDate} onChange={value => setForm(current => ({ ...current, paymentDate:value }))} type="date" />
          {form.paymentStatus === 'parcelado' && (
            <>
              <FInput label="Número de parcelas" value={form.installmentCount} onChange={value => setForm(current => ({ ...current, installmentCount:Math.min(48, Math.max(2, value)) }))} type="number" placeholder="2" />
              <div style={{ display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
                <label style={{ ...base.label }}>Valor por parcela</label>
                <div style={{ ...base.input, color:C.textSub, display:'flex', alignItems:'center' }}>
                  {fmt(installmentValueCalc)}
                </div>
              </div>
              <div style={{ gridColumn:'1 / -1' }}>
                <FInput label="Data da primeira parcela" value={form.firstInstallmentDate} onChange={value => setForm(current => ({ ...current, firstInstallmentDate:value }))} type="date" />
              </div>
            </>
          )}
          <FInput label="Custo hospital" value={form.hospitalCost} onChange={value => setForm(current => ({ ...current, hospitalCost:value }))} type="number" placeholder="0" />
          <FInput label="Custo anestesia" value={form.anesthesiaCost} onChange={value => setForm(current => ({ ...current, anesthesiaCost:value }))} type="number" placeholder="0" />
          <FInput label="Custo material" value={form.materialCost} onChange={value => setForm(current => ({ ...current, materialCost:value }))} type="number" placeholder="0" />
          <FInput label="Custo outros" value={form.otherCosts} onChange={value => setForm(current => ({ ...current, otherCosts:value }))} type="number" placeholder="0" />
          <FInput label="Emissão NF (%)" value={form.invoiceIssuancePercent} onChange={value => setForm(current => ({ ...current, invoiceIssuancePercent:value }))} type="number" placeholder="0" />
          <div style={{ gridColumn:'1 / -1' }}>
            <FInput label="Observações operacionais" value={form.notes} onChange={value => setForm(current => ({ ...current, notes:value }))} placeholder="Evite inserir dados clínicos sensíveis" />
          </div>
          <div style={{ gridColumn:'1 / -1' }}>
            <FInput label="Indicado por (opcional)" value={form.referredBy} onChange={value => setForm(current => ({ ...current, referredBy:value }))} placeholder="Ex: Paciente anterior, Instagram, Google..." />
          </div>
          <div style={{ gridColumn:'1 / -1', display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
            <Btn variant="ghost" onClick={() => setShowModal(false)}>Cancelar</Btn>
            <Btn onClick={save} disabled={!form.patient && !form.patientId}>Salvar cirurgia</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={!!installmentModal} onClose={() => setInstallmentModal(null)} title="Parcelas do pagamento">
        {installmentModal && (() => {
          const rows = installmentModal.rows || []
          const rowsTotal = rows.reduce((acc, p) => acc + (Number(p.amount) || 0), 0)
          const target = Number(form.totalValue) || 0
          const diff = round2(rowsTotal - target)
          const updateRow = (i, patch) => setInstallmentModal(cur => ({ ...cur, rows:cur.rows.map((r, idx) => idx === i ? { ...r, ...patch } : r) }))
          return (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <FInput label="Número de parcelas" type="number" value={installmentModal.count} onChange={value => setInstallmentModal(cur => ({ ...cur, count:value }))} />
                <FInput label="Frequência" value={installmentModal.frequency} onChange={value => setInstallmentModal(cur => ({ ...cur, frequency:value }))} options={INSTALLMENT_FREQUENCIES} />
                <FInput label="Data da 1ª parcela" type="date" value={installmentModal.firstDate} onChange={value => setInstallmentModal(cur => ({ ...cur, firstDate:value }))} />
                <FInput label="Forma de pagamento" value={installmentModal.method} onChange={value => setInstallmentModal(cur => ({ ...cur, method:value }))} options={PAYMENT_METHODS} />
              </div>
              <Btn variant="ghost" onClick={() => setInstallmentModal(cur => ({ ...cur, rows:generateInstallments({ total:target, count:cur.count, firstDate:cur.firstDate, frequency:cur.frequency, method:cur.method }) }))}>
                Gerar {Math.max(1, Math.min(60, Math.floor(Number(installmentModal.count) || 1)))} parcelas de {fmt(target / Math.max(1, Math.min(60, Math.floor(Number(installmentModal.count) || 1))))}
              </Btn>
              {rows.length > 0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:280, overflowY:'auto' }}>
                  {rows.map((row, i) => (
                    <div key={i} style={{ display:'grid', gridTemplateColumns:'24px 1.1fr 1fr 1fr 28px', gap:8, alignItems:'end' }}>
                      <div style={{ fontSize:12, color:C.textDim, paddingBottom:12 }}>{i + 1}</div>
                      <FInput label={i === 0 ? 'Vencimento' : ''} type="date" value={row.date} onChange={value => updateRow(i, { date:value })} />
                      <FInput label={i === 0 ? 'Valor' : ''} type="number" value={row.amount} onChange={value => updateRow(i, { amount:value })} />
                      <FInput label={i === 0 ? 'Forma' : ''} value={row.method} onChange={value => updateRow(i, { method:value })} options={PAYMENT_METHODS} />
                      <Btn variant="ghost" style={{ padding:'8px 8px', fontSize:12 }} onClick={() => setInstallmentModal(cur => ({ ...cur, rows:cur.rows.filter((_, idx) => idx !== i) }))}>×</Btn>
                    </div>
                  ))}
                  <Btn variant="ghost" style={{ fontSize:12 }} onClick={() => setInstallmentModal(cur => ({ ...cur, rows:[...cur.rows, { date:cur.rows.length ? shiftDate(cur.rows[cur.rows.length - 1].date, 1, cur.frequency) : (cur.firstDate || today()), amount:0, method:cur.method || 'pix' }] }))}>+ Adicionar parcela</Btn>
                </div>
              )}
              {rows.length > 0 && (
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:Math.abs(diff) > 0.01 ? C.yellow : C.green, fontWeight:700 }}>
                  <span>Soma das parcelas: {fmt(rowsTotal)}</span>
                  <span>{Math.abs(diff) > 0.01 ? `Diferença: ${fmt(diff)}` : 'Confere com o total'}</span>
                </div>
              )}
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <Btn variant="ghost" onClick={() => setInstallmentModal(null)}>Cancelar</Btn>
                <Btn disabled={rows.length < 2 || rows.some(r => !r.date || !(Number(r.amount) > 0))} onClick={() => {
                  setForm(current => ({ ...current, schedulePayments:rows.map(r => ({ date:r.date, amount:round2(r.amount), method:r.method || 'pix' })) }))
                  setInstallmentModal(null)
                }}>Salvar parcelas</Btn>
              </div>
            </div>
          )
        })()}
      </Modal>

      <ConfirmModal open={!!confirmId} onClose={() => setConfirmId(null)} onConfirm={() => setData(current => ({ ...current, surgeries:current.surgeries.filter(item => item.id !== confirmId) }))} />
    </div>
  )
}

function MetricPill({ label, value, color }) {
  return <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:'10px 12px' }}><div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{label}</div><div style={{ fontSize:13, color, fontWeight:700 }}>{value}</div></div>
}
