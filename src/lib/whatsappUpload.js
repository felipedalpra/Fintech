import { supabase } from './supabase.js'
import { mediaTypeFromMime } from './whatsappMediaTypes.js'

export { mediaTypeFromMime } from './whatsappMediaTypes.js'

// Sobe o arquivo direto para o Storage privado e devolve apenas a referência estável.
// O navegador faz o upload (não o endpoint) para não esbarrar no limite de corpo da função.
export async function uploadWhatsAppMedia(file, ownerId, { type } = {}) {
  if (!file) throw new Error('Nenhum arquivo para enviar.')
  const rawExt = (file.name?.split('.').pop() || file.type?.split('/').pop() || '').toLowerCase()
  const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin'
  const rid = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const path = `${ownerId}/${rid}.${ext}`
  const { error } = await supabase.storage.from('wa-media').upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (error) throw new Error(`Falha no upload: ${error.message}`)
  return {
    url: `storage://wa-media/${path}`,
    mime: file.type || null,
    fileName: file.name || path.split('/').pop(),
    type: type || mediaTypeFromMime(file.type),
  }
}
