import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Btn, Card, FInput } from '../components/UI.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { C } from '../theme.js'

const OPTIONS = {
  mensal:{ label:'Mensal', price:297, description:'Flexibilidade total para começar agora.' },
  semestral:{ label:'Semestral', price:249, description:'Compromisso intermediário com melhor custo mensal.' },
  anual:{ label:'Anual', price:197, description:'Melhor condição para clínicas que querem operar com visão de longo prazo.' },
}

export function CheckoutPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, loading } = useAuth()
  const cycle = searchParams.get('cycle') || 'mensal'
  const selected = OPTIONS[cycle] || OPTIONS.mensal
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ fullName:'', email:'', phone:'', document:'', cardName:'', cardNumber:'', cardExpiry:'', cardCvv:'' })

  const summary = useMemo(() => ({
    trialDays:7,
    cycle,
    cycleLabel:selected.label,
    monthlyEquivalent:selected.price,
    dueToday:'R$ 0,00',
    nextCharge:`R$ ${selected.price.toLocaleString('pt-BR')},00`,
  }), [cycle, selected])

  if (!loading && user) {
    return <Navigate to="/app/dashboard" replace />
  }

  const submit = async () => {
    if (!form.fullName || !form.email) return
    setBusy(true)
    await new Promise(resolve => setTimeout(resolve, 1200))
    navigate(`/signup?cycle=${summary.cycle}&trial=${summary.trialDays}&checkout=success&email=${encodeURIComponent(form.email)}`, { replace:true })
  }

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(180deg, #050B12 0%, #08111B 100%)', color:C.text }}>
      <div style={{ maxWidth:1180, margin:'0 auto', padding:'28px 24px 64px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:16, marginBottom:28, flexWrap:'wrap' }}>
          <Link to="/" style={{ textDecoration:'none', color:C.text }}><span style={{ color:'#67E8F9' }}>▲</span> SurgiFlow</Link>
          <Link to="/login" style={{ textDecoration:'none', color:'#A9BCC5', fontSize:14 }}>Já tem conta? Entrar</Link>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'minmax(320px, 0.95fr) minmax(320px, 1.05fr)', gap:22, alignItems:'start' }}>
          <Card style={{ padding:28, background:'linear-gradient(160deg, rgba(9,18,28,0.96), rgba(17,24,39,0.96))', border:'1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize:12, color:'#7DD3FC', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Plano SurgiFlow</div>
            <h1 style={{ margin:'0 0 12px', fontSize:'clamp(30px, 4vw, 46px)', lineHeight:1.02, letterSpacing:'-0.04em' }}>Comece com 7 dias grátis</h1>
            <p style={{ margin:'0 0 18px', color:'#A9BCC5', fontSize:16, lineHeight:1.8 }}>Escolha o ciclo de cobrança, teste sem custo e siga para criar sua conta. Após a ativação, você entra na plataforma com o plano já selecionado.</p>

            <div style={{ display:'grid', gap:12, marginBottom:22 }}>
              {Object.entries(OPTIONS).map(([key, option]) => {
                const active = key === cycle
                return <Link key={key} to={`/checkout?cycle=${key}`} style={{ textDecoration:'none' }}><div style={{ padding:18, borderRadius:20, border:active ? '1px solid rgba(125,211,252,0.6)' : '1px solid rgba(255,255,255,0.08)', background:active ? 'linear-gradient(135deg, rgba(59,130,246,0.16), rgba(17,24,39,0.96))' : 'rgba(255,255,255,0.02)', boxShadow:active ? '0 18px 50px rgba(59,130,246,0.18)' : 'none' }}><div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', marginBottom:6 }}><div style={{ fontSize:18, color:C.text, fontWeight:800 }}>{option.label}</div><div style={{ color:active ? '#D6F0FF' : C.text, fontSize:22, fontWeight:900 }}>R$ {option.price},00<span style={{ color:'#7F98A3', fontSize:13, fontWeight:600 }}>/mês</span></div></div><div style={{ color:'#9FB2BC', fontSize:14, lineHeight:1.7 }}>{option.description}</div></div></Link>
              })}
            </div>

            <div style={{ padding:18, borderRadius:20, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize:11, color:'#7F98A3', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>O que está incluso</div>
              <div style={{ display:'grid', gap:10, color:'#D3E2EA', fontSize:14 }}>
                <span>• Dashboard financeiro completo</span>
                <span>• Cirurgias, consultas e produtos</span>
                <span>• Fluxo de caixa, DRE e balanço</span>
                <span>• Metas financeiras e assistente IA</span>
              </div>
            </div>
          </Card>

          <Card style={{ padding:28, background:'linear-gradient(160deg, rgba(17,24,39,0.98), rgba(8,16,28,0.98))', border:'1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:20, flexWrap:'wrap' }}>
              <div>
                <div style={{ fontSize:12, color:'#FCD34D', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Pagamento</div>
                <h2 style={{ margin:0, fontSize:28, letterSpacing:'-0.04em' }}>Ative seu teste grátis</h2>
              </div>
              <div style={{ padding:'7px 12px', borderRadius:999, background:'rgba(16,185,129,0.16)', color:'#6EE7B7', fontSize:12, fontWeight:700 }}>7 dias grátis</div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:18 }}>
              <FInput label="Nome completo" value={form.fullName} onChange={value => setForm(current => ({ ...current, fullName:value }))} placeholder="Seu nome" required />
              <FInput label="E-mail" value={form.email} onChange={value => setForm(current => ({ ...current, email:value }))} placeholder="voce@clinica.com" required />
              <FInput label="Telefone" value={form.phone} onChange={value => setForm(current => ({ ...current, phone:value }))} placeholder="(00) 00000-0000" />
              <FInput label="CPF/CNPJ" value={form.document} onChange={value => setForm(current => ({ ...current, document:value }))} placeholder="Documento para cobrança" />
            </div>

            <div style={{ padding:18, borderRadius:20, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.08)', marginBottom:18 }}>
              <div style={{ fontSize:11, color:'#7F98A3', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Dados do cartão</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                <div style={{ gridColumn:'1 / -1' }}><FInput label="Nome no cartão" value={form.cardName} onChange={value => setForm(current => ({ ...current, cardName:value }))} placeholder="Nome impresso" /></div>
                <div style={{ gridColumn:'1 / -1' }}><FInput label="Número do cartão" value={form.cardNumber} onChange={value => setForm(current => ({ ...current, cardNumber:value }))} placeholder="0000 0000 0000 0000" /></div>
                <FInput label="Validade" value={form.cardExpiry} onChange={value => setForm(current => ({ ...current, cardExpiry:value }))} placeholder="MM/AA" />
                <FInput label="CVV" value={form.cardCvv} onChange={value => setForm(current => ({ ...current, cardCvv:value }))} placeholder="123" />
              </div>
            </div>

            <div style={{ padding:18, borderRadius:20, background:'linear-gradient(135deg, rgba(59,130,246,0.14), rgba(255,111,60,0.08))', border:'1px solid rgba(255,255,255,0.08)', marginBottom:18 }}>
              <div style={{ display:'grid', gap:10, fontSize:14 }}>
                <SummaryRow label="Plano" value={`SurgiFlow · ${summary.cycleLabel}`} />
                <SummaryRow label="Hoje" value={summary.dueToday} highlight />
                <SummaryRow label="Após ${summary.trialDays} dias" value={`${summary.nextCharge} no ${summary.cycleLabel.toLowerCase()}`} />
              </div>
            </div>

            <Btn onClick={submit} disabled={busy || !form.fullName || !form.email} style={{ width:'100%', justifyContent:'center', display:'inline-flex', padding:'15px 20px' }}>
              {busy ? 'Processando...' : 'Iniciar teste grátis de 7 dias'}
            </Btn>
            <div style={{ marginTop:12, color:'#7F98A3', fontSize:12, lineHeight:1.7 }}>
              Checkout de pré-assinatura. Sem gateway integrado ainda. Ao continuar, o usuário segue para criar a conta e acessar a plataforma.
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value, highlight }) {
  return <div style={{ display:'flex', justifyContent:'space-between', gap:12, color:highlight ? '#EAFBF4' : '#D3E2EA', fontWeight:highlight ? 800 : 500 }}><span>{label}</span><span>{value}</span></div>
}
