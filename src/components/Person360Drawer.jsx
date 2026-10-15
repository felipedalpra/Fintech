import { useEffect, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { createContactNote, loadContactNotes } from '../lib/operationalWorkspace.js'
import { Btn } from './UI.jsx'

export function Person360Drawer({ open, onClose, contactId, patientId, opportunityId, name, phone }) {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id
  const [timeline, setTimeline] = useState([])
  const [summary, setSummary] = useState({ opportunities:0, consultations:0, surgeries:0, tasks:0, financial:0 })
  const [notes, setNotes] = useState([])
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [noteError, setNoteError] = useState('')

  useEffect(() => {
    if (!open || !effectiveUserId || (!contactId && !patientId && !opportunityId)) return
    let active = true
    const opportunityQuery = contactId
      ? supabase.from('opportunities').select('id, title, stage, status, created_at').eq('user_id', effectiveUserId).eq('contact_id', contactId)
      : patientId
        ? supabase.from('opportunities').select('id, title, stage, status, created_at').eq('user_id', effectiveUserId).eq('patient_id', patientId)
        : supabase.from('opportunities').select('id, title, stage, status, created_at').eq('id', opportunityId)
    const empty = Promise.resolve({ data:[] })
    Promise.all([
      opportunityQuery.order('created_at', { ascending:false }),
      loadContactNotes(effectiveUserId, { contactId, patientId, opportunityId }),
      patientId ? supabase.from('consultations').select('id, date, consultation_type, value, payment_status, created_at').eq('user_id', effectiveUserId).eq('patient_id', patientId).order('date', { ascending:false }) : empty,
      patientId ? supabase.from('surgeries').select('id, date, patient, total_value, payment_status, created_at').eq('user_id', effectiveUserId).eq('patient_id', patientId).order('date', { ascending:false }) : empty,
      patientId ? supabase.from('tasks').select('id, title, due_date, status, created_at').eq('user_id', effectiveUserId).eq('patient_id', patientId).order('created_at', { ascending:false }) : opportunityId ? supabase.from('tasks').select('id, title, due_date, status, created_at').eq('user_id', effectiveUserId).eq('opportunity_id', opportunityId).order('created_at', { ascending:false }) : empty,
      patientId ? supabase.from('extra_revenues').select('id, description, value, date, created_at').eq('user_id', effectiveUserId).eq('patient_id', patientId).order('date', { ascending:false }) : empty,
    ]).then(([opportunities, noteResult, consultations, surgeries, tasks, revenues]) => {
      if (!active) return
      const opportunityRows = opportunities.data || []
      const consultationRows = consultations.data || []
      const surgeryRows = surgeries.data || []
      const taskRows = tasks.data || []
      const revenueRows = revenues.data || []
      const combined = [
        ...opportunityRows.map(item => ({ id:`opp-${item.id}`, at:item.created_at, title:item.title || 'Oportunidade', detail:`Funil · ${item.stage || 'sem etapa'} · ${item.status || 'aberta'}` })),
        ...consultationRows.map(item => ({ id:`consultation-${item.id}`, at:item.date || item.created_at, title:item.consultation_type || 'Consulta', detail:`Consulta · ${item.payment_status || 'sem situação'} · ${money(item.value)}` })),
        ...surgeryRows.map(item => ({ id:`surgery-${item.id}`, at:item.date || item.created_at, title:'Cirurgia', detail:`Cirurgia · ${item.payment_status || 'sem situação'} · ${money(item.total_value)}` })),
        ...taskRows.map(item => ({ id:`task-${item.id}`, at:item.due_date || item.created_at, title:item.title || 'Tarefa', detail:`Tarefa · ${item.status || 'pendente'}` })),
        ...revenueRows.map(item => ({ id:`revenue-${item.id}`, at:item.date || item.created_at, title:item.description || 'Receita', detail:`Financeiro · ${money(item.value)}` })),
      ].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      setTimeline(combined)
      setSummary({ opportunities:opportunityRows.length, consultations:consultationRows.length, surgeries:surgeryRows.length, tasks:taskRows.length, financial:revenueRows.reduce((sum, item) => sum + Number(item.value || 0), 0) })
      setNotes(noteResult.data || [])
    })
    return () => { active = false }
  }, [open, effectiveUserId, contactId, patientId, opportunityId])
  if (!open) return null

  async function addNote() {
    if (!draft.trim() || saving) return
    setSaving(true)
    setNoteError('')
    const { data, error } = await createContactNote(effectiveUserId, user.id, { contactId, patientId, opportunityId }, draft)
    if (error) setNoteError('Não foi possível salvar a nota. Confirme se o SQL da central operacional já foi executado.')
    else if (data) { setNotes(current => [data, ...current]); setDraft('') }
    setSaving(false)
  }

  return <div style={{ position:'fixed', inset:0, zIndex:6200, background:'rgba(0,0,0,.62)' }} onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
    <aside role="dialog" aria-label="Visão 360 do contato" style={{ position:'absolute', right:0, top:0, bottom:0, width:'min(440px,100vw)', background:C.card, borderLeft:`1px solid ${C.borderBright}`, boxShadow:'-24px 0 70px rgba(0,0,0,.45)', overflowY:'auto', padding:22 }}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:12 }}><div><div style={{ color:C.accent, fontSize:10, fontWeight:900, textTransform:'uppercase', letterSpacing:'.09em' }}>Pessoa 360°</div><h2 style={{ margin:'5px 0 3px', color:C.text, fontSize:22 }}>{name || 'Contato'}</h2><div style={{ color:C.textSub, fontSize:12 }}>{phone || 'Telefone não informado'}</div></div><button onClick={onClose} style={{ alignSelf:'start', border:0, background:'transparent', color:C.textSub, fontSize:22, cursor:'pointer' }}>×</button></div>
      <Section title="Resumo"><div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}><Metric label="Cadastro" value={patientId ? 'Paciente' : contactId ? 'Contato/lead' : 'Oportunidade'} /><Metric label="Negócios" value={String(summary.opportunities)} /><Metric label="Consultas / cirurgias" value={`${summary.consultations} / ${summary.surgeries}`} /><Metric label="Receita vinculada" value={money(summary.financial)} /></div></Section>
      <Section title="Histórico comercial">{timeline.length ? timeline.map(item => <div key={item.id} style={{ padding:'10px 0', borderBottom:`1px solid ${C.border}` }}><strong style={{ color:C.text, fontSize:13 }}>{item.title}</strong><div style={{ color:C.textSub, fontSize:11, marginTop:3 }}>{item.detail} · {new Date(item.at).toLocaleDateString('pt-BR')}</div></div>) : <Empty text="Nenhuma oportunidade vinculada." />}</Section>
      <Section title="Notas internas"><textarea value={draft} onChange={event => { setDraft(event.target.value); setNoteError('') }} placeholder="Contexto para a equipe (não é prontuário médico)" rows={3} style={{ width:'100%', resize:'vertical', padding:11, borderRadius:10, border:`1px solid ${C.border}`, background:C.surface, color:C.text, fontFamily:'inherit', boxSizing:'border-box' }} />{noteError && <div role="alert" style={{ color:C.danger, fontSize:11, marginTop:7 }}>{noteError}</div>}<div style={{ display:'flex', justifyContent:'flex-end', marginTop:8 }}><Btn onClick={addNote} disabled={saving || !draft.trim()}>{saving ? 'Salvando…' : 'Adicionar nota'}</Btn></div>{notes.map(note => <div key={note.id} style={{ marginTop:10, padding:11, borderRadius:10, border:`1px solid ${C.border}`, background:C.surface }}><div style={{ color:C.text, fontSize:12, lineHeight:1.55, whiteSpace:'pre-wrap' }}>{note.body}</div><div style={{ color:C.textDim, fontSize:10, marginTop:5 }}>{new Date(note.created_at).toLocaleString('pt-BR')}</div></div>)}</Section>
    </aside>
  </div>
}

function Section({ title, children }) { return <section style={{ marginTop:24 }}><h3 style={{ margin:'0 0 10px', color:C.text, fontSize:14 }}>{title}</h3>{children}</section> }
function Metric({ label, value }) { return <div style={{ padding:12, borderRadius:11, border:`1px solid ${C.border}`, background:C.surface }}><div style={{ color:C.textDim, fontSize:10, textTransform:'uppercase' }}>{label}</div><div style={{ color:C.text, fontWeight:800, marginTop:4 }}>{value}</div></div> }
function Empty({ text }) { return <div style={{ color:C.textDim, fontSize:12, padding:'10px 0' }}>{text}</div> }
function money(value) { return Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' }) }
