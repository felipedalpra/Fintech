import { getAdminSupabase, getAuthenticatedUser } from '../_lib/secureProfile.js'
import { enforceRateLimit, rateLimitResponse } from '../_lib/securityControls.js'
import { validateClinicalUpload } from '../_lib/clinicalUploadValidation.js'

function failure(message, status = 400) {
  const error = new Error(message)
  error.statusCode = status
  return error
}

async function markFailed(admin, asset) {
  await admin.from('clinical_assets')
    .update({ status:'failed', failed_at:new Date().toISOString() })
    .eq('id', asset.id)
    .eq('status', 'uploading')
  await admin.storage.from(asset.bucket_id).remove([asset.object_path]).catch(() => {})
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error:'Method not allowed' })
  }

  try {
    let securityAdmin = null
    try { securityAdmin = getAdminSupabase() } catch { /* ambiente de teste/configuração inicial */ }
    const limiter = await enforceRateLimit({
      admin:securityAdmin,
      req,
      scope:'clinical-upload-complete',
      limit:30,
      windowSeconds:60,
    })
    if (rateLimitResponse(res, limiter)) return
    const user = await getAuthenticatedUser(req)
    const assetId = String(req.body?.assetId || '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(assetId)) throw failure('Identificador do arquivo inválido.')

    const admin = getAdminSupabase()
    const { data:asset, error:assetError } = await admin
      .from('clinical_assets')
      .select('id,user_id,patient_id,created_by,bucket_id,object_path,file_name,expected_mime_type,expected_file_size,client_sha256,status')
      .eq('id', assetId)
      .eq('created_by', user.id)
      .eq('status', 'uploading')
      .maybeSingle()
    if (assetError) throw assetError
    if (!asset) throw failure('Upload clínico indisponível para conclusão.', 404)

    const { data:clinic } = await admin.from('clinics').select('id').eq('owner_id', asset.user_id).maybeSingle()
    if (!clinic) throw failure('Clínica do arquivo não encontrada.', 403)
    if (user.id !== asset.user_id) {
      const { data:membership } = await admin.from('clinic_members')
        .select('id')
        .eq('clinic_id', clinic.id)
        .eq('user_id', user.id)
        .eq('clinical_access', true)
        .maybeSingle()
      if (!membership) throw failure('Acesso clínico não autorizado.', 403)
    }

    const { data:file, error:downloadError } = await admin.storage.from(asset.bucket_id).download(asset.object_path)
    if (downloadError || !file) throw failure('O arquivo ainda não foi recebido pelo Storage.')
    const buffer = Buffer.from(await file.arrayBuffer())
    const validation = validateClinicalUpload({
      buffer,
      fileName:asset.file_name,
      expectedMimeType:asset.expected_mime_type,
      expectedFileSize:asset.expected_file_size,
      clientSha256:asset.client_sha256,
    })

    if (!validation.valid) {
      await markFailed(admin, asset)
      return res.status(422).json({ ok:false, error:'O conteúdo do arquivo não corresponde aos metadados informados.' })
    }

    const { data:updated, error:updateError } = await admin
      .from('clinical_assets')
      .update({ status:'available', completed_at:new Date().toISOString(), file_size:validation.observedSize, observed_mime_type:validation.observedMime })
      .eq('id', asset.id)
      .eq('status', 'uploading')
      .select('id')
      .maybeSingle()
    if (updateError) throw updateError
    if (!updated) throw failure('O upload já foi concluído ou alterado.', 409)

    await admin.from('clinical_record_access_logs').insert({
      user_id:asset.user_id,
      patient_id:asset.patient_id,
      actor_id:user.id,
      action:'complete_clinical_asset_upload',
    })
    return res.status(200).json({ ok:true, assetId:asset.id, sha256:validation.sha256, mimeType:validation.observedMime, fileSize:validation.observedSize })
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error:error.statusCode ? error.message : 'Não foi possível validar o upload clínico.' })
  }
}
