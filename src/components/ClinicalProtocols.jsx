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
const formatDate = value => value ? new Date(value).toLocaleDateString('pt-BR') : 'Data não informada'

const APPLICATION_DESTINATIONS = [
  { id:'anamnesis', label:'Anamnese', description:'Plano terapêutico e perguntas complementares' },
  { id:'exams', label:'Pedido de exames', description:'Kit de exames, indicação e orientações' },
  { id:'prescription', label:'Receita simples', description:'Medicamentos favoritos e modo de usar' },
  { id:'treatment', label:'Plano e retorno', description:'Tratamento, objetivos e etapas de acompanhamento' },
]

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

export function ClinicalProtocols({ ownerId, patients = [], canManage = false, canPrescribe = false, onApplyProtocol, onClose }) {
  const [protocols, setProtocols] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editor, setEditor] = useState(null)
  const [viewer, setViewer] = useState(null)
  const [applying, setApplying] = useState(null)
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
  function startDuplicate(protocol) {
    const form = formForEditor(protocol.currentVersion)
    setViewer(null)
    setEditor({ protocolId:null, requestId:newRequestId(), form:{ ...form, name:`Cópia de ${form.name}` } })
    setError(''); setNotice('')
  }

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

  if (viewer) return <ProtocolDetail
    protocol={viewer}
    canManage={canManage}
    onBack={() => setViewer(null)}
    onApply={() => { setViewer(null); setApplying(viewer) }}
    onRevise={() => { setViewer(null); startRevision(viewer) }}
    onDuplicate={() => startDuplicate(viewer)}
    onStatus={() => { setViewer(null); changeStatus(viewer) }}
  />

  return <section className="clinical-protocols" data-testid="clinical-protocols">
    <header className="clinical-protocols__hero"><div><span>Biblioteca da clínica</span><h2>Protocolos por procedimento</h2><p>Padronize o atendimento sem substituir a avaliação e a decisão do profissional.</p></div><div><Btn variant="ghost" onClick={onClose}>← Agenda clínica</Btn>{canManage && <Btn onClick={startCreate}>+ Novo protocolo</Btn>}</div></header>
    <div className="clinical-protocols__guardrail"><strong>Modelo, não automação clínica</strong><span>Ao aplicar um protocolo, o sistema apenas preenche um rascunho. O profissional revisa e confirma antes de registrar.</span></div>
    {error && <div className="clinical-alert" role="alert">{error}</div>}
    {notice && <div className="treatment-notice" role="status">{notice}</div>}
    <div className="clinical-protocols__filters"><label><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /> Mostrar arquivados</label><span>{visible.length} protocolo{visible.length === 1 ? '' : 's'}</span></div>
    {status === 'loading' && <div className="clinical-loading">Carregando protocolos…</div>}
    {status === 'error' && <div className="clinical-empty-panel"><Btn variant="ghost" onClick={reload}>Tentar novamente</Btn></div>}
    {status === 'ready' && visible.length === 0 && <div className="treatment-empty"><span>▤</span><h4>Nenhum protocolo configurado</h4><p>{canManage ? 'Crie o primeiro modelo da clínica.' : 'Um administrador clínico ainda não publicou modelos.'}</p>{canManage && <Btn onClick={startCreate}>Criar protocolo</Btn>}</div>}
    <div className="clinical-protocol-grid">{visible.map(protocol => <ProtocolCard
      key={protocol.id}
      protocol={protocol}
      canManage={canManage}
      onView={() => setViewer(protocol)}
      onApply={() => setApplying(protocol)}
      onRevise={() => startRevision(protocol)}
      onDuplicate={() => startDuplicate(protocol)}
      onStatus={() => changeStatus(protocol)}
    />)}</div>
    {applying && <ProtocolApplyFlow
      protocol={applying}
      patients={patients}
      canPrescribe={canPrescribe}
      onCancel={() => setApplying(null)}
      onApply={({ patient, destination }) => {
        onApplyProtocol?.({ patient, destination, version:applying.currentVersion })
        setApplying(null)
      }}
    />}
  </section>
}

