import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { C } from '../theme.js'
import { BILLING_CYCLES, getBillingCycle } from '../billing/plans.js'
import { Btn, Card, Badge, FInput } from '../components/UI.jsx'
import { FIELD_STANDARDS } from '../lib/formFieldStandards.js'
import { useBilling } from '../context/BillingContext.jsx'
import { fetchSaasBillingStatus, saveSaasBillingContact, createSaasBillingCheckout } from '../lib/billingClient.js'

export function BillingPage() {
  const location = useLocation()
  const { billing, billingLoading, refreshBilling } = useBilling()
  const [busyPlan, setBusyPlan] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [gatewayEnabled, setGatewayEnabled] = useState(false)
  const [contact, setContact] = useState({ name:'', document:'', email:'', phone:'' })
  const [contactSaving, setContactSaving] = useState(false)
  const [couponCode, setCouponCode] = useState('')
  const [firstDueDate, setFirstDueDate] = useState('')

  const selectedPlan = useMemo(() => getBillingCycle(billing?.selected_plan || 'mensal'), [billing])
  const isActive = billing?.status === 'active'
  const params = new URLSearchParams(location.search)
  const checkoutState = params.get('checkout')

  useEffect(() => {
    if (billing) {
      setContact({
        name:billing.billing_contact_name || '',
        document:billing.billing_contact_document || '',
        email:billing.billing_contact_email || '',
        phone:billing.billing_contact_phone || '',
      })
      setCouponCode(billing.coupon_code || '')
    }
  }, [billing])

  useEffect(() => {
    fetchSaasBillingStatus().then(payload => setGatewayEnabled(Boolean(payload.enabled))).catch(() => setGatewayEnabled(false))
  }, [])

  const contactComplete = Boolean(contact.name && contact.document && contact.email)

  const saveContact = async () => {
    setContactSaving(true)
    setError('')
    setNotice('')
    try {
      await saveSaasBillingContact(contact)
      await refreshBilling()
      setNotice('Dados de pagamento salvos.')
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível salvar os dados de pagamento.')
    } finally {
      setContactSaving(false)
    }
  }

  const startCheckout = async planId => {
    setBusyPlan(planId)
    setError('')
    setNotice('')
    try {
      const payload = await createSaasBillingCheckout({ planId, couponCode, firstDueDate })
      if (payload.url) window.location.href = payload.url
      else setNotice('Assinatura criada. O link de pagamento foi enviado para o e-mail de cobrança.')
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível iniciar a cobrança.')
    } finally {
      setBusyPlan('')
    }
  }

  const statusText = isActive ? 'Assinatura ativa' : 'Acesso ao ERP liberado'

  if (billingLoading) {
    return <Card><div style={{ color:C.textSub }}>Carregando billing...</div></Card>
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
      <Card style={{ padding:'22px 24px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Billing</div>
            <h2 style={{ margin:'0 0 10px', color:C.text, fontSize:28 }}>Assinatura SurgiMetrics</h2>
            <p style={{ margin:0, color:C.textDim, lineHeight:1.7, maxWidth:720 }}>
              O acesso ao ERP é independente da cobrança. Aqui você escolhe o ciclo e gerencia o pagamento recorrente no cartão.
            </p>
          </div>
          <Badge color={C.green}>{statusText}</Badge>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14, marginTop:20 }}>
          <MiniStat label="Plano selecionado" value={selectedPlan.label} sub={selectedPlan.marketingLabel} />
          <MiniStat label="Status" value={isActive ? 'Ativa' : 'Não configurada'} sub={billing?.next_due_date ? `Próxima cobrança em ${new Date(billing.next_due_date).toLocaleDateString('pt-BR')}` : 'O acesso ao ERP permanece liberado'} />
          <MiniStat label="Acesso ao ERP" value="Liberado" sub="Sem expiração ou bloqueio por cobrança" />
        </div>

        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:18 }}>
          <Btn variant="ghost" onClick={refreshBilling}>Atualizar status</Btn>
        </div>

        {checkoutState === 'success' ? <div style={{ marginTop:16, padding:'12px 14px', borderRadius:12, border:`1px solid ${C.green}33`, background:C.green + '14', color:C.green, fontSize:13 }}>Pagamento confirmado. O status da assinatura é atualizado assim que o webhook do provedor confirmar o evento.</div> : null}
        {notice ? <div style={{ marginTop:16, padding:'12px 14px', borderRadius:12, border:`1px solid ${C.green}33`, background:C.green + '14', color:C.green, fontSize:13 }}>{notice}</div> : null}
        {error ? <div style={{ marginTop:16, padding:'12px 14px', borderRadius:12, border:`1px solid ${C.red}33`, background:C.red + '14', color:C.red, fontSize:13 }}>{error}</div> : null}
      </Card>

      <Card style={{ padding:'22px 24px' }}>
        <h3 style={{ margin:'0 0 6px', color:C.text, fontSize:18 }}>Dados de pagamento</h3>
        <p style={{ margin:'0 0 16px', color:C.textDim, fontSize:13, lineHeight:1.6, maxWidth:640 }}>
          {gatewayEnabled
            ? 'O número do cartão é informado direto na página segura do Asaas — o SurgiMetrics nunca recebe nem guarda o cartão. Preencha os dados abaixo para identificar o responsável pela cobrança.'
            : 'A cobrança por cartão ainda está sendo configurada pela Zentri Tech. Você já pode preencher os dados do responsável pelo pagamento; o botão de assinar será liberado quando o novo gateway estiver ativo.'}
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14 }}>
          <FInput label="Nome do responsável" value={contact.name} onChange={value => setContact(prev => ({ ...prev, name:value }))} />
          <FInput label="CPF ou CNPJ" value={contact.document} onChange={value => setContact(prev => ({ ...prev, document:value }))}
            format={FIELD_STANDARDS.cpfCnpj.format} maxLength={FIELD_STANDARDS.cpfCnpj.maxLength} inputMode={FIELD_STANDARDS.cpfCnpj.inputMode} validator={FIELD_STANDARDS.cpfCnpj.validate} />
          <FInput label="E-mail de cobrança" type="email" value={contact.email} onChange={value => setContact(prev => ({ ...prev, email:value }))}
            format={FIELD_STANDARDS.email.format} maxLength={FIELD_STANDARDS.email.maxLength} inputMode={FIELD_STANDARDS.email.inputMode} validator={FIELD_STANDARDS.email.validate} />
          <FInput label="Telefone" value={contact.phone} onChange={value => setContact(prev => ({ ...prev, phone:value }))}
            format={FIELD_STANDARDS.phone.format} maxLength={FIELD_STANDARDS.phone.maxLength} inputMode={FIELD_STANDARDS.phone.inputMode} validator={FIELD_STANDARDS.phone.validate} />
          <FInput label="Cupom de desconto (opcional)" value={couponCode} onChange={value => setCouponCode(value.toUpperCase())} placeholder="Ex.: BEMVINDA10" />
          {!billing?.asaas_subscription_id ? (
            <FInput label="Data da primeira cobrança" type="date" value={firstDueDate} onChange={setFirstDueDate}
              help="Deixe em branco para cobrar a partir de amanhã. Se a clínica já pagou o mês atual por outro meio, informe a data do próximo vencimento combinado." />
          ) : null}
        </div>
        <div style={{ display:'flex', gap:10, marginTop:16 }}>
          <Btn variant="ghost" onClick={saveContact} disabled={contactSaving || !contact.name}>{contactSaving ? 'Salvando...' : 'Salvar dados de pagamento'}</Btn>
        </div>
      </Card>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))', gap:16 }}>
        {BILLING_CYCLES.map((cycle, index) => {
          const active = billing?.selected_plan === cycle.id
          return (
            <Card key={cycle.id} style={{ padding:22, border:active ? `1px solid ${C.accent}66` : undefined, boxShadow:active ? `0 0 28px ${C.accent}22` : undefined }}>
              {cycle.badge ? <div style={{ marginBottom:12 }}><Badge color={C.accent}>{cycle.badge}</Badge></div> : null}
              <div style={{ color:C.text, fontSize:22, fontWeight:800, marginBottom:8 }}>{cycle.label}</div>
              <div style={{ display:'flex', alignItems:'baseline', gap:6, marginBottom:10 }}>
                <span style={{ color:C.text, fontSize:34, fontWeight:900 }}>{cycle.headline}</span>
                <span style={{ color:C.textDim, fontSize:12 }}>{cycle.periodLabel}</span>
              </div>
              <div style={{ color:C.textSub, fontSize:13, marginBottom:8 }}>{cycle.cadenceLabel}</div>
              <div style={{ color:C.textDim, fontSize:14, lineHeight:1.7, marginBottom:18 }}>{cycle.note}</div>
              <Btn
                onClick={() => startCheckout(cycle.id)}
                variant={index === 2 ? 'primary' : 'ghost'}
                disabled={busyPlan === cycle.id || !gatewayEnabled || !contactComplete}
                title={!contactComplete ? 'Preencha e salve os dados de pagamento antes de assinar.' : !gatewayEnabled ? 'Cobrança por cartão ainda não está disponível.' : undefined}
                style={{ width:'100%', justifyContent:'center', display:'inline-flex' }}
              >
                {busyPlan === cycle.id ? 'Abrindo pagamento...' : isActive && active ? 'Trocar plano' : 'Assinar plano'}
              </Btn>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function MiniStat({ label, value, sub }) {
  return (
    <div style={{ padding:14, borderRadius:16, border:`1px solid ${C.border}`, background:C.surface }}>
      <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{label}</div>
      <div style={{ color:C.text, fontWeight:800, fontSize:20 }}>{value}</div>
      {sub ? <div style={{ color:C.textSub, fontSize:12, marginTop:4, lineHeight:1.5 }}>{sub}</div> : null}
    </div>
  )
}
