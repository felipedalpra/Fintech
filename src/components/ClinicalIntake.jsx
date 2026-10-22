import { useEffect, useMemo, useState } from 'react'
import { supabase, getAppOrigin } from '../lib/supabase.js'
import {
  CLINICAL_INTAKE_FIELD_TYPES,
  CLINICAL_INTAKE_SOAP_FIELDS,
  DEFAULT_CLINICAL_INTAKE_FIELDS,
  clinicalFieldId,
  clinicalIntakeRequestStatus,
  clinicalIntakeToSoapDraft,
  normalizeClinicalIntakeDefinition,
  publicClinicalIntakeUrl,
  validateClinicalIntakeDefinition,
} from '../lib/clinicalIntake.js'
import { Btn } from './UI.jsx'

function displayDateTime(value) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—'
}

function emptyField(index) {
  return { id:`campo_${index + 1}`, label:'', type:'text', required:false, soap_field:'' }
}

async function fetchIntakeData(patientId, ownerId) {
  const [templatesResult, consentsResult, requestsResult, submissionsResult] = await Promise.all([
    supabase.from('clinical_intake_templates').select('*').eq('user_id', ownerId).order('created_at', { ascending:false }),
    supabase.from('clinical_consent_templates').select('*').eq('user_id', ownerId).order('created_at', { ascending:false }),
    supabase.from('clinical_intake_requests').select('id,user_id,patient_id,template_id,template_snapshot,status,expires_at,opened_at,submitted_at,revoked_at,created_by,created_at').eq('user_id', ownerId).eq('patient_id', patientId).order('created_at', { ascending:false }),
    supabase.from('clinical_intake_submissions').select('*').eq('user_id', ownerId).eq('patient_id', patientId).order('submitted_at', { ascending:false }),
  ])
  const failed = [templatesResult, consentsResult, requestsResult, submissionsResult].find(result => result.error)
  if (failed) throw failed.error
  return {
    templates:templatesResult.data || [],
    consents:consentsResult.data || [],
    requests:requestsResult.data || [],
    submissions:submissionsResult.data || [],
  }
}

