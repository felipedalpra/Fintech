import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from './AuthContext.jsx'

const UserRoleContext = createContext(null)

const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'
const E2E_USER_ID = import.meta.env.VITE_E2E_USER_ID || 'e2e-user-id'
const E2E_CLINIC_ID = import.meta.env.VITE_E2E_CLINIC_ID || 'e2e-clinic-id'

const ROLE_ACCESS = {
  admin: [
    'dashboard', 'meu-dia', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'crm-painel', 'inbox', 'ads', 'tarefas',
    'finance', 'bank-reconciliation', 'goals', 'recurrences', 'reports', 'ledger-check', 'chart-of-accounts', 'ai', 'billing', 'settings',
  ],
  gestao: [
    'dashboard', 'meu-dia', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'crm-painel', 'inbox', 'ads', 'tarefas',
    'finance', 'bank-reconciliation', 'goals', 'recurrences', 'reports', 'ledger-check', 'chart-of-accounts', 'ai',
  ],
  // Jonas (concierge): pode cadastrar cirurgias, consultas e orçamentos — sem acesso financeiro
  concierge: [
    'meu-dia', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'inbox', 'tarefas',
  ],
  // Sumary, Jessica, Joyce: agenda, pacientes, consultas e produtos apenas
  equipe: [
    'meu-dia', 'consultations', 'calendar', 'products', 'patients', 'funnel', 'inbox', 'tarefas',
  ],
}

export function UserRoleProvider({ children }) {
  const { user } = useAuth()
  const [role, setRole] = useState(null)
  const [clinicId, setClinicId] = useState(null)
  const [clinicName, setClinicName] = useState('')
  const [ownerId, setOwnerId] = useState(null)
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  // Membro confirmado cujo escopo da clínica (data_owner_id) não resolveu. NUNCA cair pro
  // user.id nesse caso (gravaria dado órfão/veria vazio) — o app bloqueia e avisa.
  const [scopeError, setScopeError] = useState(false)

  useEffect(() => {
    if (!user) {
      // Sem user ainda = role indeterminado. Manter loading=true (NÃO false): se setássemos
      // false com role=null, o guard de rota do workspace redirecionaria pra dashboard no gap
      // entre o auth resolver e o role resolver. Logout real é tratado pelo ProtectedRoute.
      setRole(null)
      setClinicId(null)
      setOwnerId(null)
      setIsOwner(false)
      setScopeError(false)
      setLoading(true)
      return
    }
    setScopeError(false)
    setOwnerId(null) // limpa escopo do usuário anterior antes de reresolver (não vaza ownerId obsoleto)

    // E2E: concede admin sem bater no Supabase (espelha o bypass do AuthContext).
    if (E2E_BYPASS_AUTH) {
      setRole('admin')
      setOwnerId(E2E_USER_ID)
      setClinicId(E2E_CLINIC_ID)
      setClinicName('Clínica E2E')
      setIsOwner(true)
      setLoading(false)
      return
    }

    let mounted = true

    async function bootstrap() {
      setLoading(true)

      // 1. Verificar se já é owner de uma clínica.
      const { data: ownedClinic } = await supabase
        .from('clinics')
        .select('id, name')
        .eq('owner_id', user.id)
        .maybeSingle()

      if (!mounted) return

      if (ownedClinic) {
        setClinicId(ownedClinic.id)
        setClinicName(ownedClinic.name || '')
        setOwnerId(user.id)
        setRole('admin')
        setIsOwner(true)
        setLoading(false)
        return
      }

      // 2. Verificar se é membro de alguma clínica.
      const { data: membership } = await supabase
        .from('clinic_members')
        .select('clinic_id, role')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!mounted) return

      if (membership) {
        setClinicId(membership.clinic_id)
        setRole(membership.role)
        setIsOwner(false)
        // data_owner_id() é SECURITY DEFINER — funciona mesmo sem leitura direta em clinics
        let res = await supabase.rpc('data_owner_id')
        if (!res.data) {
          await new Promise(r => setTimeout(r, 400)) // blip de rede: espera curta antes do retry
          res = await supabase.rpc('data_owner_id')
        }
        if (!mounted) return
        if (!res.data) {
          // Membro confirmado mas o escopo não resolveu. NÃO usar user.id (gravaria órfão / veria
          // vazio em silêncio — o bug que o Felipe teme). Bloqueia e avisa; recarregar tenta de novo.
          console.error('[UserRoleContext] escopo da clínica não resolveu para membro:', res.error)
          setScopeError(true)
          setLoading(false)
          return
        }
        setOwnerId(res.data)
        // nome da clínica: tenta buscar, mas não trava se RLS bloquear
        const { data: memberClinic } = await supabase
          .from('clinics')
          .select('name')
          .eq('id', membership.clinic_id)
          .maybeSingle()
        if (!mounted) return
        if (memberClinic?.name) setClinicName(memberClinic.name)
        setLoading(false)
        return
      }

      // 3. Primeiro acesso: criar clínica automaticamente.
      const { data: newClinic, error } = await supabase
        .from('clinics')
        .insert({ owner_id: user.id, name: 'Minha Clínica' })
        .select('id, name')
        .single()

      if (!mounted) return

      if (!error && newClinic) {
        setClinicId(newClinic.id)
        setClinicName(newClinic.name || '')
        setOwnerId(user.id)
        setRole('admin')
        setIsOwner(true)
      }

      setLoading(false)
    }

    bootstrap()
    return () => { mounted = false }
  }, [user])

  const value = useMemo(() => ({
    role,
    clinicId,
    clinicName,
    ownerId,
    isOwner,
    loading,
    scopeError,
    canAccess(sectionId) {
      if (!role) return false
      return (ROLE_ACCESS[role] ?? []).includes(sectionId)
    },
  }), [role, clinicId, clinicName, ownerId, isOwner, loading, scopeError])

  return (
    <UserRoleContext.Provider value={value}>
      {children}
    </UserRoleContext.Provider>
  )
}

export function useUserRole() {
  const ctx = useContext(UserRoleContext)
  if (!ctx) throw new Error('useUserRole must be used within UserRoleProvider')
  return ctx
}
