import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { Btn } from './UI.jsx'
import { ClinicalAnamnesis } from './ClinicalAnamnesis.jsx'
import { ClinicalDocuments } from './ClinicalDocuments.jsx'
import { ClinicalIntake } from './ClinicalIntake.jsx'
import { ClinicalAssets } from './ClinicalAssets.jsx'
import { ClinicalTreatmentPlan } from './ClinicalTreatmentPlan.jsx'
import { ClinicalProtocols } from './ClinicalProtocols.jsx'
import { MedicalRecord } from './MedicalRecord.jsx'
import {
  ClinicalDocumentsCenter,
  ClinicalPatientSummary,
  ClinicalPatientTimeline,
  ClinicalPatientsView,
  ClinicalPendingView,
  ClinicalTodayInsights,
} from './ClinicalWorkspaceViews.jsx'
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
import { buildClinicalWorkspaceIndex } from '../lib/clinicalWorkspaceIndex.js'
import { emptyClinicalWorkspaceSources, loadClinicalWorkspaceSources } from '../lib/clinicalWorkspaceIndexClient.js'
import './ClinicalRecords.css'

const CLINICAL_MODULES = [
  { id:'today', route:'clinical-records', label:'Hoje' },
  { id:'patients', route:'clinical-patients', label:'Pacientes' },
  { id:'pending', route:'clinical-pending', label:'Pendências' },
  { id:'protocols', route:'clinical-protocols', label:'Protocolos' },
  { id:'documents', route:'clinical-documents', label:'Documentos' },
]

const CLINICAL_TABS = [
  { id:'overview', label:'Resumo' },
  { id:'record', label:'Prontuário' },
  { id:'timeline', label:'Linha do tempo' },
  { id:'summary', label:'Anamnese' },
  { id:'intake', label:'Pré-anamnese e termos' },
  { id:'prescriptions', label:'Exames e receitas' },
  { id:'files', label:'Fotos e documentos' },
  { id:'treatment', label:'Plano e retorno' },
]

