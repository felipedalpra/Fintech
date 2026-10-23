import { useEffect, useMemo, useState } from 'react'
import { Btn } from './UI.jsx'
import { supabase } from '../lib/supabase.js'
import { loadClinicalProtocols } from '../lib/clinicalProtocolClient.js'
import {
  EMPTY_CLINICAL_PROTOCOL,
  buildClinicalProtocolRpcArgs,
  newRequestId,
  protocolVersionToForm,
} from '../lib/clinicalProtocols.js'

const splitLines = value => String(value || '').split('\n').map(item => item.trim()).filter(Boolean)
const joinLines = items => (items || []).join('\n')

function formForEditor(version) {
  const base = version ? protocolVersionToForm(version) : { ...EMPTY_CLINICAL_PROTOCOL }
  return {
    ...base,
    promptsText:(base.anamnesisPrompts || []).map(item => `${item.required ? '* ' : ''}${item.label}`).join('\n'),
    examsText:joinLines(base.examKit), photosText:joinLines(base.photoRequirements),
    medicationsText:(base.medicationFavorites || []).map(item => [item.medication,item.presentation,item.quantity,item.directions].join(' | ')).join('\n'),
    returnsText:(base.returnSchedule || []).map(item => `${item.days} | ${item.title} | ${item.instructions || ''}`).join('\n'),
  }
}

function editorPayload(form) {
  return {
    ...form,
    anamnesisPrompts:splitLines(form.promptsText).map((line, index) => ({
      key:`question_${index + 1}`, label:line.replace(/^\*\s*/, ''), required:/^\*/.test(line),
    })),
    examKit:splitLines(form.examsText), photoRequirements:splitLines(form.photosText),
    medicationFavorites:splitLines(form.medicationsText).map(line => {
      const [medication='', presentation='', quantity='', directions=''] = line.split('|').map(item => item.trim())
      return { medication, presentation, quantity, directions }
    }),
    returnSchedule:splitLines(form.returnsText).map(line => {
      const [days='', title='', instructions=''] = line.split('|').map(item => item.trim())
      return { days:Number(days), title, instructions }
    }),
  }
}

export function ClinicalProtocols({ ownerId, canManage = false, onClose }) {
  const [protocols, setProtocols] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editor, setEditor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  async function reload() {
    setStatus('loading'); setError('')
    try { setProtocols(await loadClinicalProtocols(ownerId)); setStatus('ready') }
    catch (nextError) { setStatus('error'); setError(nextError.message || 'Não foi possível carregar os protocolos.') }
  }
  useEffect(() => { reload() }, [ownerId])

  const visible = useMemo(() => protocols.filter(item => showArchived || item.currentStatus === 'active'), [protocols, showArchived])
  const update = (field, value) => setEditor(current => ({ ...current, form:{ ...current.form, [field]:value } }))

  function startCreate() { setEditor({ protocolId:null, requestId:newRequestId(), form:formForEditor() }); setError(''); setNotice('') }
  function startRevision(protocol) { setEditor({ protocolId:protocol.id, requestId:newRequestId(), form:formForEditor(protocol.currentVersion) }); setError(''); setNotice('') }

  async function save() {
    if (saving) return
    setSaving(true); setError('')
    try {
      const args = buildClinicalProtocolRpcArgs({ protocolId:editor.protocolId, requestId:editor.requestId, form:editorPayload(editor.form) })
      const { error:saveError } = await supabase.rpc('save_clinical_protocol', args)
      if (saveError) throw saveError
      setEditor(null); setNotice(editor.protocolId ? 'Nova versão registrada. Os registros anteriores não foram alterados.' : 'Protocolo criado para a clínica.')
      await reload()
    } catch (nextError) { setError(nextError.message || 'Não foi possível salvar o protocolo.') }
    finally { setSaving(false) }
  }

  async function changeStatus(protocol) {
    const next = protocol.currentStatus === 'active' ? 'archived' : 'active'
    const reason = window.prompt(next === 'archived' ? 'Motivo do arquivamento:' : 'Motivo da reativação:')
    if (!reason?.trim()) return
    setError('')
    const { error:changeError } = await supabase.rpc('set_clinical_protocol_status', {
      p_protocol_id:protocol.id, p_request_id:newRequestId(), p_status:next, p_reason:reason.trim(),
    })
    if (changeError) { setError(changeError.message || 'Não foi possível alterar o protocolo.'); return }
    setNotice(next === 'archived' ? 'Protocolo arquivado sem apagar o histórico.' : 'Protocolo reativado.')
    await reload()
  }

  if (editor) return <ProtocolEditor editor={editor} update={update} saving={saving} error={error} onCancel={() => setEditor(null)} onSave={save} />

  return <section className="clinical-protocols" data-testid="clinical-protocols">
    <header className="clinical-protocols__hero"><div><span>Biblioteca da clínica</span><h2>Protocolos por procedimento</h2><p>Padronize o atendimento sem substituir a avaliação e a decisão do profissional.</p></div><div><Btn variant="ghost" onClick={onClose}>← Agenda clínica</Btn>{canManage && <Btn onClick={startCreate}>+ Novo protocolo</Btn>}</div></header>
    <div className="clinical-protocols__guardrail"><strong>Modelo, não automação clínica</strong><span>Ao aplicar um protocolo, o sistema apenas preenche um rascunho. O profissional revisa e confirma antes de registrar.</span></div>
    {error && <div className="clinical-alert" role="alert">{error}</div>}
    {notice && <div className="treatment-notice" role="status">{notice}</div>}
    <div className="clinical-protocols__filters"><label><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /> Mostrar arquivados</label><span>{visible.length} protocolo{visible.length === 1 ? '' : 's'}</span></div>
    {status === 'loading' && <div className="clinical-loading">Carregando protocolos…</div>}
    {status === 'error' && <div className="clinical-empty-panel"><Btn variant="ghost" onClick={reload}>Tentar novamente</Btn></div>}
    {status === 'ready' && visible.length === 0 && <div className="treatment-empty"><span>▤</span><h4>Nenhum protocolo configurado</h4><p>{canManage ? 'Crie o primeiro modelo da clínica.' : 'Um administrador clínico ainda não publicou modelos.'}</p>{canManage && <Btn onClick={startCreate}>Criar protocolo</Btn>}</div>}
    <div className="clinical-protocol-grid">{visible.map(protocol => <ProtocolCard key={protocol.id} protocol={protocol} canManage={canManage} onRevise={() => startRevision(protocol)} onStatus={() => changeStatus(protocol)} />)}</div>
  </section>
}

