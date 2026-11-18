import { createAdminClient, getConfig } from '../../_lib/alerts.js'
import { verifyState } from '../../_lib/oauthState.js'

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw:text } }
  if (!res.ok) throw new Error(json.error_description || json.error || `HTTP ${res.status}`)
  return json
}

async function assertClinicOwner(admin, userId) {
  const { data, error } = await admin
    .from('clinics')
    .select('id')
    .eq('owner_id', userId)
    .limit(1)
  if (error) throw error
  if (!data?.length) throw new Error('Somente o proprietário da clínica pode conectar o Gmail.')
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error:'Method not allowed' })
  }

  try {
    const config = getConfig()
    if (!config.googleClientId || !config.googleClientSecret || !config.googleRedirectUri || !config.googleStateSecret) {
      return res.status(500).json({ error:'Configuração OAuth do Gmail incompleta' })
    }
    const actorUserId = verifyState(String(req.query?.state || ''), config.googleStateSecret, Date.now(), 'gmail')
    if (!actorUserId) return res.status(400).json({ error:'Estado OAuth inválido ou expirado' })
    const code = String(req.query?.code || '')
    if (!code) return res.status(400).json({ error:'Missing code' })

    const admin = createAdminClient(config)
    await assertClinicOwner(admin, actorUserId)

    const token = await fetchJson('https://oauth2.googleapis.com/token', {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body:new URLSearchParams({
        code,
        client_id:config.googleClientId,
        client_secret:config.googleClientSecret,
        redirect_uri:config.googleRedirectUri,
        grant_type:'authorization_code',
      }),
    })

    if (!token.refresh_token) {
      return res.status(400).json({
        error:'Google nao retornou refresh_token. Revogue o app e reconecte com prompt=consent.',
      })
    }

    const profile = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers:{ Authorization:`Bearer ${token.access_token}` },
    })

    const { error } = await admin
      .from('google_oauth_tokens')
      .upsert({
        provider:'gmail',
        account_email:profile.emailAddress || null,
        refresh_token:token.refresh_token,
        scope:token.scope || null,
        connected_by:actorUserId,
        updated_at:new Date().toISOString(),
      }, { onConflict:'provider' })

    if (error) throw error

    return res.status(200).send('<h2>Gmail conectado com sucesso.</h2><p>Você já pode rodar o cron de alertas.</p>')
  } catch (error) {
    return res.status(500).json({ error:'Não foi possível concluir a conexão com o Gmail.' })
  }
}
