import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { loadWorkspacePreferences, saveWorkspacePreferences } from '../lib/operationalWorkspace.js'

export function OperationalOnboarding({ data = {} }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id
  const [remote, setRemote] = useState({ whatsapp:0, contacts:0 })
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (!effectiveUserId || !user?.id) return
    let active = true
    Promise.all([
      loadWorkspacePreferences(effectiveUserId, user.id),
      supabase.from('whatsapp_numbers').select('id', { count:'exact', head:true }).eq('active', true),
      supabase.from('crm_contacts').select('id', { count:'exact', head:true }).eq('user_id', effectiveUserId),
    ]).then(([preferences, whatsapp, contacts]) => {
      if (!active) return
      setDismissed(Boolean(preferences.data?.onboarding_dismissed_at))
      setRemote({ whatsapp:whatsapp.count || 0, contacts:contacts.count || 0 })
    })
    return () => { active = false }
  }, [effectiveUserId, user?.id])

  const steps = useMemo(() => [
    { label:'Conectar WhatsApp', done:remote.whatsapp > 0, go:'settings' },
    { label:'Revisar plano de contas', done:(data.chartAccounts || []).length > 0, go:'chart-of-accounts' },
    { label:'Cadastrar primeiro contato', done:remote.contacts > 0 || (data.patients || []).length > 0, go:'inbox' },
    { label:'Registrar primeiro lançamento', done:(data.expenses || []).length + (data.extraRevenues || []).length > 0, go:'finance' },
    { label:'Importar e conciliar extrato', done:false, go:'bank-reconciliation' },
  ], [data, remote])
  const done = steps.filter(step => step.done).length
  if (dismissed || done === steps.length) return null

  async function dismiss() {
    setDismissed(true)
    await saveWorkspacePreferences(effectiveUserId, user.id, { onboarding_dismissed_at:new Date().toISOString() })
  }

  return <div style={{ gridColumn:'1 / -1', padding:18, borderRadius:16, border:`1px solid ${C.accent}44`, background:`linear-gradient(135deg, ${C.accent}16, ${C.card})` }}>
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'start' }}><div><div style={{ color:C.accentLight, fontSize:11, fontWeight:900, textTransform:'uppercase', letterSpacing:'.08em' }}>Primeiros passos · {done}/{steps.length}</div><h3 style={{ margin:'5px 0 0', color:C.text, fontSize:18 }}>Deixe a clínica pronta para operar</h3></div><button onClick={dismiss} style={{ border:0, background:'transparent', color:C.textDim, cursor:'pointer' }}>Ocultar</button></div>
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))', gap:8, marginTop:14 }}>{steps.map((step, index) => <button key={step.label} onClick={() => navigate(`/app/${step.go}`)} style={{ display:'flex', gap:9, alignItems:'center', padding:'10px 12px', borderRadius:11, border:`1px solid ${step.done ? C.green + '55' : C.border}`, background:step.done ? C.green + '12' : C.surface, color:step.done ? C.green : C.textSub, cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}><span style={{ fontWeight:900 }}>{step.done ? '✓' : index + 1}</span><span style={{ fontSize:12, fontWeight:700 }}>{step.label}</span></button>)}</div>
  </div>
}
