import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { today } from '../utils.js'
import {
  buildClinicalAnamnesisRpcArgs,
  calculateClinicalBmi,
  clinicalAnamnesisFromLegacy,
  emptyClinicalAnamnesis,
  hasLegacyClinicalAnamnesis,
} from '../lib/clinicalAnamnesis.js'
import { Btn } from './UI.jsx'

const SOAP_SECTIONS = [
  {
    key:'subjective',
    letter:'S',
    title:'Subjetivo',
    description:'Relato, motivo da consulta e antecedentes',
    fields:[
      ['chief_complaint', 'Queixa principal', 'Motivo principal da consulta'],
      ['history_present_illness', 'História da doença atual', 'Início, evolução, sintomas e fatores associados'],
      ['personal_history', 'Antecedentes pessoais', 'Doenças, cirurgias, internações e hábitos relevantes'],
      ['family_history', 'Antecedentes familiares', 'Condições familiares relevantes'],
      ['review_of_systems', 'Revisão de sistemas', 'Achados positivos e negativos pertinentes'],
    ],
  },
  {
    key:'objective',
    letter:'O',
    title:'Objetivo',
    description:'Sinais vitais e exame físico',
    fields:[['physical_exam', 'Exame físico', 'Estado geral e achados do exame físico']],
  },
  {
    key:'assessment',
    letter:'A',
    title:'Avaliação',
    description:'Raciocínio clínico',
    fields:[['diagnostic_hypotheses', 'Hipóteses diagnósticas', 'Hipóteses, diagnóstico ou problemas avaliados']],
  },
  {
    key:'plan',
    letter:'P',
    title:'Plano',
    description:'Conduta e acompanhamento',
    fields:[['therapeutic_plan', 'Plano terapêutico', 'Condutas, orientações, exames e acompanhamento']],
  },
]

const VITAL_FIELDS = [
  ['systolic_bp', 'PA sistólica', 'mmHg'],
  ['diastolic_bp', 'PA diastólica', 'mmHg'],
  ['temperature_c', 'Temperatura', '°C'],
  ['heart_rate', 'Frequência cardíaca', 'bpm'],
  ['respiratory_rate', 'Frequência respiratória', 'irpm'],
  ['oxygen_saturation', 'Saturação', '%'],
  ['pain_score', 'Dor', '0–10'],
  ['weight_kg', 'Peso', 'kg'],
  ['height_cm', 'Altura', 'cm'],
]

function displayDate(value) {
  if (!value) return 'data não informada'
  return new Date(value.includes('T') ? value : `${value}T12:00:00`).toLocaleDateString('pt-BR')
}

function signature(record) {
  if (!record?.author_name) return ''
  return `${record.author_name} · ${record.author_council || 'CRM'} ${record.author_registration || 'não informado'}`
}

