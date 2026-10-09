import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from './AuthContext.jsx'

const UserRoleContext = createContext(null)

const ROLE_ACCESS = {
  admin: [
    'dashboard', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients',
    'finance', 'impostos', 'goals', 'recurrences', 'reports', 'ai', 'billing', 'settings',
  ],
  gestao: [
    'dashboard', 'plans', 'sales', 'consultations', 'calendar', 'products', 'patients',
    'finance', 'impostos', 'goals', 'recurrences', 'reports', 'ai',
  ],
  equipe: [
    'dashboard', 'plans', 'sales', 'consultations', 'calendar', 'patients',
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

  useEffect(() => {
    if (!user) {
      setRole(null)
      setClinicId(null)
      setIsOwner(false)
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
        const { data: memberClinic } = await supabase
          .from('clinics')
          .select('id, name, owner_id')
          .eq('id', membership.clinic_id)
          .maybeSingle()
        if (!mounted) return
        setClinicName(memberClinic?.name || '')
        setOwnerId(memberClinic?.owner_id || null)
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
    canAccess(sectionId) {
      if (!role) return false
      return (ROLE_ACCESS[role] ?? []).includes(sectionId)
    },
  }), [role, clinicId, clinicName, ownerId, isOwner, loading])

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
