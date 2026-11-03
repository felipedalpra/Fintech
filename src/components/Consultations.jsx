import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { fmt, formatDateBR, today, uid } from '../utils.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge } from './UI.jsx'
import { FilterBar } from './FilterBar.jsx'
import { decodePaymentMethod } from '../lib/paymentMethodCodec.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { PatientSelector } from './PatientSelector.jsx'
import { ClinicalCostSettlementFields } from './ClinicalCostSettlementFields.jsx'
import { withClinicalCostSettlementDefaults } from '../lib/clinicalCosts.js'
import {
  CONSULTATION_INSTALLMENT_FREQUENCIES,
  generateConsultationInstallments,
  prepareConsultationPayment,
  roundPaymentAmount,
  shiftInstallmentDate,
} from '../lib/consultationPayments.js'
import { hasRecognizedReceipt } from '../lib/receivablePaymentReversal.js'

const TYPES = [
  { v:'avaliacao', l:'Avaliação' },
  { v:'retorno', l:'Retorno' },
  { v:'pos_operatorio', l:'Pós-operatório' },
  { v:'procedimento_estetico', l:'Procedimento estético' },
]

const PAYMENT_TYPES = [
  { v:'particular', l:'Particular' },
  { v:'unimed', l:'Unimed' },
  { v:'ipe', l:'IPE' },
  { v:'outros_convenios', l:'Outros convênios' },
]
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
const PAYMENT_METHOD_LABEL = {
  pix:'PIX',
  cartao:'Cartão',
  dinheiro:'Dinheiro',
  boleto:'Boleto',
  transferencia:'Transferência',
}

const STATUSES = [
  { v:'pago', l:'Pago' },
  { v:'pendente', l:'Pendente' },
  { v:'parcelado', l:'Parcelado' },
  { v:'glosado', l:'Glosado' },
  { v:'cancelado', l:'Cancelado' },
]
const CONSULTATIONS_MODAL_DRAFT_KEY = 'surgimetrics_modal_draft_consultations'

function readDraft() {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(CONSULTATIONS_MODAL_DRAFT_KEY) || window.sessionStorage.getItem(CONSULTATIONS_MODAL_DRAFT_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.form || typeof parsed.form !== 'object') return null
    return parsed
  } catch { return null }
}

