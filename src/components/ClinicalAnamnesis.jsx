import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { today, uid } from '../utils.js'
import {
  buildClinicalAnamnesisRpcArgs,
  calculateClinicalBmi,
  clinicalAnamnesisFromLegacy,
  emptyClinicalAnamnesis,
  hasLegacyClinicalAnamnesis,
} from '../lib/clinicalAnamnesis.js'
import { Btn } from './UI.jsx'
import { loadClinicalProtocols } from '../lib/clinicalProtocolClient.js'
import { buildProtocolAnamnesisDraft, protocolVersionToForm, validateProtocolResponses } from '../lib/clinicalProtocols.js'

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

async function fetchClinicalAnamneses(patientId, ownerId) {
  const { data, error } = await supabase
    .from('clinical_anamneses')
    .select('*')
    .eq('patient_id', patientId)
    .eq('user_id', ownerId)
    .order('recorded_at', { ascending:false })
  if (error) throw error
  return data || []
}

export function ClinicalAnamnesis({ patientId, ownerId, author, legacyProfile, initialDraft, onDraftConsumed }) {
  const [records, setRecords] = useState([])
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const [requestId, setRequestId] = useState('')
  const [status, setStatus] = useState('loading')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(() => emptyClinicalAnamnesis(today()))
  const [protocols, setProtocols] = useState([])

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError('')
    setRecords([])
    setSelectedRecordId('')
    fetchClinicalAnamneses(patientId, ownerId)
      .then(rows => {
        if (!active) return
        setRecords(rows)
        setSelectedRecordId(rows[0]?.id || '')
        setStatus('ready')
      })
      .catch(() => {
        if (!active) return
        setStatus('error')
        setError('Não foi possível carregar a anamnese versionada.')
      })
    return () => { active = false }
  }, [patientId, ownerId])

  useEffect(() => {
    let active = true
    loadClinicalProtocols(ownerId, { activeOnly:true }).then(rows => { if (active) setProtocols(rows) }).catch(() => { if (active) setProtocols([]) })
    return () => { active = false }
  }, [ownerId])

  useEffect(() => {
    if (!initialDraft) return
    const source = clinicalAnamnesisFromLegacy(legacyProfile, today())
    setForm({ ...emptyClinicalAnamnesis(today()), ...source, ...initialDraft, session_date:today() })
    setRequestId(uid())
    setError('')
    setEditing(true)
    onDraftConsumed?.()
  }, [initialDraft])

  const record = records.find(item => item.id === selectedRecordId) || records[0] || null
  const latestRecord = records[0] || null
  const legacyAvailable = hasLegacyClinicalAnamnesis(legacyProfile)
  const visibleRecord = record || (legacyAvailable ? clinicalAnamnesisFromLegacy(legacyProfile) : null)
  const bmi = useMemo(() => calculateClinicalBmi(visibleRecord?.weight_kg, visibleRecord?.height_cm), [visibleRecord])
  const formBmi = useMemo(() => calculateClinicalBmi(form.weight_kg, form.height_cm), [form.weight_kg, form.height_cm])

  function beginEditing() {
    const source = latestRecord || clinicalAnamnesisFromLegacy(legacyProfile, today())
    setForm({ ...emptyClinicalAnamnesis(today()), ...source, session_date:today() })
    setRequestId(uid())
    setError('')
    setEditing(true)
  }

  function updateField(field, value) {
    setForm(current => ({ ...current, [field]:value }))
  }

  function applyProtocol(versionId) {
    if (!versionId) {
      setForm(current => ({ ...current, protocol_id:null, protocol_version_id:null, protocol_name:'', protocol_responses:{} }))
      return
    }
    const version = protocols.map(item => item.currentVersion).find(item => item?.id === versionId)
    if (version) setForm(current => buildProtocolAnamnesisDraft(version, current))
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError('')
    let signatureCompleted = false
    try {
      const selectedProtocol = protocols.map(item => item.currentVersion).find(item => item?.id === form.protocol_version_id)
      const protocolError = selectedProtocol ? validateProtocolResponses(selectedProtocol, form.protocol_responses) : ''
      if (protocolError) throw new Error(protocolError)
      const args = buildClinicalAnamnesisRpcArgs({ patientId, requestId, form, author })
      const { data:createdId, error:saveError } = await supabase.rpc('create_clinical_anamnesis', args)
      if (saveError) throw saveError
      signatureCompleted = true
      setEditing(false)
      setSelectedRecordId(createdId || '')
      setStatus('loading')
      const freshRecords = await fetchClinicalAnamneses(patientId, ownerId)
      setRecords(freshRecords)
      setSelectedRecordId(freshRecords.some(item => item.id === createdId) ? createdId : freshRecords[0]?.id || '')
      setStatus('ready')
    } catch (nextError) {
      if (signatureCompleted) {
        setStatus('error')
        setError('A anamnese foi assinada, mas a lista de versões não pôde ser atualizada. Recarregue antes de registrar outra versão.')
      } else {
        setError(nextError.message || 'Não foi possível assinar a anamnese.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function retryLoad() {
    setStatus('loading')
    setError('')
    try {
      const freshRecords = await fetchClinicalAnamneses(patientId, ownerId)
      setRecords(freshRecords)
      setSelectedRecordId(current => freshRecords.some(item => item.id === current) ? current : freshRecords[0]?.id || '')
      setStatus('ready')
    } catch {
      setStatus('error')
      setError('Não foi possível carregar a anamnese versionada.')
    }
  }

  if (status === 'loading') return <div className="clinical-loading">Carregando anamnese clínica…</div>
  if (status === 'error') {
    return <div className="clinical-empty-panel clinical-anamnesis-empty" role="alert"><strong>{error}</strong><Btn variant="ghost" onClick={retryLoad}>Tentar carregar novamente</Btn></div>
  }

  if (editing) {
    return (
      <div className="clinical-anamnesis-editor">
        <header className="clinical-anamnesis-toolbar">
          <div><span>Anamnese clínica</span><strong>Novo registro SOAP</strong></div>
          <label>Data<input type="date" value={form.session_date} onChange={event => updateField('session_date', event.target.value)} /></label>
        </header>

        {error && <div className="clinical-form-error" role="alert">{error}</div>}

        {protocols.length > 0 && <section className="clinical-protocol-apply"><div><strong>Protocolo do procedimento</strong><span>Use como roteiro e revise cada informação antes de assinar.</span></div><select aria-label="Protocolo clínico" value={form.protocol_version_id || ''} onChange={event => applyProtocol(event.target.value)}><option value="">Sem protocolo</option>{protocols.map(item => <option key={item.currentVersion.id} value={item.currentVersion.id}>{item.currentVersion.name} · v{item.currentVersion.version_number}</option>)}</select></section>}

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

        {form.protocol_version_id && (() => {
          const version = protocols.map(item => item.currentVersion).find(item => item?.id === form.protocol_version_id)
          const prompts = version ? protocolVersionToForm(version).anamnesisPrompts : []
          return prompts.length > 0 ? <section className="clinical-soap-section is-protocol"><header><span>+</span><div><strong>Campos do protocolo</strong><small>Complementos específicos de {form.protocol_name}</small></div></header><div className="clinical-soap-fields">{prompts.map(prompt => <label key={prompt.key}><span>{prompt.label}{prompt.required ? ' *' : ''}</span><textarea rows="3" value={form.protocol_responses?.[prompt.key] || ''} onChange={event => setForm(current => ({ ...current, protocol_responses:{ ...current.protocol_responses, [prompt.key]:event.target.value } }))} /></label>)}</div></section> : null
        })()}

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
          <span>{record ? (record.id === latestRecord?.id ? 'Última versão assinada' : 'Versão anterior assinada') : 'Dados legados — ainda não assinados neste formato'}</span>
          <strong>{record ? `${displayDate(record.session_date)} · ${signature(record)}` : 'Complete os campos obrigatórios para criar a primeira versão'}</strong>
        </div>
        <div className="clinical-anamnesis-toolbar__actions">
          {records.length > 1 && (
            <label className="clinical-version-select">
              <span>{records.length} versões</span>
              <select aria-label="Versão da anamnese" value={record?.id || ''} onChange={event => setSelectedRecordId(event.target.value)}>
                {records.map((item, index) => <option key={item.id} value={item.id}>{index === 0 ? 'Atual' : `Anterior ${index}`} · {displayDate(item.session_date)} · {item.author_name}</option>)}
              </select>
            </label>
          )}
          <Btn variant="ghost" onClick={beginEditing}>{record ? '+ Nova versão' : 'Completar anamnese'}</Btn>
        </div>
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

      {visibleRecord.protocol_name && <section className="clinical-protocol-record"><strong>Protocolo aplicado: {visibleRecord.protocol_name}</strong><span>Snapshot preservado neste registro</span>{Object.entries(visibleRecord.protocol_responses || {}).filter(([, value]) => String(value || '').trim()).map(([key, value]) => { const prompt = (visibleRecord.protocol_snapshot?.anamnesis_prompts || []).find(item => item.key === key); return <div key={key}><span>{prompt?.label || key}</span><p>{value}</p></div> })}</section>}

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