function ProtocolCard({ protocol, canManage, onView, onApply, onRevise, onDuplicate, onStatus }) {
  const version = protocol.currentVersion
  const counts = [
    `${version.anamnesis_prompts?.length || 0} perguntas`, `${version.exam_kit?.length || 0} exames`,
    `${version.photo_requirements?.length || 0} fotos`, `${version.return_schedule?.length || 0} etapas`,
  ]
  return <article className={`clinical-protocol-card is-${protocol.currentStatus}`}><header><div><span>{version.procedure_name}</span><h3>{version.name}</h3></div><em>{protocol.currentStatus === 'active' ? 'Ativo' : 'Arquivado'} · v{version.version_number}</em></header>{version.description && <p>{version.description}</p>}<div className="clinical-protocol-card__counts">{counts.map(item => <span key={item}>{item}</span>)}</div><div className="clinical-protocol-card__summary"><div><strong>Tratamento-base</strong><p>{version.planned_treatment}</p></div><div><strong>Orientações</strong><p>{version.guidance}</p></div></div><footer><small>Por {version.author_name} · {version.author_council} {version.author_registration}</small><div className="clinical-protocol-card__actions"><Btn variant="ghost" onClick={onView}>Visualizar</Btn>{protocol.currentStatus === 'active' && <Btn onClick={onApply}>Aplicar em paciente</Btn>}{canManage && <><Btn variant="ghost" onClick={onRevise}>Nova versão</Btn><details><summary>Mais ações</summary><div><button type="button" onClick={onDuplicate}>Duplicar</button><button type="button" onClick={onStatus}>{protocol.currentStatus === 'active' ? 'Arquivar' : 'Reativar'}</button></div></details></>}</div></footer></article>
}

function ProtocolDetail({ protocol, canManage, onBack, onApply, onRevise, onDuplicate, onStatus }) {
  const [versionId, setVersionId] = useState(protocol.currentVersion.id)
  const version = protocol.versions.find(item => item.id === versionId) || protocol.currentVersion
  const protocolData = protocolVersionToForm(version)
  const lists = [
    ['Perguntas da anamnese', protocolData.anamnesisPrompts.map(item => `${item.required ? 'Obrigatória · ' : ''}${item.label}`)],
    ['Kit de exames', protocolData.examKit],
    ['Medicamentos favoritos', protocolData.medicationFavorites.map(item => [item.medication, item.presentation, item.quantity, item.directions].filter(Boolean).join(' · '))],
    ['Fotos necessárias', protocolData.photoRequirements],
    ['Etapas e retornos', protocolData.returnSchedule.map(item => `${item.days} dias · ${item.title}${item.instructions ? ` — ${item.instructions}` : ''}`)],
  ]
  return <section className="clinical-protocol-detail" data-testid="clinical-protocol-detail">
    <header><button type="button" onClick={onBack}>← Biblioteca</button><div><span>{version.procedure_name}</span><h2>{version.name}</h2><p>{version.description || 'Sem descrição interna.'}</p></div><em>{protocol.currentStatus === 'active' ? 'Ativo' : 'Arquivado'} · v{version.version_number}</em></header>
    <div className="clinical-protocol-detail__actions"><Btn variant="ghost" onClick={onBack}>Voltar</Btn>{protocol.currentStatus === 'active' && <Btn onClick={onApply}>Aplicar em paciente</Btn>}{canManage && <><Btn variant="ghost" onClick={onRevise}>Nova versão</Btn><Btn variant="ghost" onClick={onDuplicate}>Duplicar</Btn><button type="button" onClick={onStatus}>{protocol.currentStatus === 'active' ? 'Arquivar' : 'Reativar'}</button></>}</div>
    <div className="clinical-protocol-detail__summary"><section><strong>Indicação clínica-base</strong><p>{version.indication}</p></section><section><strong>Objetivos</strong><p>{version.objectives}</p></section><section><strong>Tratamento proposto</strong><p>{version.planned_treatment}</p></section><section><strong>Orientações, riscos e decisão compartilhada</strong><p>{version.guidance}</p></section></div>
    <div className="clinical-protocol-detail__lists">{lists.map(([label, items]) => <section key={label}><strong>{label}</strong>{items.length ? <ul>{items.map((item, index) => <li key={`${label}:${index}`}>{item}</li>)}</ul> : <p>Nenhum item configurado.</p>}</section>)}</div>
    <section className="clinical-protocol-history"><header><div><span>Histórico preservado</span><strong>Versões do protocolo</strong></div><select aria-label="Versão visualizada" value={version.id} onChange={event => setVersionId(event.target.value)}>{protocol.versions.map(item => <option key={item.id} value={item.id}>Versão {item.version_number}</option>)}</select></header>{protocol.versions.map(item => <button key={item.id} type="button" className={item.id === version.id ? 'is-active' : ''} onClick={() => setVersionId(item.id)}><strong>Versão {item.version_number}</strong><span>{item.author_name} · {item.author_council} {item.author_registration}</span><small>{formatDate(item.recorded_at)}</small></button>)}</section>
  </section>
}