function ProtocolCard({ protocol, canManage, onRevise, onStatus }) {
  const version = protocol.currentVersion
  const counts = [
    `${version.anamnesis_prompts?.length || 0} perguntas`, `${version.exam_kit?.length || 0} exames`,
    `${version.photo_requirements?.length || 0} fotos`, `${version.return_schedule?.length || 0} etapas`,
  ]
  return <article className={`clinical-protocol-card is-${protocol.currentStatus}`}><header><div><span>{version.procedure_name}</span><h3>{version.name}</h3></div><em>{protocol.currentStatus === 'active' ? 'Ativo' : 'Arquivado'} · v{version.version_number}</em></header>{version.description && <p>{version.description}</p>}<div className="clinical-protocol-card__counts">{counts.map(item => <span key={item}>{item}</span>)}</div><div className="clinical-protocol-card__summary"><div><strong>Tratamento-base</strong><p>{version.planned_treatment}</p></div><div><strong>Orientações</strong><p>{version.guidance}</p></div></div><footer><small>Por {version.author_name} · {version.author_council} {version.author_registration}</small>{canManage && <div><Btn variant="ghost" onClick={onRevise}>Nova versão</Btn><button type="button" onClick={onStatus}>{protocol.currentStatus === 'active' ? 'Arquivar' : 'Reativar'}</button></div>}</footer></article>
}

function ProtocolEditor({ editor, update, saving, error, onCancel, onSave }) {
  const form = editor.form
  return <section className="clinical-protocol-editor"><header><div><span>{editor.protocolId ? 'Nova versão' : 'Novo protocolo'}</span><h2>{editor.protocolId ? 'Revisar protocolo sem apagar o histórico' : 'Criar protocolo da clínica'}</h2></div><button type="button" onClick={onCancel} aria-label="Fechar">×</button></header>{error && <div className="clinical-alert" role="alert">{error}</div>}<div className="clinical-protocol-fields"><Field label="Nome do protocolo" value={form.name} onChange={value => update('name', value)} required /><Field label="Procedimento" value={form.procedureName} onChange={value => update('procedureName', value)} required /><Field label="Descrição interna" value={form.description} onChange={value => update('description', value)} area /><Field label="Indicação clínica-base" value={form.indication} onChange={value => update('indication', value)} area required /><Field label="Objetivos" value={form.objectives} onChange={value => update('objectives', value)} area required /><Field label="Tratamento proposto" value={form.plannedTreatment} onChange={value => update('plannedTreatment', value)} area required /><Field label="Orientações, riscos e decisão compartilhada" value={form.guidance} onChange={value => update('guidance', value)} area required /></div><div className="clinical-protocol-lists"><ListField label="Perguntas complementares da anamnese" hint="Uma por linha. Comece com * para tornar obrigatória." value={form.promptsText} onChange={value => update('promptsText', value)} /><ListField label="Kit de exames" hint="Um exame por linha." value={form.examsText} onChange={value => update('examsText', value)} /><ListField label="Fotos obrigatórias" hint="Uma posição ou ângulo por linha." value={form.photosText} onChange={value => update('photosText', value)} /><ListField label="Medicamentos favoritos" hint="medicamento | apresentação | quantidade | modo de usar" value={form.medicationsText} onChange={value => update('medicationsText', value)} /><ListField label="Etapas e retornos" hint="dias após início | título | orientação" value={form.returnsText} onChange={value => update('returnsText', value)} /></div><footer><p>Salvar cria uma versão imutável. Nenhum prontuário existente será alterado.</p><div><Btn variant="ghost" disabled={saving} onClick={onCancel}>Cancelar</Btn><Btn disabled={saving} onClick={onSave}>{saving ? 'Registrando…' : 'Registrar versão'}</Btn></div></footer></section>
}

function Field({ label, value, onChange, area = false, required = false }) { return <label><span>{label}{required ? ' *' : ''}</span>{area ? <textarea rows="4" value={value} onChange={event => onChange(event.target.value)} /> : <input value={value} onChange={event => onChange(event.target.value)} />}</label> }
function ListField({ label, hint, value, onChange }) { return <label><span>{label}</span><small>{hint}</small><textarea rows="6" value={value} onChange={event => onChange(event.target.value)} /></label> }
