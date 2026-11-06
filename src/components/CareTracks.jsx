import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Btn, FInput } from './UI.jsx'
import { TASK_TYPES } from '../lib/taskQueue.js'
import { describeOffset, sortTrackSteps } from '../lib/careTracks.js'

// Config (admin) das esteiras de acompanhamento. A clínica monta as próprias trilhas: nada é
// fixo no código, porque o protocolo de pós-operatório muda por procedimento e por cirurgião.
// A criação das tarefas é feita por trigger no banco (supabase/crm_care_tracks.sql); aqui só
// administramos as trilhas e seus passos.
export function CareTracks() {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id

  const [tracks, setTracks] = useState([])
  const [steps, setSteps] = useState([])
  const [procedures, setProcedures] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [trackDraft, setTrackDraft] = useState({ name: '', procedure_id: '' })
  const [stepDraft, setStepDraft] = useState({})

  async function load() {
    setLoading(true); setError(null)
    const [tRes, sRes, pRes, mRes] = await Promise.all([
      supabase.from('care_tracks').select('id, name, procedure_id, active, created_at').order('created_at', { ascending: true }),
      supabase.from('care_track_steps').select('id, track_id, offset_days, title, task_type, assigned_user_id, active, sort_order').order('sort_order', { ascending: true }),
      supabase.from('procedures').select('id, name').order('name', { ascending: true }),
      supabase.rpc('clinic_team'),
    ])
    if (tRes.error) { setError(tRes.error.message); setLoading(false); return }
    setTracks(tRes.data ?? [])
    setSteps(sRes.data ?? [])
    setProcedures(pRes.error ? [] : (pRes.data ?? []))
    setMembers((mRes.data ?? []).filter(m => m.user_id))
    setLoading(false)
  }
  useEffect(() => { if (effectiveUserId) load() }, [effectiveUserId])

  const procedureName = useMemo(() => Object.fromEntries(procedures.map(p => [p.id, p.name])), [procedures])
  const memberLabel = useMemo(() => Object.fromEntries(members.map(m => [m.user_id, m.member_email || m.user_id])), [members])
  const stepsByTrack = useMemo(() => {
    const map = {}
    for (const step of steps) (map[step.track_id] ||= []).push(step)
    for (const key of Object.keys(map)) map[key] = sortTrackSteps(map[key])
    return map
  }, [steps])

  async function createTrack() {
    const name = trackDraft.name.trim()
    if (!name || saving) return
    setSaving(true); setError(null)
    const { data, error: err } = await supabase.from('care_tracks').insert({
      user_id: effectiveUserId, name, procedure_id: trackDraft.procedure_id || null, created_by: user?.id || null,
    }).select('id, name, procedure_id, active, created_at').single()
    setSaving(false)
    if (err) { setError(err.message); return }
    setTracks(list => [...list, data])
    setTrackDraft({ name: '', procedure_id: '' })
  }

  async function addStep(trackId) {
    const draft = stepDraft[trackId] || {}
    const title = String(draft.title || '').trim()
    if (!title || saving) return
    setSaving(true); setError(null)
    const { data, error: err } = await supabase.from('care_track_steps').insert({
      user_id: effectiveUserId,
      track_id: trackId,
      title,
      offset_days: Number(draft.offset_days || 0),
      task_type: draft.task_type || 'pos_op',
      assigned_user_id: draft.assigned_user_id || null,
      sort_order: (stepsByTrack[trackId]?.length || 0) + 1,
    }).select('id, track_id, offset_days, title, task_type, assigned_user_id, active, sort_order').single()
    setSaving(false)
    if (err) { setError(err.message); return }
    setSteps(list => [...list, data])
    setStepDraft(current => ({ ...current, [trackId]: {} }))
  }

  // Desativar NÃO apaga: as tarefas já geradas continuam na fila da equipe, e o histórico
  // de quem foi acompanhado não pode sumir porque a clínica mudou o protocolo.
  async function toggleTrack(track) {
    const next = !track.active
    setTracks(list => list.map(t => (t.id === track.id ? { ...t, active: next } : t)))
    const { error: err } = await supabase.from('care_tracks').update({ active: next }).eq('id', track.id)
    if (err) { setTracks(list => list.map(t => (t.id === track.id ? track : t))); setError(err.message) }
  }

  async function toggleStep(step) {
    const next = !step.active
    setSteps(list => list.map(s => (s.id === step.id ? { ...s, active: next } : s)))
    const { error: err } = await supabase.from('care_track_steps').update({ active: next }).eq('id', step.id)
    if (err) { setSteps(list => list.map(s => (s.id === step.id ? step : s))); setError(err.message) }
  }

  const s = {
    card: { padding: 16, borderRadius: 14, border: `1px solid ${C.border}`, background: C.bg, marginBottom: 12 },
    muted: { color: C.textSub, fontSize: 12.5, lineHeight: 1.6 },
    row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
    stepRow: { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, marginTop: 8 },
    offset: { fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: 12, color: C.accent, minWidth: 58 },
  }

  if (loading) return <div style={{ color: C.textSub, fontSize: 14 }}>Carregando esteiras…</div>

  return (
    <div data-testid="care-tracks">
      <div style={{ ...s.muted, marginBottom: 14 }}>
        Quando uma cirurgia é cadastrada, cada passo da esteira vira uma tarefa com data ancorada na data da cirurgia.
        Use número negativo para antes (<strong>-7</strong> = sete dias antes) e positivo para depois (<strong>30</strong> = D+30).
        Nenhuma tarefa é criada para cirurgia que já passou, e desativar uma esteira não apaga o que já foi gerado.
      </div>

      {error && <div role="alert" style={{ color: C.red || '#ef4444', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

      {tracks.length === 0 && <div style={{ ...s.muted, marginBottom: 12 }}>Nenhuma esteira criada ainda.</div>}

      {tracks.map(track => (
        <div key={track.id} style={s.card} data-testid={`care-track-${track.id}`}>
          <div style={{ ...s.row, justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: C.text, fontWeight: 800, fontSize: 14 }}>{track.name}</div>
              <div style={s.muted}>
                {track.procedure_id ? `Só para ${procedureName[track.procedure_id] || 'procedimento removido'}` : 'Vale para todos os procedimentos'}
                {!track.active && ' · desativada'}
              </div>
            </div>
            <Btn variant="ghost" onClick={() => toggleTrack(track)}>{track.active ? 'Desativar' : 'Reativar'}</Btn>
          </div>

          {(stepsByTrack[track.id] || []).map(step => (
            <div key={step.id} style={{ ...s.stepRow, opacity: step.active ? 1 : 0.55 }}>
              <span style={s.offset}>{describeOffset(step.offset_days)}</span>
              <span style={{ flex: 1, color: C.text, fontSize: 13 }}>{step.title}</span>
              <span style={{ ...s.muted, fontSize: 11.5 }}>
                {TASK_TYPES.find(item => item.key === step.task_type)?.label || step.task_type}
                {step.assigned_user_id ? ` · ${memberLabel[step.assigned_user_id] || ''}` : ''}
              </span>
              <Btn variant="ghost" onClick={() => toggleStep(step)} style={{ padding: '4px 10px', fontSize: 11.5 }}>
                {step.active ? 'Desativar' : 'Reativar'}
              </Btn>
            </div>
          ))}

          <div style={{ ...s.row, marginTop: 12 }}>
            <div style={{ width: 92 }}>
              <FInput label="Dias" type="number" value={stepDraft[track.id]?.offset_days ?? ''}
                onChange={v => setStepDraft(c => ({ ...c, [track.id]: { ...c[track.id], offset_days: v } }))} placeholder="-7" />
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 180 }}>
              <FInput label="Passo" value={stepDraft[track.id]?.title ?? ''}
                onChange={v => setStepDraft(c => ({ ...c, [track.id]: { ...c[track.id], title: v } }))} placeholder="Ex: Como passou a noite" />
            </div>
            <div style={{ width: 150 }}>
              <FInput label="Tipo" value={stepDraft[track.id]?.task_type ?? 'pos_op'}
                onChange={v => setStepDraft(c => ({ ...c, [track.id]: { ...c[track.id], task_type: v } }))}
                options={TASK_TYPES.map(item => ({ v: item.key, l: item.label }))} />
            </div>
            <div style={{ width: 180 }}>
              <FInput label="Responsável" value={stepDraft[track.id]?.assigned_user_id ?? ''}
                onChange={v => setStepDraft(c => ({ ...c, [track.id]: { ...c[track.id], assigned_user_id: v } }))}
                options={[{ v: '', l: 'Sem responsável' }, ...members.map(m => ({ v: m.user_id, l: memberLabel[m.user_id] }))]} />
            </div>
            <Btn onClick={() => addStep(track.id)} disabled={saving}>Adicionar passo</Btn>
          </div>
        </div>
      ))}

      <div style={{ ...s.card, borderStyle: 'dashed' }}>
        <div style={{ color: C.text, fontWeight: 800, fontSize: 13, marginBottom: 10 }}>Nova esteira</div>
        <div style={s.row}>
          <div style={{ flex: '1 1 240px', minWidth: 200 }}>
            <FInput label="Nome" value={trackDraft.name} onChange={v => setTrackDraft(c => ({ ...c, name: v }))} placeholder="Ex: Pós-operatório de mama" />
          </div>
          <div style={{ width: 230 }}>
            <FInput label="Procedimento" value={trackDraft.procedure_id} onChange={v => setTrackDraft(c => ({ ...c, procedure_id: v }))}
              options={[{ v: '', l: 'Todos os procedimentos' }, ...procedures.map(p => ({ v: p.id, l: p.name }))]} />
          </div>
          <Btn onClick={createTrack} disabled={saving || !trackDraft.name.trim()}>Criar esteira</Btn>
        </div>
      </div>
    </div>
  )
}
