import {
  decryptPayload,
  encryptPayload,
  fetchEncryptedProfile,
  getAuthenticatedUser,
  insertProfileAuditLog,
  profileMeta,
  sanitizeProfilePayload,
  saveEncryptedProfile,
} from './_lib/secureProfile.js'

// Endpoint consolidado do perfil seguro (antes eram 2 funções: get.js e save.js).
// Roteado por ?action=get|save para caber no limite de 12 funções do plano Hobby da Vercel.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const action = req.query.action || 'get'

  try {
    const user = await getAuthenticatedUser(req)

    if (action === 'save') {
      const sanitized = sanitizeProfilePayload(req.body?.profile)
      const encrypted = encryptPayload(sanitized)
      const meta = profileMeta(sanitized)
      await saveEncryptedProfile(user.id, encrypted, meta)
      await insertProfileAuditLog(user.id, 'update_secure_profile', meta)
      return res.status(200).json({ ok: true })
    }

    if (action === 'get') {
      const record = await fetchEncryptedProfile(user.id)
      const profile = record?.encrypted_payload ? decryptPayload(record.encrypted_payload) : null
      return res.status(200).json({ profile })
    }

    res.setHeader('Allow', 'POST')
    return res.status(400).json({ error: 'Ação inválida. Use ?action=get ou ?action=save.' })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Nao foi possivel processar o perfil seguro.' })
  }
}
