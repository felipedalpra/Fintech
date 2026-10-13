import { supabase } from './supabase.js'

// Tipo de mensagem a partir do MIME do arquivo (imagem vs documento).
export function mediaTypeFromMime(mime) {
  return String(mime || '').startsWith('image/') ? 'image' : 'document'
}

// Sobe o arquivo direto para o Storage (bucket wa-media) e devolve a URL pública + metadados.
// O navegador faz o upload (não o endpoint) para não esbarrar no limite de corpo da função.
export async function uploadWhatsAppMedia(file, ownerId, { type } = {}) {
  if (!file) throw new Error('Nenhum arquivo para enviar.')
  const ext = (file.name?.split('.').pop() || (file.type?.split('/').pop()) || 'bin').toLowerCase()
  const rid = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const path = `${ownerId}/${rid}.${ext}`
  const { error } = await supabase.storage.from('wa-media').upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (error) throw new Error(`Falha no upload: ${error.message}`)
  const { data } = supabase.storage.from('wa-media').getPublicUrl(path)
  return {
    url: data.publicUrl,
    mime: file.type || null,
    fileName: file.name || path.split('/').pop(),
    type: type || mediaTypeFromMime(file.type),
  }
}
