import { C } from '../theme.js'
import { fmt, today } from '../utils.js'
import { clinicalCostRows } from '../lib/clinicalCosts.js'
import { FInput } from './UI.jsx'
import { SupplierSelector } from './SupplierSelector.jsx'

const STATUS_OPTIONS = [
  { v:'pendente', l:'A pagar' },
  { v:'pago', l:'Pago' },
  { v:'cancelado', l:'Cancelado' },
]

const PAYMENT_METHODS = [
  { v:'', l:'Não informado' },
  { v:'pix', l:'PIX' },
  { v:'cartao', l:'Cartão' },
  { v:'dinheiro', l:'Dinheiro' },
  { v:'boleto', l:'Boleto' },
  { v:'transferencia', l:'Transferência' },
]

export function ClinicalCostSettlementFields({ sourceType, form, setForm }) {
  const rows = clinicalCostRows(form, sourceType)
  if (rows.length === 0) return null

  const update = (component, patch) => setForm(current => ({
    ...current,
    costSettlements:{
      ...(current.costSettlements || {}),
      [component]:{
        ...(current.costSettlements?.[component] || {}),
        ...patch,
      },
    },
  }))

  return (
    <div style={{ gridColumn:'1 / -1', display:'flex', flexDirection:'column', gap:10 }}>
      <div>
        <div style={{ color:C.text, fontSize:13, fontWeight:800 }}>Liquidação dos custos</div>
        <div style={{ color:C.textDim, fontSize:12, marginTop:3 }}>Cada custo gera uma conta a pagar independente.</div>
      </div>
      {rows.map(row => {
        const settlement = row.settlement || {}
        const status = settlement.status || 'pendente'
        return (
          <div key={row.key} style={{ border:`1px solid ${C.border}`, background:C.surface, borderRadius:12, padding:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:12, marginBottom:12 }}>
              <span style={{ color:C.text, fontWeight:700 }}>{row.label}</span>
              <span style={{ color:C.red, fontWeight:800 }}>{fmt(row.amount)}</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10 }}>
              <SupplierSelector
                label="Fornecedor / credor"
                value={settlement.supplierId || ''}
                onChange={(id, name) => update(row.key, { supplierId:id || null, supplier:name || '' })}
              />
              <FInput label="Situação" value={status} onChange={value => update(row.key, {
                status:value,
                paymentDate:value === 'pago' ? (settlement.paymentDate || today()) : '',
              })} options={STATUS_OPTIONS} />
              <FInput label="Competência" value={settlement.competenceDate || form.competenceDate || form.date || ''} onChange={value => update(row.key, { competenceDate:value })} type="date" />
              {status === 'pendente' && <FInput label="Vencimento" value={settlement.dueDate || form.date || ''} onChange={value => update(row.key, { dueDate:value })} type="date" />}
              {status === 'pago' && <FInput label="Data real do pagamento" value={settlement.paymentDate || ''} onChange={value => update(row.key, { paymentDate:value })} type="date" />}
              {status === 'pago' && <FInput label="Forma de pagamento" value={settlement.paymentMethod || ''} onChange={value => update(row.key, { paymentMethod:value })} options={PAYMENT_METHODS} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}
