import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { Btn, Card, FInput } from '../components/UI.jsx'
import { C } from '../theme.js'
import { hasSupabaseEnv } from '../lib/supabase.js'

export function ResetPasswordPage() {
  const { user, isRecoveryMode, updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  if (!hasSupabaseEnv) {
    return <Navigate to="/login" replace />
  }

  const canReset = Boolean(user && isRecoveryMode)

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
      setMessage('Senha atualizada com sucesso. Voce ja pode voltar para a area protegida.')
    } catch (nextError) {
      setError(nextError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:C.bg, padding:24 }}>
      <Card style={{ width:'min(460px, 100%)' }}>
        <div style={{ fontSize:12, color:C.accentLight, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>
          Recuperacao de senha
        </div>
        <h1 style={{ margin:'0 0 10px', fontSize:30 }}>
          {canReset ? 'Defina uma nova senha' : 'Abra o link enviado por e-mail'}
        </h1>
        <p style={{ color:C.textSub, lineHeight:1.6, marginBottom:18 }}>
          {canReset
            ? 'Sua sessao esta em modo de recuperacao. Atualize a senha para concluir o fluxo.'
            : 'Acesse esta pagina pelo link de recuperacao enviado pelo Supabase para habilitar a troca de senha.'}
        </p>

        {canReset && (
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
