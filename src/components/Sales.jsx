import { useState } from 'react'
import { C, base } from '../theme.js'
import { fmt, formatDateBR, today, uid } from '../utils.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge } from './UI.jsx'
import { decodePaymentMethod, encodePaymentMethod } from '../lib/paymentMethodCodec.js'

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
]
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

export function Sales({ data, setData }) {
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
    procedureId:data.procedures[0]?.id || '',
    totalValue:0,
    date:today(),
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
  }

  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('todos')

  const openAdd = () => {
    setForm({ ...empty, procedureId:data.procedures[0]?.id || '' })
    setEditing(null)
    setShowModal(true)
  }

  const openEdit = item => {
    const payment = decodePaymentMethod(item.paymentMethod)
    const payment1 = payment.payments?.[0]
    const payment2 = payment.payments?.[1]
    setForm({
      ...item,
      ...payment,
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
    if (!form.patient || !form.date) return
    const procedureValue = data.procedures.find(item => item.id === form.procedureId)?.price || 0
    const resolvedTotal = form.totalValue || procedureValue
    const invoiceIssuancePercent = Math.max(0, Math.min(100, Number(form.invoiceIssuancePercent || 0)))
    const invoiceIssuanceCost = resolvedTotal * (invoiceIssuancePercent / 100)
    const totalCosts = (form.hospitalCost || 0) + (form.anesthesiaCost || 0) + (form.materialCost || 0) + (form.otherCosts || 0) + invoiceIssuanceCost
    const installmentValue = form.paymentStatus === 'parcelado' && form.installmentCount >= 2
      ? resolvedTotal / form.installmentCount
      : 0
    const payments = form.paymentScheduleMode === 'duas_datas'
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
    const mixedTotal = (form.mixAmountA || 0) + (form.mixAmountB || 0)
    if (form.paymentScheduleMode !== 'duas_datas' && form.paymentMode === 'misto' && (!form.mixMethodA || !form.mixMethodB || form.mixMethodA === form.mixMethodB || mixedTotal <= 0)) return
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
      ...baseForm
    } = form
    const nextRecord = {
      ...baseForm,
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
          <FInput label="Paciente ou ID interno" required value={form.patient} onChange={value => setForm(current => ({ ...current, patient:value }))} placeholder="Use o mínimo necessário para identificar" />
          <FInput label="Cirurgião" value={form.surgeon} onChange={value => setForm(current => ({ ...current, surgeon:value }))} placeholder="Nome do cirurgião responsável" />
          <FInput label="Procedimento" value={form.procedureId} onChange={value => setForm(current => ({ ...current, procedureId:value }))} options={data.procedures.length > 0 ? data.procedures.map(item => ({ v:item.id, l:item.name })) : [{ v:'', l:'Nenhum procedimento cadastrado' }]} />
          <FInput label="Data" value={form.date} onChange={value => setForm(current => ({ ...current, date:value }))} type="date" />
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
          {form.paymentScheduleMode !== 'duas_datas' && <FInput label="Recebimento" value={form.paymentMode} onChange={value => setForm(current => ({ ...current, paymentMode:value }))} options={PAYMENT_MODES} />}
          {form.paymentScheduleMode !== 'duas_datas' && form.paymentMode !== 'misto' && <FInput label="Forma de pagamento" value={form.paymentMethod} onChange={value => setForm(current => ({ ...current, paymentMethod:value }))} options={PAYMENT_METHODS} />}
          {form.paymentScheduleMode !== 'duas_datas' && form.paymentMode === 'misto' && (
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
            <Btn onClick={save} disabled={!form.patient}>Salvar cirurgia</Btn>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={!!confirmId} onClose={() => setConfirmId(null)} onConfirm={() => setData(current => ({ ...current, surgeries:current.surgeries.filter(item => item.id !== confirmId) }))} />
    </div>
  )
}

function MetricPill({ label, value, color }) {
  return <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:'10px 12px' }}><div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{label}</div><div style={{ fontSize:13, color, fontWeight:700 }}>{value}</div></div>
}
