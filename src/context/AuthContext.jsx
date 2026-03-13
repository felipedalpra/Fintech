import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { hasSupabaseEnv, supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)

function mapAuthError(error, fallback) {
  return error?.message || fallback
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)

  useEffect(() => {
    if (!hasSupabaseEnv) {
      setLoading(false)
      return
    }

    let mounted = true

    async function bootstrap() {
      const { data, error } = await supabase.auth.getSession()
      if (!mounted) return

      if (error) {
        setLoading(false)
        return
      }

      setSession(data.session ?? null)
      setUser(data.session?.user ?? null)
      setLoading(false)
    }

    bootstrap()

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession ?? null)
      setUser(nextSession?.user ?? null)
      setIsRecoveryMode(event === 'PASSWORD_RECOVERY')
      setLoading(false)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(() => ({
    session,
    user,
    loading,
    isRecoveryMode,
    async signIn({ email, password }) {
      if (!hasSupabaseEnv) throw new Error('Supabase nao configurado.')
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error(mapAuthError(error, 'Nao foi possivel entrar.'))
      if (!data?.user?.email_confirmed_at) {
        await supabase.auth.signOut()
        throw new Error('Confirme seu e-mail antes de acessar a plataforma.')
      }
    },
    async signUp({ name, email, password, billingCycle }) {
      if (!hasSupabaseEnv) throw new Error('Supabase nao configurado.')
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: {
            name: name.trim(),
            selected_billing_cycle: billingCycle || 'mensal',
          },
        },
      })

      if (error) throw new Error(mapAuthError(error, 'Nao foi possivel criar a conta.'))
    },
    async signOut() {
      if (!hasSupabaseEnv) return
      const { error } = await supabase.auth.signOut()
      if (error) throw new Error(mapAuthError(error, 'Nao foi possivel sair da conta.'))
    },
    async requestPasswordReset(email) {
      if (!hasSupabaseEnv) throw new Error('Supabase nao configurado.')
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (error) throw new Error(mapAuthError(error, 'Nao foi possivel enviar o link de recuperacao.'))
    },
    async updatePassword(password) {
      if (!hasSupabaseEnv) throw new Error('Supabase nao configurado.')
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw new Error(mapAuthError(error, 'Nao foi possivel atualizar a senha.'))
      setIsRecoveryMode(false)
    },
  }), [session, user, loading, isRecoveryMode])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
