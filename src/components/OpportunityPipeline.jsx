import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { confirmSuggestion, dismissSuggestion } from '../lib/opportunitySuggestion.js'
import { OpportunityEditor } from './OpportunityEditor.jsx'
import { NewLeadModal } from './NewLeadModal.jsx'
import { createManualLead, patchOpportunity } from '../lib/opportunityActions.js'
import { slaForLead } from '../lib/slaBusinessTime.js'
import { initials, avatarColor } from '../lib/avatar.js'

// Ícones SVG (leitura melhor que emoji). `d` é o miolo do path.
function Ico({ d, size = 14, sw = 2, fill = 'none' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
}
const ICON = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  tag: <><path d="M20.6 13.4 12 22l-9-9V3h10z" /><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  ai: <><path d="M12 3v2m0 14v2M5 12H3m18 0h-2M6 6 4.5 4.5M18 18l1.5 1.5" /><circle cx="12" cy="12" r="4" /></>,
  wa: <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2Z" />,
  pencil: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  warn: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
}
function Avatar({ label, size = 32 }) {
  return (
    <span title={label} style={{
      width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center',
      fontSize: size <= 22 ? 9 : 12, fontWeight: 800, color: '#fff', flexShrink: 0,
      background: avatarColor(label), border: `2px solid ${C.card}`, boxShadow: '0 2px 6px -2px rgba(0,0,0,.4)',
    }}>{initials(label)}</span>
  )
}

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
  const [leadStage, setLeadStage] = useState(null) // estágio para o modal de Novo lead (null = fechado)
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
          .select('id, title, stage, status, value, source, tags, stage_entered_at, created_at, first_response_at, patient_id, responsible_user_id, suggested_stage, suggested_reason, suggested_confidence, suggestion_status, patients(full_name, phone)')
          .eq('user_id', effectiveUserId)
          .eq('status', 'aberto')
          .order('created_at', { ascending: false }),
        supabase.rpc('clinic_team'), // time completo (inclui o dono) — gestão/admin atribuem a qualquer um
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
  function addLead(opp) { setOpps(prev => [opp, ...prev]) }
  // Edição inline no card (valor/responsável): update otimista + patch parcial no banco.
  async function inlineUpdate(oppId, patch) {
    const before = opps.find(o => o.id === oppId)
    setOpps(p => p.map(o => (o.id === oppId ? { ...o, ...patch } : o)))
    const res = await patchOpportunity(oppId, patch)
    if (res.error) {
      // Reverte SÓ os campos tocados deste card (preserva mudanças concorrentes de outros).
      setOpps(p => p.map(o => {
        if (o.id !== oppId) return o
        const restored = { ...o }
        for (const k of Object.keys(patch)) restored[k] = before ? before[k] : o[k]
        return restored
      }))
      setError('Não foi possível salvar a alteração. Tente novamente.')
    }
  }

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

  const fsel = { fontSize: 12, padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit' }
  const leadBtn = { padding: '9px 15px', borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight || C.accent})`, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 7, boxShadow: `0 6px 18px -6px ${C.accent}88` }
  const oppBtn = { padding: '9px 14px', borderRadius: 10, background: C.surface, color: C.textSub, border: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 7 }

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
        <button type="button" style={oppBtn} onClick={openCreate} title="Para paciente já cadastrado">Nova oportunidade</button>
        <button type="button" style={leadBtn} onClick={() => setLeadStage('primeiro_contato')}><Ico d={ICON.plus} size={16} sw={2.4} />Novo lead</button>
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
                memberLabel={memberLabel}
                members={members}
                ownerId={effectiveUserId}
                onLeadCreated={addLead}
                onInlineUpdate={inlineUpdate}
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

      <NewLeadModal
        open={!!leadStage}
        onClose={() => setLeadStage(null)}
        ownerId={effectiveUserId}
        members={members}
        stage={leadStage || 'primeiro_contato'}
        onCreated={opp => { addLead(opp); setLeadStage(null) }}
      />
    </div>
  )
}

function PipelineColumn({ stage, opps, allStages, memberLabel, members, ownerId, onLeadCreated, onInlineUpdate, moveOpp, onAccept, onReject, onEdit, movingId, dragActive, onDragEnterStage, onDropStage }) {
  const totalValue = opps.reduce((s, o) => s + (Number(o.value) || 0), 0)
  const s = {
    column: { minWidth: 278, flex: '0 0 278px', background: dragActive ? stage.color + '14' : C.surface, border: `1px solid ${dragActive ? stage.color : C.border}`, borderRadius: 15, paddingBottom: 12, overflow: 'hidden', transition: 'background 0.12s, border-color 0.12s' },
    head: { position: 'relative', padding: '13px 14px 11px', borderBottom: `1px solid ${C.border}` },
    topbar: { position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: stage.color },
    tl: { display: 'flex', alignItems: 'center', gap: 8 },
    dot: { width: 9, height: 9, borderRadius: '50%', background: stage.color, flexShrink: 0 },
    title: { fontSize: 13, fontWeight: 700, color: C.text, flex: 1 },
    count: { fontSize: 11.5, fontWeight: 700, color: C.textSub, background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: '1px 9px', fontVariantNumeric: 'tabular-nums' },
    sum: { fontSize: 12, fontWeight: 700, color: C.textSub, marginTop: 6, fontVariantNumeric: 'tabular-nums' },
    body: { padding: '12px 11px 0', display: 'flex', flexDirection: 'column', gap: 10 },
    empty: { fontSize: 12, color: C.textDim, textAlign: 'center', padding: '24px 0', border: `1.5px dashed ${C.border}`, borderRadius: 11, margin: '0 11px' },
  }
  return (
    <div style={s.column}
      onDragOver={e => { e.preventDefault(); onDragEnterStage?.() }}
      onDrop={e => { e.preventDefault(); onDropStage?.(e.dataTransfer.getData('text/plain')) }}>
      <div style={s.head}>
        <span style={s.topbar} />
        <div style={s.tl}>
          <span style={s.dot} />
          <span style={s.title}>{stage.label}</span>
          <span style={s.count}>{opps.length}</span>
        </div>
        <div style={s.sum}>{totalValue > 0 ? fmtBRL(totalValue) : '—'}</div>
      </div>
      <div style={{ ...s.body, paddingTop: 10 }}>
        <QuickAddLead ownerId={ownerId} stage={stage.key} onCreated={onLeadCreated} />
        {opps.length === 0
          ? <div style={{ ...s.empty, margin: 0 }}>{dragActive ? 'Soltar aqui' : 'Vazio'}</div>
          : opps.map(o => (
              <OpportunityCard key={o.id} opp={o} currentStage={stage} allStages={allStages} memberLabel={memberLabel} members={members} onInlineUpdate={onInlineUpdate} moveOpp={moveOpp} onAccept={onAccept} onReject={onReject} onEdit={onEdit} isMoving={movingId === o.id} />
            ))}
      </div>
    </div>
  )
}

// Quick-add inline: botão "+ lead" que vira um campo de 1 linha (nome) e cria o lead
// já nesta etapa. Para mais campos (telefone, valor…), usar o botão "Novo lead" da barra.
function QuickAddLead({ ownerId, stage, onCreated }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    const n = name.trim()
    if (!n || saving) return
    setSaving(true); setError(null)
    const res = await createManualLead(ownerId, { name: n, stage })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onCreated?.(res.opp)
    setName(''); setOpen(false)
  }

  const trigger = { width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '8px 10px', border: `1.5px dashed ${C.borderBright || C.border}`, borderRadius: 10, background: C.accent + '0d', color: C.accent, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
  const input = { width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 9, border: `1px solid ${C.accent}`, background: C.card, color: C.text, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }

  if (!open) return <button type="button" style={trigger} onClick={() => setOpen(true)}><Ico d={ICON.plus} size={14} sw={2.4} />Adicionar lead rápido</button>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Nome do lead…"
        style={input}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setOpen(false); setName('') } }} />
      {error && <div style={{ fontSize: 11, color: C.red || '#ef4444' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={submit} disabled={saving || !name.trim()}
          style={{ flex: 1, fontSize: 12, fontWeight: 700, padding: '6px 8px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', cursor: saving || !name.trim() ? 'not-allowed' : 'pointer', opacity: saving || !name.trim() ? 0.6 : 1, fontFamily: 'inherit' }}>
          {saving ? 'Criando…' : 'Adicionar'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setName(''); setError(null) }}
          style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textSub, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
      </div>
    </div>
  )
}

function OpportunityCard({ opp, currentStage, allStages, memberLabel, members, onInlineUpdate, moveOpp, onAccept, onReject, onEdit, isMoving }) {
  const patientName = opp.patients?.full_name || 'Paciente'
  const hasPhone = !!opp.patients?.phone
  const value = fmtBRL(opp.value)
  const days = daysInStage(opp.stage_entered_at)
  const tags = Array.isArray(opp.tags) ? opp.tags : []
  const oppTitle = opp.title && opp.title !== 'Oportunidade' ? opp.title : null
  const respLabel = opp.responsible_user_id ? (memberLabel?.[opp.responsible_user_id] || null) : null
  const staleDays = days != null && days >= 7
  const sla = slaForLead(opp) // SLA de 1ª resposta (só aparece em 'primeiro_contato')
  const hasSuggestion = opp.suggestion_status === 'pending'
    && opp.suggested_stage && opp.suggested_stage !== currentStage.key

  const [hover, setHover] = useState(false)
  // Edição inline (valor e responsável) direto no card — salva na hora via patch parcial.
  const [editVal, setEditVal] = useState(false)
  const [valDraft, setValDraft] = useState('')
  const [respOpen, setRespOpen] = useState(false)
  const memberOptions = (members && members.length ? members.map(m => ({ id: m.user_id, label: m.member_email || m.user_id }))
    : Object.entries(memberLabel || {}).map(([id, l]) => ({ id, label: l })))
  const canInline = typeof onInlineUpdate === 'function'
  function openVal(e) { e.stopPropagation(); setValDraft(opp.value == null ? '' : String(opp.value)); setEditVal(true) }
  function saveVal(e) { e?.stopPropagation?.(); setEditVal(false); if (String(valDraft) !== String(opp.value ?? '')) onInlineUpdate(opp.id, { value: valDraft }) }
  function pickResp(e, id) { e.stopPropagation(); setRespOpen(false); if ((id || null) !== (opp.responsible_user_id || null)) onInlineUpdate(opp.id, { responsible_user_id: id }) }

  const s = {
    card: { background: C.card, border: `1px solid ${hover ? (C.borderBright || C.border) : (hasSuggestion ? C.accent + '66' : C.border)}`, borderRadius: 12, padding: 12, opacity: isMoving ? 0.5 : 1, cursor: 'grab', transform: hover && !isMoving ? 'translateY(-3px)' : 'none', boxShadow: hover && !isMoving ? '0 16px 40px -16px rgba(0,0,0,.6)' : 'none', transition: 'transform .16s, box-shadow .16s, border-color .16s, opacity .15s' },
    dhead: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 },
    nm: { fontSize: 13.5, fontWeight: 700, color: C.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    sub: { fontSize: 11.5, color: C.textSub, fontWeight: 500, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    value: { fontSize: 16, fontWeight: 800, color: C.accent, marginBottom: 9, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' },
    tags: { display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 },
    tag: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: C.textSub, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 7px' },
    foot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` },
    days: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: staleDays ? (C.yellow || '#f59e0b') : C.textSub },
    wa: { width: 30, height: 30, borderRadius: 9, border: 'none', display: 'grid', placeItems: 'center', color: '#fff', background: hasPhone ? '#25D366' : C.surface, boxShadow: hasPhone ? '0 3px 9px -3px #25D36688' : 'none', cursor: hasPhone ? 'pointer' : 'not-allowed', flexShrink: 0 },
  }

  return (
    <div style={s.card} draggable={!isMoving}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onDragStart={e => e.dataTransfer.setData('text/plain', opp.id)}
      onClick={() => onEdit?.(opp)} title="Clique para editar · arraste para mover">
      <div style={s.dhead}>
        <Avatar label={patientName} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.nm}>{patientName}</div>
          {oppTitle && <div style={s.sub}>{oppTitle}</div>}
        </div>
      </div>
      {canInline ? (
        editVal ? (
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 9 }}>
            <input autoFocus type="number" value={valDraft} onChange={e => setValDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveVal(e); if (e.key === 'Escape') { e.stopPropagation(); setEditVal(false) } }}
              style={{ width: 120, fontSize: 14, fontWeight: 700, padding: '5px 8px', borderRadius: 8, border: `1px solid ${C.accent}`, background: C.card, color: C.text, outline: 'none', fontFamily: 'inherit' }} />
            <button type="button" onClick={saveVal} style={{ border: 'none', borderRadius: 7, padding: '5px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: C.accent, color: '#fff' }}>✓</button>
            <button type="button" onClick={e => { e.stopPropagation(); setEditVal(false) }} style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '5px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: C.surface, color: C.textSub }}>✕</button>
          </div>
        ) : (
          <div onClick={openVal} title="Clique para editar o valor" style={{ ...s.value, display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'text' }}>
            {value || <span style={{ color: C.textDim, fontWeight: 600, fontSize: 13 }}>+ valor</span>}
            <span style={{ color: C.textDim, display: 'inline-flex', opacity: hover ? 1 : 0.5 }}><Ico d={ICON.pencil} size={12} /></span>
          </div>
        )
      ) : (value && <div style={s.value}>{value}</div>)}
      {currentStage.key === 'primeiro_contato' && sla.state !== 'na' && (() => {
        const cfg = {
          ok: { bg: C.accent, label: `Responder em ${sla.minutes} min`, warn: false },
          late: { bg: C.red || '#EF4444', label: `Sem resposta há ${sla.minutes} min`, warn: true },
          respondido: { bg: C.green || '#10B981', label: `Respondido em ${sla.minutes} min`, warn: false },
        }[sla.state]
        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 9, padding: '5px 9px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, color: cfg.bg, background: cfg.bg + '22' }}>
            <Ico d={cfg.warn ? ICON.warn : (sla.state === 'respondido' ? ICON.check : ICON.clock)} size={12} />{cfg.label}
          </div>
        )
      })()}
      {(opp.source || tags.length > 0) && (
        <div style={s.tags}>
          {opp.source && <span style={s.tag}><span style={{ color: C.textDim, display: 'inline-flex' }}><Ico d={ICON.tag} size={11} /></span>{opp.source}</span>}
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
        <span style={s.days}>{days != null && <><Ico d={ICON.clock} size={12} />{days}d no estágio</>}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {canInline ? (
            <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
              <button type="button" onClick={() => setRespOpen(o => !o)} title="Atribuir responsável"
                style={{ display: 'inline-flex', alignItems: 'center', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
                {respLabel
                  ? <Avatar label={respLabel} size={24} />
                  : <span style={{ width: 24, height: 24, borderRadius: '50%', border: `1.5px dashed ${C.borderBright || C.border}`, display: 'grid', placeItems: 'center', color: C.textDim }}><Ico d={ICON.user} size={13} /></span>}
              </button>
              {respOpen && <>
                <div onClick={e => { e.stopPropagation(); setRespOpen(false) }} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
                <div style={{ position: 'absolute', bottom: 32, right: 0, zIndex: 31, minWidth: 180, maxHeight: 240, overflowY: 'auto', background: C.card, border: `1px solid ${C.borderBright || C.border}`, borderRadius: 10, padding: 5, boxShadow: '0 16px 40px -14px rgba(0,0,0,.6)' }}>
                  <div onClick={e => pickResp(e, null)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, fontSize: 12.5, cursor: 'pointer', color: C.textSub }}>Sem responsável</div>
                  {memberOptions.map(m => (
                    <div key={m.id} onClick={e => pickResp(e, m.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, fontSize: 12.5, cursor: 'pointer', background: m.id === opp.responsible_user_id ? C.accent + '18' : 'transparent', color: m.id === opp.responsible_user_id ? C.accent : C.text }}>
                      <Avatar label={m.label} size={20} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              </>}
            </div>
          ) : (respLabel && <Avatar label={respLabel} size={24} />)}
          <button type="button" style={s.wa} disabled={!hasPhone}
            onClick={e => { e.stopPropagation(); if (!hasPhone) return; const digits = String(opp.patients.phone).replace(/\D/g, ''); if (digits) window.open(`https://wa.me/${digits}`, '_blank', 'noopener') }}
            title={hasPhone ? 'Abrir conversa no WhatsApp' : 'Sem telefone'}>
            <Ico d={ICON.wa} size={15} fill="currentColor" sw={0} />
          </button>
        </div>
      </div>
      <select style={{ width: '100%', marginTop: 10, fontSize: 11.5, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textSub, cursor: isMoving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
        value={currentStage.key} onChange={e => { if (e.target.value !== currentStage.key) moveOpp(opp.id, e.target.value) }}
        onClick={e => e.stopPropagation()} disabled={isMoving} aria-label="Mover para estágio">
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
    box: { background: `linear-gradient(135deg, ${C.accent}1f, ${(C.purple || '#8B5CF6')}18)`, border: `1px solid ${C.accent}55`, borderRadius: 11, padding: '9px 10px', marginBottom: 10 },
    head: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800, color: C.accent, marginBottom: 3 },
    reason: { fontSize: 11.5, color: C.textSub, marginBottom: 9, lineHeight: 1.4, fontStyle: 'italic' },
    row: { display: 'flex', gap: 7 },
    accept: { flex: 1, fontSize: 11.5, fontWeight: 700, padding: '6px 8px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, fontFamily: 'inherit' },
    reject: { fontSize: 11.5, fontWeight: 700, padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.textSub, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' },
  }
  return (
    <div style={s.box}>
      <div style={s.head}><Ico d={ICON.ai} size={13} /> IA sugere → {label}{pct != null ? ` · ${pct}%` : ''}</div>
      {opp.suggested_reason && <div style={s.reason}>"{opp.suggested_reason}"</div>}
      <div style={s.row}>
        <button type="button" style={s.accept} onClick={onAccept} disabled={disabled}>✓ Mover</button>
        <button type="button" style={s.reject} onClick={onReject} disabled={disabled}>Ignorar</button>
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
