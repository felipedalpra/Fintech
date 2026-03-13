import { decryptPayload, fetchEncryptedProfile, getAuthenticatedUser } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error:'Method not allowed' })
  }

  try {
    const user = await getAuthenticatedUser(req)
    const record = await fetchEncryptedProfile(user.id)
    const profile = record?.encrypted_payload ? decryptPayload(record.encrypted_payload) : null
    return res.status(200).json({ profile })
  } catch (error) {
    return res.status(500).json({ error:error.message || 'Nao foi possivel carregar o perfil seguro.' })
  }
}
