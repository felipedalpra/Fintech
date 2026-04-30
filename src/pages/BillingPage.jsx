import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { C } from '../theme.js'
import { BILLING_CYCLES, FREE_TRIAL_DAYS, getBillingCycle } from '../billing/plans.js'
import { Btn, Card, Badge } from '../components/UI.jsx'
import { useBilling } from '../context/BillingContext.jsx'
import { createStripeCheckoutSession, createStripePortalSession } from '../lib/billingClient.js'

export function BillingPage() {
  const location = useLocation()
  const { billing, billingLoading, trialDaysLeft, refreshBilling, selectPlan, hasAppAccess } = useBilling()
  const [busyPlan, setBusyPlan] = useState('')
  const [portalBusy, setPortalBusy] = useState(false)
  const [error, setError] = useState('')

  const selectedPlan = useMemo(() => getBillingCycle(billing?.selected_plan || 'mensal'), [billing])
  const isTrialing = billing?.status === 'trialing'
  const isActive = billing?.status === 'active'
  const isTrialEnded = isTrialing && trialDaysLeft === 0
  const params = new URLSearchParams(location.search)
  const checkoutState = params.get('checkout')

  const startCheckout = async planId => {
    setBusyPlan(planId)
    setError('')
    try {
      await selectPlan(planId)
      const payload = await createStripeCheckoutSession(planId)
      window.location.href = payload.url
    } catch (nextError) {
      setError(nextError.message || 'Nao foi possivel iniciar o checkout.')
    } finally {
      setBusyPlan('')
    }
  }

  const openPortal = async () => {
    setPortalBusy(true)
    setError('')
    try {
      const payload = await createStripePortalSession()
      window.location.href = payload.url
    } catch (nextError) {
      setError(nextError.message || 'Nao foi possivel abrir o portal de assinaturas.')
    } finally {
      setPortalBusy(false)
    }
  }

  const statusText = isActive
    ? 'Assinatura ativa'
    : isTrialing
      ? (isTrialEnded ? 'Trial encerrado (beta): acesso liberado' : `Trial ativo: ${trialDaysLeft} dia(s) restantes`)
      : 'Acesso liberado'

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
              Todo usuário entra com {FREE_TRIAL_DAYS} dias grátis sem cartão. Para beta testers, mesmo após o término do trial o acesso ao ERP continua liberado.
            </p>
          </div>
          <Badge color={hasAppAccess ? C.green : C.red}>{statusText}</Badge>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14, marginTop:20 }}>
          <MiniStat label="Plano selecionado" value={selectedPlan.label} sub={selectedPlan.marketingLabel} />
          <MiniStat label="Status" value={billing?.status || 'trialing'} sub={billing?.current_period_end ? `Período atual até ${new Date(billing.current_period_end).toLocaleDateString('pt-BR')}` : 'Sem ciclo pago ainda'} />
          <MiniStat label="Trial" value={isTrialing ? `${trialDaysLeft} dia(s)` : 'Encerrado'} sub={billing?.trial_ends_at ? `Termina em ${new Date(billing.trial_ends_at).toLocaleDateString('pt-BR')}` : ''} />
        </div>

        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:18 }}>
          <Btn variant="ghost" onClick={refreshBilling}>Atualizar status</Btn>
          {billing?.stripe_customer_id ? <Btn variant="ghost" onClick={openPortal} disabled={portalBusy}>{portalBusy ? 'Abrindo portal...' : 'Gerenciar assinatura'}</Btn> : null}
        </div>

        {checkoutState === 'success' ? <div style={{ marginTop:16, padding:'12px 14px', borderRadius:12, border:`1px solid ${C.green}33`, background:C.green + '14', color:C.green, fontSize:13 }}>Checkout concluído. O status da assinatura é atualizado assim que o webhook do Stripe confirmar o evento.</div> : null}
        {checkoutState === 'cancel' ? <div style={{ marginTop:16, padding:'12px 14px', borderRadius:12, border:`1px solid ${C.yellow}33`, background:C.yellow + '14', color:C.yellow, fontSize:13 }}>Checkout cancelado. O trial continua até o fim do período gratuito.</div> : null}
        {error ? <div style={{ marginTop:16, padding:'12px 14px', borderRadius:12, border:`1px solid ${C.red}33`, background:C.red + '14', color:C.red, fontSize:13 }}>{error}</div> : null}
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
                disabled={busyPlan === cycle.id}
                style={{ width:'100%', justifyContent:'center', display:'inline-flex' }}
              >
                {busyPlan === cycle.id ? 'Abrindo checkout...' : isActive && active ? 'Trocar plano' : 'Assinar plano'}
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
