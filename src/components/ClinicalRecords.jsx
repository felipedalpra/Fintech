import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { Card, Btn } from './UI.jsx'
import { MedicalRecord } from './MedicalRecord.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { fetchSecureProfile } from '../lib/secureProfileClient.js'
import { formatDateBR } from '../utils.js'

export function ClinicalRecords() {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false
  const { user } = useAuth()
  const {
    ownerId,
    clinicId,
    isOwner,
    professionalName,
    professionalRegistration,
    professionalCouncil,
  } = useUserRole()
  const [patients, setPatients] = useState([])
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('record')
  const [clinicalProfile, setClinicalProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [author, setAuthor] = useState({ name:professionalName || '', registration:professionalRegistration || '', council:professionalCouncil || 'CRM' })

  useEffect(() => {
    if (!ownerId) return
    loadPatients()
  }, [ownerId])

  useEffect(() => {
    setAuthor({ name:professionalName || '', registration:professionalRegistration || '', council:professionalCouncil || 'CRM' })
  }, [professionalName, professionalRegistration, professionalCouncil])

  useEffect(() => {
    if (!isOwner) return
    let active = true
    fetchSecureProfile()
      .then(async payload => {
        if (!active) return
        const nextAuthor = {
          name:payload?.profile?.doctor?.fullName || '',
          registration:payload?.profile?.doctor?.registrationId || '',
          council:'CRM',
        }
        if (nextAuthor.name && nextAuthor.registration && clinicId) {
          const { error:syncError } = await supabase
            .from('clinics')
            .update({
              clinical_professional_name:nextAuthor.name,
              clinical_professional_registration:nextAuthor.registration,
              clinical_professional_council:nextAuthor.council,
            })
            .eq('id', clinicId)
          if (syncError) throw syncError
          if (active) setAuthor(nextAuthor)
        }
      })
      .catch(() => {})
    return () => { active = false }
  }, [isOwner, clinicId])

  async function loadPatients() {
    setLoading(true)
    setError('')
    const { data, error:loadError } = await supabase
      .from('patients')
      .select('id, full_name, date_of_birth, sex, phone, start_date, active')
      .eq('user_id', ownerId)
      .eq('active', true)
      .order('full_name')
    if (loadError) setError(loadError.message || 'Não foi possível carregar os pacientes.')
    setPatients(data || [])
    setLoading(false)
  }

  function selectPatient(patient) {
    setSelected(patient)
    setTab('record')
    setClinicalProfile(null)
    setError('')
  }

  async function openClinicalSummary() {
    if (!selected || tab === 'summary') return
    setTab('summary')
    setProfileLoading(true)
    setError('')
    const { error:auditError } = await supabase.rpc('log_clinical_record_access', {
      p_patient_id:selected.id,
      p_action:'view_record',
    })
    if (auditError) {
      setError('Não foi possível auditar o acesso. O resumo clínico não foi aberto.')
      setProfileLoading(false)
      return
    }
    const { data, error:profileError } = await supabase
      .from('patient_clinical_profiles')
      .select('*')
      .eq('patient_id', selected.id)
      .eq('user_id', ownerId)
      .maybeSingle()
    if (profileError) setError(profileError.message || 'Não foi possível carregar o resumo clínico.')
    setClinicalProfile(data || null)
    setProfileLoading(false)
  }

  const filteredPatients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    if (!query) return patients
    return patients.filter(patient => [patient.full_name, patient.phone].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query)))
  }, [patients, search])

  return (
    <div data-testid="clinical-records-page" style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'minmax(240px, 320px) minmax(0, 1fr)', gap:18, alignItems:'start' }}>
      <Card style={{ padding:0, overflow:'hidden' }}>
        <div style={{ padding:16, borderBottom:`1px solid ${C.border}` }}>
          <div style={{ color:C.text, fontWeight:800, fontSize:16 }}>Pacientes</div>
          <div style={{ color:C.textDim, fontSize:11, marginTop:3 }}>Somente pacientes ativos desta clínica</div>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nome ou telefone" style={{ width:'100%', boxSizing:'border-box', marginTop:12, padding:'9px 11px', borderRadius:9, border:`1px solid ${C.border}`, background:C.bg, color:C.text }} />
        </div>
        <div style={{ maxHeight:isMobile ? 260 : 'calc(100vh - 280px)', overflowY:'auto' }}>
          {loading && <div style={{ padding:18, color:C.textDim, fontSize:12 }}>Carregando…</div>}
          {!loading && filteredPatients.length === 0 && <div style={{ padding:18, color:C.textDim, fontSize:12 }}>Nenhum paciente encontrado.</div>}
          {filteredPatients.map(patient => (
            <button key={patient.id} type="button" onClick={() => selectPatient(patient)} style={{ width:'100%', textAlign:'left', padding:'12px 16px', border:'none', borderBottom:`1px solid ${C.border}`, background:selected?.id === patient.id ? C.accent + '18' : 'transparent', color:C.text, cursor:'pointer', fontFamily:'inherit' }}>
              <div style={{ fontSize:13, fontWeight:700 }}>{patient.full_name}</div>
              <div style={{ fontSize:11, color:C.textDim, marginTop:3 }}>{patient.date_of_birth ? formatDateBR(patient.date_of_birth) : 'Nascimento não informado'}{patient.phone ? ` · ${patient.phone}` : ''}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card style={{ minHeight:420 }}>
        {!selected ? (
          <div style={{ display:'grid', placeItems:'center', minHeight:360, textAlign:'center', color:C.textDim, fontSize:13 }}>Selecione um paciente para abrir o prontuário.</div>
        ) : (
          <div style={{ display:'grid', gap:18 }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:14, alignItems:'flex-start', flexWrap:'wrap', paddingBottom:14, borderBottom:`1px solid ${C.border}` }}>
              <div>
                <h2 style={{ margin:0, color:C.text, fontSize:20 }}>{selected.full_name}</h2>
                <div style={{ color:C.textDim, fontSize:11, marginTop:5 }}>{selected.date_of_birth ? `Nascimento: ${formatDateBR(selected.date_of_birth)}` : 'Nascimento não informado'}{selected.start_date ? ` · Em acompanhamento desde ${formatDateBR(selected.start_date)}` : ''}</div>
              </div>
              <div style={{ display:'flex', gap:7 }}>
                <Btn variant={tab === 'record' ? undefined : 'ghost'} onClick={() => setTab('record')}>Prontuário</Btn>
                <Btn variant={tab === 'summary' ? undefined : 'ghost'} onClick={openClinicalSummary}>Resumo clínico</Btn>
              </div>
            </div>

            {error && <div role="alert" style={{ color:C.red, fontSize:12 }}>{error}</div>}
            {tab === 'record' && (
              <MedicalRecord patientId={selected.id} userId={ownerId} actorId={user?.id} author={author} />
            )}
            {tab === 'summary' && (
              profileLoading ? <div style={{ color:C.textDim, fontSize:12 }}>Carregando resumo com auditoria…</div> : <ClinicalSummary profile={clinicalProfile} />
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function ClinicalSummary({ profile }) {
  if (!profile) return <div style={{ color:C.textDim, fontSize:13, padding:'24px 0', textAlign:'center' }}>Anamnese clínica ainda não registrada.</div>
  const fields = [
    ['Queixa principal', profile.chief_complaint],
    ['História da doença atual', profile.hda],
    ['Alergias', profile.allergies],
    ['Doenças crônicas', profile.chronic_diseases],
    ['Medicamentos em uso', profile.current_medications],
    ['Cirurgias anteriores', profile.previous_surgeries],
    ['Internações', profile.hospitalizations],
    ['Tabagismo', profile.smoking],
    ['Etilismo', profile.alcohol],
    ['Atividade física', profile.physical_activity],
    ['Antecedentes familiares', profile.family_history],
    ['Antecedentes ginecológicos', profile.gynecological_history],
    ['Observações', profile.clinical_notes],
  ].filter(([, value]) => value)
  return (
    <div style={{ display:'grid', gap:10 }}>
      {fields.length === 0 && <div style={{ color:C.textDim, fontSize:13 }}>Anamnese sem informações preenchidas.</div>}
      {fields.map(([label, value]) => (
        <div key={label} style={{ padding:'11px 13px', borderRadius:10, border:`1px solid ${C.border}`, background:C.surface }}>
          <div style={{ color:C.textDim, fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.07em' }}>{label}</div>
          <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6, whiteSpace:'pre-wrap', marginTop:5 }}>{value}</div>
        </div>
      ))}
      <div style={{ color:profile.consent_signed ? C.green : C.yellow, fontSize:12, fontWeight:700 }}>TCLE: {profile.consent_signed ? `assinado${profile.consent_date ? ` em ${formatDateBR(profile.consent_date)}` : ''}` : 'pendente'}</div>
    </div>
  )
}
