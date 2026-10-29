// api/_lib/bryToken.js
// Obtencao e renovacao do JWT de acesso da BRy.
//
// Por que existe: a documentacao de autenticacao da BRy e explicita em que o
// `access_token` "tem validade de alguns minutos" e que a aplicacao deve
// renova-lo automaticamente. Guardar um JWT fixo em variavel de ambiente
// pararia de funcionar poucos minutos depois de configurado.
//
// Contrato conferido na documentacao oficial em 29/10/2026:
//   POST {cloud}/token-service/jwt        (application/x-www-form-urlencoded)
//     grant_type=client_credentials, client_id, client_secret
//   Resposta 200: access_token, expires_in, refresh_token, refresh_expires_in,
//                 token_type, policy, session_state, scope
//
// Hosts: https://cloud.bry.com.br (producao) e https://cloud-hom.bry.com.br
// (homologacao). O `client_secret` nao expira e e segredo de servidor: vive
// somente em variavel protegida, nunca em banco, log ou resposta de API.

const TOKEN_PATH = '/token-service/jwt'
const DEFAULT_TIMEOUT_MS = 15_000

// Renova com folga: um token que expira durante a chamada seguinte e tao ruim
// quanto um token expirado.
const EXPIRY_SKEW_SECONDS = 30
// Teto defensivo caso a BRy devolva um expires_in absurdo.
const MAX_CACHE_SECONDS = 3600

export const BRY_TOKEN_HOSTS = Object.freeze({
  'cloud.bry.com.br':'production',
  'cloud-hom.bry.com.br':'homologation',
})

export class BryTokenError extends Error {
  constructor(message, { kind = 'provider', statusCode = null } = {}) {
    super(message)
    this.name = 'BryTokenError'
    this.kind = kind
    this.statusCode = statusCode
  }
}

// Cache em memoria do processo. Em serverless cada instancia quente reaproveita
// o token ate expirar; uma instancia fria simplesmente pede outro. O token
// nunca e persistido.
const tokenCache = new Map()

export function resetBryTokenCache() {
  tokenCache.clear()
}

