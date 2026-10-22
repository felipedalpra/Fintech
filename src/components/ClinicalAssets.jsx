import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { today } from '../utils.js'
import {
  buildClinicalAssetRpcArgs,
  clinicalAssetDateLabel,
  clinicalAssetKind,
  clinicalAssetSha256,
  clinicalAssetStageLabel,
  clinicalAssetStatusLabel,
  filterClinicalAssets,
  validateClinicalAssetFile,
} from '../lib/clinicalAssets.js'
import { Btn } from './UI.jsx'

const ASSET_COLUMNS = 'id,user_id,patient_id,created_by,asset_kind,stage,captured_on,region,procedure_name,notes,bucket_id,object_path,file_name,expected_mime_type,expected_file_size,observed_mime_type,file_size,client_sha256,consent_acceptance_id,status,created_at,completed_at,failed_at,archived_at'

function initialForm() {
  return { stage:'before', captured_on:today(), region:'', procedure_name:'', notes:'', consent_acceptance_id:'' }
}

async function fetchClinicalAssetBundle(patientId, ownerId) {
  const [assetsResult, consentsResult] = await Promise.all([
    supabase.from('clinical_assets').select(ASSET_COLUMNS).eq('user_id', ownerId).eq('patient_id', patientId).order('captured_on', { ascending:false }).order('created_at', { ascending:false }).limit(200),
    supabase.from('clinical_consent_acceptances').select('id,title,accepted_at,respondent_name').eq('user_id', ownerId).eq('patient_id', patientId).eq('consent_type', 'image').order('accepted_at', { ascending:false }),
  ])
  if (assetsResult.error) throw assetsResult.error
  if (consentsResult.error) throw consentsResult.error
  return { assets:assetsResult.data || [], consents:consentsResult.data || [] }
}

async function signedAssetUrl(asset) {
  const { error:auditError } = await supabase.rpc('log_clinical_asset_access', { p_asset_id:asset.id })
  if (auditError) throw auditError
  const { data, error } = await supabase.storage.from(asset.bucket_id).createSignedUrl(asset.object_path, 300)
  if (error || !data?.signedUrl) throw error || new Error('URL temporária indisponível.')
  return data.signedUrl
}

