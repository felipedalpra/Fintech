import { useEffect, useRef, useState } from 'react'
import { C, base } from '../theme.js'
import { fmt, formatDateBR, today } from '../utils.js'
import { Card, Btn, FInput, Modal, ConfirmModal, Badge } from './UI.jsx'
import { MedicalRecord } from './MedicalRecord.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

const SEX_OPTIONS = [
  { v: '', l: 'Não informado' },
  { v: 'F', l: 'Feminino' },
  { v: 'M', l: 'Masculino' },
  { v: 'outro', l: 'Outro' },
]

const CIVIL_STATUS_OPTIONS = [
  { v: '', l: 'Não informado' },
  { v: 'solteiro', l: 'Solteiro(a)' },
  { v: 'casado', l: 'Casado(a)' },
  { v: 'divorciado', l: 'Divorciado(a)' },
  { v: 'viuvo', l: 'Viúvo(a)' },
  { v: 'uniao_estavel', l: 'União estável' },
]

const DRAWER_TABS = ['resumo', 'pessoal', 'anamnese', 'prontuario', 'financeiro']
const DRAWER_TAB_LABELS = { resumo: 'Resumo', pessoal: 'Dados', anamnese: 'Anamnese', prontuario: 'Prontuário', financeiro: 'Financeiro' }

const emptyForm = {
  full_name: '',
  cpf: '',
  date_of_birth: '',
  sex: '',
  civil_status: '',
  profession: '',
  phone: '',
  email: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  address_street: '',
  address_number: '',
  address_complement: '',
  address_district: '',
  address_city: '',
  address_state: '',
  address_zip: '',
  start_date: today(),
  chief_complaint: '',
  hda: '',
  previous_surgeries: '',
  hospitalizations: '',
  chronic_diseases: '',
  allergies: '',
  current_medications: '',
  smoking: '',
  alcohol: '',
  physical_activity: '',
  family_history: '',
  gynecological_history: '',
  clinical_notes: '',
  consent_signed: false,
  consent_date: '',
}