export function ClinicalAnamnesis({ patientId, ownerId, author, legacyProfile }) {
  const [record, setRecord] = useState(null)
  const [status, setStatus] = useState('loading')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(() => emptyClinicalAnamnesis(today()))

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError('')
    supabase
      .from('clinical_anamneses')
      .select('*')
      .eq('patient_id', patientId)
      .eq('user_id', ownerId)
      .order('recorded_at', { ascending:false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error:loadError }) => {
        if (!active) return
        if (loadError) {
          setStatus('error')
          setError('Não foi possível carregar a anamnese versionada.')
          return
        }
        setRecord(data || null)
        setStatus('ready')
      })
    return () => { active = false }
  }, [patientId, ownerId])

  const legacyAvailable = hasLegacyClinicalAnamnesis(legacyProfile)
  const visibleRecord = record || (legacyAvailable ? clinicalAnamnesisFromLegacy(legacyProfile) : null)
  const bmi = useMemo(() => calculateClinicalBmi(visibleRecord?.weight_kg, visibleRecord?.height_cm), [visibleRecord])
  const formBmi = useMemo(() => calculateClinicalBmi(form.weight_kg, form.height_cm), [form.weight_kg, form.height_cm])

  function beginEditing() {
    const source = record || clinicalAnamnesisFromLegacy(legacyProfile, today())
    setForm({ ...emptyClinicalAnamnesis(today()), ...source, session_date:today() })
    setError('')
    setEditing(true)
  }

  function updateField(field, value) {
    setForm(current => ({ ...current, [field]:value }))
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const args = buildClinicalAnamnesisRpcArgs({ patientId, form, author })
      const { error:saveError } = await supabase.rpc('create_clinical_anamnesis', args)
      if (saveError) throw saveError
      const { data:fresh, error:reloadError } = await supabase
        .from('clinical_anamneses')
        .select('*')
        .eq('patient_id', patientId)
        .eq('user_id', ownerId)
        .order('recorded_at', { ascending:false })
        .limit(1)
        .maybeSingle()
      if (reloadError || !fresh) throw reloadError || new Error('Anamnese salva, mas a confirmação não foi carregada.')
      setRecord(fresh)
      setEditing(false)
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível assinar a anamnese.')
    } finally {
      setSaving(false)
    }
  }

  if (status === 'loading') return <div className="clinical-loading">Carregando anamnese clínica…</div>
  if (status === 'error') return <div className="clinical-empty-panel" role="alert">{error}</div>

  if (editing) {
    return (
      <div className="clinical-anamnesis-editor">
        <header className="clinical-anamnesis-toolbar">
          <div><span>Anamnese clínica</span><strong>Novo registro SOAP</strong></div>
          <label>Data<input type="date" value={form.session_date} onChange={event => updateField('session_date', event.target.value)} /></label>
        </header>

        {error && <div className="clinical-form-error" role="alert">{error}</div>}

        {SOAP_SECTIONS.map(section => (
          <section key={section.key} className={`clinical-soap-section is-${section.key}`}>
            <header><span>{section.letter}</span><div><strong>{section.title}</strong><small>{section.description}</small></div></header>
            {section.key === 'objective' && (
              <div className="clinical-vitals-grid">
                {VITAL_FIELDS.map(([field, label, unit]) => (
                  <label key={field}><span>{label}</span><div><input inputMode="decimal" value={form[field]} onChange={event => updateField(field, event.target.value)} aria-label={label} /><small>{unit}</small></div></label>
                ))}
                <div className="clinical-bmi"><span>IMC</span><strong>{formBmi ?? '—'}</strong></div>
              </div>
            )}
            <div className="clinical-soap-fields">
              {section.fields.map(([field, label, placeholder]) => (
                <label key={field}><span>{label}{['chief_complaint', 'history_present_illness', 'physical_exam', 'diagnostic_hypotheses', 'therapeutic_plan'].includes(field) && ' *'}</span><textarea rows={field === 'history_present_illness' ? 4 : 3} value={form[field]} placeholder={placeholder} onChange={event => updateField(field, event.target.value)} /></label>
              ))}
            </div>
          </section>
        ))}

        <footer className="clinical-anamnesis-actions">
          <p>Ao assinar, esta versão se torna imutável. Correções devem ser registradas em uma nova versão.</p>
          <div><Btn variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancelar</Btn><Btn disabled={saving} onClick={save}>{saving ? 'Assinando…' : 'Assinar anamnese'}</Btn></div>
        </footer>
      </div>
    )
  }

  if (!visibleRecord) {
    return (
      <div className="clinical-empty-panel clinical-anamnesis-empty">
        <strong>Anamnese clínica ainda não registrada</strong>
        <p>Registre queixa, história, exame físico, avaliação e plano no formato SOAP.</p>
        <Btn onClick={beginEditing}>+ Registrar anamnese</Btn>
      </div>
    )
  }

  const vitalValues = VITAL_FIELDS
    .map(([field, label, unit]) => [label, visibleRecord[field], unit])
    .filter(([, value]) => value !== null && value !== undefined && value !== '')

  return (
    <div className="clinical-anamnesis-view">
      <header className="clinical-anamnesis-toolbar">
        <div>
          <span>{record ? 'Última versão assinada' : 'Dados legados — ainda não assinados neste formato'}</span>
          <strong>{record ? `${displayDate(record.session_date)} · ${signature(record)}` : 'Complete os campos obrigatórios para criar a primeira versão'}</strong>
        </div>
        <Btn variant="ghost" onClick={beginEditing}>{record ? '+ Nova versão' : 'Completar anamnese'}</Btn>
      </header>

      {vitalValues.length > 0 && (
        <div className="clinical-vitals-strip">
          {vitalValues.map(([label, value, unit]) => <div key={label}><span>{label}</span><strong>{value} <small>{unit}</small></strong></div>)}
          {bmi !== null && <div><span>IMC</span><strong>{bmi}</strong></div>}
        </div>
      )}

      <div className="clinical-soap-summary">
        {SOAP_SECTIONS.map(section => {
          const populated = section.fields.filter(([field]) => String(visibleRecord[field] || '').trim())
          if (populated.length === 0) return null
          return (
            <section key={section.key}>
              <header><span>{section.letter}</span><strong>{section.title}</strong></header>
              {populated.map(([field, label]) => <div key={field}><span>{label}</span><p>{visibleRecord[field]}</p></div>)}
            </section>
          )
        })}
      </div>

      {legacyProfile && (
        <div className="clinical-legacy-alerts">
          {legacyProfile.allergies && <span><strong>Alergias:</strong> {legacyProfile.allergies}</span>}
          {legacyProfile.current_medications && <span><strong>Medicamentos em uso:</strong> {legacyProfile.current_medications}</span>}
          <span className={legacyProfile.consent_signed ? 'is-signed' : ''}><strong>TCLE:</strong> {legacyProfile.consent_signed ? `assinado${legacyProfile.consent_date ? ` em ${displayDate(legacyProfile.consent_date)}` : ''}` : 'pendente'}</span>
        </div>
      )}
    </div>
  )
}
