export const CLINICAL_ASSET_BUCKET = 'clinical-assets'
export const CLINICAL_ASSET_MAX_BYTES = 20 * 1024 * 1024
export const CLINICAL_ASSET_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

export const CLINICAL_ASSET_STAGES = [
  { value:'neutral', label:'Sem etapa' },
  { value:'before', label:'Antes' },
  { value:'after', label:'Depois' },
]

export function clinicalAssetKind(fileOrMime) {
  const mimeType = typeof fileOrMime === 'string' ? fileOrMime : fileOrMime?.type
  return mimeType === 'application/pdf' ? 'document' : 'clinical_photo'
}

export function validateClinicalAssetFile(file) {
  if (!file) return 'Selecione uma foto ou PDF.'
  if (!CLINICAL_ASSET_MIME_TYPES.includes(file.type)) return 'Formato não aceito. Use JPEG, PNG, WebP ou PDF.'
  if (!Number.isFinite(file.size) || file.size <= 0) return 'O arquivo está vazio.'
  if (file.size > CLINICAL_ASSET_MAX_BYTES) return 'O arquivo deve ter no máximo 20 MB.'
  if (!String(file.name || '').trim()) return 'O arquivo precisa ter um nome.'
  return ''
}

export async function clinicalAssetSha256(file) {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function buildClinicalAssetRpcArgs({ patientId, file, form, sha256 }) {
  const kind = clinicalAssetKind(file)
  return {
    p_patient_id:patientId,
    p_asset_kind:kind,
    p_stage:kind === 'document' ? 'neutral' : form.stage,
    p_captured_on:form.captured_on,
    p_region:form.region.trim() || null,
    p_procedure_name:form.procedure_name.trim() || null,
    p_notes:form.notes.trim() || null,
    p_file_name:file.name,
    p_mime_type:file.type,
    p_file_size:file.size,
    p_client_sha256:sha256,
    p_consent_acceptance_id:kind === 'clinical_photo' ? form.consent_acceptance_id || null : null,
  }
}

export function clinicalAssetStageLabel(stage) {
  return CLINICAL_ASSET_STAGES.find(item => item.value === stage)?.label || 'Sem etapa'
}

export function clinicalAssetStatusLabel(status) {
  return {
    uploading:'Aguardando confirmação',
    available:'Disponível',
    failed:'Falhou',
    archived:'Arquivado',
  }[status] || status
}

export function filterClinicalAssets(assets, { query = '', kind = 'all', stage = 'all', showArchived = false } = {}) {
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  return (assets || []).filter(asset => {
    if (!showArchived && asset.status === 'archived') return false
    if (kind !== 'all' && asset.asset_kind !== kind) return false
    if (stage !== 'all' && asset.stage !== stage) return false
    if (!normalizedQuery) return true
    return [asset.file_name, asset.region, asset.procedure_name, asset.notes]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(normalizedQuery))
  })
}

export function clinicalAssetDateLabel(value) {
  if (!value) return 'Data não informada'
  return new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
}
