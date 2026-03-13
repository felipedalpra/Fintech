import { encryptPayload, getAuthenticatedUser, insertProfileAuditLog, profileMeta, sanitizeProfilePayload, saveEncryptedProfile } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error:'Method not allowed' })
  }

  try {
    const user = await getAuthenticatedUser(req)
    const sanitized = sanitizeProfilePayload(req.body?.profile)
    const encrypted = encryptPayload(sanitized)
    const meta = profileMeta(sanitized)

    await saveEncryptedProfile(user.id, encrypted, meta)
    await insertProfileAuditLog(user.id, 'update_secure_profile', meta)

    return res.status(200).json({ ok:true })
  } catch (error) {
    return res.status(500).json({ error:error.message || 'Nao foi possivel salvar o perfil seguro.' })
  }
}
