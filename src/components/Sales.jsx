import { useState } from 'react'
import { C, base } from '../theme.js'
import { fmt, today, uid } from '../utils.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge } from './UI.jsx'

const PAYMENT_METHODS = [
  { v:'pix', l:'PIX' },
  { v:'cartao', l:'Cartão' },
  { v:'boleto', l:'Boleto' },
  { v:'transferencia', l:'Transferência' },
]

const PAYMENT_STATUS = [
  { v:'pago', l:'Pago' },
  { v:'pendente', l:'Pendente' },
  { v:'parcelado', l:'Parcelado' },
  { v:'cancelado', l:'Cancelado' },
]

const STATUS_COLORS = {
  pago: C.green,
  pendente: C.yellow,
  parcelado: C.cyan,
  cancelado: C.red,
}

export function Sales({ data, setData }) {
  const empty = {
    patient:'',
    procedureId:data.procedures[0]?.id || '',
    totalValue:0,
    date:today(),
    paymentMethod:'pix',
    paymentStatus:'pendente',
    surgeon:'',
    hospitalCost:0,
    anesthesiaCost:0,
    materialCost:0,
    otherCosts:0,
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
    setForm({ ...item })
    setEditing(item.id)
    setShowModal(true)
  }

  const save = () => {
    if (!form.patient || !form.date) return
    const totalCosts = (form.hospitalCost || 0) + (form.anesthesiaCost || 0) + (form.materialCost || 0) + (form.otherCosts || 0)
    const procedureValue = data.procedures.find(item => item.id === form.procedureId)?.price || 0
    const resolvedTotal = form.totalValue || procedureValue
    const installmentValue = form.paymentStatus === 'parcelado' && form.installmentCount >= 2
      ? resolvedTotal / form.installmentCount
      : 0
    const nextRecord = {
      ...form,
      totalValue:resolvedTotal,
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
        const costs = (item.hospitalCost || 0) + (item.anesthesiaCost || 0) + (item.materialCost || 0) + (item.otherCosts || 0)
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
        <input placeholder="Buscar paciente ou ID interno..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...base.input, maxWidth:280 }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...base.input, width:'auto' }}>
          <option value="todos">Todos</option>
          {PAYMENT_STATUS.map(s => (
            <option key={s.v} value={s.v}>{s.l}</option>
          ))}
        </select>
        <span style={{ marginLeft:'auto', fontSize:13, color:C.textDim }}>{filtered.length} cirurgia{filtered.length !== 1 ? 's' : ''}</span>
        <Btn onClick={openAdd}>+ Nova Cirurgia</Btn>
      </div>

      {/* Summary stats bar */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
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

      <Card style={{ padding:0, overflow:'hidden' }}>
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
                const netRevenue = (item.totalValue || 0) - ((item.hospitalCost || 0) + (item.anesthesiaCost || 0) + (item.materialCost || 0) + (item.otherCosts || 0))
                const statusColor = STATUS_COLORS[item.paymentStatus] || C.textDim
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
                    <td style={{ padding:'13px 18px', color:C.textSub }}>{item.date}</td>
                    <td style={{ padding:'13px 18px', color:C.green, fontWeight:700 }}>{fmt(item.totalValue)}</td>
                    <td style={{ padding:'13px 18px', color:netRevenue >= 0 ? C.accent : C.red, fontWeight:700 }}>{fmt(netRevenue)}</td>
                    <td style={{ padding:'13px 18px' }}>
                      <Badge color={statusColor} small>{item.paymentStatus}</Badge>
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
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar Cirurgia' : 'Nova Cirurgia'} width={720}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <FInput label="Paciente ou ID interno" required value={form.patient} onChange={value => setForm(current => ({ ...current, patient:value }))} placeholder="Use o mínimo necessário para identificar" />
          <FInput label="Cirurgião" value={form.surgeon} onChange={value => setForm(current => ({ ...current, surgeon:value }))} placeholder="Nome do cirurgião responsável" />
          <FInput label="Procedimento" value={form.procedureId} onChange={value => setForm(current => ({ ...current, procedureId:value }))} options={data.procedures.length > 0 ? data.procedures.map(item => ({ v:item.id, l:item.name })) : [{ v:'', l:'Nenhum procedimento cadastrado' }]} />
          <FInput label="Data" value={form.date} onChange={value => setForm(current => ({ ...current, date:value }))} type="date" />
          <FInput label="Valor total" value={form.totalValue} onChange={value => setForm(current => ({ ...current, totalValue:value }))} type="number" placeholder="0" />
          <FInput label="Forma de pagamento" value={form.paymentMethod} onChange={value => setForm(current => ({ ...current, paymentMethod:value }))} options={PAYMENT_METHODS} />
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