export function ClinicalAssets({ patient, ownerId }) {
  const [assets, setAssets] = useState([])
  const [consents, setConsents] = useState([])
  const [urls, setUrls] = useState({})
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [file, setFile] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [progress, setProgress] = useState('')
  const [filters, setFilters] = useState({ query:'', kind:'all', stage:'all', showArchived:false })
  const [beforeId, setBeforeId] = useState('')
  const [afterId, setAfterId] = useState('')
  const [preview, setPreview] = useState(null)
  const fileInputRef = useRef(null)
  const loadRequestRef = useRef(0)

  async function hydratePhotoUrls(rows, requestId) {
    const photos = rows.filter(asset => asset.asset_kind === 'clinical_photo' && asset.status === 'available')
    if (photos.length === 0) return
    const { error:auditError } = await supabase.rpc('log_clinical_asset_accesses', { p_asset_ids:photos.map(asset => asset.id) })
    if (auditError) return
    const { data:signedRows, error:signError } = await supabase.storage
      .from(photos[0].bucket_id)
      .createSignedUrls(photos.map(asset => asset.object_path), 300)
    if (signError) return
    if (requestId !== loadRequestRef.current) return
    const idsByPath = new Map(photos.map(asset => [asset.object_path, asset.id]))
    setUrls(current => ({
      ...current,
      ...Object.fromEntries((signedRows || [])
        .filter(row => row?.signedUrl && idsByPath.has(row.path))
        .map(row => [idsByPath.get(row.path), row.signedUrl])),
    }))
  }

  async function load({ preserveError = false } = {}) {
    const requestId = ++loadRequestRef.current
    setStatus('loading')
    if (!preserveError) setError('')
    try {
      const bundle = await fetchClinicalAssetBundle(patient.id, ownerId)
      if (requestId !== loadRequestRef.current) return
      setAssets(bundle.assets)
      setConsents(bundle.consents)
      const availablePhotos = bundle.assets.filter(asset => asset.asset_kind === 'clinical_photo' && asset.status === 'available')
      setBeforeId(current => availablePhotos.some(asset => asset.id === current) ? current : availablePhotos.find(asset => asset.stage === 'before')?.id || '')
      setAfterId(current => availablePhotos.some(asset => asset.id === current) ? current : availablePhotos.find(asset => asset.stage === 'after')?.id || '')
      setStatus('ready')
      hydratePhotoUrls(bundle.assets, requestId)
    } catch (nextError) {
      if (requestId !== loadRequestRef.current) return
      setStatus('error')
      setError(nextError.message || 'Não foi possível carregar fotos e documentos clínicos.')
    }
  }

  useEffect(() => {
    loadRequestRef.current += 1
    setAssets([])
    setUrls({})
    setBeforeId('')
    setAfterId('')
    setPreview(null)
    load()
  }, [patient.id, ownerId])

  const visibleAssets = useMemo(() => filterClinicalAssets(assets, filters), [assets, filters])
  const availablePhotos = useMemo(() => assets.filter(asset => asset.asset_kind === 'clinical_photo' && asset.status === 'available'), [assets])
  const beforeAsset = availablePhotos.find(asset => asset.id === beforeId)
  const afterAsset = availablePhotos.find(asset => asset.id === afterId)
  const kind = clinicalAssetKind(file)

  function updateForm(key, value) {
    setForm(current => ({ ...current, [key]:value }))
  }

  function resetUpload() {
    setFile(null)
    setForm(initialForm())
    setProgress('')
    setUploadOpen(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function upload(event) {
    event.preventDefault()
    if (status === 'saving') return
    const validationError = validateClinicalAssetFile(file)
    if (validationError) {
      setError(validationError)
      return
    }
    setStatus('saving')
    setError('')
    let reservedAsset = null
    try {
      setProgress('Verificando integridade do arquivo…')
      const sha256 = await clinicalAssetSha256(file)
      setProgress('Reservando o registro clínico…')
      const { data:createdRows, error:createError } = await supabase.rpc('create_clinical_asset_upload', buildClinicalAssetRpcArgs({ patientId:patient.id, file, form, sha256 }))
      if (createError) throw createError
      reservedAsset = Array.isArray(createdRows) ? createdRows[0] : createdRows
      if (!reservedAsset?.asset_id || !reservedAsset?.object_path) throw new Error('O banco não devolveu a reserva do arquivo.')
      setProgress('Enviando para o armazenamento privado…')
      const { error:uploadError } = await supabase.storage
        .from(reservedAsset.bucket_id)
        .upload(reservedAsset.object_path, file, { upsert:false, contentType:file.type, cacheControl:'3600' })
      if (uploadError) {
        await supabase.rpc('fail_clinical_asset_upload', { p_asset_id:reservedAsset.asset_id })
        throw uploadError
      }
      setProgress('Confirmando o arquivo no prontuário…')
      const { data:confirmed, error:confirmError } = await supabase.rpc('complete_clinical_asset_upload', { p_asset_id:reservedAsset.asset_id })
      if (confirmError) throw confirmError
      if (!confirmed) throw new Error('O Storage recebeu um arquivo diferente do reservado. O item foi bloqueado para revisão.')
      resetUpload()
      await load()
    } catch (nextError) {
      setStatus('ready')
      setProgress('')
      setError(reservedAsset ? `${nextError.message || 'Falha no upload'} Se o envio terminou, use “Finalizar confirmação” no item pendente.` : nextError.message || 'Não foi possível enviar o arquivo.')
      await load({ preserveError:true })
    }
  }

  async function completePending(asset) {
    setStatus('saving')
    setError('')
    const { data:confirmed, error:confirmError } = await supabase.rpc('complete_clinical_asset_upload', { p_asset_id:asset.id })
    if (confirmError || !confirmed) {
      setStatus('ready')
      setError(confirmError?.message || 'O arquivo não corresponde à reserva e foi bloqueado.')
      return
    }
    await load()
  }

  async function setArchived(asset, archived) {
    setStatus('saving')
    setError('')
    const { data:changed, error:archiveError } = await supabase.rpc('set_clinical_asset_archived', { p_asset_id:asset.id, p_archived:archived })
    if (archiveError || !changed) {
      setStatus('ready')
      setError(archiveError?.message || 'O estado do arquivo mudou. Recarregue e tente novamente.')
      return
    }
    await load()
  }

  async function openAsset(asset) {
    setError('')
    try {
      const url = urls[asset.id] || await signedAssetUrl(asset)
      setUrls(current => ({ ...current, [asset.id]:url }))
      if (asset.asset_kind === 'clinical_photo') {
        setPreview({ asset, url })
      } else {
        const opened = window.open(url, '_blank', 'noopener,noreferrer')
        if (!opened) setError('O navegador bloqueou a abertura. Libere pop-ups e tente novamente.')
      }
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível abrir o arquivo privado.')
    }
  }

  if (status === 'loading' && assets.length === 0) return <div className="clinical-loading">Carregando fotos e documentos…</div>
  if (status === 'error' && assets.length === 0) return <div className="clinical-empty-panel" role="alert"><strong>{error}</strong><Btn variant="ghost" onClick={() => load()}>Tentar novamente</Btn></div>

  return (
    <div className="clinical-assets">
      <header className="clinical-assets__toolbar">
        <div><span>Arquivo clínico privado</span><strong>{assets.filter(asset => asset.status === 'available').length} item(ns) disponível(is)</strong><small>Fotos, laudos e anexos permanecem vinculados à ficha de {patient.full_name}.</small></div>
        <Btn onClick={() => { setUploadOpen(value => !value); setError('') }}>{uploadOpen ? 'Fechar envio' : '+ Adicionar arquivo'}</Btn>
      </header>

      {error && <div className="clinical-form-error" role="alert">{error}</div>}

      {uploadOpen && (
        <form className="clinical-asset-upload" onSubmit={upload}>
          <div className="clinical-asset-upload__title"><div><span>Novo ativo</span><strong>Foto clínica ou documento</strong></div><small>Máximo de 20 MB · JPEG, PNG, WebP ou PDF</small></div>
          <label className="clinical-asset-file"><input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => { const next = event.target.files?.[0] || null; setFile(next); if (clinicalAssetKind(next) === 'document') updateForm('stage', 'neutral') }} /><span>{file ? file.name : 'Escolher arquivo'}</span><small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'O arquivo original não será sobrescrito.'}</small></label>
          <div className="clinical-asset-form-grid">
            <label><span>Data do registro *</span><input type="date" max={today()} value={form.captured_on} onChange={event => updateForm('captured_on', event.target.value)} required /></label>
            <label><span>Etapa</span><select value={kind === 'document' ? 'neutral' : form.stage} disabled={kind === 'document'} onChange={event => updateForm('stage', event.target.value)}><option value="before">Antes</option><option value="after">Depois</option><option value="neutral">Sem etapa</option></select></label>
            <label><span>Região</span><input value={form.region} onChange={event => updateForm('region', event.target.value)} placeholder="Ex.: Abdômen, face, mama" maxLength={120} /></label>
            <label><span>Procedimento</span><input value={form.procedure_name} onChange={event => updateForm('procedure_name', event.target.value)} placeholder="Ex.: Abdominoplastia" maxLength={160} /></label>
            <label className="is-wide"><span>Observação clínica</span><textarea rows={3} value={form.notes} onChange={event => updateForm('notes', event.target.value)} maxLength={2000} /></label>
            {kind !== 'document' && <label className="is-wide"><span>Aceite de uso de imagem relacionado</span><select value={form.consent_acceptance_id} onChange={event => updateForm('consent_acceptance_id', event.target.value)}><option value="">Nenhum aceite vinculado</option>{consents.map(consent => <option key={consent.id} value={consent.id}>{consent.title} · {clinicalAssetDateLabel(consent.accepted_at)}</option>)}</select><small>Este vínculo não autoriza uso externo além do texto efetivamente aceito.</small></label>}
          </div>
          <footer><span>{progress || 'O upload será registrado e auditado na ficha clínica.'}</span><div><Btn variant="ghost" disabled={status === 'saving'} onClick={event => { event.preventDefault(); resetUpload() }}>Cancelar</Btn><Btn disabled={status === 'saving'}>{status === 'saving' ? 'Enviando…' : 'Enviar arquivo'}</Btn></div></footer>
        </form>
      )}

      <div className="clinical-assets__filters">
        <input aria-label="Buscar fotos e documentos" value={filters.query} onChange={event => setFilters(current => ({ ...current, query:event.target.value }))} placeholder="Buscar arquivo, região ou procedimento" />
        <select aria-label="Filtrar tipo" value={filters.kind} onChange={event => setFilters(current => ({ ...current, kind:event.target.value }))}><option value="all">Todos os tipos</option><option value="clinical_photo">Fotos</option><option value="document">Documentos</option></select>
        <select aria-label="Filtrar etapa" value={filters.stage} onChange={event => setFilters(current => ({ ...current, stage:event.target.value }))}><option value="all">Todas as etapas</option><option value="before">Antes</option><option value="after">Depois</option><option value="neutral">Sem etapa</option></select>
        <label><input type="checkbox" checked={filters.showArchived} onChange={event => setFilters(current => ({ ...current, showArchived:event.target.checked }))} /> Mostrar arquivados</label>
      </div>

      <div className="clinical-assets__workspace">
        <section className="clinical-assets-gallery">
          <header><strong>Galeria</strong><small>{visibleAssets.length} resultado(s)</small></header>
          {visibleAssets.length === 0 && <div className="clinical-intake-callout"><span>Nenhuma foto ou documento neste filtro.</span></div>}
          <div className="clinical-assets-grid">
            {visibleAssets.map(asset => (
              <article key={asset.id} className={`clinical-asset-card is-${asset.status}`}>
                <button type="button" className="clinical-asset-card__preview" disabled={!['available', 'archived'].includes(asset.status)} onClick={() => openAsset(asset)}>
                  {asset.asset_kind === 'clinical_photo' && urls[asset.id] ? <img src={urls[asset.id]} alt={`${clinicalAssetStageLabel(asset.stage)} · ${asset.region || asset.file_name}`} /> : <span>{asset.asset_kind === 'document' ? 'PDF' : 'FOTO'}</span>}
                </button>
                <div className="clinical-asset-card__body"><div><span className={`is-${asset.stage}`}>{clinicalAssetStageLabel(asset.stage)}</span><small>{clinicalAssetStatusLabel(asset.status)}</small></div><strong title={asset.file_name}>{asset.procedure_name || asset.region || asset.file_name}</strong><small>{clinicalAssetDateLabel(asset.captured_on)}{asset.region ? ` · ${asset.region}` : ''}</small>{asset.consent_acceptance_id && <em>✓ aceite de imagem vinculado</em>}</div>
                <footer>{asset.status === 'uploading' && <Btn variant="ghost" onClick={() => completePending(asset)}>Finalizar confirmação</Btn>}{asset.status === 'available' && <><Btn variant="ghost" onClick={() => openAsset(asset)}>Abrir</Btn><button type="button" onClick={() => setArchived(asset, true)}>Arquivar</button></>}{asset.status === 'archived' && <Btn variant="ghost" onClick={() => setArchived(asset, false)}>Restaurar</Btn>}</footer>
              </article>
            ))}
          </div>
        </section>

        <section className="clinical-assets-compare">
          <header><div><span>Comparação clínica</span><strong>Antes e depois</strong></div><small>Selecione duas fotos do histórico.</small></header>
          <div className="clinical-assets-compare__selectors">
            <label><span>Antes</span><select value={beforeId} onChange={event => setBeforeId(event.target.value)}><option value="">Selecionar foto</option>{availablePhotos.map(asset => <option key={asset.id} value={asset.id}>{clinicalAssetDateLabel(asset.captured_on)} · {asset.region || asset.procedure_name || asset.file_name}</option>)}</select></label>
            <label><span>Depois</span><select value={afterId} onChange={event => setAfterId(event.target.value)}><option value="">Selecionar foto</option>{availablePhotos.map(asset => <option key={asset.id} value={asset.id}>{clinicalAssetDateLabel(asset.captured_on)} · {asset.region || asset.procedure_name || asset.file_name}</option>)}</select></label>
          </div>
          <div className="clinical-assets-compare__images">
            <ComparisonImage label="Antes" asset={beforeAsset} url={beforeAsset && urls[beforeAsset.id]} onOpen={openAsset} />
            <ComparisonImage label="Depois" asset={afterAsset} url={afterAsset && urls[afterAsset.id]} onOpen={openAsset} />
          </div>
          <p>Comparação visual para acompanhamento. A plataforma não produz diagnóstico automático.</p>
        </section>
      </div>

      {preview && <div className="clinical-asset-modal" role="dialog" aria-modal="true" aria-label="Visualização da foto clínica" onMouseDown={event => { if (event.target === event.currentTarget) setPreview(null) }}><div><header><div><strong>{preview.asset.procedure_name || preview.asset.region || preview.asset.file_name}</strong><small>{clinicalAssetDateLabel(preview.asset.captured_on)} · {clinicalAssetStageLabel(preview.asset.stage)}</small></div><button type="button" onClick={() => setPreview(null)} aria-label="Fechar visualização">×</button></header><img src={preview.url} alt={preview.asset.file_name} />{preview.asset.notes && <p>{preview.asset.notes}</p>}</div></div>}
    </div>
  )
}

function ComparisonImage({ label, asset, url, onOpen }) {
  return <div><span>{label}</span>{asset && url ? <button type="button" onClick={() => onOpen(asset)}><img src={url} alt={`${label}: ${asset.file_name}`} /></button> : <div><strong>{asset ? 'Carregando imagem…' : 'Nenhuma foto selecionada'}</strong></div>}{asset && <small>{clinicalAssetDateLabel(asset.captured_on)} · {asset.region || asset.procedure_name || 'Sem região'}</small>}</div>
}
