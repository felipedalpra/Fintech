import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { formatDateBR, today } from '../utils.js'
import { Btn, FInput, Modal, Badge } from './UI.jsx'
import { supabase } from '../lib/supabase.js'

export function MedicalRecord({ patientId, userId, professionalName }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const emptyForm = {
    session_date: today(),
    evolution_notes: '',
    procedures_applied: '',
    next_appointment_date: '',
    professional_name: professionalName || '',
  }
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!patientId || !userId) return
    load()
  }, [patientId, userId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('medical_records')
      .select('*')
      .eq('patient_id', patientId)
      .eq('user_id', userId)
      .order('session_date', { ascending: false })
    setRecords(data || [])
    setLoading(false)
  }

  function openNew() {
    setForm({ ...emptyForm, professional_name: professionalName || '' })
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(rec) {
    setForm({
      session_date: rec.session_date || today(),
      evolution_notes: rec.evolution_notes || '',
      procedures_applied: rec.procedures_applied || '',
      next_appointment_date: rec.next_appointment_date || '',
      professional_name: rec.professional_name || '',
    })
    setEditingId(rec.id)
    setShowForm(true)
  }

  async function save() {
    if (!form.session_date || !form.evolution_notes.trim()) return
    setSaving(true)
    if (editingId) {
      await supabase.from('medical_records').update({
        session_date: form.session_date,
        evolution_notes: form.evolution_notes,
        procedures_applied: form.procedures_applied || null,
        next_appointment_date: form.next_appointment_date || null,
        professional_name: form.professional_name || null,
        updated_at: new Date().toISOString(),
      }).eq('id', editingId).eq('user_id', userId)
    } else {
      await supabase.from('medical_records').insert({
        user_id: userId,
        patient_id: patientId,
        session_date: form.session_date,
        evolution_notes: form.evolution_notes,
        procedures_applied: form.procedures_applied || null,
        next_appointment_date: form.next_appointment_date || null,
        professional_name: form.professional_name || null,
      })
    }
    setSaving(false)
    setShowForm(false)
    load()
  }

  async function archive(id) {
    await supabase.from('medical_records').update({
      archived: true,
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('user_id', userId)
    load()
  }

  const active = records.filter(r => !r.archived)
  const archived = records.filter(r => r.archived)

  const sessionNumber = id => {
    const ordered = [...records].filter(r => !r.archived).sort((a, b) => a.session_date.localeCompare(b.session_date))
    return ordered.findIndex(r => r.id === id) + 1
  }

  if (loading) {
    return <div style={{ color: C.textDim, fontSize: 13, padding: 16 }}>Carregando prontuário…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: C.textSub }}>
          {active.length} sessão{active.length !== 1 ? 'ões' : ''} registrada{active.length !== 1 ? 's' : ''}
        </span>
        <Btn onClick={openNew} style={{ padding: '7px 14px', fontSize: 12 }}>+ Nova sessão</Btn>
      </div>

      {active.length === 0 && (
        <div style={{ color: C.textDim, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
          Nenhum registro de evolução ainda.
        </div>
      )}

      {active.map(rec => (
        <RecordCard
          key={rec.id}
          rec={rec}
          number={sessionNumber(rec.id)}
          onEdit={() => openEdit(rec)}
          onArchive={() => archive(rec.id)}
        />
      ))}

      {archived.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12, color: C.textDim, cursor: 'pointer', userSelect: 'none' }}>
            {archived.length} registro{archived.length !== 1 ? 's' : ''} arquivado{archived.length !== 1 ? 's' : ''}
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {archived.map(rec => (
              <RecordCard key={rec.id} rec={rec} number={null} archived />
            ))}
          </div>
        </details>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? 'Editar registro de sessão' : 'Nova sessão'}
        width={600}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FInput
              label="Data da sessão"
              type="date"
              required
              value={form.session_date}
              onChange={v => setForm(f => ({ ...f, session_date: v }))}
            />
            <FInput
              label="Profissional"
              value={form.professional_name}
              onChange={v => setForm(f => ({ ...f, professional_name: v }))}
              placeholder="Nome do profissional responsável"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={base.label}>Evolução <span style={{ color: C.red }}>*</span></label>
            <textarea
              value={form.evolution_notes}
              onChange={e => setForm(f => ({ ...f, evolution_notes: e.target.value }))}
              placeholder="Relato da sessão, observações clínicas, evolução do paciente…"
              rows={5}
              style={{
                ...base.input,
                resize: 'vertical',
                minHeight: 100,
                fontFamily: 'inherit',
                lineHeight: 1.6,
              }}
            />
          </div>

          <FInput
            label="Procedimentos realizados (opcional)"
            value={form.procedures_applied}
            onChange={v => setForm(f => ({ ...f, procedures_applied: v }))}
            placeholder="Ex.: Avaliação inicial, EMDR, TCC — sessão 3"
          />

          <FInput
            label="Próxima sessão (opcional)"
            type="date"
            value={form.next_appointment_date}
            onChange={v => setForm(f => ({ ...f, next_appointment_date: v }))}
          />

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Btn>
            <Btn
              onClick={save}
              disabled={saving || !form.session_date || !form.evolution_notes.trim()}
            >
              {saving ? 'Salvando…' : 'Salvar registro'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function RecordCard({ rec, number, onEdit, onArchive, archived }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 14,
      opacity: archived ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {number != null && (
            <span style={{
              background: C.accent + '20',
              color: C.accent,
              border: `1px solid ${C.accent}44`,
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 700,
            }}>
              Sessão {number}
            </span>
          )}
          {archived && <Badge color={C.textDim} small>Arquivado</Badge>}
          <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
            {formatDateBR(rec.session_date)}
          </span>
          {rec.professional_name && (
            <span style={{ fontSize: 12, color: C.textSub }}>· {rec.professional_name}</span>
          )}
        </div>
        {!archived && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <Btn variant="ghost" onClick={onEdit} style={{ padding: '4px 10px', fontSize: 11 }}>Editar</Btn>
            <Btn variant="ghost" onClick={onArchive} style={{ padding: '4px 10px', fontSize: 11, color: C.textDim }}>Arquivar</Btn>
          </div>
        )}
      </div>

      <div
        style={{
          fontSize: 13,
          color: C.textSub,
          marginTop: 10,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          ...(expanded ? {} : {
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
          }),
        }}
      >
        {rec.evolution_notes}
      </div>

      {rec.evolution_notes.length > 200 && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            background: 'none',
            border: 'none',
            color: C.accent,
            fontSize: 12,
            cursor: 'pointer',
            padding: '4px 0',
            fontFamily: 'inherit',
          }}
        >
          {expanded ? 'Mostrar menos' : 'Ver completo'}
        </button>
      )}

      {(rec.procedures_applied || rec.next_appointment_date) && (
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          {rec.procedures_applied && (
            <span style={{ fontSize: 11, color: C.textDim, background: C.border, borderRadius: 6, padding: '3px 8px' }}>
              {rec.procedures_applied}
            </span>
          )}
          {rec.next_appointment_date && (
            <span style={{ fontSize: 11, color: C.cyan, background: C.cyan + '15', borderRadius: 6, padding: '3px 8px' }}>
              Próxima: {formatDateBR(rec.next_appointment_date)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
