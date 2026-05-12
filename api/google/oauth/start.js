import { getConfig } from '../../_lib/alerts.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error:'Method not allowed' })
  }

  const config = getConfig()
  if (!config.googleClientId || !config.googleRedirectUri) {
    return res.status(500).json({ error:'GOOGLE_CLIENT_ID/GOOGLE_REDIRECT_URI nao configurados' })
  }

  const params = new URLSearchParams({
    client_id:config.googleClientId,
    redirect_uri:config.googleRedirectUri,
    response_type:'code',
    access_type:'offline',
    prompt:'consent',
    scope:'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
    state:'gmail_oauth_setup',
  })

  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
}