export function Consultations({ data, setData, saveDataNow }) {
  // Blindagem (Fase 3): grava imediato e confirmado; erro vai pro banner; fallback setData.
  const persist = updater => { const r = (saveDataNow || setData)(updater); if (r && r.catch) r.catch(() => {}) }
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false
  const isNarrow = typeof window !== 'undefined' ? window.innerWidth < 380 : false
  const empty = {
    patient:'',
    patientId:'',
    date:today(),
    competenceDate:today(),
    startTime:'',
    durationMinutes:60,
    consultationType:'avaliacao',
    value:0,
    invoiceIssuancePercent:0,
    costSettlements:{},
    paymentType:'particular',
    paymentMethod:'pix',
    paymentMode:'unico',
    paymentScheduleMode:'unica',
    payment1Date:today(),
    payment1Amount:0,
    payment1Method:'pix',
    payment2Date:today(),
    payment2Amount:0,
    payment2Method:'cartao',
    schedulePayments:[],
    mixMethodA:'pix',
    mixMethodB:'cartao',
    mixAmountA:0,
    mixAmountB:0,
    insurance:'',
    paymentStatus:'pendente',
    forecastPaymentDate:'',
    paymentDate:'',
  }

  const [form, setForm] = useState(() => {
    const draft = readDraft()
    return draft?.form ? { ...empty, ...draft.form } : empty
  })
  const [editing, setEditing] = useState(() => readDraft()?.editing || null)
  const [showModal, setShowModal] = useState(() => Boolean(readDraft()?.showModal))
  const [confirmId, setConfirmId] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('todos') // paymentStatus
  const [sortBy, setSortBy] = useState('recentes')          // 'recentes' | 'antigas' | 'valor'
  const [installmentModal, setInstallmentModal] = useState(null)
  const editingRecord = editing ? data.consultations.find(item => item.id === editing) : null
  const paymentLocked = hasRecognizedReceipt(editingRecord)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!showModal) {
      window.localStorage.removeItem(CONSULTATIONS_MODAL_DRAFT_KEY)
      window.sessionStorage.removeItem(CONSULTATIONS_MODAL_DRAFT_KEY)
      return
    }
    const payload = JSON.stringify({ showModal, editing, form })
    window.localStorage.setItem(CONSULTATIONS_MODAL_DRAFT_KEY, payload)
    window.sessionStorage.setItem(CONSULTATIONS_MODAL_DRAFT_KEY, payload)
  }, [showModal, editing, form])

  const openAdd = () => { setForm(empty); setEditing(null); setShowModal(true) }
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
      paymentScheduleMode:isScheduled ? 'parcelas' : payment.paymentScheduleMode,
      schedulePayments:isScheduled ? scheduledPayments.map(item => ({ ...item })) : [],
      startTime:item.startTime || '',
      durationMinutes:item.durationMinutes || 60,
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
    const totalValue = Math.max(0, Number(form.value || 0))
    const preparedPayment = prepareConsultationPayment(form, totalValue)
    if (!paymentLocked && !preparedPayment.scheduleValid) return
    const mixedTotal = (form.mixAmountA || 0) + (form.mixAmountB || 0)
    if (!paymentLocked && !preparedPayment.scheduled && form.paymentMode === 'misto' && (!form.mixMethodA || !form.mixMethodB || form.mixMethodA === form.mixMethodB || mixedTotal <= 0)) return
    const {
      paymentMode,
      paymentScheduleMode,
      payment1Date,
      payment1Amount:_payment1Amount,
      payment1Method,
      payment2Date,
      payment2Amount:_payment2Amount,
      payment2Method,
      schedulePayments,
      mixMethodA,
      mixMethodB,
      mixAmountA,
      mixAmountB,
      ...baseForm
    } = form
    const nextRecord = withClinicalCostSettlementDefaults({
      ...baseForm,
      value:paymentLocked ? editingRecord.value : baseForm.value,
      patientId: form.patientId || null,
      invoiceIssuancePercent:Math.max(0, Math.min(100, Number(form.invoiceIssuancePercent || 0))),
      insurance:form.paymentType === 'particular' ? '' : form.insurance,
      paymentMethod:paymentLocked ? editingRecord.paymentMethod : preparedPayment.paymentMethod,
      competenceDate:preparedPayment.competenceDate,
      dueDate:paymentLocked ? editingRecord.dueDate : preparedPayment.dueDate,
      forecastPaymentDate:paymentLocked ? editingRecord.forecastPaymentDate : preparedPayment.forecastPaymentDate,
      paymentDate:paymentLocked ? editingRecord.paymentDate : preparedPayment.paymentDate,
      paymentStatus:paymentLocked ? editingRecord.paymentStatus : baseForm.paymentStatus,
    }, 'consultation')
    persist(current => ({
      ...current,
      consultations: editing
        ? current.consultations.map(item => {
          if (item.id !== editing) return item
          if (!hasRecognizedReceipt(item)) return { ...nextRecord, id:editing }
          return {
            ...nextRecord,
            id:editing,
            value:item.value,
            paymentMethod:item.paymentMethod,
            paymentStatus:item.paymentStatus,
            dueDate:item.dueDate,
            forecastPaymentDate:item.forecastPaymentDate,
            paymentDate:item.paymentDate,
            receivedDate:item.receivedDate,
            receiptSettlements:item.receiptSettlements,
          }
        })
        : [...current.consultations, { ...nextRecord, id:uid() }],
    }))
    setShowModal(false)
  }

  const filtered = data.consultations
    .filter(item => item.patient.toLowerCase().includes(search.toLowerCase()))
    .filter(item => statusFilter === 'todos' || item.paymentStatus === statusFilter)
    .sort((a, b) => {
      if (sortBy === 'valor') return (b.value || 0) - (a.value || 0)
      const cmp = (a.date || '').localeCompare(b.date || '')
      return sortBy === 'antigas' ? cmp : -cmp
    })
  const preparedPayment = prepareConsultationPayment(form, form.value)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <FilterBar
        isMobile={isMobile}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Buscar paciente ou ID interno…"
        selects={[
          { label:'Pagamento', value:statusFilter, onChange:setStatusFilter, options:[
            { v:'todos', l:'Todos' }, { v:'pago', l:'Pago' }, { v:'pendente', l:'Pendente' }, { v:'parcelado', l:'Parcelado' },
          ] },
          { label:'Ordenar', value:sortBy, onChange:setSortBy, options:[
            { v:'recentes', l:'Mais recentes' }, { v:'antigas', l:'Mais antigas' }, { v:'valor', l:'Maior valor' },
          ] },
        ]}
        count={filtered.length}
        countLabel="consulta"
        onClear={() => { setSearch(''); setStatusFilter('todos'); setSortBy('recentes') }}
        right={<Btn onClick={openAdd}>+ Nova Consulta</Btn>}
      />

      {!isMobile && <Card style={{ padding:0, overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr style={{ borderBottom:`1px solid ${C.border}` }}>{['Paciente', 'Data', 'Tipo', 'Pagamento', 'Valor', 'Líquido', 'Status', 'Ações'].map(header => <th key={header} style={{ padding:'14px 18px', textAlign:'left', fontSize:11, color:C.textSub, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>{header}</th>)}</tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ padding:40, textAlign:'center', color:C.textDim, fontSize:13 }}>Nenhuma consulta cadastrada.</td></tr>}
              {filtered.map(item => {
                const payment = decodePaymentMethod(item.paymentMethod)
                const netValue = (item.value || 0) - ((item.value || 0) * ((item.invoiceIssuancePercent || 0) / 100))
                const paymentLabel = payment.paymentScheduleMode === 'duas_datas' && payment.payments.length > 0
                  ? payment.payments.map(entry => `${formatDateBR(entry.date)} · ${PAYMENT_METHOD_LABEL[entry.method] || entry.method} ${fmt(entry.amount)}`).join(' | ')
                  : payment.paymentMode === 'misto'
                    ? `${PAYMENT_METHOD_LABEL[payment.mixMethodA] || payment.mixMethodA} ${fmt(payment.mixAmountA)} + ${PAYMENT_METHOD_LABEL[payment.mixMethodB] || payment.mixMethodB} ${fmt(payment.mixAmountB)}`
                    : (PAYMENT_METHOD_LABEL[payment.paymentMethod] || payment.paymentMethod || 'Nao informado')
                return (
                  <tr key={item.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                    <td style={{ padding:'13px 18px', color:C.text, fontWeight:600 }}>{item.patient}</td>
                    <td style={{ padding:'13px 18px', color:C.textSub }}>{formatDateBR(item.date)}</td>
                    <td style={{ padding:'13px 18px', color:C.textSub }}>{item.consultationType}</td>
                    <td style={{ padding:'13px 18px', color:C.textSub }}>
                      <div>{item.paymentType === 'particular' ? 'Particular' : item.insurance || item.paymentType}</div>
                      <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>{paymentLabel}</div>
                      <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>NF {item.invoiceIssuancePercent || 0}%</div>
                    </td>
                    <td style={{ padding:'13px 18px', color:C.green, fontWeight:700 }}>{fmt(item.value)}</td>
                    <td style={{ padding:'13px 18px', color:netValue >= 0 ? C.accent : C.red, fontWeight:700 }}>{fmt(netValue)}</td>
                    <td style={{ padding:'13px 18px' }}><Badge color={item.paymentStatus === 'pago' ? C.green : item.paymentStatus === 'glosado' ? C.red : C.yellow} small>{item.paymentStatus}</Badge></td>
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
          {filtered.length === 0 && <Card><div style={{ color:C.textDim, fontSize:13, textAlign:'center' }}>Nenhuma consulta cadastrada.</div></Card>}
          {filtered.map(item => {
            const payment = decodePaymentMethod(item.paymentMethod)
            const netValue = (item.value || 0) - ((item.value || 0) * ((item.invoiceIssuancePercent || 0) / 100))
            const paymentLabel = payment.paymentScheduleMode === 'duas_datas' && payment.payments.length > 0
              ? payment.payments.map(entry => `${formatDateBR(entry.date)} · ${PAYMENT_METHOD_LABEL[entry.method] || entry.method} ${fmt(entry.amount)}`).join(' | ')
              : payment.paymentMode === 'misto'
                ? `${PAYMENT_METHOD_LABEL[payment.mixMethodA] || payment.mixMethodA} ${fmt(payment.mixAmountA)} + ${PAYMENT_METHOD_LABEL[payment.mixMethodB] || payment.mixMethodB} ${fmt(payment.mixAmountB)}`
                : (PAYMENT_METHOD_LABEL[payment.paymentMethod] || payment.paymentMethod || 'Nao informado')
            return (
              <Card key={item.id} style={{ padding:14 }}>
                <div style={{ color:C.text, fontWeight:700 }}>{item.patient}</div>
                <div style={{ display:'grid', gridTemplateColumns:isNarrow ? '1fr' : '1fr 1fr', gap:8, marginTop:10 }}>
                  <MetricPill label="Data" value={formatDateBR(item.date)} color={C.textSub} />
                  <MetricPill label="Tipo" value={item.consultationType} color={C.textSub} />
                  <MetricPill label="Convênio" value={item.paymentType === 'particular' ? 'Particular' : item.insurance || item.paymentType} color={C.textSub} />
                  <MetricPill label="Forma" value={paymentLabel} color={C.textSub} />
                  <MetricPill label="NF" value={`${item.invoiceIssuancePercent || 0}%`} color={C.textSub} />
                  <MetricPill label="Valor" value={fmt(item.value)} color={C.green} />
                  <MetricPill label="Líquido" value={fmt(netValue)} color={netValue >= 0 ? C.accent : C.red} />
                  <MetricPill label="Status" value={item.paymentStatus} color={item.paymentStatus === 'pago' ? C.green : item.paymentStatus === 'glosado' ? C.red : C.yellow} />
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar Consulta' : 'Nova Consulta'} width={720}>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1fr 1fr', gap:16 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <PatientSelector
              userId={ownerId || user?.id}
              value={form.patientId}
              onChange={(id, name) => setForm(current => ({ ...current, patientId: id, patient: name || current.patient }))}
            />
          </div>
          <FInput label="Identificador interno (opcional)" value={form.patient} onChange={value => setForm(current => ({ ...current, patient:value }))} placeholder="Apelido, código ou observação" />
          <FInput label="Data da consulta (competência)" value={form.date} onChange={value => setForm(current => ({ ...current, date:value, competenceDate:value }))} type="date" />
          <FInput label="Horário (opcional)" value={form.startTime} onChange={value => setForm(current => ({ ...current, startTime:value }))} type="time" />
          <FInput label="Duração (min)" value={form.durationMinutes} onChange={value => setForm(current => ({ ...current, durationMinutes:value }))} type="number" placeholder="60" />
          <FInput label="Tipo de consulta" value={form.consultationType} onChange={value => setForm(current => ({ ...current, consultationType:value }))} options={TYPES} />
          {!paymentLocked
            ? <FInput label="Valor" value={form.value} onChange={value => setForm(current => ({ ...current, value:value }))} type="number" placeholder="0" />
            : <div><label style={{ ...base.label }}>Valor</label><div style={{ ...base.input, display:'flex', alignItems:'center', color:C.textSub }}>{fmt(editingRecord.value)}</div></div>}
          <FInput label="Emissão NF (%)" value={form.invoiceIssuancePercent} onChange={value => setForm(current => ({ ...current, invoiceIssuancePercent:value }))} type="number" placeholder="0" />
          <ClinicalCostSettlementFields sourceType="consultation" form={form} setForm={setForm} />
          <FInput label="Forma / convênio" value={form.paymentType} onChange={value => setForm(current => ({ ...current, paymentType:value }))} options={PAYMENT_TYPES} />
          <FInput label="Convênio" value={form.insurance} onChange={value => setForm(current => ({ ...current, insurance:value }))} placeholder="Nome do convênio" />
          {!paymentLocked && <FInput label="Configuração de pagamento" value={form.paymentScheduleMode} onChange={value => setForm(current => ({ ...current, paymentScheduleMode:value }))} options={PAYMENT_SCHEDULE_MODES} />}
          {paymentLocked && <div style={{ gridColumn:'1 / -1', border:`1px solid ${C.yellow}55`, background:`${C.yellow}12`, color:C.textSub, borderRadius:12, padding:14, fontSize:12 }}>
            O cronograma e o status financeiro estão bloqueados porque esta consulta já possui recebimento registrado. Isso preserva o histórico do caixa; as demais informações da consulta continuam editáveis.
          </div>}
          {!paymentLocked && form.paymentScheduleMode === 'duas_datas' && (
            <>
              <FInput label="Vencimento 1" value={form.payment1Date} onChange={value => setForm(current => ({ ...current, payment1Date:value }))} type="date" />
              <FInput label="Forma da parcela 1" value={form.payment1Method} onChange={value => setForm(current => ({ ...current, payment1Method:value }))} options={PAYMENT_METHODS} />
              <FInput label="Valor da parcela 1" value={form.payment1Amount} onChange={value => setForm(current => ({ ...current, payment1Amount:value }))} type="number" placeholder="0" />
              <div />
              <FInput label="Vencimento 2" value={form.payment2Date} onChange={value => setForm(current => ({ ...current, payment2Date:value }))} type="date" />
              <FInput label="Forma da parcela 2" value={form.payment2Method} onChange={value => setForm(current => ({ ...current, payment2Method:value }))} options={PAYMENT_METHODS} />
              <FInput label="Valor da parcela 2" value={form.payment2Amount} onChange={value => setForm(current => ({ ...current, payment2Amount:value }))} type="number" placeholder="0" />
              {!preparedPayment.scheduleValid && <div style={{ gridColumn:'1 / -1', color:C.yellow, fontSize:12 }}>As duas parcelas precisam ter vencimento, forma, valor positivo e somar exatamente {fmt(form.value)}.</div>}
            </>
          )}
          {!paymentLocked && form.paymentScheduleMode === 'parcelas' && (
            <div style={{ gridColumn:'1 / -1', border:`1px solid ${C.border}`, borderRadius:12, padding:14, background:C.surface }}>
              {(form.schedulePayments || []).length > 0 ? (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:8 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{form.schedulePayments.length} parcelas · {fmt(preparedPayment.scheduledTotal)}</div>
                    <Btn variant="ghost" style={{ padding:'5px 12px', fontSize:12 }} onClick={() => setInstallmentModal({ rows:form.schedulePayments.map(item => ({ ...item })), count:form.schedulePayments.length, frequency:'mensal', firstDate:form.schedulePayments[0]?.date || form.date, method:form.schedulePayments[0]?.method || 'pix' })}>Editar parcelas</Btn>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:140, overflowY:'auto' }}>
                    {form.schedulePayments.map((item, index) => (
                      <div key={`${item.date}-${index}`} style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:C.textSub, borderTop:index ? `1px solid ${C.border}44` : 'none', paddingTop:index ? 4 : 0 }}>
                        <span>{index + 1}ª · {formatDateBR(item.date)} · {PAYMENT_METHOD_LABEL[item.method] || item.method}</span>
                        <span style={{ fontWeight:700, color:C.text }}>{fmt(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                  {!preparedPayment.scheduleValid && <div style={{ fontSize:12, color:C.yellow, marginTop:8 }}>O cronograma precisa de ao menos 2 parcelas válidas e deve somar exatamente {fmt(form.value)}.</div>}
                </>
              ) : (
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <span style={{ fontSize:13, color:C.textSub }}>Nenhuma parcela configurada ainda.</span>
                  <Btn style={{ padding:'6px 14px', fontSize:12 }} onClick={() => setInstallmentModal({ rows:[], count:3, frequency:'mensal', firstDate:form.date || today(), method:'pix' })}>Configurar parcelas</Btn>
                </div>
              )}
            </div>
          )}
          {!paymentLocked && !['duas_datas', 'parcelas'].includes(form.paymentScheduleMode) && <FInput label="Recebimento" value={form.paymentMode} onChange={value => setForm(current => ({ ...current, paymentMode:value }))} options={PAYMENT_MODES} />}
          {!paymentLocked && !['duas_datas', 'parcelas'].includes(form.paymentScheduleMode) && form.paymentMode !== 'misto' && <FInput label="Forma de pagamento" value={form.paymentMethod} onChange={value => setForm(current => ({ ...current, paymentMethod:value }))} options={PAYMENT_METHODS} />}
          {!paymentLocked && !['duas_datas', 'parcelas'].includes(form.paymentScheduleMode) && form.paymentMode === 'misto' && (
            <>
              <FInput label="Forma 1" value={form.mixMethodA} onChange={value => setForm(current => ({ ...current, mixMethodA:value }))} options={PAYMENT_METHODS} />
              <FInput label="Valor 1" value={form.mixAmountA} onChange={value => setForm(current => ({ ...current, mixAmountA:value }))} type="number" placeholder="0" />
              <FInput label="Forma 2" value={form.mixMethodB} onChange={value => setForm(current => ({ ...current, mixMethodB:value }))} options={PAYMENT_METHODS} />
              <FInput label="Valor 2" value={form.mixAmountB} onChange={value => setForm(current => ({ ...current, mixAmountB:value }))} type="number" placeholder="0" />
            </>
          )}
          {!paymentLocked && <FInput label="Status" value={form.paymentStatus} onChange={value => setForm(current => ({ ...current, paymentStatus:value }))} options={STATUSES} />}
          {!paymentLocked && !preparedPayment.scheduled && <FInput label="Vencimento (previsão de pagamento)" value={form.forecastPaymentDate} onChange={value => setForm(current => ({ ...current, forecastPaymentDate:value, dueDate:value }))} type="date" />}
          {!paymentLocked && <FInput label="Data do recebimento (caixa)" value={form.paymentDate} onChange={value => setForm(current => ({ ...current, paymentDate:value }))} type="date" />}
          {!paymentLocked && ['pago', 'recebido'].includes(form.paymentStatus) && !form.paymentDate && <div style={{ gridColumn:'1 / -1', color:C.yellow, fontSize:12 }}>Informe a data real do recebimento. O sistema não usa o vencimento como data de caixa.</div>}
          <div style={{ gridColumn:'1 / -1', display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
            <Btn variant="ghost" onClick={() => setShowModal(false)}>Cancelar</Btn>
            <Btn onClick={save} disabled={(!form.patient && !form.patientId) || (!paymentLocked && !preparedPayment.scheduleValid)}>Salvar consulta</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={!!installmentModal} onClose={() => setInstallmentModal(null)} title="Parcelas da consulta" width={720}>
        {installmentModal && (() => {
          const rows = installmentModal.rows || []
          const rowsTotal = roundPaymentAmount(rows.reduce((sum, item) => sum + Number(item.amount || 0), 0))
          const target = roundPaymentAmount(form.value)
          const difference = roundPaymentAmount(rowsTotal - target)
          const updateRow = (index, patch) => setInstallmentModal(current => ({ ...current, rows:current.rows.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }))
          return (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1fr 1fr', gap:12 }}>
                <FInput label="Número de parcelas" type="number" value={installmentModal.count} onChange={value => setInstallmentModal(current => ({ ...current, count:value }))} />
                <FInput label="Frequência" value={installmentModal.frequency} onChange={value => setInstallmentModal(current => ({ ...current, frequency:value }))} options={CONSULTATION_INSTALLMENT_FREQUENCIES} />
                <FInput label="Data da 1ª parcela" type="date" value={installmentModal.firstDate} onChange={value => setInstallmentModal(current => ({ ...current, firstDate:value }))} />
                <FInput label="Forma de pagamento" value={installmentModal.method} onChange={value => setInstallmentModal(current => ({ ...current, method:value }))} options={PAYMENT_METHODS} />
              </div>
              <Btn variant="ghost" onClick={() => setInstallmentModal(current => ({ ...current, rows:generateConsultationInstallments({ total:target, count:current.count, firstDate:current.firstDate, frequency:current.frequency, method:current.method }) }))}>
                Gerar {Math.max(2, Math.min(60, Math.floor(Number(installmentModal.count) || 2)))} parcelas de {fmt(target / Math.max(2, Math.min(60, Math.floor(Number(installmentModal.count) || 2))))}
              </Btn>
              {rows.length > 0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:280, overflowY:'auto' }}>
                  {rows.map((row, index) => (
                    <div key={index} style={{ display:'grid', gridTemplateColumns:isMobile ? '24px 1fr' : '24px 1.1fr 1fr 1fr 28px', gap:8, alignItems:'end' }}>
                      <div style={{ fontSize:12, color:C.textDim, paddingBottom:12 }}>{index + 1}</div>
                      <FInput label={index === 0 ? 'Vencimento' : ''} type="date" value={row.date} onChange={value => updateRow(index, { date:value })} />
                      <FInput label={index === 0 ? 'Valor' : ''} type="number" value={row.amount} onChange={value => updateRow(index, { amount:value })} />
                      <FInput label={index === 0 ? 'Forma' : ''} value={row.method} onChange={value => updateRow(index, { method:value })} options={PAYMENT_METHODS} />
                      <Btn variant="ghost" style={{ padding:'8px', fontSize:12 }} onClick={() => setInstallmentModal(current => ({ ...current, rows:current.rows.filter((_, itemIndex) => itemIndex !== index) }))}>×</Btn>
                    </div>
                  ))}
                  <Btn variant="ghost" style={{ fontSize:12 }} onClick={() => setInstallmentModal(current => ({ ...current, rows:[...current.rows, { date:current.rows.length ? shiftInstallmentDate(current.rows[current.rows.length - 1].date, 1, current.frequency) : (current.firstDate || today()), amount:0, method:current.method || 'pix' }] }))}>+ Adicionar parcela</Btn>
                </div>
              )}
              {rows.length > 0 && (
                <div style={{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', fontSize:13, color:Math.abs(difference) > 0.01 ? C.yellow : C.green, fontWeight:700 }}>
                  <span>Soma das parcelas: {fmt(rowsTotal)}</span>
                  <span>{Math.abs(difference) > 0.01 ? `Diferença: ${fmt(difference)}` : 'Confere com o valor da consulta'}</span>
                </div>
              )}
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <Btn variant="ghost" onClick={() => setInstallmentModal(null)}>Cancelar</Btn>
                <Btn disabled={rows.length < 2 || rows.some(row => !row.date || !row.method || !(Number(row.amount) > 0)) || Math.abs(difference) > 0.01} onClick={() => {
                  setForm(current => ({ ...current, schedulePayments:rows.map(row => ({ date:row.date, amount:roundPaymentAmount(row.amount), method:row.method || 'pix' })) }))
                  setInstallmentModal(null)
                }}>Salvar parcelas</Btn>
              </div>
            </div>
          )
        })()}
      </Modal>

      <ConfirmModal open={!!confirmId} onClose={() => setConfirmId(null)} onConfirm={() => persist(current => ({ ...current, consultations:current.consultations.filter(item => item.id !== confirmId) }))} />
    </div>
  )
}

function MetricPill({ label, value, color }) {
  return <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:'10px 12px' }}><div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{label}</div><div style={{ fontSize:13, color, fontWeight:700 }}>{value}</div></div>
}