export function Patients({ data }) {
  const { user } = useAuth()
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false

  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [selected, setSelected] = useState(null)
  const [drawerTab, setDrawerTab] = useState('dados')

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [confirmArchiveId, setConfirmArchiveId] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    load()
  }, [user?.id])

  async function load() {
    setLoading(true)
    const { data: rows } = await supabase
      .from('patients')
      .select('*')
      .eq('user_id', user.id)
      .order('full_name')
    setPatients(rows || [])
    setLoading(false)
  }

  function openAdd() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(p) {
    setForm({
      full_name: p.full_name || '',
      cpf: p.cpf || '',
      date_of_birth: p.date_of_birth || '',
      sex: p.sex || '',
      civil_status: p.civil_status || '',
      profession: p.profession || '',
      phone: p.phone || '',
      email: p.email || '',
      emergency_contact_name: p.emergency_contact_name || '',
      emergency_contact_phone: p.emergency_contact_phone || '',
      address_street: p.address_street || '',
      address_number: p.address_number || '',
      address_complement: p.address_complement || '',
      address_district: p.address_district || '',
      address_city: p.address_city || '',
      address_state: p.address_state || '',
      address_zip: p.address_zip || '',
      start_date: p.start_date || today(),
      chief_complaint: p.chief_complaint || '',
      hda: p.hda || '',
      previous_surgeries: p.previous_surgeries || '',
      hospitalizations: p.hospitalizations || '',
      chronic_diseases: p.chronic_diseases || '',
      allergies: p.allergies || '',
      current_medications: p.current_medications || '',
      smoking: p.smoking || '',
      alcohol: p.alcohol || '',
      physical_activity: p.physical_activity || '',
      family_history: p.family_history || '',
      gynecological_history: p.gynecological_history || '',
      clinical_notes: p.clinical_notes || '',
      consent_signed: p.consent_signed || false,
      consent_date: p.consent_date || '',
    })
    setEditingId(p.id)
    setShowForm(true)
  }

  async function save() {
    if (!form.full_name.trim()) return
    setSaving(true)
    const payload = {
      full_name: form.full_name.trim(),
      cpf: form.cpf || null,
      date_of_birth: form.date_of_birth || null,
      sex: form.sex || null,
      civil_status: form.civil_status || null,
      profession: form.profession || null,
      phone: form.phone || null,
      email: form.email || null,
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
      address_street: form.address_street || null,
      address_number: form.address_number || null,
      address_complement: form.address_complement || null,
      address_district: form.address_district || null,
      address_city: form.address_city || null,
      address_state: form.address_state || null,
      address_zip: form.address_zip || null,
      start_date: form.start_date || null,
      chief_complaint: form.chief_complaint || null,
      hda: form.hda || null,
      previous_surgeries: form.previous_surgeries || null,
      hospitalizations: form.hospitalizations || null,
      chronic_diseases: form.chronic_diseases || null,
      allergies: form.allergies || null,
      current_medications: form.current_medications || null,
      smoking: form.smoking || null,
      alcohol: form.alcohol || null,
      physical_activity: form.physical_activity || null,
      family_history: form.family_history || null,
      gynecological_history: form.gynecological_history || null,
      clinical_notes: form.clinical_notes || null,
      consent_signed: form.consent_signed,
      consent_date: form.consent_signed ? (form.consent_date || null) : null,
    }

    if (editingId) {
      const { data: updated } = await supabase
        .from('patients')
        .update(payload)
        .eq('id', editingId)
        .eq('user_id', user.id)
        .select()
        .single()
      if (updated) {
        setPatients(ps => ps.map(p => p.id === editingId ? updated : p))
        if (selected?.id === editingId) setSelected(updated)
      }
    } else {
      const { data: created } = await supabase
        .from('patients')
        .insert({ ...payload, user_id: user.id })
        .select()
        .single()
      if (created) setPatients(ps => [...ps, created].sort((a, b) => a.full_name.localeCompare(b.full_name)))
    }

    setSaving(false)
    setShowForm(false)
  }

  async function archivePatient(id) {
    await supabase.from('patients').update({ active: false }).eq('id', id).eq('user_id', user.id)
    setPatients(ps => ps.filter(p => p.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const filtered = patients.filter(p =>
    p.active !== false &&
    (p.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (p.cpf || '').replace(/\D/g, '').includes(search.replace(/\D/g, '')))
  )

  // Financeiro tab: filter surgeries and consultations linked to selected patient
  const patientSurgeries = selected
    ? (data?.surgeries || []).filter(s => s.patientId === selected.id || s.patient_id === selected.id)
    : []
  const patientConsultations = selected
    ? (data?.consultations || []).filter(c => c.patientId === selected.id || c.patient_id === selected.id)
    : []
  const totalFinanceiro = [...patientSurgeries, ...patientConsultations].reduce(
    (sum, r) => sum + (r.totalValue || r.value || 0), 0
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Buscar por nome ou CPF…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...base.input, maxWidth: isMobile ? '100%' : 280, width: isMobile ? '100%' : 'auto' }}
        />
        <span style={{ marginLeft: isMobile ? 0 : 'auto', fontSize: 13, color: C.textDim }}>
          {filtered.length} paciente{filtered.length !== 1 ? 's' : ''}
        </span>
        <Btn onClick={openAdd}>+ Novo paciente</Btn>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: C.textDim, fontSize: 13, textAlign: 'center', padding: 32 }}>Carregando…</div>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Nome', 'CPF', 'Telefone', 'Início', 'TCLE', ''].map(h => (
                    <th key={h} style={{ padding: '14px 18px', textAlign: 'left', fontSize: 11, color: C.textSub, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                      {search ? 'Nenhum paciente encontrado.' : 'Nenhum paciente cadastrado ainda.'}
                    </td>
                  </tr>
                )}
                {filtered.map(p => (
                  <tr
                    key={p.id}
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      cursor: 'pointer',
                      background: selected?.id === p.id ? C.accent + '10' : 'transparent',
                    }}
                    onClick={() => { setSelected(p); setDrawerTab('resumo') }}
                  >
                    <td style={{ padding: '13px 18px', color: C.text, fontWeight: 600 }}>{p.full_name}</td>
                    <td style={{ padding: '13px 18px', color: C.textSub, fontSize: 13 }}>{p.cpf || '—'}</td>
                    <td style={{ padding: '13px 18px', color: C.textSub, fontSize: 13 }}>{p.phone || '—'}</td>
                    <td style={{ padding: '13px 18px', color: C.textSub, fontSize: 13 }}>{p.start_date ? formatDateBR(p.start_date) : '—'}</td>
                    <td style={{ padding: '13px 18px' }}>
                      {p.consent_signed
                        ? <Badge color={C.green} small>Assinado</Badge>
                        : <Badge color={C.yellow} small>Pendente</Badge>}
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                        <Btn variant="ghost" onClick={() => openEdit(p)} style={{ padding: '5px 10px', fontSize: 11 }}>Editar</Btn>
                        <Btn variant="danger" onClick={() => setConfirmArchiveId(p.id)} style={{ padding: '5px 10px', fontSize: 11 }}>Arquivar</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Drawer lateral */}
      {selected && (
        <Drawer
          patient={selected}
          tab={drawerTab}
          onTabChange={setDrawerTab}
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          userId={user?.id}
          surgeries={patientSurgeries}
          consultations={patientConsultations}
          totalFinanceiro={totalFinanceiro}
        />
      )}

      {/* Form modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? 'Editar paciente' : 'Novo paciente'}
        width={720}
      >
        <PatientForm
          form={form}
          setForm={setForm}
          onSave={save}
          onCancel={() => setShowForm(false)}
          saving={saving}
        />
      </Modal>

      <ConfirmModal
        open={!!confirmArchiveId}
        onClose={() => setConfirmArchiveId(null)}
        onConfirm={() => archivePatient(confirmArchiveId)}
        title="Arquivar paciente?"
        message="O paciente será removido da lista ativa. O prontuário e o histórico financeiro são preservados."
        confirmLabel="Arquivar"
      />
    </div>
  )
}

function Drawer({ patient, tab, onTabChange, onClose, onEdit, userId, surgeries, consultations, totalFinanceiro }) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 200,
        }}
      />
      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: isMobile ? '100%' : 560,
        background: C.card,
        borderLeft: `1px solid ${C.borderBright}`,
        zIndex: 201,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 0', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>{patient.full_name}</h3>
              {patient.start_date && (
                <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>
                  Acompanhamento desde {formatDateBR(patient.start_date)}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="ghost" onClick={onEdit} style={{ padding: '6px 12px', fontSize: 12 }}>Editar dados</Btn>
              <button
                onClick={onClose}
                style={{ background: C.border, border: 'none', color: C.textSub, width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}
              >×</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4 }}>
            {DRAWER_TABS.map(t => (
              <button
                key={t}
                onClick={() => onTabChange(t)}
                style={{
                  background: tab === t ? C.accent + '18' : 'transparent',
                  color: tab === t ? C.accent : C.textSub,
                  border: tab === t ? `1px solid ${C.accent}44` : '1px solid transparent',
                  borderBottom: 'none',
                  borderRadius: '8px 8px 0 0',
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {DRAWER_TAB_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div style={{ padding: '20px 24px', flex: 1 }}>
          {tab === 'resumo' && (
            <ResumoTab
              patient={patient}
              userId={userId}
              surgeries={surgeries}
              consultations={consultations}
              totalFinanceiro={totalFinanceiro}
            />
          )}
          {tab === 'pessoal' && <PessoalTab patient={patient} />}
          {tab === 'anamnese' && <AnamneseTab patient={patient} />}
          {tab === 'prontuario' && (
            <MedicalRecord patientId={patient.id} userId={userId} />
          )}
          {tab === 'financeiro' && (
            <FinanceiroTab
              surgeries={surgeries}
              consultations={consultations}
              total={totalFinanceiro}
            />
          )}
        </div>
      </div>
    </>
  )
}

function Field({ label, value }) {
  if (!value) return null
  return (
    <div>
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.text }}>{value}</div>
    </div>
  )
}

function TabSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, color: C.textDim, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>{children}</div>
    </div>
  )
}

function ResumoTab({ patient, userId, surgeries, consultations, totalFinanceiro }) {
  const [records, setRecords] = useState([])
  useEffect(() => {
    if (!patient?.id || !userId) return
    supabase.from('medical_records').select('id,session_date,evolution_notes,procedures_applied,archived')
      .eq('patient_id', patient.id).eq('user_id', userId).eq('archived', false)
      .order('session_date', { ascending: false })
      .then(({ data }) => setRecords(data || []))
  }, [patient?.id, userId])

  const sexLabel = { F: 'Feminino', M: 'Masculino', outro: 'Outro' }

  // Unified timeline
  const timeline = [
    ...records.map(r => ({
      id: r.id, date: r.session_date, type: 'prontuario',
      label: 'Sessão', desc: r.procedures_applied || r.evolution_notes?.slice(0, 80),
      color: C.accent,
    })),
    ...surgeries.map(s => ({
      id: s.id, date: s.date, type: 'cirurgia',
      label: 'Cirurgia', desc: fmt(s.totalValue),
      color: C.cyan,
    })),
    ...consultations.map(c => ({
      id: c.id, date: c.date, type: 'consulta',
      label: 'Consulta', desc: fmt(c.value),
      color: C.green,
    })),
  ].filter(e => e.date).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const age = patient.date_of_birth
    ? Math.floor((Date.now() - new Date(patient.date_of_birth)) / (365.25 * 24 * 3600 * 1000))
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Quick info card */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
        {age !== null && <Field label="Idade" value={`${age} anos`} />}
        {patient.sex && <Field label="Sexo" value={sexLabel[patient.sex] || patient.sex} />}
        {patient.chief_complaint && <Field label="Queixa principal" value={patient.chief_complaint} />}
        {patient.phone && <Field label="Telefone" value={patient.phone} />}
        {patient.allergies && <Field label="Alergias" value={patient.allergies} />}
        {patient.current_medications && <Field label="Medicamentos" value={patient.current_medications} />}
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          { label: 'Sessões', value: records.length, color: C.accent },
          { label: 'Procedimentos', value: surgeries.length + consultations.length, color: C.cyan },
          { label: 'Total', value: fmt(totalFinanceiro), color: C.green },
        ].map(s => (
          <div key={s.label} style={{ background: s.color + '12', border: `1px solid ${s.color}30`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* TCLE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: patient.consent_signed ? C.green + '10' : C.yellow + '10', border: `1px solid ${patient.consent_signed ? C.green : C.yellow}33`, borderRadius: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: patient.consent_signed ? C.green : C.yellow, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: C.text }}>TCLE — {patient.consent_signed ? `Assinado${patient.consent_date ? ` em ${formatDateBR(patient.consent_date)}` : ''}` : 'Pendente'}</span>
      </div>

      {/* Timeline */}
      <div>
        <div style={{ fontSize: 10, color: C.textDim, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>Histórico</div>
        {timeline.length === 0 ? (
          <div style={{ color: C.textDim, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>Nenhum registro ainda.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {timeline.map((e, i) => (
              <div key={e.id} style={{ display: 'flex', gap: 12, paddingBottom: 14, position: 'relative' }}>
                {/* Line */}
                {i < timeline.length - 1 && (
                  <div style={{ position: 'absolute', left: 11, top: 22, bottom: 0, width: 2, background: C.border }} />
                )}
                {/* Dot */}
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: e.color + '20', border: `2px solid ${e.color}`, flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: e.color }} />
                </div>
                {/* Content */}
                <div style={{ flex: 1, paddingTop: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: e.color, background: e.color + '15', borderRadius: 4, padding: '1px 6px' }}>{e.label}</span>
                    <span style={{ fontSize: 12, color: C.textDim }}>{formatDateBR(e.date)}</span>
                  </div>
                  {e.desc && <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{e.desc}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PessoalTab({ patient }) {
  const sexLabel = { F: 'Feminino', M: 'Masculino', outro: 'Outro' }
  const civilLabel = { solteiro: 'Solteiro(a)', casado: 'Casado(a)', divorciado: 'Divorciado(a)', viuvo: 'Viúvo(a)', uniao_estavel: 'União estável' }

  return (
    <div>
      <TabSection title="Identificação">
        <Field label="Nome completo" value={patient.full_name} />
        <Field label="CPF" value={patient.cpf} />
        <Field label="Data de nascimento" value={patient.date_of_birth ? formatDateBR(patient.date_of_birth) : null} />
        <Field label="Sexo" value={sexLabel[patient.sex] || null} />
        <Field label="Estado civil" value={civilLabel[patient.civil_status] || null} />
        <Field label="Profissão" value={patient.profession} />
        <Field label="Início do acompanhamento" value={patient.start_date ? formatDateBR(patient.start_date) : null} />
      </TabSection>

      <TabSection title="Contato">
        <Field label="Telefone" value={patient.phone} />
        <Field label="E-mail" value={patient.email} />
        <Field label="Contato de emergência" value={patient.emergency_contact_name} />
        <Field label="Telefone emergência" value={patient.emergency_contact_phone} />
      </TabSection>

      {(patient.address_street || patient.address_city) && (
        <TabSection title="Endereço">
          <Field label="Logradouro" value={[patient.address_street, patient.address_number].filter(Boolean).join(', ')} />
          <Field label="Complemento" value={patient.address_complement} />
          <Field label="Bairro" value={patient.address_district} />
          <Field label="Cidade / UF" value={[patient.address_city, patient.address_state].filter(Boolean).join(' — ')} />
          <Field label="CEP" value={patient.address_zip} />
        </TabSection>
      )}
    </div>
  )
}

function AnamneseTab({ patient }) {
  const hasAnamnese = patient.chief_complaint || patient.hda || patient.chronic_diseases || patient.allergies || patient.current_medications || patient.previous_surgeries || patient.hospitalizations || patient.smoking || patient.alcohol || patient.physical_activity || patient.family_history || patient.gynecological_history || patient.clinical_notes

  if (!hasAnamnese) {
    return <div style={{ color: C.textDim, fontSize: 13, textAlign: 'center', padding: '32px 0' }}>Anamnese não preenchida ainda.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {patient.chief_complaint && <AnamneseField label="Queixa principal" value={patient.chief_complaint} />}
      {patient.hda && <AnamneseField label="HDA — História da doença atual" value={patient.hda} />}
      {patient.chronic_diseases && <AnamneseField label="Doenças crônicas" value={patient.chronic_diseases} />}
      {patient.allergies && <AnamneseField label="Alergias" value={patient.allergies} />}
      {patient.current_medications && <AnamneseField label="Medicamentos em uso" value={patient.current_medications} />}
      {patient.previous_surgeries && <AnamneseField label="Cirurgias anteriores" value={patient.previous_surgeries} />}
      {patient.hospitalizations && <AnamneseField label="Internações" value={patient.hospitalizations} />}
      {patient.smoking && <AnamneseField label="Tabagismo" value={patient.smoking} />}
      {patient.alcohol && <AnamneseField label="Etilismo" value={patient.alcohol} />}
      {patient.physical_activity && <AnamneseField label="Atividade física" value={patient.physical_activity} />}
      {patient.family_history && <AnamneseField label="Antecedentes familiares" value={patient.family_history} />}
      {patient.gynecological_history && <AnamneseField label="Antecedentes ginecológicos" value={patient.gynecological_history} />}
      {patient.clinical_notes && <AnamneseField label="Observações gerais" value={patient.clinical_notes} />}
    </div>
  )
}

function FinanceiroTab({ surgeries, consultations, total }) {
  if (surgeries.length === 0 && consultations.length === 0) {
    return (
      <div style={{ color: C.textDim, fontSize: 13, textAlign: 'center', padding: '32px 0' }}>
        Nenhum registro financeiro vinculado a este paciente ainda.
      </div>
    )
  }

  const all = [
    ...surgeries.map(s => ({ ...s, tipo: 'Cirurgia', valor: s.totalValue || 0 })),
    ...consultations.map(c => ({ ...c, tipo: 'Consulta', valor: c.value || 0 })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const STATUS_COLOR = {
    pago: C.green, pendente: C.yellow, parcelado: C.cyan, cancelado: C.red, glosado: C.red,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: C.textSub }}>
        Total acumulado: <strong style={{ color: C.green }}>{fmt(total)}</strong>
      </div>

      {all.map(r => (
        <div key={r.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{r.tipo}</div>
            <div style={{ fontSize: 12, color: C.textDim }}>{r.date ? formatDateBR(r.date) : '—'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>{fmt(r.valor)}</span>
            <Badge color={STATUS_COLOR[r.paymentStatus] || C.textDim} small>{r.paymentStatus || 'pendente'}</Badge>
          </div>
        </div>
      ))}
    </div>
  )
}

const FORM_STEPS = [
  { id: 'identificacao', label: 'Identificação' },
  { id: 'contato',       label: 'Contato' },
  { id: 'endereco',      label: 'Endereço' },
  { id: 'clinico',       label: 'Clínico' },
  { id: 'anamnese',      label: 'Anamnese' },
  { id: 'tcle',          label: 'TCLE' },
  { id: 'revisao',       label: 'Revisão' },
]

function PatientForm({ form, setForm, onSave, onCancel, saving }) {
  const [step, setStep] = useState(0)
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 900 : false
  const grid = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }

  const fi = (field, label, opts = {}) => (
    <FInput
      key={field}
      label={label}
      value={form[field]}
      onChange={v => setForm(f => ({ ...f, [field]: v }))}
      type={opts.type || 'text'}
      placeholder={opts.placeholder}
      options={opts.options}
      required={opts.required}
    />
  )

  const isLast = step === FORM_STEPS.length - 1
  const canSave = form.full_name.trim()

  const stepContent = {
    identificacao: (
      <div style={grid}>
        {fi('full_name', 'Nome completo', { required: true, placeholder: 'Nome completo do paciente' })}
        {fi('cpf', 'CPF', { placeholder: '000.000.000-00' })}
        {fi('date_of_birth', 'Data de nascimento', { type: 'date' })}
        {fi('sex', 'Sexo', { options: SEX_OPTIONS })}
        {fi('civil_status', 'Estado civil', { options: CIVIL_STATUS_OPTIONS })}
        {fi('profession', 'Profissão', { placeholder: 'Ex.: Professora, Engenheiro…' })}
      </div>
    ),
    contato: (
      <div style={grid}>
        {fi('phone', 'Telefone', { placeholder: '(11) 99999-9999' })}
        {fi('email', 'E-mail', { type: 'email', placeholder: 'email@exemplo.com' })}
        {fi('emergency_contact_name', 'Contato de emergência', { placeholder: 'Nome' })}
        {fi('emergency_contact_phone', 'Telefone de emergência', { placeholder: '(11) 99999-9999' })}
      </div>
    ),
    endereco: (
      <div style={grid}>
        {fi('address_zip', 'CEP', { placeholder: '00000-000' })}
        {fi('address_street', 'Logradouro', { placeholder: 'Rua, Av., Praça…' })}
        {fi('address_number', 'Número', { placeholder: '123' })}
        {fi('address_complement', 'Complemento', { placeholder: 'Apto, Bloco…' })}
        {fi('address_district', 'Bairro')}
        {fi('address_city', 'Cidade')}
        {fi('address_state', 'UF', { placeholder: 'SP' })}
      </div>
    ),
    clinico: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={grid}>
          {fi('start_date', 'Início do acompanhamento', { type: 'date' })}
          {fi('chief_complaint', 'Queixa principal', { placeholder: 'Motivo da busca pelo atendimento' })}
        </div>
      </div>
    ),
    anamnese: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AutoTextarea field="hda" label="HDA — História da doença atual" placeholder="Descreva o histórico e evolução da queixa principal…" form={form} setForm={setForm} />
        <div style={grid}>
          {fi('chronic_diseases', 'Doenças crônicas', { placeholder: 'HAS, DM, hipotireoidismo…' })}
          {fi('allergies', 'Alergias', { placeholder: 'Medicamentos, látex, outros…' })}
        </div>
        <AutoTextarea field="current_medications" label="Medicamentos em uso" placeholder="Nome, dose e frequência de cada medicamento…" form={form} setForm={setForm} />
        <div style={grid}>
          {fi('previous_surgeries', 'Cirurgias anteriores', { placeholder: 'Ex.: apendicectomia 2010, colecistectomia 2018…' })}
          {fi('hospitalizations', 'Internações', { placeholder: 'Motivo e ano…' })}
        </div>
        <div style={grid}>
          {fi('smoking', 'Tabagismo', { placeholder: 'Nunca / Ex-tabagista (X anos) / Ativo (X cigarros/dia)' })}
          {fi('alcohol', 'Etilismo', { placeholder: 'Não / Social / Frequente' })}
          {fi('physical_activity', 'Atividade física', { placeholder: 'Tipo, frequência e intensidade…' })}
        </div>
        <div style={grid}>
          {fi('family_history', 'Antecedentes familiares', { placeholder: 'Doenças cardiovasculares, câncer, diabetes…' })}
          {fi('gynecological_history', 'Antecedentes ginecológicos', { placeholder: 'G P A, última menstruação, contraceptivos…' })}
        </div>
        <AutoTextarea field="clinical_notes" label="Observações gerais (opcional)" placeholder="Outras informações relevantes…" form={form} setForm={setForm} />
      </div>
    ),
    tcle: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', background: C.surface, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <input
            type="checkbox"
            id="consent_signed"
            checked={form.consent_signed}
            onChange={e => setForm(f => ({ ...f, consent_signed: e.target.checked }))}
            style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0, marginTop: 2 }}
          />
          <div>
            <label htmlFor="consent_signed" style={{ fontSize: 13, color: C.text, cursor: 'pointer', fontWeight: 600 }}>
              Termo de Consentimento Livre e Esclarecido assinado
            </label>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>
              O paciente foi informado sobre os procedimentos, riscos e benefícios e concordou com o tratamento.
            </div>
          </div>
        </div>
        {form.consent_signed && (
          <div style={{ maxWidth: 240 }}>
            <FInput label="Data da assinatura" type="date" value={form.consent_date} onChange={v => setForm(f => ({ ...f, consent_date: v }))} />
          </div>
        )}
      </div>
    ),
    revisao: <RevisaoForm form={form} />,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Step pills */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
        {FORM_STEPS.map((s, i) => {
          const active = i === step
          const done = i < step
          return (
            <button
              key={s.id}
              onClick={() => setStep(i)}
              style={{
                background: active ? C.accent : done ? C.accent + '20' : C.surface,
                color: active ? '#fff' : done ? C.accent : C.textDim,
                border: `1px solid ${active ? C.accent : done ? C.accent + '50' : C.border}`,
                borderRadius: 99,
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              {i + 1}. {s.label}
            </button>
          )
        })}
      </div>

      {/* Step content */}
      <div style={{ minHeight: 180 }}>
        {stepContent[FORM_STEPS[step].id]}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={onCancel}>Cancelar</Btn>
          {step > 0 && <Btn variant="ghost" onClick={() => setStep(s => s - 1)}>← Anterior</Btn>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isLast && <Btn onClick={() => setStep(s => s + 1)}>Próximo →</Btn>}
          {isLast && (
            <Btn onClick={onSave} disabled={saving || !canSave}>
              {saving ? 'Salvando…' : 'Salvar paciente'}
            </Btn>
          )}
        </div>
      </div>
    </div>
  )
}

function RevisaoForm({ form }) {
  const sexLabel = { F: 'Feminino', M: 'Masculino', outro: 'Outro' }
  const civilLabel = { solteiro: 'Solteiro(a)', casado: 'Casado(a)', divorciado: 'Divorciado(a)', viuvo: 'Viúvo(a)', uniao_estavel: 'União estável' }

  function Block({ title, fields }) {
    const visible = fields.filter(f => f.value)
    if (!visible.length) return null
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: C.textDim, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>{title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
          {visible.map(f => (
            <div key={f.label}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 1 }}>{f.label}</div>
              <div style={{ fontSize: 13, color: C.text, whiteSpace: 'pre-wrap' }}>{f.value}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <Block title="Identificação" fields={[
        { label: 'Nome', value: form.full_name },
        { label: 'CPF', value: form.cpf },
        { label: 'Nascimento', value: form.date_of_birth ? formatDateBR(form.date_of_birth) : '' },
        { label: 'Sexo', value: sexLabel[form.sex] || '' },
        { label: 'Estado civil', value: civilLabel[form.civil_status] || '' },
        { label: 'Profissão', value: form.profession },
      ]} />
      <Block title="Contato" fields={[
        { label: 'Telefone', value: form.phone },
        { label: 'E-mail', value: form.email },
        { label: 'Emergência', value: form.emergency_contact_name },
        { label: 'Tel. emergência', value: form.emergency_contact_phone },
      ]} />
      <Block title="Endereço" fields={[
        { label: 'Logradouro', value: [form.address_street, form.address_number].filter(Boolean).join(', ') },
        { label: 'Bairro', value: form.address_district },
        { label: 'Cidade / UF', value: [form.address_city, form.address_state].filter(Boolean).join(' — ') },
        { label: 'CEP', value: form.address_zip },
      ]} />
      <Block title="Clínico" fields={[
        { label: 'Início', value: form.start_date ? formatDateBR(form.start_date) : '' },
        { label: 'Queixa principal', value: form.chief_complaint },
      ]} />
      <Block title="Anamnese" fields={[
        { label: 'HDA', value: form.hda },
        { label: 'Doenças crônicas', value: form.chronic_diseases },
        { label: 'Alergias', value: form.allergies },
        { label: 'Medicamentos', value: form.current_medications },
        { label: 'Cirurgias anteriores', value: form.previous_surgeries },
        { label: 'Internações', value: form.hospitalizations },
        { label: 'Tabagismo', value: form.smoking },
        { label: 'Etilismo', value: form.alcohol },
        { label: 'Atividade física', value: form.physical_activity },
        { label: 'Antec. familiares', value: form.family_history },
        { label: 'Antec. ginecológicos', value: form.gynecological_history },
        { label: 'Observações', value: form.clinical_notes },
      ]} />
      <Block title="TCLE" fields={[
        { label: 'Status', value: form.consent_signed ? 'Assinado' : 'Pendente' },
        { label: 'Data', value: form.consent_date ? formatDateBR(form.consent_date) : '' },
      ]} />
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 11, color: C.textDim, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
      {children}
    </div>
  )
}

function AutoTextarea({ field, label, placeholder, form, setForm }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = Math.max(80, ref.current.scrollHeight) + 'px'
    }
  }, [form[field]])
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={base.label}>{label}</label>
      <textarea
        ref={ref}
        value={form[field]}
        onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
        placeholder={placeholder}
        style={{ ...base.input, resize: 'none', fontFamily: 'inherit', lineHeight: 1.6, overflow: 'hidden' }}
      />
    </div>
  )
}

function AnamneseField({ label, value }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
      <div style={{ fontSize: 10, color: C.textDim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.textSub, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{value}</div>
    </div>
  )
}
