import { useEffect, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { formatDateBR } from '../utils.js'

// Estágios fixos da jornada (fonte: CLAUDE.md / spec do funil).
// Cores são literais (não tokens de tema) — seguro no nível de módulo.
const STAGES = [
  { key: 'consulta_agendada', label: 'Consulta Agendada', color: '#6366f1' },
  { key: 'consultado',        label: 'Consultado',        color: '#0ea5e9' },
  { key: 'orcamento_enviado', label: 'Orçamento Enviado', color: '#f59e0b' },
  { key: 'reserva_paga',      label: 'Reserva Paga',      color: '#10b981' },
  { key: 'follow_up',         label: 'Follow-up',         color: '#8b5cf6' },
]

export function PatientFunnel() {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  // Multi-tenant: membros de clínica leem/escrevem os dados do dono (owner).
  const effectiveUserId = ownerId || user?.id

  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [movingId, setMovingId] = useState(null)

  useEffect(() => {
    if (!effectiveUserId) return
    let mounted = true

    async function load() {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase
        .from('patients')
        .select('id, full_name, phone, start_date, funnel_stage')
        .eq('user_id', effectiveUserId)
        .eq('active', true)
        .order('created_at', { ascending: false })

      if (!mounted) return
      if (err) { setError(err.message); setLoading(false); return }
      setPatients(data ?? [])
      setLoading(false)
    }

    load()
    return () => { mounted = false }
  }, [effectiveUserId])

  async function movePatient(patientId, newStage) {
    // Otimista com rollback: aplica localmente, reverte se o update falhar.
    const previous = patients
    setMovingId(patientId)
    setPatients(prev => prev.map(p => (p.id === patientId ? { ...p, funnel_stage: newStage } : p)))

    const { error: err } = await supabase
      .from('patients')
      .update({ funnel_stage: newStage })
      .eq('id', patientId)
      .eq('user_id', effectiveUserId)

    if (err) {
      setPatients(previous)
      setError('Não foi possível mover o paciente. Tente novamente.')
    }
    setMovingId(null)
  }

  function getStagePatients(stageKey) {
    return patients.filter(p => p.funnel_stage === stageKey)
  }

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  return (
    <FunnelBoard
      stages={STAGES}
      getStagePatients={getStagePatients}
      movePatient={movePatient}
      movingId={movingId}
      total={patients.length}
    />
  )
}

function FunnelBoard({ stages, getStagePatients, movePatient, movingId, total }) {
  const s = {
    board: { display: 'flex', gap: 16, overflowX: 'auto', padding: '4px 0 16px', alignItems: 'flex-start' },
    empty: { color: C.textSub, fontSize: 14, padding: '40px 0', textAlign: 'center', width: '100%' },
  }
  if (total === 0) {
    return <div style={s.empty}>Nenhum paciente cadastrado ainda. Cadastre em <strong>Pacientes</strong> e eles aparecem aqui.</div>
  }
  return (
    <div style={s.board}>
      {stages.map(stage => (
        <FunnelColumn
          key={stage.key}
          stage={stage}
          patients={getStagePatients(stage.key)}
          allStages={stages}
          movePatient={movePatient}
          movingId={movingId}
        />
      ))}
    </div>
  )
}

function FunnelColumn({ stage, patients, allStages, movePatient, movingId }) {
  const s = {
    column: { minWidth: 240, flex: '0 0 240px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 },
    header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
    dot: { width: 10, height: 10, borderRadius: '50%', background: stage.color, flexShrink: 0 },
    title: { fontSize: 13, fontWeight: 600, color: C.text, flex: 1 },
    count: { fontSize: 12, color: C.textSub, background: C.border, borderRadius: 10, padding: '1px 8px' },
    empty: { fontSize: 12, color: C.textSub, textAlign: 'center', padding: '20px 0' },
  }
  return (
    <div style={s.column}>
      <div style={s.header}>
        <div style={s.dot} />
        <span style={s.title}>{stage.label}</span>
        <span style={s.count}>{patients.length}</span>
      </div>
      {patients.length === 0
        ? <div style={s.empty}>Nenhum paciente</div>
        : patients.map(p => (
            <PatientCard
              key={p.id}
              patient={p}
              currentStage={stage}
              allStages={allStages}
              movePatient={movePatient}
              isMoving={movingId === p.id}
            />
          ))
      }
    </div>
  )
}

function PatientCard({ patient, currentStage, allStages, movePatient, isMoving }) {
  const s = {
    card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8, opacity: isMoving ? 0.5 : 1, transition: 'opacity 0.15s' },
    name: { fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 },
    phone: { fontSize: 12, color: C.textSub, marginBottom: 6 },
    date: { fontSize: 11, color: C.textSub, marginBottom: 8 },
    select: { width: '100%', fontSize: 11, padding: '3px 6px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: isMoving ? 'not-allowed' : 'pointer' },
  }

  function handleChange(e) {
    const newStage = e.target.value
    if (newStage !== currentStage.key) movePatient(patient.id, newStage)
  }

  return (
    <div style={s.card}>
      <div style={s.name}>{patient.full_name}</div>
      {patient.phone && <div style={s.phone}>{patient.phone}</div>}
      {patient.start_date && <div style={s.date}>Desde {formatDateBR(patient.start_date)}</div>}
      <select style={s.select} value={currentStage.key} onChange={handleChange} disabled={isMoving} aria-label="Mover para estágio">
        {allStages.map(st => (
          <option key={st.key} value={st.key}>{st.label}</option>
        ))}
      </select>
    </div>
  )
}

function LoadingState() {
  const s = {
    wrap: { display: 'flex', gap: 16, padding: '4px 0' },
    col: { minWidth: 240, flex: '0 0 240px', height: 200, borderRadius: 12, background: C.border, opacity: 0.4 },
  }
  return (
    <div style={s.wrap}>
      {[1, 2, 3, 4, 5].map(i => <div key={i} style={s.col} />)}
    </div>
  )
}

function ErrorState({ message }) {
  return <div style={{ padding: 24, color: '#ef4444', fontSize: 14 }}>Erro ao carregar o funil: {message}</div>
}
