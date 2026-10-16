import { useState } from 'react'
import { C } from '../theme.js'
import { Btn, FInput, Modal } from './UI.jsx'
import { cancelBillingCharge, createBillingCharge } from '../lib/billingClient.js'
import { formatDateBR, uid } from '../utils.js'

function money(value) { return Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' }) }

export function BillingChargeButton({ item }) {
  const installment = item?.openInstallmentRows?.[0]
  const [open, setOpen] = useState(false)
  const [billingType, setBillingType] = useState('PIX')
  const [attemptId, setAttemptId] = useState('')
  const [charge, setCharge] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  if (!installment || !['surgery','consultation','product_sale','extra_revenue'].includes(item?.sourceType)) return null

  const show = () => {
    setOpen(true); setCharge(null); setError('')
    setAttemptId(uid())
  }
  const emit = async () => {
    setLoading(true); setError('')
    try {
      const result = await createBillingCharge({
        sourceType:item.sourceType,
        sourceId:item.sourceId,
        sourceComponent:item.sourceComponent || 'revenue',
        installmentNumber:installment.installmentNumber,
        billingType,
        idempotencyKey:attemptId,
      })
      setCharge(result.charge)
    } catch (nextError) { setError(nextError.message) }
    finally { setLoading(false) }
  }
  const cancel = async () => {
    setLoading(true); setError('')
    try { const result = await cancelBillingCharge(charge.id); setCharge(result.charge) }
    catch (nextError) { setError(nextError.message) }
    finally { setLoading(false) }
  }
  const copy = async value => { if (value) await navigator.clipboard.writeText(value) }
  const paymentLink = charge?.bankSlipUrl || charge?.invoiceUrl

  return <>
    <Btn variant="ghost" onClick={show} style={{ padding:'5px 10px', fontSize:12 }}>Emitir cobrança</Btn>
    <Modal open={open} onClose={() => setOpen(false)} title="Emitir cobrança" width={560} trackDirty={false}>
      <div style={{ display:'grid', gap:16 }}>
        <div style={{ padding:14, border:`1px solid ${C.border}`, borderRadius:12, background:C.surface }}>
          <strong style={{ color:C.text }}>{item.patient}</strong>
          <div style={{ color:C.textSub, fontSize:13, marginTop:5 }}>{item.description}</div>
          <div style={{ display:'flex', gap:18, marginTop:10, color:C.text, fontSize:13 }}><span>Parcela {installment.installmentNumber}/{item.installmentsTotal}</span><strong>{money(installment.amount)}</strong><span>vence {formatDateBR(installment.dueDate)}</span></div>
        </div>
        {!charge && <FInput label="Forma de cobrança" value={billingType} onChange={setBillingType} options={[{ v:'PIX', l:'Pix' }, { v:'BOLETO', l:'Boleto bancário' }]} />}
        {charge && <div style={{ display:'grid', gap:10, padding:14, border:`1px solid ${C.green}55`, borderRadius:12 }}>
          <strong style={{ color:C.green }}>Cobrança {charge.status === 'overdue' ? 'vencida' : charge.status === 'canceled' ? 'cancelada' : 'emitida'}</strong>
          {paymentLink && <a href={paymentLink} target="_blank" rel="noreferrer" style={{ color:C.accent }}>Abrir link de pagamento</a>}
          {charge.pixPayload && <div><div style={{ color:C.textSub, fontSize:12, marginBottom:5 }}>Pix copia e cola</div><div style={{ display:'flex', gap:8 }}><input readOnly value={charge.pixPayload} style={{ flex:1, minWidth:0, padding:9, borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text }} /><Btn variant="ghost" onClick={() => copy(charge.pixPayload)}>Copiar</Btn></div></div>}
          {charge.boletoBarcode && <div><div style={{ color:C.textSub, fontSize:12, marginBottom:5 }}>Linha digitável</div><div style={{ display:'flex', gap:8 }}><input readOnly value={charge.boletoBarcode} style={{ flex:1, minWidth:0, padding:9, borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text }} /><Btn variant="ghost" onClick={() => copy(charge.boletoBarcode)}>Copiar</Btn></div></div>}
        </div>}
        {error && <div style={{ color:C.red, fontSize:13, fontWeight:600 }}>{error}</div>}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
          {charge && ['pending','overdue','creating'].includes(charge.status) && <Btn variant="danger" onClick={cancel} disabled={loading}>Cancelar cobrança</Btn>}
          {!charge && <Btn onClick={emit} disabled={loading}>{loading ? 'Emitindo…' : `Emitir ${billingType === 'PIX' ? 'Pix' : 'boleto'}`}</Btn>}
          <Btn variant="ghost" onClick={() => setOpen(false)}>Fechar</Btn>
        </div>
      </div>
    </Modal>
  </>
}
