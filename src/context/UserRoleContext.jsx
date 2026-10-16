import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { canRoleAccess } from '../lib/roleAccess.js'
import { useAuth } from './AuthContext.jsx'

const UserRoleContext = createContext(null)

const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'
const E2E_USER_ID = import.meta.env.VITE_E2E_USER_ID || 'e2e-user-id'
const E2E_CLINIC_ID = import.meta.env.VITE_E2E_CLINIC_ID || 'e2e-clinic-id'
const E2E_ROLE = import.meta.env.VITE_E2E_ROLE || 'admin'
const E2E_CLINICAL_ACCESS = import.meta.env.VITE_E2E_CLINICAL_ACCESS !== 'false'

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
  const [clinicalAccess, setClinicalAccess] = useState(false)
  const [professionalName, setProfessionalName] = useState('')
  const [professionalRegistration, setProfessionalRegistration] = useState('')
  const [professionalCouncil, setProfessionalCouncil] = useState('CRM')

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
      setClinicalAccess(false)
      setProfessionalName('')
      setProfessionalRegistration('')
      setProfessionalCouncil('CRM')
      setLoading(true)
      return
    }
    setScopeError(false)
    setOwnerId(null) // limpa escopo do usuário anterior antes de reresolver (não vaza ownerId obsoleto)
    setClinicalAccess(false)
    setProfessionalName('')
    setProfessionalRegistration('')
    setProfessionalCouncil('CRM')

    // E2E: resolve o perfil configurado sem bater no Supabase (espelha o bypass do AuthContext).
    if (E2E_BYPASS_AUTH) {
      setRole(E2E_ROLE)
      setOwnerId(E2E_USER_ID)
      setClinicId(E2E_CLINIC_ID)
      setClinicName('Clínica E2E')
      setIsOwner(E2E_ROLE === 'admin')
      setClinicalAccess(E2E_CLINICAL_ACCESS)
      setProfessionalName('Dra. Clínica E2E')
      setProfessionalRegistration('CRM-E2E 0001')
      setProfessionalCouncil('CRM')
      setLoading(false)
      return
    }

    let mounted = true

    async function bootstrap() {
      setLoading(true)

      // 1. Verificar se já é owner de uma clínica.
      const { data: ownedClinic } = await supabase
        .from('clinics')
        .select('id, name, clinical_professional_name, clinical_professional_registration, clinical_professional_council')
        .eq('owner_id', user.id)
        .maybeSingle()

      if (!mounted) return

      if (ownedClinic) {
        setClinicId(ownedClinic.id)
        setClinicName(ownedClinic.name || '')
        setOwnerId(user.id)
        setRole('admin')
        setIsOwner(true)
        setClinicalAccess(true)
        setProfessionalName(ownedClinic.clinical_professional_name || '')
        setProfessionalRegistration(ownedClinic.clinical_professional_registration || '')
        setProfessionalCouncil(ownedClinic.clinical_professional_council || 'CRM')
        setLoading(false)
        return
      }

      // 2. Verificar se é membro de alguma clínica.
      const { data: membership } = await supabase
        .from('clinic_members')
        .select('clinic_id, role, clinical_access, professional_name, professional_registration, professional_council')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!mounted) return

      if (membership) {
        setClinicId(membership.clinic_id)
        setRole(membership.role)
        setIsOwner(false)
        setClinicalAccess(membership.clinical_access === true)
        setProfessionalName(membership.professional_name || '')
        setProfessionalRegistration(membership.professional_registration || '')
        setProfessionalCouncil(membership.professional_council || 'CRM')
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
        setClinicalAccess(true)
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
    clinicalAccess,
    professionalName,
    professionalRegistration,
    professionalCouncil,
    canAccess(sectionId) {
      return canRoleAccess(role, sectionId, { clinicalAccess })
    },
  }), [role, clinicId, clinicName, ownerId, isOwner, loading, scopeError, clinicalAccess, professionalName, professionalRegistration, professionalCouncil])

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
