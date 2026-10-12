import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { confirmSuggestion, dismissSuggestion } from '../lib/opportunitySuggestion.js'
import { OpportunityEditor } from './OpportunityEditor.jsx'

// Pipeline de oportunidades (CRM estilo Kommo). Cada card é uma oportunidade (negócio)
// ligada a um paciente. Movimentação atômica/auditável via RPC move_opportunity.
const STAGES = [
  { key: 'primeiro_contato',  label: 'Primeiro Contato',  color: '#94a3b8' },
  { key: 'consulta_agendada', label: 'Consulta Agendada', color: '#6366f1' },
  { key: 'consultado',        label: 'Consultado',        color: '#0ea5e9' },
  { key: 'orcamento_enviado', label: 'Orçamento Enviado', color: '#f59e0b' },
  { key: 'reserva_paga',      label: 'Reserva Paga',      color: '#10b981' },
  { key: 'cirurgia_marcada',  label: 'Cirurgia Marcada',  color: '#14b8a6' },
  { key: 'cirurgia_feita',    label: 'Cirurgia Feita',    color: '#22c55e' },
  { key: 'follow_up',         label: 'Follow-up',         color: '#8b5cf6' },
]
const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.key, s.label]))

function fmtBRL(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (Number.isNaN(n)) return null
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function daysInStage(ts) {
  if (!ts) return null
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  return d >= 0 ? d : null
}

export function OpportunityPipeline() {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id

  const [opps, setOpps] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [movingId, setMovingId] = useState(null)
  const [dragStage, setDragStage] = useState(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorOpp, setEditorOpp] = useState(null)
  const [filters, setFilters] = useState({ q: '', responsible: 'all', source: 'all', tag: 'all' })

  useEffect(() => {
    if (!effectiveUserId) return
    let mounted = true
    async function load() {
      setLoading(true)
      setError(null)
      const [oppRes, memRes] = await Promise.all([
        supabase
          .from('opportunities')
          .select('id, title, stage, status, value, source, tags, stage_entered_at, patient_id, responsible_user_id, suggested_stage, suggested_reason, suggested_confidence, suggestion_status, patients(full_name, phone)')
          .eq('user_id', effectiveUserId)
          .eq('status', 'aberto')
          .order('created_at', { ascending: false }),
        supabase.from('clinic_members').select('user_id, member_email, role'),
      ])
      if (!mounted) return
      if (oppRes.error) { setError(oppRes.error.message); setLoading(false); return }
      setOpps(oppRes.data ?? [])
      setMembers((memRes.data ?? []).filter(m => m.user_id))
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [effectiveUserId])

  // Opções de filtro derivadas das oportunidades carregadas.
  const sourceOpts = useMemo(() => [...new Set(opps.map(o => o.source).filter(Boolean))].sort(), [opps])
  const tagOpts = useMemo(() => [...new Set(opps.flatMap(o => Array.isArray(o.tags) ? o.tags : []))].sort(), [opps])
  const memberLabel = useMemo(() => Object.fromEntries(members.map(m => [m.user_id, m.member_email || m.user_id])), [members])

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return opps.filter(o => {
      if (q && !((o.patients?.full_name || '').toLowerCase().includes(q) || (o.title || '').toLowerCase().includes(q))) return false
      if (filters.responsible !== 'all' && o.responsible_user_id !== (filters.responsible === 'none' ? null : filters.responsible)) return false
      if (filters.source !== 'all' && o.source !== filters.source) return false
      if (filters.tag !== 'all' && !(Array.isArray(o.tags) && o.tags.includes(filters.tag))) return false
      return true
    })
  }, [opps, filters])

  function openCreate() { setEditorOpp(null); setEditorOpen(true) }
  function openEdit(opp) { setEditorOpp(opp); setEditorOpen(true) }

  function onSaved(result) {
    if (result.created) setOpps(prev => [result.created, ...prev])
    else if (result.updated) setOpps(prev => prev.map(o => (o.id === result.updated.id ? { ...o, ...result.updated } : o)))
    else if (result.closed) setOpps(prev => prev.filter(o => o.id !== result.closed))
  }

  async function moveOpp(oppId, newStage) {
    const previous = opps
    setMovingId(oppId)
    setOpps(prev => prev.map(o => (o.id === oppId ? { ...o, stage: newStage, stage_entered_at: new Date().toISOString() } : o)))
    const { error: err } = await supabase.rpc('move_opportunity', { opp_id: oppId, new_stage: newStage, move_source: 'manual' })
    if (err) {
      setOpps(previous)
      setError('Não foi possível mover a oportunidade. Tente novamente.')
    }
    setMovingId(null)
  }

  // Confirma a sugestão da IA: move e limpa o aviso. Descarta: só limpa o aviso.
  async function acceptSuggestion(opp) {
    const previous = opps
    setMovingId(opp.id)
    setOpps(prev => prev.map(o => (o.id === opp.id
      ? { ...o, stage: opp.suggested_stage, stage_entered_at: new Date().toISOString(), suggestion_status: 'confirmed' }
      : o)))
    const { error: err } = await confirmSuggestion(opp)
    if (err) { setOpps(previous); setError('Não foi possível aplicar a sugestão. Tente novamente.') }
    setMovingId(null)
  }
  async function rejectSuggestion(opp) {
    const previous = opps
    setOpps(prev => prev.map(o => (o.id === opp.id ? { ...o, suggestion_status: 'dismissed' } : o)))
    const { error: err } = await dismissSuggestion(opp)
    if (err) { setOpps(previous); setError('Não foi possível descartar a sugestão.') }
  }

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const fsel = { fontSize: 12, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontFamily: 'inherit' }
  const createBtn = { padding: '7px 14px', borderRadius: 8, background: C.accent, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
          placeholder="🔍 Buscar paciente…" style={{ ...fsel, flex: '1 1 180px', minWidth: 140 }} />
        <select value={filters.responsible} onChange={e => setFilters(f => ({ ...f, responsible: e.target.value }))} style={fsel} title="Responsável">
          <option value="all">Responsável: todos</option>
          <option value="none">Sem responsável</option>
          {members.map(m => <option key={m.user_id} value={m.user_id}>{memberLabel[m.user_id]}</option>)}
        </select>
        <select value={filters.source} onChange={e => setFilters(f => ({ ...f, source: e.target.value }))} style={fsel} title="Origem">
          <option value="all">Origem: todas</option>
          {sourceOpts.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.tag} onChange={e => setFilters(f => ({ ...f, tag: e.target.value }))} style={fsel} title="Tag">
          <option value="all">Tag: todas</option>
          {tagOpts.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button type="button" style={createBtn} onClick={openCreate}>+ Nova oportunidade</button>
      </div>

      {opps.length === 0
        ? <div style={{ color: C.textSub, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>
            Nenhuma oportunidade aberta. Crie uma em <strong>+ Nova oportunidade</strong> ou cadastre pacientes em <strong>Pacientes</strong>.
          </div>
        : <div style={{ display: 'flex', gap: 16, overflowX: 'auto', padding: '4px 0 16px', alignItems: 'flex-start' }}>
            {STAGES.map(stage => (
              <PipelineColumn
                key={stage.key}
                stage={stage}
                opps={visible.filter(o => o.stage === stage.key)}
                allStages={STAGES}
                moveOpp={moveOpp}
                onAccept={acceptSuggestion}
                onReject={rejectSuggestion}
                onEdit={openEdit}
                movingId={movingId}
                dragActive={dragStage === stage.key}
                onDragEnterStage={() => setDragStage(stage.key)}
                onDropStage={id => { setDragStage(null); if (id) moveOpp(id, stage.key) }}
              />
            ))}
          </div>}

      <OpportunityEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        opp={editorOpp}
        stages={STAGES}
        members={members}
        ownerId={effectiveUserId}
        userId={user?.id}
        onSaved={onSaved}
      />
    </div>
  )
}

function PipelineColumn({ stage, opps, allStages, moveOpp, onAccept, onReject, onEdit, movingId, dragActive, onDragEnterStage, onDropStage }) {
  const totalValue = opps.reduce((s, o) => s + (Number(o.value) || 0), 0)
  const s = {
    column: { minWidth: 260, flex: '0 0 260px', background: dragActive ? C.accent + '10' : C.surface, border: `1px solid ${dragActive ? C.accent : C.border}`, borderRadius: 12, padding: 12, transition: 'background 0.1s, border-color 0.1s' },
    header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
    dot: { width: 10, height: 10, borderRadius: '50%', background: stage.color, flexShrink: 0 },
    title: { fontSize: 13, fontWeight: 600, color: C.text, flex: 1 },
    count: { fontSize: 12, color: C.textSub, background: C.border, borderRadius: 10, padding: '1px 8px' },
    sum: { fontSize: 11, color: C.textSub, marginBottom: 12, paddingLeft: 18 },
    empty: { fontSize: 12, color: C.textSub, textAlign: 'center', padding: '20px 0' },
  }
  return (
    <div style={s.column}
      onDragOver={e => { e.preventDefault(); onDragEnterStage?.() }}
      onDrop={e => { e.preventDefault(); onDropStage?.(e.dataTransfer.getData('text/plain')) }}>
      <div style={s.header}>
        <div style={s.dot} />
        <span style={s.title}>{stage.label}</span>
        <span style={s.count}>{opps.length}</span>
      </div>
      <div style={s.sum}>{totalValue > 0 ? fmtBRL(totalValue) : '—'}</div>
      {opps.length === 0
        ? <div style={s.empty}>{dragActive ? 'Soltar aqui' : 'Vazio'}</div>
        : opps.map(o => (
            <OpportunityCard key={o.id} opp={o} currentStage={stage} allStages={allStages} moveOpp={moveOpp} onAccept={onAccept} onReject={onReject} onEdit={onEdit} isMoving={movingId === o.id} />
          ))}
    </div>
  )
}

function OpportunityCard({ opp, currentStage, allStages, moveOpp, onAccept, onReject, onEdit, isMoving }) {
  const patientName = opp.patients?.full_name || 'Paciente'
  const hasPhone = !!opp.patients?.phone
  const value = fmtBRL(opp.value)
  const days = daysInStage(opp.stage_entered_at)
  const tags = Array.isArray(opp.tags) ? opp.tags : []
  const hasSuggestion = opp.suggestion_status === 'pending'
    && opp.suggested_stage && opp.suggested_stage !== currentStage.key

  const s = {
    card: { background: C.card, border: `1px solid ${hasSuggestion ? C.accent + '66' : C.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8, opacity: isMoving ? 0.5 : 1, transition: 'opacity 0.15s', cursor: 'grab' },
    name: { fontSize: 13, fontWeight: 700, color: C.text },
    title: { fontSize: 12, color: C.textSub, marginBottom: 6 },
    value: { fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 6 },
    metaRow: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 },
    tag: { fontSize: 10, color: C.textSub, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '1px 6px' },
    foot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
    days: { fontSize: 11, color: days != null && days >= 7 ? (C.yellow || '#f59e0b') : C.textDim },
    wa: { fontSize: 13, opacity: hasPhone ? 1 : 0.3 },
    select: { width: '100%', fontSize: 11, padding: '3px 6px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: isMoving ? 'not-allowed' : 'pointer' },
  }

  function onChange(e) {
    const ns = e.target.value
    if (ns !== currentStage.key) moveOpp(opp.id, ns)
  }

  return (
    <div style={s.card} draggable={!isMoving}
      onDragStart={e => e.dataTransfer.setData('text/plain', opp.id)}
      onClick={() => onEdit?.(opp)} title="Clique para editar · arraste para mover">
      <div style={s.name}>{patientName}</div>
      {opp.title && opp.title !== 'Oportunidade' && <div style={s.title}>{opp.title}</div>}
      {value && <div style={s.value}>{value}</div>}
      {(opp.source || tags.length > 0) && (
        <div style={s.metaRow}>
          {opp.source && <span style={s.tag}>🏷 {opp.source}</span>}
          {tags.map((t, i) => <span key={i} style={s.tag}>{t}</span>)}
        </div>
      )}
      {hasSuggestion && (
        <div onClick={e => e.stopPropagation()}>
          <SuggestionBox opp={opp} disabled={isMoving}
            onAccept={() => onAccept?.(opp)} onReject={() => onReject?.(opp)} />
        </div>
      )}
      <div style={s.foot}>
        <span style={s.days}>{days != null ? `⏱ ${days}d no estágio` : ''}</span>
        <span style={s.wa} title={hasPhone ? 'Tem WhatsApp' : 'Sem telefone'}>💬</span>
      </div>
      <select style={s.select} value={currentStage.key} onChange={onChange} onClick={e => e.stopPropagation()}
        disabled={isMoving} aria-label="Mover para estágio">
        {allStages.map(st => <option key={st.key} value={st.key}>{st.label}</option>)}
      </select>
    </div>
  )
}

// Aviso da IA no card (sugere e confirma). Mostra o estágio proposto, o motivo e a confiança.
export function SuggestionBox({ opp, disabled, onAccept, onReject }) {
  const pct = opp.suggested_confidence != null ? Math.round(Number(opp.suggested_confidence) * 100) : null
  const label = STAGE_LABEL[opp.suggested_stage] || opp.suggested_stage
  const s = {
    box: { background: C.accent + '12', border: `1px solid ${C.accent}44`, borderRadius: 8, padding: '8px 10px', marginBottom: 8 },
    head: { fontSize: 11, fontWeight: 700, color: C.accent, marginBottom: 2 },
    reason: { fontSize: 11, color: C.textSub, marginBottom: 6, lineHeight: 1.35 },
    row: { display: 'flex', gap: 6 },
    accept: { flex: 1, fontSize: 11, fontWeight: 700, padding: '5px 8px', borderRadius: 6, border: 'none', background: C.accent, color: '#fff', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, fontFamily: 'inherit' },
    reject: { fontSize: 11, padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.textSub, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' },
  }
  return (
    <div style={s.box}>
      <div style={s.head}>🤖 IA sugere: → {label}{pct != null ? ` · ${pct}%` : ''}</div>
      {opp.suggested_reason && <div style={s.reason}>"{opp.suggested_reason}"</div>}
      <div style={s.row}>
        <button type="button" style={s.accept} onClick={onAccept} disabled={disabled}>✓ Mover</button>
        <button type="button" style={s.reject} onClick={onReject} disabled={disabled}>✗ Ignorar</button>
      </div>
    </div>
  )
}

function LoadingState() {
  const s = { wrap: { display: 'flex', gap: 16, padding: '4px 0' }, col: { minWidth: 260, flex: '0 0 260px', height: 220, borderRadius: 12, background: C.border, opacity: 0.4 } }
  return <div style={s.wrap}>{[1, 2, 3, 4, 5].map(i => <div key={i} style={s.col} />)}</div>
}

function ErrorState({ message }) {
  return <div style={{ padding: 24, color: C.red || '#ef4444', fontSize: 14 }}>Erro ao carregar o pipeline: {message}</div>
}