export function bryTokenConfig(env = process.env) {
  const read = name => String(env[name] || '').trim()
  const problems = []

  const clientId = read('BRY_EASY_SIGN_CLIENT_ID')
  const clientSecret = read('BRY_EASY_SIGN_CLIENT_SECRET')
  // Token estatico so serve ao Quickstart de homologacao, que envia o JWT por
  // e-mail. Credenciais de aplicacao, quando existem, sempre vencem.
  const staticToken = read('BRY_EASY_SIGN_TOKEN')

  const tokenUrlRaw = read('BRY_EASY_SIGN_TOKEN_URL') || 'https://cloud.bry.com.br'
  let tokenBaseUrl = ''
  try {
    const url = new URL(tokenUrlRaw)
    if (url.protocol !== 'https:' || url.username || url.password
      || (url.port && url.port !== '443') || !BRY_TOKEN_HOSTS[url.hostname.toLowerCase()]) {
      problems.push('BRY_EASY_SIGN_TOKEN_URL fora da allowlist oficial da BRy')
    } else {
      tokenBaseUrl = url.origin
    }
  } catch {
    problems.push('BRY_EASY_SIGN_TOKEN_URL invalida')
  }

  const usesClientCredentials = Boolean(clientId && clientSecret)
  if (!usesClientCredentials && !staticToken) {
    problems.push('Configure BRY_EASY_SIGN_CLIENT_ID e BRY_EASY_SIGN_CLIENT_SECRET')
  }
  if (clientId && !clientSecret) problems.push('BRY_EASY_SIGN_CLIENT_SECRET nao configurado')
  if (clientSecret && !clientId) problems.push('BRY_EASY_SIGN_CLIENT_ID nao configurado')

  const timeoutRaw = Number(read('BRY_EASY_SIGN_TOKEN_TIMEOUT_MS') || DEFAULT_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 60_000
    ? Math.floor(timeoutRaw)
    : DEFAULT_TIMEOUT_MS

  return {
    ready:problems.length === 0 && Boolean(tokenBaseUrl),
    problems,
    usesClientCredentials,
    clientId,
    clientSecret,
    staticToken,
    tokenBaseUrl,
    timeoutMs,
  }
}

// Visao segura: confirma que ha autenticacao configurada sem revelar nada.
export function publicBryTokenState(config) {
  return {
    configured:Boolean(config?.ready),
    mode:config?.ready ? (config.usesClientCredentials ? 'client_credentials' : 'static_token') : null,
  }
}

export function normalizeTokenResponse(payload, { now = Date.now() } = {}) {
  const accessToken = String(payload?.access_token || '').trim()
  if (!accessToken) {
    throw new BryTokenError('A BRy nao devolveu o token de acesso.', { kind:'invalid_response' })
  }
  const expiresInRaw = Number(payload?.expires_in)
  // Sem expires_in utilizavel, tratamos como token de vida muito curta em vez
  // de assumir uma validade longa que nao foi informada.
  const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 0
    ? Math.min(expiresInRaw, MAX_CACHE_SECONDS)
    : 60
  const usableSeconds = Math.max(expiresIn - EXPIRY_SKEW_SECONDS, 5)
  return { accessToken, expiresAt:now + usableSeconds * 1000 }
}

async function requestToken(config, { fetchImpl = fetch } = {}) {
  const body = new URLSearchParams({
    grant_type:'client_credentials',
    client_id:config.clientId,
    client_secret:config.clientSecret,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  let response
  try {
    response = await fetchImpl(`${config.tokenBaseUrl}${TOKEN_PATH}`, {
      method:'POST',
      headers:{
        'Content-Type':'application/x-www-form-urlencoded',
        Accept:'application/json',
      },
      body:body.toString(),
      signal:controller.signal,
      redirect:'manual',
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new BryTokenError('A BRy nao respondeu ao pedido de token.', { kind:'timeout' })
    }
    throw new BryTokenError('Nao foi possivel contatar a autenticacao da BRy.', { kind:'network' })
  } finally {
    clearTimeout(timer)
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    throw new BryTokenError('A autenticacao da BRy redirecionou a chamada.', { kind:'invalid_response' })
  }
  if (!response.ok) {
    // O corpo do erro pode ecoar a requisicao, que contem o client_secret.
    // Nada dele e propagado: so o status.
    const kind = response.status === 400 || response.status === 401 || response.status === 403
      ? 'auth' : response.status === 429 ? 'rate_limit' : 'provider'
    throw new BryTokenError(
      kind === 'auth'
        ? 'A BRy recusou as credenciais da aplicacao.'
        : 'A autenticacao da BRy esta indisponivel.',
      { kind, statusCode:response.status },
    )
  }

  let payload
  try {
    payload = JSON.parse((await response.text()) || '{}')
  } catch {
    throw new BryTokenError('A autenticacao da BRy devolveu resposta ilegivel.', { kind:'invalid_response' })
  }
  return normalizeTokenResponse(payload)
}

// Devolve um JWT valido, reaproveitando o cache enquanto ele durar.
// Chamadas concorrentes compartilham a mesma promessa, para nao disparar varias
// trocas de token ao mesmo tempo.
export async function getBryAccessToken(config, options = {}) {
  if (!config?.ready) {
    throw new BryTokenError('Autenticacao da BRy nao configurada.', { kind:'config' })
  }
  if (!config.usesClientCredentials) return config.staticToken

  const now = options.now ?? Date.now()
  const key = `${config.tokenBaseUrl}:${config.clientId}`
  const cached = tokenCache.get(key)
  if (cached?.accessToken && cached.expiresAt > now) return cached.accessToken
  if (cached?.pending) return cached.pending

  const pending = requestToken(config, options)
    .then(result => {
      tokenCache.set(key, { accessToken:result.accessToken, expiresAt:result.expiresAt })
      return result.accessToken
    })
    .catch(error => {
      tokenCache.delete(key)
      throw error
    })

  tokenCache.set(key, { pending })
  return pending
}
