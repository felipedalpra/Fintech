import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { hasSupabaseEnv } from '../lib/supabase.js'
import { Btn, Card, FInput } from '../components/UI.jsx'
import { BrandLogo } from '../components/BrandLogo.jsx'
import { C, base } from '../theme.js'
import { BILLING_LABELS, FREE_TRIAL_DAYS } from '../billing/plans.js'

const PASSWORD_POLICY = {
  minLength:8,
  upper:/[A-Z]/,
  lower:/[a-z]/,
  number:/\d/,
  special:/[^A-Za-z0-9]/,
}

export function LoginPage({ initialMode = 'login' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { user, session, loading, signIn, signUp, requestPasswordReset } = useAuth()
  const [mode, setMode] = useState(initialMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ name:'', email:'', password:'' })

  const checkoutSummary = useMemo(() => {
    const cycle = searchParams.get('cycle')
    const trial = searchParams.get('trial')
    const onboarding = searchParams.get('onboarding')
    if (!cycle && !trial && !onboarding) return ''
    const cycleLabel = BILLING_LABELS[cycle] || 'Mensal'
    return `Plano SurgiMetrics selecionado: ${cycleLabel}. Você começa com ${trial || FREE_TRIAL_DAYS} dias grátis e só precisa pagar depois do período de trial.`
  }, [searchParams])

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => {
    const email = searchParams.get('email')
    if (email) {
      setForm(current => ({ ...current, email }))
    }
  }, [searchParams])

  if (!hasSupabaseEnv) {
    return <SupabaseSetupScreen />
  }

  if (!loading && user) {
    return <Navigate to={location.state?.from || '/app/dashboard'} replace />
  }

  const isRegister = mode === 'register'
  const passwordChecks = useMemo(() => ({
    length:form.password.length >= PASSWORD_POLICY.minLength,
    upper:PASSWORD_POLICY.upper.test(form.password),
    lower:PASSWORD_POLICY.lower.test(form.password),
    number:PASSWORD_POLICY.number.test(form.password),
    special:PASSWORD_POLICY.special.test(form.password),
  }), [form.password])
  const passwordValid = Object.values(passwordChecks).every(Boolean)

  const onChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
    if (error) setError('')
    if (message) setMessage('')
  }

  const submit = async () => {
    if (isRegister && !passwordValid) {
      setError('A senha precisa ter no mínimo 8 caracteres, com 1 letra maiúscula, 1 minúscula, 1 número e 1 caractere especial.')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')

    try {
      if (isRegister) {
        await signUp({ ...form, billingCycle:searchParams.get('cycle') || 'mensal' })
        setMessage('Conta criada. Verifique seu e-mail e confirme o cadastro antes do primeiro login.')
        navigate(`/login${location.search}`, { replace:true })
      } else {
        await signIn(form)
        navigate(location.state?.from || '/app/dashboard', { replace: true })
      }
    } catch (nextError) {
      setError(nextError.message)
    } finally {
      setBusy(false)
    }
  }

  const forgotPassword = async () => {
    if (!form.email) {
      setError('Informe seu e-mail para recuperar a senha.')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')

    try {
      await requestPasswordReset(form.email)
      setMessage('Link de recuperacao enviado. Abra o e-mail e siga o fluxo para redefinir a senha.')
    } catch (nextError) {
      setError(nextError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight:'100vh',
      display:'grid',
      gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))',
      background:`radial-gradient(circle at top left, ${C.accent}26, transparent 28%), radial-gradient(circle at bottom right, ${C.cyan}20, transparent 24%), ${C.bg}`,
    }}>
      <div style={{ padding:'48px 24px', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <Card style={{ width:'100%', maxWidth:420, padding:32 }}>
          <div style={{ marginBottom:20 }}>
            <BrandLogo size="sm" />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:10 }}>
            <div style={{ fontSize:13, color:C.accentLight, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' }}>
              {isRegister ? 'Nova conta' : 'Acesso seguro'}
            </div>
            <Link to="/" style={{ color:C.textDim, textDecoration:'none', fontSize:13 }}>Voltar ao site</Link>
          </div>
          <h1 style={{ fontSize:32, lineHeight:1.05, margin:'0 0 10px', color:C.text }}>
            {isRegister ? 'Crie sua conta' : 'Entre na plataforma'}
          </h1>
          <p style={{ color:C.textSub, fontSize:14, lineHeight:1.6, marginBottom:22 }}>
            {isRegister
              ? 'Cadastre seu acesso e comece a centralizar o financeiro da clínica no SurgiMetrics.'
              : 'Login com sessao persistida, trial automático de 30 dias e sincronizacao remota da operacao financeira.'}
          </p>

          {checkoutSummary && (
            <div style={{ background:C.green+'14', border:`1px solid ${C.green}33`, borderRadius:12, padding:'12px 14px', color:C.green, fontSize:13, marginBottom:16 }}>
              {checkoutSummary}
            </div>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {isRegister && (
              <FInput label="Nome" value={form.name} onChange={value => onChange('name', value)} placeholder="Seu nome" required />
            )}
            <FInput label="E-mail" value={form.email} onChange={value => onChange('email', value)} placeholder="voce@empresa.com" required />
            <FInput label="Senha" value={form.password} onChange={value => onChange('password', value)} type="password" placeholder="8+ caracteres, com maiúscula, minúscula, número e especial" required />

            {isRegister && (
              <div style={{ padding:'12px 14px', borderRadius:12, border:`1px solid ${C.border}`, background:C.surface, display:'grid', gap:6 }}>
                <PasswordRule ok={passwordChecks.length}>Pelo menos 8 caracteres</PasswordRule>
                <PasswordRule ok={passwordChecks.upper}>1 letra maiúscula</PasswordRule>
                <PasswordRule ok={passwordChecks.lower}>1 letra minúscula</PasswordRule>
                <PasswordRule ok={passwordChecks.number}>1 número</PasswordRule>
                <PasswordRule ok={passwordChecks.special}>1 caractere especial</PasswordRule>
                <div style={{ color:C.textDim, fontSize:12, lineHeight:1.5, marginTop:2 }}>
                  O primeiro acesso só é liberado após confirmação do e-mail.
                </div>
              </div>
            )}

            {error && (
              <div style={{ background:C.red+'14', border:`1px solid ${C.red}33`, borderRadius:12, padding:'12px 14px', color:C.red, fontSize:13 }}>
                {error}
              </div>
            )}

            {message && (
              <div style={{ background:C.green+'14', border:`1px solid ${C.green}33`, borderRadius:12, padding:'12px 14px', color:C.green, fontSize:13 }}>
                {message}
              </div>
            )}

            {!user && session?.user && !session.user.email_confirmed_at && (
              <div style={{ background:C.yellow+'14', border:`1px solid ${C.yellow}33`, borderRadius:12, padding:'12px 14px', color:C.yellow, fontSize:13 }}>
                Cadastro criado, mas o acesso só é liberado após confirmar o e-mail. Abra sua caixa de entrada e clique no link de verificação.
              </div>
            )}

            <Btn onClick={submit} disabled={busy || !form.email || !form.password || (isRegister && (!form.name || !passwordValid))} style={{ justifyContent:'center', display:'inline-flex' }}>
              {busy ? 'Processando...' : isRegister ? 'Criar conta' : 'Entrar'}
            </Btn>

            {!isRegister && (
              <button
                onClick={forgotPassword}
                disabled={busy}
                style={{ background:'transparent', border:'none', color:C.textSub, cursor:'pointer', fontFamily:'inherit', fontSize:13 }}
              >
                Esqueci minha senha
              </button>
            )}
          </div>

          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:20, paddingTop:20, borderTop:`1px solid ${C.border}` }}>
            <span style={{ fontSize:13, color:C.textDim }}>
              {isRegister ? 'Ja tem acesso?' : 'Ainda nao tem conta?'}
            </span>
            <Link
              to={isRegister ? '/login' : `/signup${location.search}`}
              style={{ color:C.accentLight, textDecoration:'none', fontSize:13, fontWeight:700 }}
            >
              {isRegister ? 'Fazer login' : 'Criar conta'}
            </Link>
          </div>
        </Card>
      </div>

      <div style={{ padding:'48px 32px', display:'flex', alignItems:'center' }}>
        <div style={{ maxWidth:560, width:'100%' }}>
          <div style={{ display:'inline-flex', padding:'10px 14px', borderRadius:20, border:`1px solid ${C.borderBright}`, background:C.glass, marginBottom:20 }}>
            <BrandLogo size="sm" />
          </div>
          <h2 style={{ fontSize:'clamp(36px, 5vw, 64px)', lineHeight:0.95, margin:'0 0 18px', letterSpacing:'-0.04em' }}>
            Gestão financeira para cirurgia plástica.
          </h2>
          <p style={{ fontSize:18, color:C.textSub, lineHeight:1.6, maxWidth:520, marginBottom:28 }}>
            Controle sua clínica com clareza total.
            Cirurgias, consultas, receitas, despesas, fluxo de caixa, DRE, balanço e metas passam a funcionar de forma integrada em um único sistema seguro na nuvem.
          </p>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:14 }}>
            {[
              ['Tudo conectado em um só lugar', 'Análise financeira por IA, controle de consultas, gerenciamento financeiro e muito mais.'],
              ['Saiba exatamente o que está acontecendo', 'Acompanhe em tempo real o desempenho financeiro da sua clínica.'],
              ['Desenvolvido para a cirurgia plástica', 'SurgiMetrics é construído do zero para atender a rotina financeira de clínicas especializadas.'],
            ].map(([title, text]) => (
              <div key={title} style={{ ...base.card, background:C.glass, backdropFilter:'blur(8px)' }}>
                <div style={{ fontSize:12, color:C.accentLight, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>{title}</div>
                <div style={{ fontSize:14, color:C.textSub, lineHeight:1.6 }}>{text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function SupabaseSetupScreen() {
  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:C.bg, padding:24 }}>
      <Card style={{ width:'min(760px, 100%)' }}>
        <div style={{ fontSize:12, color:C.accentLight, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Configuracao pendente</div>
        <h1 style={{ margin:'0 0 12px', fontSize:30 }}>Faltam as variaveis do Supabase.</h1>
        <p style={{ color:C.textSub, lineHeight:1.7, marginBottom:18 }}>
          Defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em um arquivo `.env` para ativar autenticacao real, reset de senha e persistencia remota.
        </p>
        <pre style={{ ...base.card, overflowX:'auto', fontSize:13 }}>{`VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon`}</pre>
      </Card>
    </div>
  )
}

function PasswordRule({ ok, children }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:ok ? C.green : C.textDim }}>
      <span style={{ width:16, textAlign:'center', fontWeight:700 }}>{ok ? '✓' : '•'}</span>
      <span>{children}</span>
    </div>
  )
}
