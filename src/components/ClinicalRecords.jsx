import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../theme.js'
import { Btn } from './UI.jsx'
import { ClinicalAnamnesis } from './ClinicalAnamnesis.jsx'
import { ClinicalDocuments } from './ClinicalDocuments.jsx'
import { ClinicalIntake } from './ClinicalIntake.jsx'
import { ClinicalAssets } from './ClinicalAssets.jsx'
import { ClinicalTreatmentPlan } from './ClinicalTreatmentPlan.jsx'
import { MedicalRecord } from './MedicalRecord.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { canIssueClinicalPrescription } from '../lib/roleAccess.js'
import { fetchSecureProfile } from '../lib/secureProfileClient.js'
import { formatDateBR, today } from '../utils.js'
import {
  buildClinicalDaySchedule,
  millisecondsUntilNextLocalDay,
  patientAge,
  patientInitials,
  resolveSchedulePatient,
} from '../lib/clinicalWorkspace.js'
import './ClinicalRecords.css'

const CLINICAL_TABS = [
  { id:'record', label:'Prontuário' },
  { id:'summary', label:'Anamnese' },
  { id:'intake', label:'Pré-anamnese e termos' },
  { id:'prescriptions', label:'Exames e receitas' },
  { id:'files', label:'Fotos e documentos' },
  { id:'treatment', label:'Plano e retorno' },
]

