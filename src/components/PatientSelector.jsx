import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { Btn, FInput, Modal } from './UI.jsx'
import { supabase } from '../lib/supabase.js'

export function PatientSelector({ userId, value, onChange }) {
  const [patients, setPatients] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ full_name: '', cpf: '', phone: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!userId) return
    supabase.from('patients').select('id,full_name,cpf,phone').eq('user_id', userId).eq('active', true).order('full_name')
      .then(({ data }) => setPatients(data || []))
  }, [userId])

  async function createPatient() {
    if (!form.full_name.trim()) return
    setSaving(true)
    const { data: created } = await supabase.from('patients').insert({
      user_id: userId,
      full_name: form.full_name.trim(),
      cpf: form.cpf || null,
      phone: form.phone || null,
      consent_signed: false,
    }).select().single()
    setSaving(false)
    if (created) {
      setPatients(ps => [...ps, created].sort((a, b) => a.full_name.localeCompare(b.full_name)))
      onChange(created.id, created.full_name)
      setShowCreate(false)
      setForm({ full_name: '', cpf: '', phone: '' })
    }
  }

  const selected = patients.find(p => p.id === value)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={base.label}>Paciente</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          value={value || ''}
          onChange={e => {
            const p = patients.find(pt => pt.id === e.target.value)
            onChange(e.target.value, p?.full_name || '')
          }}
          style={{ ...base.input, flex: 1 }}
        >
          <option value="">Selecionar paciente cadastrado…</option>
          {patients.map(p => (
            <option key={p.id} value={p.id}>{p.full_name}{p.cpf ? ` · ${p.cpf}` : ''}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          style={{
            background: C.accent + '18',
            color: C.accent,
            border: `1px solid ${C.accent}44`,
            borderRadius: 8,
            padding: '0 14px',
            height: 38,
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          + Novo
        </button>
      </div>
      {selected && (
        <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
          {[selected.phone, selected.cpf].filter(Boolean).join(' · ')}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Criar paciente" width={440}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FInput
            label="Nome completo"
            required
            value={form.full_name}
            onChange={v => setForm(f => ({ ...f, full_name: v }))}
            placeholder="Nome completo do paciente"
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FInput
              label="CPF (opcional)"
              value={form.cpf}
              onChange={v => setForm(f => ({ ...f, cpf: v }))}
              placeholder="000.000.000-00"
            />
            <FInput
              label="Telefone (opcional)"
              value={form.phone}
              onChange={v => setForm(f => ({ ...f, phone: v }))}
              placeholder="(11) 99999-9999"
            />
          </div>
          <div style={{ fontSize: 12, color: C.textDim }}>
            Dados adicionais podem ser preenchidos em Pacientes a qualquer momento.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <Btn variant="ghost" onClick={() => setShowCreate(false)}>Cancelar</Btn>
            <Btn onClick={createPatient} disabled={saving || !form.full_name.trim()}>
              {saving ? 'Criando…' : 'Criar e selecionar'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
