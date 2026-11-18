import crypto from 'node:crypto'

export const MIME_BY_EXTENSION = Object.freeze({
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.png':'image/png',
  '.webp':'image/webp',
  '.pdf':'application/pdf',
})

export function extensionOf(fileName) {
  const match = /\.[^.]+$/.exec(String(fileName || '').trim().toLowerCase())
  return match?.[0] || ''
}

export function sniffClinicalMime(buffer) {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

export function validateClinicalUpload({ buffer, fileName, expectedMimeType, expectedFileSize, clientSha256 }) {
  const observedSize = buffer.length
  const observedMime = sniffClinicalMime(buffer)
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const extensionMime = MIME_BY_EXTENSION[extensionOf(fileName)]
  const valid = observedSize === Number(expectedFileSize)
    && observedMime === expectedMimeType
    && extensionMime === expectedMimeType
    && sha256 === String(clientSha256 || '').toLowerCase()
  return { valid, observedSize, observedMime, sha256, extensionMime }
}