function ProtocolApplyFlow({ protocol, patients, canPrescribe, onCancel, onApply }) {
  const [query, setQuery] = useState('')
  const [patientId, setPatientId] = useState('')
  const [destination, setDestination] = useState('anamnesis')
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const visiblePatients = patients.filter(patient => !normalizedQuery || [patient.full_name, patient.phone, patient.email].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(normalizedQuery))).slice(0, 20)
  const version = protocol.currentVersion
  const destinationAvailable = id => {
    if (id === 'exams') return Boolean(version.exam_kit?.length)
    if (id === 'prescription') return canPrescribe && Boolean(version.medication_favorites?.length)
    return true
  }
  const selectedPatient = patients.find(patient => patient.id === patientId)
  return <div className="clinical-protocol-apply-modal" role="dialog" aria-modal="true" aria-labelledby="protocol-apply-title"><div>
    <header><div><span>Aplicar como rascunho</span><h3 id="protocol-apply-title">{version.name}</h3><p>Escolha o paciente e onde deseja continuar. Nada será registrado automaticamente.</p></div><button type="button" onClick={onCancel} aria-label="Fechar">×</button></header>
    <div className="clinical-protocol-apply-grid"><section><label><span>Buscar paciente</span><input aria-label="Buscar paciente para o protocolo" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome, telefone ou e-mail" /></label><div className="clinical-protocol-patient-list">{visiblePatients.map(patient => <button key={patient.id} type="button" className={patient.id === patientId ? 'is-active' : ''} onClick={() => setPatientId(patient.id)}><strong>{patient.full_name}</strong><span>{patient.phone || patient.email || 'Contato não informado'}</span></button>)}{visiblePatients.length === 0 && <p>Nenhum paciente encontrado.</p>}</div></section><section><span>Destino do rascunho</span><div className="clinical-protocol-destinations">{APPLICATION_DESTINATIONS.map(item => { const available = destinationAvailable(item.id); return <button key={item.id} type="button" disabled={!available} className={destination === item.id ? 'is-active' : ''} onClick={() => setDestination(item.id)}><strong>{item.label}</strong><span>{available ? item.description : item.id === 'prescription' && !canPrescribe ? 'Seu perfil não pode emitir receitas' : 'Este protocolo não possui itens para este destino'}</span></button> })}</div></section></div>
    <footer><Btn variant="ghost" onClick={onCancel}>Cancelar</Btn><Btn disabled={!selectedPatient || !destinationAvailable(destination)} onClick={() => onApply({ patient:selectedPatient, destination })}>Abrir rascunho</Btn></footer>
  </div></div>
}

function ProtocolEditor({ editor, update, saving, error, onCancel, onSave }) {
  const form = editor.form
  return <section className="clinical-protocol-editor"><header><div><span>{editor.protocolId ? 'Nova versão' : 'Novo protocolo'}</span><h2>{editor.protocolId ? 'Revisar protocolo sem apagar o histórico' : 'Criar protocolo da clínica'}</h2></div><button type="button" onClick={onCancel} aria-label="Fechar">×</button></header>{error && <div className="clinical-alert" role="alert">{error}</div>}<div className="clinical-protocol-fields"><Field label="Nome do protocolo" value={form.name} onChange={value => update('name', value)} required /><Field label="Procedimento" value={form.procedureName} onChange={value => update('procedureName', value)} required /><Field label="Descrição interna" value={form.description} onChange={value => update('description', value)} area /><Field label="Indicação clínica-base" value={form.indication} onChange={value => update('indication', value)} area required /><Field label="Objetivos" value={form.objectives} onChange={value => update('objectives', value)} area required /><Field label="Tratamento proposto" value={form.plannedTreatment} onChange={value => update('plannedTreatment', value)} area required /><Field label="Orientações, riscos e decisão compartilhada" value={form.guidance} onChange={value => update('guidance', value)} area required /></div><div className="clinical-protocol-lists"><ListField label="Perguntas complementares da anamnese" hint="Uma por linha. Comece com * para tornar obrigatória." value={form.promptsText} onChange={value => update('promptsText', value)} /><ListField label="Kit de exames" hint="Um exame por linha." value={form.examsText} onChange={value => update('examsText', value)} /><ListField label="Fotos obrigatórias" hint="Uma posição ou ângulo por linha." value={form.photosText} onChange={value => update('photosText', value)} /><ListField label="Medicamentos favoritos" hint="medicamento | apresentação | quantidade | modo de usar" value={form.medicationsText} onChange={value => update('medicationsText', value)} /><ListField label="Etapas e retornos" hint="dias após início | título | orientação" value={form.returnsText} onChange={value => update('returnsText', value)} /></div><footer><p>Salvar cria uma versão imutável. Nenhum prontuário existente será alterado.</p><div><Btn variant="ghost" disabled={saving} onClick={onCancel}>Cancelar</Btn><Btn disabled={saving} onClick={onSave}>{saving ? 'Registrando…' : 'Registrar versão'}</Btn></div></footer></section>
}

function Field({ label, value, onChange, area = false, required = false }) { return <label><span>{label}{required ? ' *' : ''}</span>{area ? <textarea rows="4" value={value} onChange={event => onChange(event.target.value)} /> : <input value={value} onChange={event => onChange(event.target.value)} />}</label> }
function ListField({ label, hint, value, onChange }) { return <label><span>{label}</span><small>{hint}</small><textarea rows="6" value={value} onChange={event => onChange(event.target.value)} /></label> }
