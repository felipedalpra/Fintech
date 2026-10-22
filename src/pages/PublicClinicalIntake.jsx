import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { validateClinicalIntakeAnswers } from '../lib/clinicalIntake.js'
import './PublicClinicalIntake.css'

function newSubmissionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.random() * 16 | 0
    return (character === 'x' ? random : (random & 0x3 | 0x8)).toString(16)
  })
}

function PublicField({ field, value, onChange }) {
  if (field.type === 'textarea') {
    return <textarea rows={4} value={value || ''} onChange={event => onChange(event.target.value)} />
  }
  if (field.type === 'date') {
    return <input type="date" value={value || ''} onChange={event => onChange(event.target.value)} />
  }
  if (field.type === 'boolean') {
    return (
      <div className="public-intake-choice">
        <label><input type="radio" name={field.id} checked={value === true} onChange={() => onChange(true)} /> Sim</label>
        <label><input type="radio" name={field.id} checked={value === false} onChange={() => onChange(false)} /> Não</label>
      </div>
    )
  }
  if (field.type === 'select') {
    return <select value={value || ''} onChange={event => onChange(event.target.value)}><option value="">Selecione…</option>{field.options?.map(option => <option key={option}>{option}</option>)}</select>
  }
  if (field.type === 'multiselect') {
    const selected = new Set(Array.isArray(value) ? value : [])
    return <div className="public-intake-options">{field.options?.map(option => <label key={option}><input type="checkbox" checked={selected.has(option)} onChange={event => onChange(event.target.checked ? [...selected, option] : [...selected].filter(item => item !== option))} /> {option}</label>)}</div>
  }
  return <input type="text" value={value || ''} onChange={event => onChange(event.target.value)} />
}

export function PublicClinicalIntake() {
  const { token = '' } = useParams()
  const [status, setStatus] = useState('loading')
  const [payload, setPayload] = useState(null)
  const [answers, setAnswers] = useState({})
  const [accepted, setAccepted] = useState([])
  const [respondentName, setRespondentName] = useState('')
  const [submissionId] = useState(newSubmissionId)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError('')
    if (!supabase) {
      setStatus('error')
      setError('O formulário não está disponível neste ambiente.')
      return () => { active = false }
    }
    supabase.rpc('get_public_clinical_intake', { p_token:token })
      .then(({ data, error:loadError }) => {
        if (!active) return
        if (loadError || !data) throw loadError || new Error('Formulário indisponível.')
        setPayload(data)
        setStatus('ready')
      })
      .catch(() => {
        if (!active) return
        setStatus('error')
        setError('Este link é inválido, expirou, foi revogado ou já foi utilizado.')
      })
    return () => { active = false }
  }, [token])

  const fields = payload?.definition?.fields || []
  const consents = payload?.consents || []
  const expiration = useMemo(() => payload?.expiresAt ? new Date(payload.expiresAt).toLocaleString('pt-BR') : '', [payload?.expiresAt])

  async function submit(event) {
    event.preventDefault()
    if (status === 'submitting') return
    setError('')
    if (!respondentName.trim()) {
      setError('Informe o nome de quem está preenchendo.')
      return
    }
    const validationError = validateClinicalIntakeAnswers(payload?.definition, answers, accepted, consents)
    if (validationError) {
      setError(validationError)
      return
    }
    setStatus('submitting')
    const { error:submitError } = await supabase.rpc('submit_public_clinical_intake', {
      p_token:token,
      p_submission_request_id:submissionId,
      p_answers:answers,
      p_respondent_name:respondentName.trim(),
      p_accepted_consent_ids:accepted,
    })
    if (submitError) {
      setStatus('ready')
      setError('Não foi possível enviar agora. Confira os campos e tente novamente; nenhuma resposta duplicada será criada.')
      return
    }
    setStatus('submitted')
  }

  return (
    <main className="public-intake-page">
      <header className="public-intake-brand"><img src="/assets/surgimetrics-logo.png" alt="SurgiMetrics" /></header>
      <section className="public-intake-shell">
        {status === 'loading' && <div className="public-intake-state"><span className="public-intake-spinner" /><strong>Carregando formulário seguro…</strong></div>}
        {status === 'error' && <div className="public-intake-state is-error"><span>!</span><strong>Formulário indisponível</strong><p>{error}</p></div>}
        {status === 'submitted' && <div className="public-intake-state is-success"><span>✓</span><strong>Respostas enviadas</strong><p>A clínica recebeu seus dados para revisão. O envio não substitui avaliação, diagnóstico ou orientação profissional.</p></div>}
        {(status === 'ready' || status === 'submitting') && payload && (
          <form onSubmit={submit}>
            <div className="public-intake-heading">
              <span>{payload.clinicName}</span>
              <h1>{payload.title}</h1>
              {payload.description && <p>{payload.description}</p>}
              <small>Link válido até {expiration}. Seus dados são enviados diretamente à clínica.</small>
            </div>

            <div className="public-intake-fields">
              {fields.map((field, index) => (
                <label key={field.id} className="public-intake-field">
                  <span><b>{index + 1}.</b> {field.label}{field.required && <em> *</em>}</span>
                  <PublicField field={field} value={answers[field.id]} onChange={value => setAnswers(current => ({ ...current, [field.id]:value }))} />
                </label>
              ))}
            </div>

            {consents.length > 0 && (
              <section className="public-intake-consents">
                <header><span>Consentimentos</span><h2>Leia antes de confirmar</h2></header>
                {consents.map(consent => (
                  <article key={consent.id}>
                    <details><summary>{consent.title}</summary><p>{consent.content}</p></details>
                    <label><input type="checkbox" checked={accepted.includes(consent.id)} onChange={event => setAccepted(current => event.target.checked ? [...new Set([...current, consent.id])] : current.filter(id => id !== consent.id))} /> Li e aceito este termo{consent.required ? ' obrigatório' : ''}.</label>
                  </article>
                ))}
              </section>
            )}

            <section className="public-intake-declaration">
              <label><span>Nome completo de quem está respondendo *</span><input value={respondentName} onChange={event => setRespondentName(event.target.value)} autoComplete="name" /></label>
              <p>Ao enviar, declaro que as respostas foram fornecidas por mim e que li e aceitei os termos selecionados. Este é um aceite eletrônico simples e não uma assinatura digital ICP-Brasil.</p>
            </section>

            {error && <div className="public-intake-error" role="alert">{error}</div>}
            <button type="submit" disabled={status === 'submitting'}>{status === 'submitting' ? <><span className="public-intake-spinner" /> Enviando com segurança…</> : 'Confirmar e enviar'}</button>
            <footer>Em caso de urgência médica, não use este formulário; procure atendimento imediato.</footer>
          </form>
        )}
      </section>
    </main>
  )
}
