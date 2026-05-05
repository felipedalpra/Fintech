import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getAppOrigin, hasSupabaseEnv, supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)
const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'

function mapAuthError(error, fallback) {
  return error?.message || fallback
}

function resolveVerifiedUser(session) {
  const nextUser = session?.user ?? null
  if (!nextUser?.email_confirmed_at) return null
  return nextUser
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)

  useEffect(() => {
    if (E2E_BYPASS_AUTH) {
      const mockSession = {
        user:{
          id:'e2e-user-id',
          email:'e2e@surgimetrics.local',
          email_confirmed_at:'2026-01-01T00:00:00.000Z',
          user_metadata:{ name:'E2E User' },
        },
      }
      setSession(mockSession)
      setUser(mockSession.user)
      setLoading(false)
      return
    }

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
      setUser(resolveVerifiedUser(data.session))
      setLoading(false)
    }

    bootstrap()

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession ?? null)
      setUser(resolveVerifiedUser(nextSession))
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
          emailRedirectTo: `${getAppOrigin()}/login`,
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
        redirectTo: `${getAppOrigin()}/reset-password`,
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
