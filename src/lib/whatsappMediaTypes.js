export function mediaTypeFromMime(mime) {
  const value = String(mime || '').toLowerCase()
  if (value.startsWith('image/')) return 'image'
  if (value.startsWith('video/')) return 'video'
  if (value.startsWith('audio/')) return 'audio'
  return 'document'
}