export function ClinicalRecords({ data, setData, initialView = 'today' }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { ownerId, clinicId, clinicName, isOwner, role, clinicalAccess, professionalName, professionalRegistration, professionalCouncil } = useUserRole()
  const [patients, setPatients] = useState([])
  const [selected, setSelected] = useState(null)
  const [moduleView, setModuleView] = useState(initialView)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('overview')
  const [clinicalProfile, setClinicalProfile] = useState(null)
  const [anamnesisDraft, setAnamnesisDraft] = useState(null)
  const [clinicalAccessStatus, setClinicalAccessStatus] = useState('idle')
  const [profileStatus, setProfileStatus] = useState('idle')
  const [openAttempt, setOpenAttempt] = useState(0)
  const [currentDate, setCurrentDate] = useState(today)
  const [author, setAuthor] = useState({ name:professionalName || '', registration:professionalRegistration || '', council:professionalCouncil || 'CRM' })
  const [secureProfile, setSecureProfile] = useState(null)
  const [secureProfileStatus, setSecureProfileStatus] = useState('loading')
  const [workspaceSources, setWorkspaceSources] = useState(emptyClinicalWorkspaceSources)
  const [workspaceStatus, setWorkspaceStatus] = useState('loading')
  const searchWrapRef = useRef(null)
  const daySchedule = useMemo(() => buildClinicalDaySchedule(data, currentDate), [data, currentDate])
  const workspaceIndex = useMemo(() => buildClinicalWorkspaceIndex({
    ...workspaceSources,
    patients,
    data,
  }), [workspaceSources, patients, data])

  useEffect(() => {
    setModuleView(initialView)
    setSelected(null)
    setClinicalProfile(null)
    setClinicalAccessStatus('idle')
    setProfileStatus('idle')
    setTab('overview')
  }, [initialView])

  useEffect(() => {
    if (!ownerId) return
    loadPatients()
    loadWorkspaceIndex()
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

  async function loadWorkspaceIndex() {
    if (!ownerId) return
    setWorkspaceStatus('loading')
    const sources = await loadClinicalWorkspaceSources(ownerId)
    setWorkspaceSources(sources)
    setWorkspaceStatus('ready')
  }

  function selectPatient(patient, initialTab = 'overview') {
    setModuleView('patient')
    setClinicalAccessStatus('auditing')
    setProfileStatus('loading')
    setClinicalProfile(null)
    setAnamnesisDraft(null)
    setOpenAttempt(value => value + 1)
    setSelected(patient)
    setTab(initialTab)
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
    selectPatient(patient, 'record')
  }

  function navigateModule(view) {
    const module = CLINICAL_MODULES.find(item => item.id === view)
    if (!module) return
    setModuleView(view)
    setSelected(null)
    setClinicalProfile(null)
    setAnamnesisDraft(null)
    setClinicalAccessStatus('idle')
    setProfileStatus('idle')
    setTab('overview')
    setError('')
    if (view !== 'protocols') loadWorkspaceIndex()
    navigate(`/app/${module.route}`)
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
  const selectedIndex = selected ? workspaceIndex.patientItems.find(item => item.id === selected.id) : null
  const selectedTimeline = selected ? workspaceIndex.timelineByPatient.get(selected.id) || [] : []
  const moduleCounts = {
    today:daySchedule.length,
    patients:patients.length,
    pending:workspaceIndex.pendingItems.length,
    documents:workspaceIndex.documents.length,
  }

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
        <button type="button" className="clinical-home-button is-active" onClick={() => navigateModule('today')}>
          <span className="clinical-home-button__icon">✚</span>
          <span><strong>Workspace clínico</strong><small>Cuidado e continuidade</small></span>
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
                <button key={patient.id} type="button" role="option" aria-selected={selected?.id === patient.id} onClick={() => selectPatient(patient, 'overview')}>
                  <PatientAvatar patient={patient} small />
                  <span><strong>{patient.full_name}</strong><small>{patient.phone || patient.email || 'Contato não informado'}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="clinical-toolbar-context"><span>{selected ? 'Ficha aberta' : 'Área clínica'}</span><strong>{selected?.full_name || 'Visão geral da operação'}</strong></div>
      </div>

      <nav className="clinical-module-tabs" aria-label="Módulos clínicos">
        {CLINICAL_MODULES.map(item => <button key={item.id} type="button" className={moduleView === item.id ? 'is-active' : ''} onClick={() => navigateModule(item.id)}><span>{item.label}</span>{moduleCounts[item.id] !== undefined && <small>{moduleCounts[item.id]}</small>}</button>)}
      </nav>

      {error && <div className="clinical-alert" role="alert">{error}</div>}

      {moduleView === 'protocols' && <ClinicalProtocols ownerId={ownerId} canManage={isOwner || role === 'admin'} onClose={() => navigateModule('today')} />}
      {moduleView === 'today' && <>
        <DayAgenda date={currentDate} schedule={daySchedule} patients={patients} loading={loading} onAppointment={openAppointment} onPatient={(patient) => selectPatient(patient, 'overview')} />
        <ClinicalTodayInsights index={workspaceIndex} loading={workspaceStatus === 'loading'} unavailableSources={workspaceSources.unavailableSources} onNavigate={navigateModule} onRefresh={loadWorkspaceIndex} />
      </>}
      {moduleView === 'patients' && <ClinicalPatientsView index={workspaceIndex} loading={loading || workspaceStatus === 'loading'} unavailableSources={workspaceSources.unavailableSources} onOpenPatient={selectPatient} onRefresh={() => { loadPatients(); loadWorkspaceIndex() }} />}
      {moduleView === 'pending' && <ClinicalPendingView index={workspaceIndex} loading={workspaceStatus === 'loading'} unavailableSources={workspaceSources.unavailableSources} onOpenPatient={selectPatient} onRefresh={loadWorkspaceIndex} />}
      {moduleView === 'documents' && <ClinicalDocumentsCenter index={workspaceIndex} loading={workspaceStatus === 'loading'} unavailableSources={workspaceSources.unavailableSources} onOpenPatient={selectPatient} onRefresh={loadWorkspaceIndex} />}
      {moduleView === 'patient' && selected && (
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
                {tab === 'overview' && <ClinicalPatientSummary patient={selected} profile={clinicalProfile} patientIndex={selectedIndex} timeline={selectedTimeline} onOpenTab={setTab} />}
                {tab === 'record' && <MedicalRecord patientId={selected.id} userId={ownerId} actorId={user?.id} author={author} />}
                {tab === 'timeline' && <ClinicalPatientTimeline timeline={selectedTimeline} loading={workspaceStatus === 'loading'} onRefresh={loadWorkspaceIndex} />}
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
