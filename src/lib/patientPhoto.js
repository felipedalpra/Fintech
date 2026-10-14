import { supabase } from './supabase.js'

const BUCKET = 'patient-photos'
const MAX_BYTES = 5 * 1024 * 1024

// Sobe a foto do paciente ao bucket PRIVADO (pasta da clínica) e grava o caminho em patients.photo_path.
// NOME FIXO por paciente (sem extensão) + upsert:true → trocar a foto SOBRESCREVE o mesmo objeto,
// sem deixar a foto antiga órfã no bucket (evita reter dado sensível à toa — LGPD). O content-type
// fica no objeto, então a imagem renderiza certo independente do formato.
export async function uploadPatientPhoto(file, ownerId, patientId) {
  if (!file) return { error: 'Nenhum arquivo selecionado.' }
  if (!ownerId || !patientId) return { error: 'Paciente ou clínica não identificados.' }
  if (!String(file.type || '').startsWith('image/')) return { error: 'Envie uma imagem (JPG, PNG ou WebP).' }
  if (file.size > MAX_BYTES) return { error: 'Imagem muito grande (máx. 5 MB).' }

  const path = `${ownerId}/${patientId}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: true })
  if (up.error) return { error: `Falha no upload: ${up.error.message}` }

  // READ-BACK: confirma que o paciente foi atualizado (RLS permitiu). Senão desfaz o upload.
  const { data, error } = await supabase.from('patients').update({ photo_path: path }).eq('id', patientId).select('id')
  if (error || !data || data.length !== 1) {
    await supabase.storage.from(BUCKET).remove([path]) // não deixa arquivo órfão
    return { error: error?.message || 'Não foi possível salvar a foto (sem permissão ou paciente não encontrado).' }
  }
  return { path }
}

// URL assinada de validade curta (foto é privada; nunca servimos link público).
export async function signedPatientPhotoUrl(path, expiresInSeconds = 3600) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds)
  if (error) return null
  return data?.signedUrl || null
}

// Remove a foto (do storage e do paciente). Zera o photo_path só depois de confirmar (read-back),
// e aborta se a remoção do arquivo falhar (não deixa referência pra arquivo que sumiu).
export async function removePatientPhoto(patientId, path) {
  if (!patientId) return { error: 'Paciente não identificado.' }
  if (path) {
    const rm = await supabase.storage.from(BUCKET).remove([path])
    if (rm.error) return { error: `Falha ao remover a foto: ${rm.error.message}` }
  }
  const { data, error } = await supabase.from('patients').update({ photo_path: null }).eq('id', patientId).select('id')
  if (error || !data || data.length !== 1) return { error: error?.message || 'Não foi possível remover a foto.' }
  return { ok: true }
}