export function ClinicalIntake({ patient, ownerId, onUseDraft }) {
  const [data, setData] = useState({ templates:[], consents:[], requests:[], submissions:[] })
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [mode, setMode] = useState('overview')
  const [templateTitle, setTemplateTitle] = useState('Anamnese pré-consulta')
  const [templateDescription, setTemplateDescription] = useState('Preencha estas informações antes da consulta. A equipe clínica revisará suas respostas durante o atendimento.')
  const [fields, setFields] = useState(() => DEFAULT_CLINICAL_INTAKE_FIELDS.map(field => ({ ...field })))
  const [replacesTemplateId, setReplacesTemplateId] = useState(null)
  const [consentDraft, setConsentDraft] = useState({ title:'', content:'', type:'tcle', required:true })
  const [replacesConsentId, setReplacesConsentId] = useState(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [selectedConsentIds, setSelectedConsentIds] = useState([])
  const [validDays, setValidDays] = useState(3)
  const [lastLink, setLastLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [expandedSubmissionId, setExpandedSubmissionId] = useState('')

  async function load() {
    setStatus('loading')
    setError('')
    try {
      const loaded = await fetchIntakeData(patient.id, ownerId)
      setData(loaded)
      setSelectedTemplateId(current => current || loaded.templates[0]?.id || '')
      setStatus('ready')
    } catch {
      setStatus('error')
      setError('Não foi possível carregar formulários e consentimentos. Confirme se a migration clínica foi aplicada.')
    }
  }

  useEffect(() => { load() }, [patient.id, ownerId])

  const submissionsByRequest = useMemo(() => new Map(data.submissions.map(item => [item.request_id, item])), [data.submissions])

  function updateField(index, key, value) {
    setFields(current => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, [key]:value } : field))
  }

  function addField() {
    setFields(current => [...current, emptyField(current.length)])
  }

  function removeField(index) {
    setFields(current => current.filter((_, fieldIndex) => fieldIndex !== index))
  }

  function createTemplate() {
    setTemplateTitle('Anamnese pré-consulta')
    setTemplateDescription('Preencha estas informações antes da consulta. A equipe clínica revisará suas respostas durante o atendimento.')
    setFields(DEFAULT_CLINICAL_INTAKE_FIELDS.map(field => ({ ...field, options:Array.isArray(field.options) ? [...field.options] : field.options })))
    setReplacesTemplateId(null)
    setError('')
    setMode('template')
  }

  function editTemplateVersion() {
    const template = data.templates.find(item => item.id === selectedTemplateId)
    if (!template) return
    setTemplateTitle(template.title)
    setTemplateDescription(template.description || '')
    setFields((template.definition?.fields || []).map(field => ({ ...field, options:Array.isArray(field.options) ? [...field.options] : field.options })))
    setReplacesTemplateId(template.id)
    setError('')
    setMode('template')
  }

  function createConsent() {
    setConsentDraft({ title:'', content:'', type:'tcle', required:true })
    setReplacesConsentId(null)
    setError('')
    setMode('consent')
  }

  function editConsentVersion(consent) {
    setConsentDraft({ title:consent.title, content:consent.content, type:consent.consent_type, required:consent.required })
    setReplacesConsentId(consent.id)
    setError('')
    setMode('consent')
  }

  async function saveTemplate() {
    setError('')
    const normalized = normalizeClinicalIntakeDefinition(fields.map((field, index) => ({ ...field, id:field.id || clinicalFieldId(field.label, index) })))
    const validationError = validateClinicalIntakeDefinition(normalized)
    if (!templateTitle.trim() || validationError) {
      setError(validationError || 'Informe o nome do formulário.')
      return
    }
    setStatus('saving')
    const { data:createdId, error:saveError } = await supabase.rpc('create_clinical_intake_template', {
      p_title:templateTitle.trim(),
      p_description:templateDescription.trim() || null,
      p_definition:normalized,
      p_replaces_template_id:replacesTemplateId,
    })
    if (saveError) {
      setStatus('ready')
      setError(saveError.message || 'Não foi possível salvar o modelo.')
      return
    }
    setReplacesTemplateId(null)
    setMode('overview')
    await load()
    setSelectedTemplateId(createdId || '')
  }

  async function saveConsent() {
    setError('')
    if (!consentDraft.title.trim() || consentDraft.content.trim().length < 20) {
      setError('Informe o título e o texto completo do termo (mínimo de 20 caracteres).')
      return
    }
    setStatus('saving')
    const replacedConsentId = replacesConsentId
    const { data:createdId, error:saveError } = await supabase.rpc('create_clinical_consent_template', {
      p_title:consentDraft.title.trim(),
      p_content:consentDraft.content.trim(),
      p_consent_type:consentDraft.type,
      p_required:consentDraft.required,
      p_replaces_consent_id:replacesConsentId,
    })
    if (saveError) {
      setStatus('ready')
      setError(saveError.message || 'Não foi possível publicar o termo.')
      return
    }
    setConsentDraft({ title:'', content:'', type:'tcle', required:true })
    setReplacesConsentId(null)
    setMode('overview')
    await load()
    setSelectedConsentIds(current => [...new Set([...current.filter(id => id !== replacedConsentId), createdId].filter(Boolean))])
  }

  async function createRequest() {
    if (!selectedTemplateId || status === 'saving') return
    setStatus('saving')
    setError('')
    setLastLink('')
    const { data:createdRows, error:createError } = await supabase.rpc('create_clinical_intake_request', {
      p_patient_id:patient.id,
      p_template_id:selectedTemplateId,
      p_consent_ids:selectedConsentIds,
      p_valid_days:Number(validDays),
    })
    if (createError) {
      setStatus('ready')
      setError(createError.message || 'Não foi possível gerar o link.')
      return
    }
    const created = Array.isArray(createdRows) ? createdRows[0] : createdRows
    const link = publicClinicalIntakeUrl(created?.access_token, getAppOrigin())
    setLastLink(link)
    setCopied(false)
    await load()
  }

  async function copyLink() {
    if (!lastLink) return
    try {
      await navigator.clipboard.writeText(lastLink)
      setCopied(true)
    } catch {
      setError('Não foi possível copiar automaticamente. Selecione o link e copie manualmente.')
    }
  }

  async function revokeRequest(requestId) {
    setStatus('saving')
    setError('')
    const { error:revokeError } = await supabase.rpc('revoke_clinical_intake_request', { p_request_id:requestId })
    if (revokeError) {
      setStatus('ready')
      setError(revokeError.message || 'Não foi possível revogar o link.')
      return
    }
    await load()
  }

  function useDraft(submission) {
    const draft = clinicalIntakeToSoapDraft(submission)
    if (Object.keys(draft).length === 0) {
      setError('Este formulário não possui campos mapeados para o rascunho SOAP.')
      return
    }
    onUseDraft(draft)
  }

  if (status === 'loading') return <div className="clinical-loading">Carregando pré-anamnese e consentimentos…</div>
  if (status === 'error') return <div className="clinical-empty-panel clinical-intake-empty" role="alert"><strong>{error}</strong><Btn variant="ghost" onClick={load}>Tentar novamente</Btn></div>

  if (mode === 'template') {
    return (
      <div className="clinical-intake-editor">
        <header><div><span>Modelo de formulário</span><strong>{replacesTemplateId ? 'Criar nova versão da pré-anamnese' : 'Personalizar pré-anamnese'}</strong></div><Btn variant="ghost" onClick={() => { setReplacesTemplateId(null); setMode('overview') }}>Voltar</Btn></header>
        {error && <div className="clinical-form-error">{error}</div>}
        <div className="clinical-intake-meta">
          <label><span>Nome do modelo</span><input value={templateTitle} onChange={event => setTemplateTitle(event.target.value)} /></label>
          <label><span>Orientação ao paciente</span><textarea rows={3} value={templateDescription} onChange={event => setTemplateDescription(event.target.value)} /></label>
        </div>
        <div className="clinical-intake-field-editor">
          {fields.map((field, index) => (
            <article key={`${field.id}-${index}`}>
              <div className="clinical-intake-field-editor__top"><strong>Campo {index + 1}</strong><button type="button" onClick={() => removeField(index)}>Remover</button></div>
              <div className="clinical-intake-field-editor__grid">
                <label className="is-wide"><span>Pergunta</span><input value={field.label} onChange={event => updateField(index, 'label', event.target.value)} /></label>
                <label><span>Tipo</span><select value={field.type} onChange={event => updateField(index, 'type', event.target.value)}>{CLINICAL_INTAKE_FIELD_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
                <label><span>Levar ao rascunho SOAP</span><select value={field.soap_field || ''} onChange={event => updateField(index, 'soap_field', event.target.value)}>{CLINICAL_INTAKE_SOAP_FIELDS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                {(field.type === 'select' || field.type === 'multiselect') && <label className="is-wide"><span>Opções (uma por linha)</span><textarea rows={3} value={Array.isArray(field.options) ? field.options.join('\n') : field.options || ''} onChange={event => updateField(index, 'options', event.target.value)} /></label>}
                <label className="clinical-intake-checkbox"><input type="checkbox" checked={field.required} onChange={event => updateField(index, 'required', event.target.checked)} /> Resposta obrigatória</label>
              </div>
            </article>
          ))}
        </div>
        <div className="clinical-intake-actions"><Btn variant="ghost" onClick={addField}>+ Adicionar campo</Btn><Btn disabled={status === 'saving'} onClick={saveTemplate}>{status === 'saving' ? 'Salvando…' : 'Salvar modelo imutável'}</Btn></div>
      </div>
    )
  }

  if (mode === 'consent') {
    return (
      <div className="clinical-intake-editor">
        <header><div><span>Termo versionado</span><strong>{replacesConsentId ? 'Criar nova versão do termo' : 'Publicar TCLE ou consentimento'}</strong></div><Btn variant="ghost" onClick={() => { setReplacesConsentId(null); setMode('overview') }}>Voltar</Btn></header>
        {error && <div className="clinical-form-error">{error}</div>}
        <div className="clinical-intake-meta">
          <label><span>Título do termo</span><input value={consentDraft.title} onChange={event => setConsentDraft(current => ({ ...current, title:event.target.value }))} /></label>
          <label><span>Tipo</span><select value={consentDraft.type} onChange={event => setConsentDraft(current => ({ ...current, type:event.target.value }))}><option value="tcle">TCLE</option><option value="privacy">Privacidade e dados</option><option value="image">Uso de imagem</option><option value="procedure">Procedimento</option><option value="other">Outro</option></select></label>
          <label><span>Conteúdo integral</span><textarea rows={12} value={consentDraft.content} onChange={event => setConsentDraft(current => ({ ...current, content:event.target.value }))} /></label>
          <label className="clinical-intake-checkbox"><input type="checkbox" checked={consentDraft.required} onChange={event => setConsentDraft(current => ({ ...current, required:event.target.checked }))} /> Exigir aceite para enviar</label>
        </div>
        <div className="clinical-intake-legal-note">Este registro comprova um aceite eletrônico simples. Não use “assinatura digital” ou “ICP-Brasil” até a integração qualificada estar homologada.</div>
        <div className="clinical-intake-actions"><span /><Btn disabled={status === 'saving'} onClick={saveConsent}>{status === 'saving' ? 'Publicando…' : 'Publicar versão imutável'}</Btn></div>
      </div>
    )
  }

  return (
    <div className="clinical-intake">
      <header className="clinical-intake-toolbar">
        <div><span>Antes da consulta</span><strong>Pré-anamnese e consentimentos</strong><small>As respostas ficam separadas do prontuário assinado até sua revisão.</small></div>
        <div><Btn variant="ghost" onClick={createTemplate}>+ Modelo</Btn><Btn variant="ghost" onClick={createConsent}>+ Termo/TCLE</Btn></div>
      </header>
      {error && <div className="clinical-form-error" role="alert">{error}</div>}

      <section className="clinical-intake-invite">
        <div className="clinical-intake-section-title"><div><span>1</span><strong>Gerar link para {patient.full_name}</strong></div><small>O token não contém dados pessoais e é mostrado somente uma vez.</small></div>
        {data.templates.length === 0 ? (
          <div className="clinical-intake-callout"><span>Crie o primeiro modelo para liberar o link ao paciente.</span><Btn onClick={createTemplate}>Criar modelo padrão</Btn></div>
        ) : (
          <>
            <div className="clinical-intake-invite-grid">
              <div className="clinical-intake-version-control"><label><span>Formulário</span><select value={selectedTemplateId} onChange={event => setSelectedTemplateId(event.target.value)}>{data.templates.map(template => <option key={template.id} value={template.id}>{template.title} · v{template.version}</option>)}</select></label><Btn variant="ghost" onClick={editTemplateVersion}>Nova versão</Btn></div>
              <label><span>Validade</span><select value={validDays} onChange={event => setValidDays(event.target.value)}>{[1,2,3,5,7].map(days => <option key={days} value={days}>{days} dia{days === 1 ? '' : 's'}</option>)}</select></label>
            </div>
            <div className="clinical-intake-consent-picker">
              <span>Termos anexados</span>
              {data.consents.length === 0 && <small>Nenhum termo criado. O formulário pode ser enviado sem consentimentos.</small>}
              {data.consents.map(consent => <div className="clinical-intake-consent-option" key={consent.id}><label><input type="checkbox" checked={selectedConsentIds.includes(consent.id)} onChange={event => setSelectedConsentIds(current => event.target.checked ? [...new Set([...current, consent.id])] : current.filter(id => id !== consent.id))} /><span><strong>{consent.title}</strong><small>{consent.consent_type.toUpperCase()} · v{consent.version}{consent.required ? ' · obrigatório' : ''}</small></span></label><button type="button" onClick={() => editConsentVersion(consent)}>Nova versão</button></div>)}
            </div>
            <Btn disabled={status === 'saving'} onClick={createRequest}>{status === 'saving' ? 'Gerando…' : 'Gerar link seguro'}</Btn>
          </>
        )}
        {lastLink && <div className="clinical-intake-generated"><div><strong>Link criado — copie agora</strong><small>Se ele for perdido, revogue e gere outro; o token não fica recuperável.</small></div><input readOnly value={lastLink} onFocus={event => event.target.select()} /><Btn onClick={copyLink}>{copied ? 'Copiado ✓' : 'Copiar link'}</Btn></div>}
      </section>

      <section className="clinical-intake-history">
        <div className="clinical-intake-section-title"><div><span>2</span><strong>Envios e respostas</strong></div><small>{data.requests.length} solicitação{data.requests.length === 1 ? '' : 'ões'}</small></div>
        {data.requests.length === 0 && <div className="clinical-intake-callout"><span>Nenhum link gerado para este paciente.</span></div>}
        {data.requests.map(request => {
          const submission = submissionsByRequest.get(request.id)
          const requestStatus = clinicalIntakeRequestStatus(request)
          const expanded = expandedSubmissionId === submission?.id
          return (
            <article key={request.id} className="clinical-intake-request">
              <div className="clinical-intake-request__summary">
                <div><span className={`is-${requestStatus.tone}`}>{requestStatus.label}</span><strong>{request.template_snapshot?.title || 'Formulário'}</strong><small>Criado em {displayDateTime(request.created_at)} · expira em {displayDateTime(request.expires_at)}</small></div>
                <div>{submission && <Btn variant="ghost" onClick={() => setExpandedSubmissionId(expanded ? '' : submission.id)}>{expanded ? 'Fechar resposta' : 'Revisar resposta'}</Btn>}{request.status === 'pending' && <Btn variant="ghost" onClick={() => revokeRequest(request.id)}>Revogar</Btn>}</div>
              </div>
              {expanded && submission && (
                <div className="clinical-intake-response">
                  <header><div><span>Declaração do paciente</span><strong>Respondido por {submission.respondent_name}</strong><small>{displayDateTime(submission.submitted_at)}</small></div><Btn onClick={() => useDraft(submission)}>Usar como rascunho SOAP</Btn></header>
                  <div>{(submission.template_snapshot?.definition?.fields || []).map(field => <section key={field.id}><span>{field.label}</span><p>{Array.isArray(submission.answers?.[field.id]) ? submission.answers[field.id].join(', ') : typeof submission.answers?.[field.id] === 'boolean' ? (submission.answers[field.id] ? 'Sim' : 'Não') : submission.answers?.[field.id] || 'Não informado'}</p></section>)}</div>
                  <footer>O rascunho ainda precisa de revisão, exame, avaliação, plano e assinatura do profissional. Nenhum registro clínico é criado automaticamente.</footer>
                </div>
              )}
            </article>
          )
        })}
      </section>
    </div>
  )
}
