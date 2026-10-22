// api/_lib/metaOAuth.js
// Cliente OAuth do Meta ("Login do Facebook para empresas"). Funções puras/testáveis —
// quem grava/lê o Supabase é api/whatsapp.js. Nunca loga nem retorna token em mensagem de erro.

const DIALOG_BASE = 'https://www.facebook.com'
const GRAPH_BASE = 'https://graph.facebook.com'

export function getMetaOAuthConfig() {
  return {
    clientId:process.env.META_APP_ID || '',
    clientSecret:process.env.META_APP_SECRET || '',
    configId:process.env.META_CLIENT_CONFIG_ID || '',
    redirectUri:process.env.META_OAUTH_REDIRECT_URI || '',
    graphVersion:process.env.META_GRAPH_VERSION || '',
    stateSecret:process.env.APP_DATA_ENCRYPTION_KEY || '',
    appUrl:(process.env.APP_URL || process.env.VITE_APP_URL || '').replace(/\/+$/, ''),
  }
}

export function isMetaOAuthConfigured(config) {
  return Boolean(config.clientId && config.clientSecret && config.configId && config.redirectUri && config.graphVersion && config.stateSecret)
}

async function metaFetch(url) {
  const res = await fetch(url)
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = {} }
  if (!res.ok) {
    const error = new Error(json.error?.message || `HTTP ${res.status}`)
    error.statusCode = res.status
    error.code = json.error?.code
    throw error
  }
  return json
}

export function buildMetaAuthUrl(config, state) {
  const params = new URLSearchParams({
    client_id:config.clientId,
    redirect_uri:config.redirectUri,
    state,
    response_type:'code',
    config_id:config.configId,
  })
  return `${DIALOG_BASE}/${config.graphVersion}/dialog/oauth?${params.toString()}`
}

export function exchangeMetaCode(config, code) {
  const params = new URLSearchParams({
    client_id:config.clientId,
    redirect_uri:config.redirectUri,
    client_secret:config.clientSecret,
    code,
  })
  return metaFetch(`${GRAPH_BASE}/${config.graphVersion}/oauth/access_token?${params.toString()}`)
}

export function exchangeMetaLongLivedToken(config, shortLivedToken) {
  const params = new URLSearchParams({
    grant_type:'fb_exchange_token',
    client_id:config.clientId,
    client_secret:config.clientSecret,
    fb_exchange_token:shortLivedToken,
  })
  return metaFetch(`${GRAPH_BASE}/${config.graphVersion}/oauth/access_token?${params.toString()}`)
}

export async function fetchMetaGrantedPages(config, longLivedToken) {
  const params = new URLSearchParams({ fields:'id,name,access_token', access_token:longLivedToken })
  const json = await metaFetch(`${GRAPH_BASE}/${config.graphVersion}/me/accounts?${params.toString()}`)
  return Array.isArray(json.data) ? json.data : []
}

export async function fetchMetaGrantedAdAccounts(config, longLivedToken) {
  const params = new URLSearchParams({ fields:'id,name,account_id', access_token:longLivedToken })
  const json = await metaFetch(`${GRAPH_BASE}/${config.graphVersion}/me/adaccounts?${params.toString()}`)
  return Array.isArray(json.data) ? json.data : []
}

// Best-effort: se a Graph API estiver fora do ar, a conexão local é removida de qualquer forma
// (quem chama isso é handleMetaDisconnect, que apaga a linha do banco na sequência).
export async function revokeMetaToken(config, token) {
  try {
    await fetch(`${GRAPH_BASE}/${config.graphVersion}/me/permissions?access_token=${encodeURIComponent(token)}`, { method:'DELETE' })
  } catch { /* best-effort */ }
}

export function computeMetaTokenExpiresAt(expiresInSeconds, now = Date.now()) {
  const seconds = Number(expiresInSeconds)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(now + seconds * 1000).toISOString()
}
