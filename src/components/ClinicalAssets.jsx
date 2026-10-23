import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { today } from '../utils.js'
import {
  buildClinicalAssetRpcArgs,
  clinicalAssetDateLabel,
  clinicalAssetSha256,
  clinicalAssetStageLabel,
  clinicalAssetStatusLabel,
  filterClinicalAssets,
  validateClinicalAssetFile,
} from '../lib/clinicalAssets.js'
import { Btn } from './UI.jsx'

const ASSET_COLUMNS = 'id,user_id,patient_id,created_by,asset_kind,stage,captured_on,region,procedure_name,notes,bucket_id,object_path,file_name,expected_mime_type,expected_file_size,observed_mime_type,file_size,client_sha256,consent_acceptance_id,status,created_at,completed_at,failed_at,archived_at'
const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'
const DOCUMENT_ACCEPT = 'application/pdf'
const MAX_BATCH_FILES = 12

function initialForm(stage = 'before') {
  return { stage, captured_on:today(), region:'', procedure_name:'', notes:'', consent_acceptance_id:'' }
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

async function signedAssetUrl(asset, { audit = true } = {}) {
  if (audit) {
    const { error:auditError } = await supabase.rpc('log_clinical_asset_access', { p_asset_id:asset.id })
    if (auditError) throw auditError
  }
  const { data, error } = await supabase.storage.from(asset.bucket_id).createSignedUrl(asset.object_path, 300)
  if (error || !data?.signedUrl) throw error || new Error('URL temporária indisponível.')
  return data.signedUrl
}

function fileEntry(file) {
  return {
    file,
    id:`${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    previewUrl:file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
  }
}

function fileSizeLabel(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ClinicalAssets({ patient, ownerId }) {
  const [assets, setAssets] = useState([])
  const [consents, setConsents] = useState([])
  const [urls, setUrls] = useState({})
  const [urlFailures, setUrlFailures] = useState({})
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [mediaNotice, setMediaNotice] = useState('')
  const [section, setSection] = useState('compare')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadKind, setUploadKind] = useState('clinical_photo')
  const [fileEntries, setFileEntries] = useState([])
  const [dragActive, setDragActive] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [progress, setProgress] = useState(null)
  const [filters, setFilters] = useState({ query:'', kind:'all', stage:'all', showArchived:false })
  const [beforeId, setBeforeId] = useState('')
  const [afterId, setAfterId] = useState('')
  const [previewId, setPreviewId] = useState('')
  const [compareFullscreen, setCompareFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const fileInputRef = useRef(null)
  const fileEntriesRef = useRef([])
  const loadRequestRef = useRef(0)
  const modalRef = useRef(null)

  const availablePhotos = useMemo(() => assets.filter(asset => asset.asset_kind === 'clinical_photo' && asset.status === 'available'), [assets])
  const beforePhotos = useMemo(() => availablePhotos.filter(asset => asset.stage === 'before'), [availablePhotos])
  const afterPhotos = useMemo(() => availablePhotos.filter(asset => asset.stage === 'after'), [availablePhotos])
  const beforeAsset = beforePhotos.find(asset => asset.id === beforeId)
  const afterAsset = afterPhotos.find(asset => asset.id === afterId)
  const previewAsset = availablePhotos.find(asset => asset.id === previewId)
  const previewIndex = availablePhotos.findIndex(asset => asset.id === previewId)

  const visibleAssets = useMemo(() => {
    const kind = section === 'documents' ? 'document' : 'clinical_photo'
    return filterClinicalAssets(assets, { ...filters, kind })
  }, [assets, filters, section])

  const counts = useMemo(() => ({
    photos:assets.filter(asset => asset.asset_kind === 'clinical_photo' && asset.status === 'available').length,
    documents:assets.filter(asset => asset.asset_kind === 'document' && asset.status === 'available').length,
    before:beforePhotos.length,
    after:afterPhotos.length,
  }), [assets, beforePhotos.length, afterPhotos.length])

  async function hydratePhotoUrls(rows, requestId) {
    const photos = rows.filter(asset => asset.asset_kind === 'clinical_photo' && ['available', 'archived'].includes(asset.status))
    if (photos.length === 0) return
    setMediaNotice('')
    const { error:auditError } = await supabase.rpc('log_clinical_asset_accesses', { p_asset_ids:photos.map(asset => asset.id) })
    const bulkAuditWorked = !auditError
    const loaded = {}

    if (bulkAuditWorked) {
      const byBucket = photos.reduce((groups, asset) => {
        if (!groups.has(asset.bucket_id)) groups.set(asset.bucket_id, [])
        groups.get(asset.bucket_id).push(asset)
        return groups
      }, new Map())
      for (const [bucket, bucketPhotos] of byBucket) {
        const { data:signedRows, error:signError } = await supabase.storage.from(bucket).createSignedUrls(bucketPhotos.map(asset => asset.object_path), 300)
        if (signError) continue
        const idsByPath = new Map(bucketPhotos.map(asset => [asset.object_path, asset.id]))
        for (const row of signedRows || []) {
          const id = idsByPath.get(row.path)
          if (id && row?.signedUrl) loaded[id] = row.signedUrl
        }
      }
    }

    const missing = photos.filter(asset => !loaded[asset.id])
    const fallbackRows = await Promise.all(missing.map(async asset => {
      try {
        return [asset.id, await signedAssetUrl(asset, { audit:!bulkAuditWorked })]
      } catch {
        return [asset.id, null]
      }
    }))
    if (requestId !== loadRequestRef.current) return
    Object.assign(loaded, Object.fromEntries(fallbackRows.filter(([, url]) => url)))
    const failed = Object.fromEntries(fallbackRows.filter(([, url]) => !url).map(([id]) => [id, true]))
    if (Object.keys(loaded).length) setUrls(current => ({ ...current, ...loaded }))
    if (Object.keys(failed).length) {
      setUrlFailures(current => ({ ...current, ...failed }))
      setMediaNotice('Algumas miniaturas não carregaram. Você pode tentar novamente em cada foto.')
    }
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
      setBeforeId(current => bundle.assets.some(asset => asset.id === current && asset.stage === 'before' && asset.status === 'available') ? current : bundle.assets.find(asset => asset.asset_kind === 'clinical_photo' && asset.stage === 'before' && asset.status === 'available')?.id || '')
      setAfterId(current => bundle.assets.some(asset => asset.id === current && asset.stage === 'after' && asset.status === 'available') ? current : bundle.assets.find(asset => asset.asset_kind === 'clinical_photo' && asset.stage === 'after' && asset.status === 'available')?.id || '')
      setStatus('ready')
      await hydratePhotoUrls(bundle.assets, requestId)
    } catch (nextError) {
      if (requestId !== loadRequestRef.current) return
      setStatus('error')
      setError(nextError.message || 'Não foi possível carregar fotos e documentos clínicos.')
    }
  }

  useEffect(() => {
    fileEntriesRef.current = fileEntries
  }, [fileEntries])

  useEffect(() => () => {
    fileEntriesRef.current.forEach(entry => entry.previewUrl && URL.revokeObjectURL(entry.previewUrl))
  }, [])

  useEffect(() => {
    loadRequestRef.current += 1
    setAssets([])
    setUrls({})
    setUrlFailures({})
    setBeforeId('')
    setAfterId('')
    setPreviewId('')
    resetUpload()
    load()
  }, [patient.id, ownerId])

  useEffect(() => {
    if (!previewId && !compareFullscreen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = event => {
      if (event.key === 'Escape') closeViewer()
      if (previewId && event.key === 'ArrowRight') showAdjacentPhoto(1)
      if (previewId && event.key === 'ArrowLeft') showAdjacentPhoto(-1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [previewId, compareFullscreen, previewIndex, availablePhotos.length])

  function updateForm(key, value) {
    setForm(current => ({ ...current, [key]:value }))
  }

  function clearFiles() {
    setFileEntries(current => {
      current.forEach(entry => entry.previewUrl && URL.revokeObjectURL(entry.previewUrl))
      return []
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function resetUpload() {
    clearFiles()
    setProgress(null)
    setUploadOpen(false)
    setDragActive(false)
  }

  function startUpload(kind = 'clinical_photo', stage = 'before') {
    clearFiles()
    setUploadKind(kind)
    setForm(initialForm(kind === 'document' ? 'neutral' : stage))
    setProgress(null)
    setError('')
    setUploadOpen(true)
    window.setTimeout(() => fileInputRef.current?.focus(), 0)
  }

  function selectFiles(nextFiles) {
    const acceptedType = uploadKind === 'document' ? DOCUMENT_ACCEPT : PHOTO_ACCEPT
    const allowed = acceptedType.split(',')
    const incoming = Array.from(nextFiles || [])
    if (!incoming.length) return
    if (incoming.some(file => !allowed.includes(file.type))) {
      setError(uploadKind === 'document' ? 'Selecione somente arquivos PDF.' : 'Selecione somente fotos JPEG, PNG ou WebP.')
      return
    }
    if (fileEntries.length + incoming.length > MAX_BATCH_FILES) {
      setError(`Envie no máximo ${MAX_BATCH_FILES} arquivos por vez.`)
      return
    }
    const invalid = incoming.map(validateClinicalAssetFile).find(Boolean)
    if (invalid) {
      setError(invalid)
      return
    }
    setError('')
    setFileEntries(current => [...current, ...incoming.map(fileEntry)])
  }

  function removeFile(id) {
    setFileEntries(current => {
      const removed = current.find(entry => entry.id === id)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return current.filter(entry => entry.id !== id)
    })
  }

  async function upload(event) {
    event.preventDefault()
    if (status === 'saving') return
    if (!fileEntries.length) {
      setError(uploadKind === 'document' ? 'Selecione ao menos um PDF.' : 'Selecione ao menos uma foto.')
      return
    }
    setStatus('saving')
    setError('')
    const failures = []
    let completed = 0

    for (let index = 0; index < fileEntries.length; index += 1) {
      const { file } = fileEntries[index]
      try {
        setProgress({ current:index + 1, total:fileEntries.length, label:`Preparando ${file.name}` })
        const sha256 = await clinicalAssetSha256(file)
        const { data:createdRows, error:createError } = await supabase.rpc('create_clinical_asset_upload', buildClinicalAssetRpcArgs({ patientId:patient.id, file, form:{ ...form, stage:uploadKind === 'document' ? 'neutral' : form.stage }, sha256 }))
        if (createError) throw createError
        const reservedAsset = Array.isArray(createdRows) ? createdRows[0] : createdRows
        if (!reservedAsset?.asset_id || !reservedAsset?.object_path) throw new Error('O banco não devolveu a reserva do arquivo.')
        setProgress({ current:index + 1, total:fileEntries.length, label:`Enviando ${file.name}` })
        const { error:uploadError } = await supabase.storage.from(reservedAsset.bucket_id).upload(reservedAsset.object_path, file, { upsert:false, contentType:file.type, cacheControl:'3600' })
        if (uploadError) {
          await supabase.rpc('fail_clinical_asset_upload', { p_asset_id:reservedAsset.asset_id })
          throw uploadError
        }
        setProgress({ current:index + 1, total:fileEntries.length, label:`Confirmando ${file.name}` })
        const { data:confirmed, error:confirmError } = await supabase.rpc('complete_clinical_asset_upload', { p_asset_id:reservedAsset.asset_id })
        if (confirmError) throw confirmError
        if (!confirmed) throw new Error('O arquivo recebido não corresponde ao arquivo selecionado.')
        completed += 1
      } catch (nextError) {
        failures.push(`${file.name}: ${nextError.message || 'falha no envio'}`)
      }
    }

    setProgress({ current:fileEntries.length, total:fileEntries.length, label:`${completed} de ${fileEntries.length} arquivo(s) enviado(s)` })
    await load({ preserveError:true })
    setStatus('ready')
    if (failures.length) {
      setError(`${completed} arquivo(s) enviado(s). Não foi possível concluir: ${failures.join(' · ')}`)
      return
    }
    resetUpload()
    setSection(uploadKind === 'document' ? 'documents' : 'photos')
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

  async function loadAssetUrl(asset, { force = false } = {}) {
    if (!force && urls[asset.id]) return urls[asset.id]
    setUrlFailures(current => ({ ...current, [asset.id]:false }))
    try {
      const url = await signedAssetUrl(asset)
      setUrls(current => ({ ...current, [asset.id]:url }))
      return url
    } catch (nextError) {
      setUrlFailures(current => ({ ...current, [asset.id]:true }))
      throw nextError
    }
  }

  async function openAsset(asset) {
    setError('')
    const popup = asset.asset_kind === 'document' ? window.open('about:blank', '_blank') : null
    if (popup) popup.opener = null
    try {
      const url = await loadAssetUrl(asset)
      if (asset.asset_kind === 'clinical_photo') {
        setZoom(1)
        setPreviewId(asset.id)
      } else if (popup) {
        popup.location.replace(url)
      } else {
        setError('O navegador bloqueou a abertura. Libere pop-ups e tente novamente.')
      }
    } catch (nextError) {
      popup?.close()
      setError(nextError.message || 'Não foi possível abrir o arquivo privado.')
    }
  }

  async function retryPhoto(asset) {
    setMediaNotice('')
    try {
      await loadAssetUrl(asset, { force:true })
    } catch (nextError) {
      setMediaNotice(nextError.message || 'A foto continua indisponível. Tente novamente em instantes.')
    }
  }

  function closeViewer() {
    setPreviewId('')
    setCompareFullscreen(false)
    setZoom(1)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }

  function showAdjacentPhoto(direction) {
    if (!availablePhotos.length) return
    const nextIndex = (previewIndex + direction + availablePhotos.length) % availablePhotos.length
    const next = availablePhotos[nextIndex]
    setZoom(1)
    setPreviewId(next.id)
    if (!urls[next.id]) retryPhoto(next)
  }

  function requestBrowserFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else modalRef.current?.requestFullscreen?.().catch(() => {})
  }

  if (status === 'loading' && assets.length === 0) return <div className="clinical-loading">Carregando galeria clínica…</div>
  if (status === 'error' && assets.length === 0) return <div className="clinical-empty-panel" role="alert"><strong>{error}</strong><Btn variant="ghost" onClick={() => load()}>Tentar novamente</Btn></div>

  return (
    <div className="clinical-assets">
      <header className="clinical-assets-hero">
        <div className="clinical-assets-hero__copy"><span>Galeria clínica privada</span><h3>Fotos e documentos de {patient.full_name}</h3><p>Compare a evolução com clareza e mantenha cada arquivo organizado no prontuário.</p></div>
        <div className="clinical-assets-hero__actions"><Btn variant="ghost" onClick={() => startUpload('document', 'neutral')}>Adicionar documento</Btn><Btn onClick={() => startUpload('clinical_photo', section === 'compare' && counts.before > 0 && !counts.after ? 'after' : 'before')}>+ Adicionar fotos</Btn></div>
      </header>

      <div className="clinical-assets-summary" aria-label="Resumo da galeria">
        <div><strong>{counts.photos}</strong><span>Fotos</span></div><div className="is-before"><strong>{counts.before}</strong><span>Antes</span></div><div className="is-after"><strong>{counts.after}</strong><span>Depois</span></div><div><strong>{counts.documents}</strong><span>Documentos</span></div>
      </div>

      <nav className="clinical-assets-nav" aria-label="Seções de fotos e documentos">
        <button type="button" className={section === 'compare' ? 'is-active' : ''} onClick={() => setSection('compare')}><span>◫</span><strong>Antes e depois</strong><small>Compare lado a lado</small></button>
        <button type="button" className={section === 'photos' ? 'is-active' : ''} onClick={() => setSection('photos')}><span>▦</span><strong>Galeria de fotos</strong><small>{counts.photos} foto(s)</small></button>
        <button type="button" className={section === 'documents' ? 'is-active' : ''} onClick={() => setSection('documents')}><span>▤</span><strong>Documentos</strong><small>{counts.documents} arquivo(s)</small></button>
      </nav>

      {error && <div className="clinical-form-error" role="alert">{error}</div>}
      {mediaNotice && <div className="clinical-assets-notice" role="status"><span>{mediaNotice}</span><button type="button" onClick={() => load()}>Recarregar galeria</button></div>}

      {uploadOpen && <UploadPanel kind={uploadKind} entries={fileEntries} form={form} consents={consents} saving={status === 'saving'} dragActive={dragActive} progress={progress} fileInputRef={fileInputRef} onFiles={selectFiles} onRemoveFile={removeFile} onForm={updateForm} onDragActive={setDragActive} onCancel={resetUpload} onSubmit={upload} />}

      {section === 'compare' && <CompareWorkspace beforePhotos={beforePhotos} afterPhotos={afterPhotos} beforeId={beforeId} afterId={afterId} beforeAsset={beforeAsset} afterAsset={afterAsset} urls={urls} failures={urlFailures} onBefore={setBeforeId} onAfter={setAfterId} onOpen={openAsset} onRetry={retryPhoto} onAddBefore={() => startUpload('clinical_photo', 'before')} onAddAfter={() => startUpload('clinical_photo', 'after')} onFullscreen={() => setCompareFullscreen(true)} />}

      {(section === 'photos' || section === 'documents') && <GalleryWorkspace section={section} assets={visibleAssets} filters={filters} urls={urls} failures={urlFailures} onFilters={setFilters} onOpen={openAsset} onRetry={retryPhoto} onArchive={setArchived} onComplete={completePending} onAdd={() => startUpload(section === 'documents' ? 'document' : 'clinical_photo', 'before')} />}

      {previewAsset && <PhotoViewer modalRef={modalRef} asset={previewAsset} url={urls[previewAsset.id]} zoom={zoom} position={`${previewIndex + 1} de ${availablePhotos.length}`} onClose={closeViewer} onZoom={setZoom} onPrevious={() => showAdjacentPhoto(-1)} onNext={() => showAdjacentPhoto(1)} onFullscreen={requestBrowserFullscreen} />}
      {compareFullscreen && <CompareViewer modalRef={modalRef} beforeAsset={beforeAsset} afterAsset={afterAsset} urls={urls} onClose={closeViewer} onOpen={asset => { setCompareFullscreen(false); openAsset(asset) }} onFullscreen={requestBrowserFullscreen} />}
    </div>
  )
}

function UploadPanel({ kind, entries, form, consents, saving, dragActive, progress, fileInputRef, onFiles, onRemoveFile, onForm, onDragActive, onCancel, onSubmit }) {
  const isDocument = kind === 'document'
  const accept = isDocument ? DOCUMENT_ACCEPT : PHOTO_ACCEPT
  return (
    <form className="clinical-asset-upload" onSubmit={onSubmit}>
      <header className="clinical-asset-upload__header"><div><span>{isDocument ? 'Novo documento' : `Novas fotos · ${clinicalAssetStageLabel(form.stage)}`}</span><strong>{isDocument ? 'Anexar PDF ao prontuário' : 'Adicionar fotos clínicas'}</strong><small>{isDocument ? 'PDF de até 20 MB' : `Até ${MAX_BATCH_FILES} fotos JPEG, PNG ou WebP por envio`}</small></div><button type="button" onClick={onCancel} disabled={saving} aria-label="Fechar envio">×</button></header>
      {!isDocument && <div className="clinical-asset-stage-picker" role="group" aria-label="Momento das fotos"><button type="button" className={form.stage === 'before' ? 'is-active is-before' : ''} onClick={() => onForm('stage', 'before')}><strong>Antes</strong><small>Registro pré-procedimento</small></button><button type="button" className={form.stage === 'after' ? 'is-active is-after' : ''} onClick={() => onForm('stage', 'after')}><strong>Depois</strong><small>Evolução e resultado</small></button><button type="button" className={form.stage === 'neutral' ? 'is-active' : ''} onClick={() => onForm('stage', 'neutral')}><strong>Sem etapa</strong><small>Foto clínica geral</small></button></div>}
      <label className={`clinical-asset-dropzone${dragActive ? ' is-dragging' : ''}`} onDragEnter={event => { event.preventDefault(); onDragActive(true) }} onDragOver={event => { event.preventDefault(); onDragActive(true) }} onDragLeave={event => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget)) onDragActive(false) }} onDrop={event => { event.preventDefault(); onDragActive(false); onFiles(event.dataTransfer.files) }}>
        <input ref={fileInputRef} type="file" multiple accept={accept} onChange={event => { onFiles(event.target.files); event.target.value = '' }} />
        <span className="clinical-asset-dropzone__icon">{isDocument ? 'PDF' : '＋'}</span><strong>{isDocument ? 'Escolha ou arraste seus PDFs' : 'Escolha ou arraste as fotos aqui'}</strong><small>Os arquivos ficam privados e vinculados somente à ficha desta paciente.</small><em>Selecionar {isDocument ? 'documentos' : 'fotos'}</em>
      </label>
      {entries.length > 0 && <div className="clinical-asset-selection" aria-label="Arquivos selecionados"><header><strong>{entries.length} arquivo(s) pronto(s)</strong><small>{fileSizeLabel(entries.reduce((total, entry) => total + entry.file.size, 0))} no total</small></header><div>{entries.map(entry => <article key={entry.id}>{entry.previewUrl ? <img src={entry.previewUrl} alt="" /> : <span>PDF</span>}<div><strong title={entry.file.name}>{entry.file.name}</strong><small>{fileSizeLabel(entry.file.size)}</small></div><button type="button" disabled={saving} onClick={() => onRemoveFile(entry.id)} aria-label={`Remover ${entry.file.name}`}>×</button></article>)}</div></div>}
      <div className="clinical-asset-form-grid">
        <label><span>Data do registro *</span><input type="date" max={today()} value={form.captured_on} onChange={event => onForm('captured_on', event.target.value)} required /></label>
        <label><span>Região</span><input aria-label="Região" value={form.region} onChange={event => onForm('region', event.target.value)} placeholder="Ex.: Abdômen, face, mama" maxLength={120} /></label>
        <label className="is-wide"><span>Procedimento</span><input aria-label="Procedimento" value={form.procedure_name} onChange={event => onForm('procedure_name', event.target.value)} placeholder="Ex.: Abdominoplastia" maxLength={160} /></label>
        <label className="is-wide"><span>Observação clínica</span><textarea aria-label="Observação clínica" rows={3} value={form.notes} onChange={event => onForm('notes', event.target.value)} placeholder="Contexto importante para acompanhar esta imagem" maxLength={2000} /></label>
        {!isDocument && <label className="is-wide"><span>Aceite de uso de imagem relacionado</span><select aria-label="Aceite de uso de imagem relacionado" value={form.consent_acceptance_id} onChange={event => onForm('consent_acceptance_id', event.target.value)}><option value="">Nenhum aceite vinculado</option>{consents.map(consent => <option key={consent.id} value={consent.id}>{consent.title} · {clinicalAssetDateLabel(consent.accepted_at)}</option>)}</select><small>O vínculo não amplia a autorização além do texto aceito pela paciente.</small></label>}
      </div>
      {progress && <div className="clinical-asset-progress" role="status"><div><strong>{progress.label}</strong><span>{progress.current} de {progress.total}</span></div><progress value={progress.current} max={progress.total} /></div>}
      <footer><span>O envio e cada visualização ficam registrados na auditoria clínica.</span><div><Btn variant="ghost" disabled={saving} onClick={event => { event.preventDefault(); onCancel() }}>Cancelar</Btn><Btn disabled={saving || entries.length === 0}>{saving ? `Enviando ${progress?.current || 1} de ${progress?.total || entries.length}…` : `Salvar ${entries.length || ''} ${isDocument ? 'documento(s)' : 'foto(s)'}`}</Btn></div></footer>
    </form>
  )
}

function CompareWorkspace({ beforePhotos, afterPhotos, beforeId, afterId, beforeAsset, afterAsset, urls, failures, onBefore, onAfter, onOpen, onRetry, onAddBefore, onAddAfter, onFullscreen }) {
  const ready = beforeAsset && afterAsset && urls[beforeAsset.id] && urls[afterAsset.id]
  return <section className="clinical-assets-compare"><header className="clinical-assets-section-header"><div><span>Comparação clínica</span><h4>Antes e depois, lado a lado</h4><p>Escolha registros da mesma região ou procedimento para acompanhar a evolução.</p></div>{ready && <Btn variant="ghost" onClick={onFullscreen}>⛶ Comparar em tela cheia</Btn>}</header><div className="clinical-assets-compare__selectors"><label><span>Foto de antes</span><select aria-label="Foto de antes" value={beforeId} onChange={event => onBefore(event.target.value)}><option value="">Selecionar foto de antes</option>{beforePhotos.map(asset => <option key={asset.id} value={asset.id}>{clinicalAssetDateLabel(asset.captured_on)} · {asset.region || asset.procedure_name || asset.file_name}</option>)}</select></label><label><span>Foto de depois</span><select aria-label="Foto de depois" value={afterId} onChange={event => onAfter(event.target.value)}><option value="">Selecionar foto de depois</option>{afterPhotos.map(asset => <option key={asset.id} value={asset.id}>{clinicalAssetDateLabel(asset.captured_on)} · {asset.region || asset.procedure_name || asset.file_name}</option>)}</select></label></div><div className="clinical-assets-compare__images"><ComparisonImage label="Antes" asset={beforeAsset} url={beforeAsset && urls[beforeAsset.id]} failed={beforeAsset && failures[beforeAsset.id]} onOpen={onOpen} onRetry={onRetry} onAdd={onAddBefore} /><ComparisonImage label="Depois" asset={afterAsset} url={afterAsset && urls[afterAsset.id]} failed={afterAsset && failures[afterAsset.id]} onOpen={onOpen} onRetry={onRetry} onAdd={onAddAfter} /></div>{!beforePhotos.length && !afterPhotos.length && <div className="clinical-assets-guide"><strong>Comece registrando as fotos pré-procedimento</strong><span>Depois, adicione as fotos de evolução para montar a comparação automaticamente.</span></div>}<footer>Comparação apenas para acompanhamento clínico. A plataforma não realiza diagnóstico automático.</footer></section>
}

function ComparisonImage({ label, asset, url, failed, onOpen, onRetry, onAdd }) {
  return <article className={`clinical-compare-card is-${label === 'Antes' ? 'before' : 'after'}`}><header><span>{label}</span>{asset && <small>{clinicalAssetDateLabel(asset.captured_on)}</small>}</header>{asset && url ? <button type="button" className="clinical-compare-card__image" onClick={() => onOpen(asset)} aria-label={`Abrir foto de ${label.toLowerCase()} em tela cheia`}><img src={url} alt={`${label}: ${asset.file_name}`} /><span>⛶ Ver em tela cheia</span></button> : <div className="clinical-compare-card__empty"><span>{failed ? '!' : '＋'}</span><strong>{failed ? 'Não foi possível carregar a foto' : `Nenhuma foto de ${label.toLowerCase()} selecionada`}</strong><button type="button" onClick={() => asset && failed ? onRetry(asset) : onAdd()}>{asset && failed ? 'Tentar novamente' : `Adicionar foto de ${label.toLowerCase()}`}</button></div>}{asset && <div className="clinical-compare-card__meta"><strong>{asset.procedure_name || asset.region || asset.file_name}</strong><small>{asset.region || 'Região não informada'}</small></div>}</article>
}

function GalleryWorkspace({ section, assets, filters, urls, failures, onFilters, onOpen, onRetry, onArchive, onComplete, onAdd }) {
  const isDocuments = section === 'documents'
  return <section className="clinical-assets-gallery"><header className="clinical-assets-section-header"><div><span>{isDocuments ? 'Prontuário digital' : 'Histórico visual'}</span><h4>{isDocuments ? 'Documentos clínicos' : 'Galeria de fotos'}</h4><p>{isDocuments ? 'Laudos e anexos organizados por data.' : 'Clique em qualquer imagem para ampliar e navegar em tela cheia.'}</p></div><Btn onClick={onAdd}>+ {isDocuments ? 'Adicionar documento' : 'Adicionar fotos'}</Btn></header><div className="clinical-assets__filters"><label className="clinical-assets-search"><span>⌕</span><input aria-label="Buscar fotos e documentos" value={filters.query} onChange={event => onFilters(current => ({ ...current, query:event.target.value }))} placeholder={isDocuments ? 'Buscar documento ou procedimento' : 'Buscar por região ou procedimento'} /></label>{!isDocuments && <select aria-label="Filtrar etapa" value={filters.stage} onChange={event => onFilters(current => ({ ...current, stage:event.target.value }))}><option value="all">Todas as etapas</option><option value="before">Antes</option><option value="after">Depois</option><option value="neutral">Sem etapa</option></select>}<label className="clinical-assets-archived"><input type="checkbox" checked={filters.showArchived} onChange={event => onFilters(current => ({ ...current, showArchived:event.target.checked }))} /> Mostrar arquivados</label></div>{assets.length === 0 ? <div className="clinical-assets-empty"><span>{isDocuments ? '▤' : '▦'}</span><strong>{filters.query || filters.showArchived || filters.stage !== 'all' ? 'Nenhum item encontrado neste filtro' : isDocuments ? 'Nenhum documento adicionado' : 'Nenhuma foto adicionada'}</strong><small>{isDocuments ? 'Anexe PDFs para mantê-los junto ao prontuário.' : 'Adicione fotos de antes, depois ou registros clínicos gerais.'}</small><Btn onClick={onAdd}>+ {isDocuments ? 'Adicionar documento' : 'Adicionar fotos'}</Btn></div> : <div className={`clinical-assets-grid${isDocuments ? ' is-documents' : ''}`}>{assets.map(asset => <AssetCard key={asset.id} asset={asset} url={urls[asset.id]} failed={failures[asset.id]} onOpen={onOpen} onRetry={onRetry} onArchive={onArchive} onComplete={onComplete} />)}</div>}</section>
}

function AssetCard({ asset, url, failed, onOpen, onRetry, onArchive, onComplete }) {
  const isPhoto = asset.asset_kind === 'clinical_photo'
  return <article className={`clinical-asset-card is-${asset.status}`}><div className="clinical-asset-card__media">{isPhoto && url ? <button type="button" onClick={() => onOpen(asset)} aria-label={`Abrir ${asset.file_name} em tela cheia`}><img src={url} alt={`${clinicalAssetStageLabel(asset.stage)} · ${asset.region || asset.file_name}`} /><span>⛶</span></button> : isPhoto ? <div><span>{failed ? '!' : '◌'}</span><strong>{failed ? 'Foto indisponível' : 'Carregando foto…'}</strong>{failed && <button type="button" onClick={() => onRetry(asset)}>Tentar novamente</button>}</div> : <button type="button" className="is-document" onClick={() => onOpen(asset)}><span>PDF</span><small>Abrir documento</small></button>}<span className={`clinical-asset-stage is-${asset.stage}`}>{clinicalAssetStageLabel(asset.stage)}</span></div><div className="clinical-asset-card__body"><div><strong title={asset.procedure_name || asset.region || asset.file_name}>{asset.procedure_name || asset.region || asset.file_name}</strong><small>{clinicalAssetStatusLabel(asset.status)}</small></div><p>{clinicalAssetDateLabel(asset.captured_on)}{asset.region ? ` · ${asset.region}` : ''}</p>{asset.notes && <em title={asset.notes}>{asset.notes}</em>}{asset.consent_acceptance_id && <span>✓ Aceite de imagem vinculado</span>}</div><footer>{asset.status === 'uploading' && <Btn variant="ghost" onClick={() => onComplete(asset)}>Finalizar envio</Btn>}{asset.status === 'available' && <><Btn variant="ghost" onClick={() => onOpen(asset)}>{isPhoto ? 'Visualizar' : 'Abrir PDF'}</Btn><button type="button" onClick={() => onArchive(asset, true)}>Arquivar</button></>}{asset.status === 'archived' && <Btn variant="ghost" onClick={() => onArchive(asset, false)}>Restaurar</Btn>}</footer></article>
}

function ViewerShell({ modalRef, title, subtitle, children, onClose, onFullscreen, footer }) {
  return <div ref={modalRef} className="clinical-asset-viewer" role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><header><div><strong>{title}</strong><small>{subtitle}</small></div><div><button type="button" onClick={onFullscreen} aria-label="Alternar tela cheia">⛶</button><button type="button" onClick={onClose} aria-label="Fechar visualização">×</button></div></header>{children}{footer}</div>
}

function PhotoViewer({ modalRef, asset, url, zoom, position, onClose, onZoom, onPrevious, onNext, onFullscreen }) {
  return <ViewerShell modalRef={modalRef} title={asset.procedure_name || asset.region || asset.file_name} subtitle={`${clinicalAssetStageLabel(asset.stage)} · ${clinicalAssetDateLabel(asset.captured_on)} · ${position}`} onClose={onClose} onFullscreen={onFullscreen} footer={<footer className="clinical-asset-viewer__footer"><div><strong>{asset.region || 'Região não informada'}</strong>{asset.notes && <span>{asset.notes}</span>}</div><div><button type="button" onClick={() => onZoom(Math.max(.6, zoom - .2))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => onZoom(Math.min(3, zoom + .2))}>＋</button><button type="button" onClick={() => onZoom(1)}>Ajustar</button></div></footer>}><main className="clinical-asset-viewer__stage"><button type="button" className="is-previous" onClick={onPrevious} aria-label="Foto anterior">‹</button>{url ? <div className="clinical-asset-viewer__canvas"><img src={url} alt={asset.file_name} style={{ transform:`scale(${zoom})` }} /></div> : <div className="clinical-asset-viewer__loading"><span className="clinical-spinner" /><strong>Carregando foto privada…</strong></div>}<button type="button" className="is-next" onClick={onNext} aria-label="Próxima foto">›</button></main></ViewerShell>
}

function CompareViewer({ modalRef, beforeAsset, afterAsset, urls, onClose, onOpen, onFullscreen }) {
  return <ViewerShell modalRef={modalRef} title="Comparação antes e depois" subtitle={`${beforeAsset?.region || afterAsset?.region || 'Acompanhamento clínico'} · visualização lado a lado`} onClose={onClose} onFullscreen={onFullscreen} footer={<footer className="clinical-asset-viewer__compare-note">Clique em uma imagem para examiná-la individualmente.</footer>}><main className="clinical-asset-viewer__compare">{[[beforeAsset, 'Antes'], [afterAsset, 'Depois']].map(([asset, label]) => <article key={label}><header><strong>{label}</strong><span>{asset ? clinicalAssetDateLabel(asset.captured_on) : 'Sem foto'}</span></header>{asset && urls[asset.id] ? <button type="button" onClick={() => onOpen(asset)}><img src={urls[asset.id]} alt={`${label}: ${asset.file_name}`} /></button> : <div><strong>Nenhuma foto selecionada</strong></div>}</article>)}</main></ViewerShell>
}