export function ClinicalRecords({ data, setData }) {
  const { user } = useAuth()
  const { ownerId, clinicId, clinicName, isOwner, role, clinicalAccess, professionalName, professionalRegistration, professionalCouncil } = useUserRole()
  const [patients, setPatients] = useState([])
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('record')
  const [clinicalProfile, setClinicalProfile] = useState(null)
  const [anamnesisDraft, setAnamnesisDraft] = useState(null)
  const [clinicalAccessStatus, setClinicalAccessStatus] = useState('idle')
  const [profileStatus, setProfileStatus] = useState('idle')
  const [openAttempt, setOpenAttempt] = useState(0)
  const [currentDate, setCurrentDate] = useState(today)
  const [author, setAuthor] = useState({ name:professionalName || '', registration:professionalRegistration || '', council:professionalCouncil || 'CRM' })
  const [secureProfile, setSecureProfile] = useState(null)
  const [secureProfileStatus, setSecureProfileStatus] = useState('loading')
  const searchWrapRef = useRef(null)
  const daySchedule = useMemo(() => buildClinicalDaySchedule(data, currentDate), [data, currentDate])

  useEffect(() => {
    if (!ownerId) return
    loadPatients()
  }, [ownerId])

  useEffect(() => {
    setAuthor({ name:professionalName || '', registration:professionalRegistration || '', council:professionalCouncil || 'CRM' })
  }, [professionalName, professionalRegistration, professionalCouncil])

  useEffect(() => {
    let active = true
    setSecureProfileStatus('loading')
    fetchSecureProfile()
      .then(async payload => {
        if (!active) return
        setSecureProfile(payload?.profile || null)
        setSecureProfileStatus('ready')
        const nextAuthor = {
          name:payload?.profile?.doctor?.fullName || '',
          registration:payload?.profile?.doctor?.registrationId || '',
          council:'CRM',
        }
        if (isOwner && nextAuthor.name && nextAuthor.registration && clinicId) {
          const { error:syncError } = await supabase
            .from('clinics')
            .update({
              clinical_professional_name:nextAuthor.name,
              clinical_professional_registration:nextAuthor.registration,
              clinical_professional_council:nextAuthor.council,
            })
            .eq('id', clinicId)
          if (syncError) return
          if (active) setAuthor(nextAuthor)
        }
      })
      .catch(() => {
        if (!active) return
        setSecureProfile(null)
        setSecureProfileStatus('error')
      })
    return () => { active = false }
  }, [isOwner, clinicId])

  useEffect(() => {
    const close = event => {
      if (!searchWrapRef.current?.contains(event.target)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    let timeoutId
    const scheduleNextDay = () => {
      timeoutId = window.setTimeout(() => {
        setCurrentDate(today())
        scheduleNextDay()
      }, millisecondsUntilNextLocalDay())
    }
    const syncVisibleDate = () => {
      if (!document.hidden) setCurrentDate(today())
    }
    scheduleNextDay()
    document.addEventListener('visibilitychange', syncVisibleDate)
    return () => {
      window.clearTimeout(timeoutId)
      document.removeEventListener('visibilitychange', syncVisibleDate)
    }
  }, [])

  useEffect(() => {
    if (!selected?.id || !ownerId) return
    let active = true
    setClinicalAccessStatus('auditing')
    setProfileStatus('loading')
    setClinicalProfile(null)
    setError('')
    Promise.resolve()
      .then(async () => {
        const { error:auditError } = await supabase.rpc('log_clinical_record_access', {
          p_patient_id:selected.id,
          p_action:'view_record',
        })
        if (auditError) throw new Error('Não foi possível auditar a abertura da ficha clínica.')
        if (!active) return
        setClinicalAccessStatus('ready')
        const { data:profile, error:profileError } = await supabase
          .from('patient_clinical_profiles')
          .select('*')
          .eq('patient_id', selected.id)
          .eq('user_id', ownerId)
          .maybeSingle()
        if (profileError) {
          if (active) {
            setProfileStatus('error')
            setError('Não foi possível carregar os alertas e a anamnese do paciente.')
          }
          return
        }
        if (active) {
          setClinicalProfile(profile || null)
          setProfileStatus('ready')
        }
      })
      .catch(nextError => {
        if (active) {
          setClinicalAccessStatus('error')
          setProfileStatus('error')
          setError(nextError.message || 'Não foi possível abrir a ficha clínica.')
        }
      })
    return () => { active = false }
  }, [selected?.id, ownerId, openAttempt])

  async function loadPatients() {
    setLoading(true)
    setError('')
    const { data:rows, error:loadError } = await supabase
      .from('patients')
      .select('id, full_name, cpf, date_of_birth, sex, phone, email, address_street, address_number, address_complement, address_district, address_city, address_state, address_zip, start_date, active')
      .eq('user_id', ownerId)
      .eq('active', true)
      .order('full_name')
    if (loadError) setError(loadError.message || 'Não foi possível carregar os pacientes.')
    setPatients(rows || [])
    setLoading(false)
  }

  function selectPatient(patient) {
    setClinicalAccessStatus('auditing')
    setProfileStatus('loading')
    setClinicalProfile(null)
    setAnamnesisDraft(null)
    setOpenAttempt(value => value + 1)
    setSelected(patient)
    setTab('record')
    setSearch('')
    setSearchOpen(false)
    setError('')
  }

  function openAppointment(item) {
    const patient = resolveSchedulePatient(item, patients)
    if (!patient) {
      setSearch(item.patientName === 'Paciente não identificado' ? '' : item.patientName)
      setSearchOpen(true)
      setError('Este atendimento não está vinculado a um paciente ativo. Selecione o cadastro correto pela busca; a agenda não abrirá prontuários automaticamente pelo nome.')
      return
    }
    selectPatient(patient)
  }

  function returnToAgenda() {
    setSelected(null)
    setClinicalProfile(null)
    setAnamnesisDraft(null)
    setClinicalAccessStatus('idle')
    setProfileStatus('idle')
    setTab('record')
    setError('')
  }

  const filteredPatients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    if (!query) return patients.slice(0, 8)
    return patients.filter(patient => [patient.full_name, patient.phone, patient.email]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query)))
      .slice(0, 12)
  }, [patients, search])

  const selectedAppointments = useMemo(() => {
    if (!selected) return []
    return daySchedule.filter(item => item.patientId === selected.id)
  }, [daySchedule, selected])

  const themeVars = {
    '--clinical-bg':C.bg,
    '--clinical-surface':C.surface,
    '--clinical-card':C.card,
    '--clinical-hover':C.cardHover,
    '--clinical-border':C.border,
    '--clinical-border-bright':C.borderBright,
    '--clinical-text':C.text,
    '--clinical-sub':C.textSub,
    '--clinical-dim':C.textDim,
    '--clinical-accent':C.accent,
    '--clinical-green':C.green,
    '--clinical-yellow':C.yellow,
    '--clinical-red':C.red,
    '--clinical-purple':C.purple,
  }

  return (
    <div className="clinical-workspace" data-testid="clinical-records-page" style={themeVars}>
      <div className="clinical-toolbar">
        <button type="button" className={`clinical-home-button${selected ? '' : ' is-active'}`} onClick={returnToAgenda}>
          <span className="clinical-home-button__icon">▦</span>
          <span><strong>Agenda do dia</strong><small>{daySchedule.length} atendimento{daySchedule.length === 1 ? '' : 's'}</small></span>
        </button>

        <div className="clinical-patient-search" ref={searchWrapRef}>
          <span aria-hidden="true" className="clinical-search-icon">⌕</span>
          <input
            value={search}
            onChange={event => { setSearch(event.target.value); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Buscar paciente por nome, telefone ou e-mail"
            aria-label="Buscar paciente"
          />
          {searchOpen && (
            <div className="clinical-search-results" role="listbox" aria-label="Pacientes encontrados">
              {loading && <div className="clinical-search-empty">Carregando pacientes…</div>}
              {!loading && filteredPatients.length === 0 && <div className="clinical-search-empty">Nenhum paciente encontrado.</div>}
              {filteredPatients.map(patient => (
                <button key={patient.id} type="button" role="option" aria-selected={selected?.id === patient.id} onClick={() => selectPatient(patient)}>
                  <PatientAvatar patient={patient} small />
                  <span><strong>{patient.full_name}</strong><small>{patient.phone || patient.email || 'Contato não informado'}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && <div className="clinical-toolbar-context"><span>Ficha aberta</span><strong>{selected.full_name}</strong></div>}
      </div>

      {error && <div className="clinical-alert" role="alert">{error}</div>}

      {!selected ? (
        <DayAgenda date={currentDate} schedule={daySchedule} patients={patients} loading={loading} onAppointment={openAppointment} onPatient={selectPatient} />
      ) : (
        <div className="clinical-patient-workspace">
          <PatientHeader patient={selected} profile={clinicalProfile} profileStatus={profileStatus} appointments={selectedAppointments} />
          {clinicalAccessStatus === 'auditing' && <div className="clinical-loading">Abrindo ficha com auditoria…</div>}
          {clinicalAccessStatus === 'error' && <ClinicalOpenError onRetry={() => setOpenAttempt(value => value + 1)} />}
          {clinicalAccessStatus === 'ready' && (
            <>
              <nav className="clinical-tabs" aria-label="Ficha clínica do paciente">
                {CLINICAL_TABS.map(item => (
                  <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>
                    {item.label}
                  </button>
                ))}
              </nav>
              <div className="clinical-tab-content">
                {tab === 'record' && <MedicalRecord patientId={selected.id} userId={ownerId} actorId={user?.id} author={author} />}
                {tab === 'summary' && profileStatus === 'loading' && <div className="clinical-loading">Carregando anamnese…</div>}
                {tab === 'summary' && profileStatus === 'error' && <div className="clinical-empty-panel">Anamnese indisponível no momento.</div>}
                {tab === 'summary' && profileStatus === 'ready' && (
                  <ClinicalAnamnesis
                    patientId={selected.id}
                    ownerId={ownerId}
                    author={author}
                    legacyProfile={clinicalProfile}
                    initialDraft={anamnesisDraft}
                    onDraftConsumed={() => setAnamnesisDraft(null)}
                  />
                )}
                {tab === 'intake' && (
                  <ClinicalIntake
                    patient={selected}
                    ownerId={ownerId}
                    onUseDraft={draft => {
                      setAnamnesisDraft(draft)
                      setTab('summary')
                    }}
                  />
                )}
                {tab === 'prescriptions' && (
                  <ClinicalDocuments
                    patient={selected}
                    ownerId={ownerId}
                    author={author}
                    profile={secureProfile}
                    profileLoading={secureProfileStatus === 'loading'}
                    clinicName={clinicName}
                    canPrescribe={canIssueClinicalPrescription(role, { clinicalAccess })}
                  />
                )}
                {tab === 'files' && <ClinicalAssets patient={selected} ownerId={ownerId} />}
                {tab === 'treatment' && <ClinicalTreatmentPlan patient={selected} ownerId={ownerId} data={data} setData={setData} />}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DayAgenda({ date, schedule, patients, loading, onAppointment, onPatient }) {
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long' })
  return (
    <section className="clinical-day" data-testid="clinical-day-agenda">
      <header className="clinical-day__header">
        <div><span>Atendimentos de hoje</span><h2>{dateLabel}</h2></div>
        <div className="clinical-day__summary"><strong>{schedule.length}</strong><span>na agenda</span></div>
      </header>

      {schedule.length > 0 ? (
        <div className="clinical-agenda-list">
          {schedule.map((item, index) => (
            <button key={item.id} type="button" onClick={() => onAppointment(item)} className="clinical-agenda-row">
              <span className="clinical-agenda-row__time">{item.time || '—'}</span>
              <span className={`clinical-agenda-row__marker is-${item.kind}`} />
              <span className="clinical-agenda-row__body"><strong>{item.patientName}</strong><small>{item.label} · {item.durationMinutes} min</small></span>
              <span className="clinical-agenda-row__position">{String(index + 1).padStart(2, '0')}</span>
              <span className="clinical-agenda-row__action">Abrir ficha →</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="clinical-agenda-empty">
          <div className="clinical-agenda-empty__icon">✓</div>
          <div><strong>Nenhum atendimento na agenda de hoje</strong><span>Use a busca acima ou abra um dos pacientes recentes.</span></div>
        </div>
      )}

      {schedule.length === 0 && !loading && patients.length > 0 && (
        <div className="clinical-recent-patients">
          <div className="clinical-section-label">Pacientes disponíveis</div>
          <div>
            {patients.slice(0, 6).map(patient => (
              <button key={patient.id} type="button" onClick={() => onPatient(patient)}>
                <PatientAvatar patient={patient} small />
                <span><strong>{patient.full_name}</strong><small>{patient.phone || 'Sem telefone'}</small></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function PatientAvatar({ patient, small = false }) {
  return <span className={`clinical-avatar${small ? ' is-small' : ''}`} aria-hidden="true">{patientInitials(patient?.full_name)}</span>
}

function PatientHeader({ patient, profile, profileStatus, appointments }) {
  const age = patientAge(patient.date_of_birth)
  const alertItems = [
    profile?.allergies ? { label:`Alergias: ${profile.allergies}`, tone:'danger' } : null,
    profile?.current_medications ? { label:`Em uso: ${profile.current_medications}`, tone:'warn' } : null,
  ].filter(Boolean)
  return (
    <header className="clinical-patient-header">
      <PatientAvatar patient={patient} />
      <div className="clinical-patient-header__identity">
        <div><h2>{patient.full_name}</h2><span>Paciente ativo</span></div>
        <p>{patient.date_of_birth ? `${formatDateBR(patient.date_of_birth)}${age !== null ? ` · ${age} anos` : ''}` : 'Nascimento não informado'}{patient.phone ? ` · ${patient.phone}` : ''}{patient.email ? ` · ${patient.email}` : ''}</p>
      </div>
      <div className="clinical-patient-header__alerts">
        {profileStatus === 'loading' && <span className="is-muted">Verificando alertas…</span>}
        {profileStatus === 'error' && <span className="is-warn">Alertas indisponíveis</span>}
        {profileStatus === 'ready' && alertItems.length === 0 && <span className="is-ok">Sem alertas registrados</span>}
        {profileStatus === 'ready' && alertItems.map(item => <span key={item.label} className={`is-${item.tone}`} title={item.label}>{item.label}</span>)}
      </div>
      <div className="clinical-patient-header__today"><span>Hoje</span><strong>{appointments[0]?.time || 'Sem horário'}</strong><small>{appointments[0]?.label || 'Ficha avulsa'}</small></div>
    </header>
  )
}

function ClinicalOpenError({ onRetry }) {
  return (
    <div className="clinical-empty-panel">
      <p>Os dados clínicos não foram abertos porque a auditoria não pôde ser confirmada.</p>
      <Btn variant="ghost" onClick={onRetry}>Tentar novamente</Btn>
    </div>
  )
}
