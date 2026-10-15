import { FInput } from './UI.jsx'

const PAYMENT_METHODS = [
  { v:'pix', l:'PIX' },
  { v:'cartao', l:'Cartão' },
  { v:'dinheiro', l:'Dinheiro' },
  { v:'boleto', l:'Boleto' },
  { v:'transferencia', l:'Transferência' },
]

const PAYMENT_TYPES = [
  { v:'particular', l:'Particular' },
  { v:'unimed', l:'Unimed' },
  { v:'ipe', l:'IPE' },
  { v:'outros_convenios', l:'Outros convênios' },
]

const CONSULTATION_STATUSES = [
  { v:'pendente', l:'Pendente' },
  { v:'pago', l:'Pago' },
  { v:'glosado', l:'Glosado' },
  { v:'cancelado', l:'Cancelado' },
]

const SURGERY_STATUSES = [
  { v:'pendente', l:'Pendente' },
  { v:'pago', l:'Pago' },
  { v:'cancelado', l:'Cancelado' },
]

function MoneyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h.01M17 14h.01M12 9v6m2-4.5c-.6-1-3.4-1-3.4.5s2.8 1 2.8 2.5-2.8 1.5-3.4.5" />
    </svg>
  )
}

export function CalendarFinancialFields({ open, onToggle, draft, setDraft, editing }) {
  const isSurgery = draft.type === 'surgery'
  const update = patch => setDraft(current => ({ ...current, ...patch }))
  const paymentMethods = draft.hasAdvancedPaymentMethod && !draft.paymentMethodTouched
    ? [{ v:'__advanced__', l:'Configuração avançada (preservada)' }, ...PAYMENT_METHODS]
    : PAYMENT_METHODS
  const paymentStatuses = isSurgery && draft.paymentStatus === 'parcelado'
    ? [...SURGERY_STATUSES, { v:'parcelado', l:'Parcelado (configuração preservada)' }]
    : isSurgery ? SURGERY_STATUSES : CONSULTATION_STATUSES

  return (
    <div className={`cal-finance${open ? ' is-open' : ''}`}>
      <button type="button" className="cal-finance__toggle" onClick={onToggle} aria-expanded={open}>
        <span className="cal-finance__icon"><MoneyIcon /></span>
        <span>
          <strong>{open ? 'Informações financeiras' : editing ? 'Ver informações financeiras' : 'Adicionar informações financeiras'}</strong>
          <small>{open ? 'Esses dados serão salvos no mesmo atendimento.' : 'Opcional — você também pode preencher depois.'}</small>
        </span>
        <span className="cal-finance__chevron" aria-hidden="true">⌄</span>
      </button>

      {open && (
        <section className="cal-finance__panel" data-testid="calendar-financial-fields">
          {draft.hasAdvancedPaymentMethod && !draft.paymentMethodTouched && (
            <div className="cal-finance__notice">Este atendimento possui uma configuração avançada de pagamento. Ela será preservada enquanto a forma de pagamento não for alterada aqui.</div>
          )}

          <div className="cal-finance__grid">
            <FInput
              label={isSurgery ? 'Valor total da cirurgia' : 'Valor da consulta'}
              type="number"
              value={isSurgery ? draft.totalValue : draft.value}
              onChange={value => update(isSurgery ? { totalValue:value } : { value })}
              placeholder="0"
            />
            <FInput label="Vencimento previsto" type="date" value={draft.dueDate} onChange={dueDate => update({ dueDate })} />
            <FInput label="Forma de pagamento" value={draft.paymentMethod} onChange={paymentMethod => update({ paymentMethod, paymentMethodTouched:true })} options={paymentMethods} />
            <FInput label="Status financeiro" value={draft.paymentStatus} onChange={paymentStatus => update({ paymentStatus, paymentDate:paymentStatus === 'pago' ? draft.paymentDate : '' })} options={paymentStatuses} />
            {draft.paymentStatus === 'pago' && <FInput label="Data do recebimento" type="date" value={draft.paymentDate} onChange={paymentDate => update({ paymentDate })} required />}
            <FInput label="Emissão de NF (%)" type="number" value={draft.invoiceIssuancePercent} onChange={invoiceIssuancePercent => update({ invoiceIssuancePercent })} placeholder="0" />

            {!isSurgery && (
              <>
                <FInput label="Forma / convênio" value={draft.paymentType} onChange={paymentType => update({ paymentType })} options={PAYMENT_TYPES} />
                {draft.paymentType !== 'particular' && <FInput label="Convênio" value={draft.insurance} onChange={insurance => update({ insurance })} placeholder="Nome do convênio" />}
              </>
            )}

            {isSurgery && (
              <>
                <FInput label="Custo hospital" type="number" value={draft.hospitalCost} onChange={hospitalCost => update({ hospitalCost })} placeholder="0" />
                <FInput label="Custo anestesia" type="number" value={draft.anesthesiaCost} onChange={anesthesiaCost => update({ anesthesiaCost })} placeholder="0" />
                <FInput label="Custo material" type="number" value={draft.materialCost} onChange={materialCost => update({ materialCost })} placeholder="0" />
                <FInput label="Outros custos" type="number" value={draft.otherCosts} onChange={otherCosts => update({ otherCosts })} placeholder="0" />
              </>
            )}
          </div>

          <p className="cal-finance__footnote">Parcelamentos, pagamentos mistos e baixas individuais de custos continuam disponíveis na tela completa de {isSurgery ? 'Cirurgias' : 'Consultas'}.</p>
        </section>
      )}
    </div>
  )
}
