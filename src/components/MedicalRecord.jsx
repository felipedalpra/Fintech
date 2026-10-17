import { useEffect, useMemo, useState } from 'react'
import { C, base } from '../theme.js'
import { formatDateBR, today } from '../utils.js'
import { Btn, FInput, Modal, Badge } from './UI.jsx'
import { supabase } from '../lib/supabase.js'
import {
  buildAddendumPayload,
  buildClinicalRecordPayload,
  groupAddendaByRecord,
  professionalSignature,
} from '../lib/clinicalRecord.js'

const emptyForm = () => ({
  session_date:today(),
  evolution_notes:'',
  procedures_applied:'',
  next_appointment_date:'',
})

export function MedicalRecord({ patientId, userId, actorId, author }) {
  const [records, setRecords] = useState([])
  const [addenda, setAddenda] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [addendumTarget, setAddendumTarget] = useState(null)
  const [addendumText, setAddendumText] = useState('')
  const hasVerifiedAuthor = Boolean(author?.name?.trim() && author?.registration?.trim())

  useEffect(() => {
    if (!patientId || !userId) return
    load()
  }, [patientId, userId])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { data:recordRows, error:recordsError } = await supabase
        .from('medical_records')
        .select('*')
        .eq('patient_id', patientId)
        .eq('user_id', userId)
        .order('session_date', { ascending:false })
        .order('recorded_at', { ascending:false })
      if (recordsError) throw recordsError
      const patientRecords = recordRows || []
      const recordIds = patientRecords.map(record => record.id)
      let addendumRows = []
      if (recordIds.length > 0) {
        const { data, error:addendaError } = await supabase
          .from('medical_record_addenda')
          .select('*')
          .eq('user_id', userId)
          .in('record_id', recordIds)
          .order('created_at', { ascending:true })
        if (addendaError) throw addendaError
        addendumRows = data || []
      }
      setRecords(patientRecords)
      setAddenda(groupAddendaByRecord(addendumRows))
    } catch (nextError) {
      setRecords([])
      setAddenda({})
      setError(nextError.message || 'Não foi possível carregar o prontuário.')
    } finally {
      setLoading(false)
    }
  }

  function openNew() {
    setForm(emptyForm())
    setError('')
    setShowForm(true)
  }

  async function saveRecord() {
    setSaving(true)
    setError('')
    try {
      const payload = buildClinicalRecordPayload({ form, ownerId:userId, patientId, actorId, author })
      const { error:insertError } = await supabase.rpc('create_clinical_record', {
        p_patient_id:payload.patient_id,
        p_session_date:payload.session_date,
        p_evolution_notes:payload.evolution_notes,
        p_procedures_applied:payload.procedures_applied,
        p_next_appointment_date:payload.next_appointment_date,
      })
      if (insertError) throw insertError
      setShowForm(false)
      await load()
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível assinar a evolução.')
    } finally {
      setSaving(false)
    }
  }

  async function saveAddendum() {
    setSaving(true)
    setError('')
    try {
      const payload = buildAddendumPayload({ text:addendumText, ownerId:userId, recordId:addendumTarget?.id, actorId, author })
      const { error:insertError } = await supabase.rpc('create_medical_record_addendum', {
        p_record_id:payload.record_id,
        p_addendum_text:payload.addendum_text,
      })
      if (insertError) throw insertError
      setAddendumTarget(null)
      setAddendumText('')
      await load()
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível registrar o adendo.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ color:C.textDim, fontSize:13, padding:16 }}>Carregando prontuário…</div>
  if (error && records.length === 0) return <ClinicalError message={error} onRetry={load} />

  return (
    <div data-testid="medical-record" style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:13, color:C.textSub }}>{records.length} {records.length === 1 ? 'evolução registrada' : 'evoluções registradas'}</div>
          <div style={{ fontSize:11, color:C.textDim, marginTop:4 }}>Abertura registrada na trilha de auditoria.</div>
        </div>
        <Btn onClick={openNew} disabled={!hasVerifiedAuthor} style={{ padding:'7px 14px', fontSize:12 }}>+ Nova evolução</Btn>
      </div>

      {!hasVerifiedAuthor && (
        <div role="alert" style={{ padding:'12px 14px', borderRadius:10, border:`1px solid ${C.yellow}55`, background:C.yellow + '10', color:C.textSub, fontSize:12, lineHeight:1.6 }}>
          Para assinar evoluções e adendos, complete o nome e o registro profissional em Configurações. A leitura continua disponível e auditada.
        </div>
      )}
      {error && <div role="alert" style={{ color:C.red, fontSize:12 }}>{error}</div>}

      {records.length === 0 ? (
        <div style={{ color:C.textDim, fontSize:13, textAlign:'center', padding:'28px 0' }}>Nenhuma evolução registrada.</div>
      ) : (
        <div style={{ position:'relative', display:'grid', gap:14, paddingLeft:18 }}>
          <div aria-hidden="true" style={{ position:'absolute', left:5, top:10, bottom:10, width:2, borderRadius:2, background:C.border }} />
          {records.map(record => (
            <RecordCard key={record.id} record={record} addenda={addenda[record.id] || []} canAddendum={hasVerifiedAuthor && !record.archived} onAddendum={() => { setAddendumTarget(record); setAddendumText(''); setError('') }} />
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Nova evolução clínica" width={640}>
        <div style={{ display:'grid', gap:14 }}>
          <div style={{ padding:'10px 12px', borderRadius:9, background:C.surface, border:`1px solid ${C.border}`, color:C.textSub, fontSize:12 }}>
            Assinatura: <strong style={{ color:C.text }}>{author?.name}</strong> · {author?.council || 'CRM'} {author?.registration}
          </div>
          <FInput label="Data do atendimento" type="date" required value={form.session_date} onChange={value => setForm(current => ({ ...current, session_date:value }))} />
          <label style={{ display:'grid', gap:6 }}>
            <span style={base.label}>Evolução <span style={{ color:C.red }}>*</span></span>
            <textarea value={form.evolution_notes} onChange={event => setForm(current => ({ ...current, evolution_notes:event.target.value }))} placeholder="Anamnese do atendimento, exame, hipóteses, conduta e evolução…" rows={7} maxLength={20000} style={{ ...base.input, resize:'vertical', minHeight:140, fontFamily:'inherit', lineHeight:1.6 }} />
          </label>
          <FInput label="Procedimentos realizados" value={form.procedures_applied} onChange={value => setForm(current => ({ ...current, procedures_applied:value }))} placeholder="Descreva os procedimentos realizados" />
          <FInput label="Próximo atendimento" type="date" value={form.next_appointment_date} onChange={value => setForm(current => ({ ...current, next_appointment_date:value }))} />
          <div style={{ color:C.textDim, fontSize:11, lineHeight:1.5 }}>Após assinar, esta evolução não poderá ser editada ou excluída. Correções serão registradas como adendo.</div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
            <Btn variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Btn>
            <Btn onClick={saveRecord} disabled={saving || !form.session_date || !form.evolution_notes.trim()}>{saving ? 'Assinando…' : 'Assinar evolução'}</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(addendumTarget)} onClose={() => setAddendumTarget(null)} title="Adicionar adendo" width={600}>
        <div style={{ display:'grid', gap:14 }}>
          <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>O texto original de {addendumTarget?.session_date ? formatDateBR(addendumTarget.session_date) : 'esta evolução'} será preservado integralmente.</div>
          <textarea value={addendumText} onChange={event => setAddendumText(event.target.value)} placeholder="Descreva a correção ou informação complementar…" rows={6} maxLength={20000} style={{ ...base.input, resize:'vertical', minHeight:130, fontFamily:'inherit', lineHeight:1.6 }} />
          <div style={{ fontSize:11, color:C.textDim }}>Assinado por {author?.name} · {author?.council || 'CRM'} {author?.registration}</div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
            <Btn variant="ghost" onClick={() => setAddendumTarget(null)}>Cancelar</Btn>
            <Btn onClick={saveAddendum} disabled={saving || !addendumText.trim()}>{saving ? 'Registrando…' : 'Registrar adendo'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function RecordCard({ record, addenda, canAddendum, onAddendum }) {
  const [expanded, setExpanded] = useState(true)
  const recordedAt = record.recorded_at || record.created_at
  const timestamp = useMemo(() => recordedAt ? new Date(recordedAt).toLocaleString('pt-BR') : '', [recordedAt])

  return (
    <article style={{ position:'relative', background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:15 }}>
      <div aria-hidden="true" style={{ position:'absolute', left:-18, top:21, width:10, height:10, borderRadius:'50%', background:C.accent, boxShadow:`0 0 0 4px ${C.card}` }} />
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10, flexWrap:'wrap' }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <strong style={{ color:C.text, fontSize:13 }}>{formatDateBR(record.session_date)}</strong>
            {record.archived && <Badge color={C.textDim} small>Legado arquivado</Badge>}
            {record.authorship_source === 'legacy_unverified' && <Badge color={C.yellow} small>Autoria legada</Badge>}
          </div>
          <div style={{ color:C.textDim, fontSize:11, marginTop:4 }}>{professionalSignature(record)}{timestamp ? ` · registrado em ${timestamp}` : ''}</div>
        </div>
        <div style={{ display:'flex', gap:7 }}>
          {canAddendum && <Btn variant="ghost" onClick={onAddendum} style={{ padding:'5px 10px', fontSize:11 }}>+ Adendo</Btn>}
          <Btn variant="ghost" onClick={() => setExpanded(value => !value)} style={{ padding:'5px 10px', fontSize:11 }}>{expanded ? 'Recolher' : 'Abrir'}</Btn>
        </div>
      </div>

      {expanded && (
        <>
          <div style={{ marginTop:13, color:C.textSub, fontSize:13, lineHeight:1.65, whiteSpace:'pre-wrap' }}>{record.evolution_notes}</div>
          {(record.procedures_applied || record.next_appointment_date) && (
            <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
              {record.procedures_applied && <span style={{ fontSize:11, color:C.textSub, background:C.border, borderRadius:6, padding:'3px 8px' }}>{record.procedures_applied}</span>}
              {record.next_appointment_date && <span style={{ fontSize:11, color:C.cyan, background:C.cyan + '15', borderRadius:6, padding:'3px 8px' }}>Próximo: {formatDateBR(record.next_appointment_date)}</span>}
            </div>
          )}
          {addenda.length > 0 && (
            <div style={{ display:'grid', gap:9, marginTop:14, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
              {addenda.map(addendum => (
                <div key={addendum.id} style={{ borderLeft:`3px solid ${C.accent}`, padding:'8px 10px', background:C.card, borderRadius:'0 8px 8px 0' }}>
                  <div style={{ color:C.accent, fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em' }}>Adendo · {new Date(addendum.created_at).toLocaleString('pt-BR')}</div>
                  <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6, whiteSpace:'pre-wrap', marginTop:5 }}>{addendum.addendum_text}</div>
                  <div style={{ color:C.textDim, fontSize:10, marginTop:6 }}>{professionalSignature(addendum)}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </article>
  )
}

function ClinicalError({ message, onRetry }) {
  return (
    <div role="alert" style={{ padding:16, borderRadius:12, border:`1px solid ${C.red}55`, background:C.red + '0D' }}>
      <div style={{ color:C.red, fontSize:13, lineHeight:1.6 }}>{message}</div>
      <Btn variant="ghost" onClick={onRetry} style={{ marginTop:10 }}>Tentar novamente</Btn>
    </div>
  )
}
