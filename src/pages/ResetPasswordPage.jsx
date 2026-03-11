import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Btn, Card, FInput } from '../components/UI.jsx'
import { C } from '../theme.js'
import { hasSupabaseEnv, supabase } from '../lib/supabase.js'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { user, loading, isRecoveryMode, updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState(true)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!hasSupabaseEnv) return

    let active = true

    async function resolveRecoveryLink() {
      const search = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const tokenHash = search.get('token_hash')
      const searchType = search.get('type')
      const code = search.get('code')
      const hashType = hash.get('type')
      const accessToken = hash.get('access_token')

      try {
        setError('')

        if (tokenHash && searchType === 'recovery') {
          const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
          if (verifyError) throw verifyError
          if (!active) return
          setRecoveryReady(true)
          return
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
          if (!active) return
          setRecoveryReady(true)
          return
        }

        if (accessToken && hashType === 'recovery') {
          if (!active) return
          setRecoveryReady(true)
          return
        }
      } catch (nextError) {
        if (!active) return
        setError(nextError.message || 'Nao foi possivel validar o link de recuperacao.')
      } finally {
        if (active) setVerifying(false)
      }
    }

    resolveRecoveryLink()
    return () => { active = false }
  }, [])

  if (!hasSupabaseEnv) {
    return <Navigate to="/login" replace />
  }

  const canReset = useMemo(() => Boolean(user && (isRecoveryMode || recoveryReady)), [user, isRecoveryMode, recoveryReady])

  const submit = async () => {
    setError('')
    setMessage('')

    if (password.length < 6) {
      setError('A nova senha precisa ter pelo menos 6 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setError('As senhas nao conferem.')
      return
    }

    setBusy(true)
    try {
      await updatePassword(password)
      setMessage('Senha atualizada com sucesso. Redirecionando para o login...')
      setTimeout(() => {
        navigate('/login', { replace:true })
      }, 1200)
    } catch (nextError) {
      setError(nextError.message)
    } finally {
      setBusy(false)
    }
  }

  const waiting = loading || verifying

  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:C.bg, padding:24 }}>
      <Card style={{ width:'min(460px, 100%)' }}>
        <div style={{ fontSize:12, color:C.accentLight, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>
          Recuperacao de senha
        </div>
        <h1 style={{ margin:'0 0 10px', fontSize:30 }}>
          {waiting ? 'Validando link de recuperacao' : canReset ? 'Defina uma nova senha' : 'Abra o link enviado por e-mail'}
        </h1>
        <p style={{ color:C.textSub, lineHeight:1.6, marginBottom:18 }}>
          {waiting
            ? 'Estamos verificando o link enviado pelo Supabase para liberar a redefinicao da senha.'
            : canReset
              ? 'Sua sessao esta em modo de recuperacao. Atualize a senha para concluir o fluxo.'
              : 'Acesse esta pagina pelo link de recuperacao enviado pelo Supabase para habilitar a troca de senha.'}
        </p>

        {waiting && <div style={{ color:C.textDim, fontSize:13 }}>Aguarde alguns segundos...</div>}

        {!waiting && canReset && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <FInput label="Nova senha" value={password} onChange={setPassword} type="password" placeholder="Minimo de 6 caracteres" required />
            <FInput label="Confirmar senha" value={confirmPassword} onChange={setConfirmPassword} type="password" placeholder="Repita a nova senha" required />
            <Btn onClick={submit} disabled={busy || !password || !confirmPassword} style={{ justifyContent:'center', display:'inline-flex' }}>
              {busy ? 'Atualizando...' : 'Salvar nova senha'}
            </Btn>
          </div>
        )}

        {error && (
          <div style={{ marginTop:16, background:C.red+'14', border:`1px solid ${C.red}33`, borderRadius:12, padding:'12px 14px', color:C.red, fontSize:13 }}>
            {error}
          </div>
        )}

        {message && (
          <div style={{ marginTop:16, background:C.green+'14', border:`1px solid ${C.green}33`, borderRadius:12, padding:'12px 14px', color:C.green, fontSize:13 }}>
            {message}
          </div>
        )}
      </Card>
    </div>
  )
}
