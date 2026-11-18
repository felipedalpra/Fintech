import { getConfig } from '../../_lib/alerts.js'
import { getAuthenticatedUser } from '../../_lib/secureProfile.js'
import { signState } from '../../_lib/oauthState.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error:'Method not allowed' })
  }

  let user
  try {
    user = await getAuthenticatedUser(req)
  } catch {
    return res.status(401).json({ error:'Sessão obrigatória' })
  }

  const config = getConfig()
  if (!config.googleClientId || !config.googleRedirectUri || !config.googleStateSecret) {
    return res.status(500).json({ error:'Configuração OAuth do Gmail incompleta' })
  }

  const params = new URLSearchParams({
    client_id:config.googleClientId,
    redirect_uri:config.googleRedirectUri,
    response_type:'code',
    access_type:'offline',
    prompt:'consent',
    scope:'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
    state:signState(user.id, config.googleStateSecret, Date.now(), 'gmail'),
  })

  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
}
