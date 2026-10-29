import { expect, test } from '@playwright/test'
import {
  BryTokenError,
  bryTokenConfig,
  getBryAccessToken,
  normalizeTokenResponse,
  publicBryTokenState,
  resetBryTokenCache,
} from '../../api/_lib/bryToken.js'

const CLIENT_ID = 'fca2d1d1-0000-4000-8000-000000000001'
const CLIENT_SECRET = 'segredo-da-aplicacao-que-nunca-pode-vazar=='
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJicnkifQ.assinatura'

function env(overrides = {}) {
  return {
    BRY_EASY_SIGN_CLIENT_ID:CLIENT_ID,
    BRY_EASY_SIGN_CLIENT_SECRET:CLIENT_SECRET,
    ...overrides,
  }
}

const config = (overrides = {}) => bryTokenConfig(env(overrides))

function tokenResponse(body = {}, { status = 200 } = {}) {
  return {
    ok:status >= 200 && status < 300,
    status,
    headers:new Map(),
    text:async () => JSON.stringify({
      access_token:ACCESS_TOKEN,
      expires_in:300,
      refresh_token:'refresh',
      refresh_expires_in:1800,
      token_type:'Bearer',
      ...body,
    }),
  }
}

test.beforeEach(() => resetBryTokenCache())

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

test('credenciais de aplicacao sao o caminho oficial e exigem o par completo', () => {
  expect(config().ready).toBe(true)
  expect(config().usesClientCredentials).toBe(true)

  expect(bryTokenConfig(env({ BRY_EASY_SIGN_CLIENT_SECRET:'' })).ready).toBe(false)
  expect(bryTokenConfig(env({ BRY_EASY_SIGN_CLIENT_ID:'' })).ready).toBe(false)
  expect(bryTokenConfig({}).ready).toBe(false)
})

test('token estatico so vale sem credenciais de aplicacao, e elas sempre vencem', () => {
  // O Quickstart de homologacao envia um JWT por e-mail; e o unico caso.
  const staticOnly = bryTokenConfig({ BRY_EASY_SIGN_TOKEN:'jwt-do-quickstart' })
  expect(staticOnly.ready).toBe(true)
  expect(staticOnly.usesClientCredentials).toBe(false)

  const both = bryTokenConfig(env({ BRY_EASY_SIGN_TOKEN:'jwt-antigo' }))
  expect(both.usesClientCredentials).toBe(true)
})

test('a URL de token aceita somente os hosts oficiais da BRy', () => {
  // Padrao: producao sem sufixo, homologacao com -hom.
  expect(config().tokenBaseUrl).toBe('https://cloud.bry.com.br')
  expect(config({ BRY_EASY_SIGN_TOKEN_URL:'https://cloud-hom.bry.com.br' }).tokenBaseUrl).toBe('https://cloud-hom.bry.com.br')

  for (const url of [
    'http://cloud.bry.com.br',
    'https://cloud.bry.com.br.evil.test',
    'https://evil.test',
    'https://user:senha@cloud.bry.com.br',
    'https://cloud.bry.com.br:8443',
    'nao-e-url',
  ]) {
    const candidate = config({ BRY_EASY_SIGN_TOKEN_URL:url })
    expect(candidate.ready, url).toBe(false)
    expect(candidate.tokenBaseUrl, url).toBe('')
  }
})

test('o estado publico confirma a autenticacao sem revelar credencial', () => {
  const state = publicBryTokenState(config())
  expect(state).toEqual({ configured:true, mode:'client_credentials' })
  const serialized = JSON.stringify(state)
  expect(serialized).not.toContain(CLIENT_SECRET)
  expect(serialized).not.toContain(CLIENT_ID)
})

// ---------------------------------------------------------------------------
// Normalizacao
// ---------------------------------------------------------------------------

test('a validade e encurtada por folga, para o token nao vencer durante a chamada', () => {
  const now = 1_000_000
  const result = normalizeTokenResponse({ access_token:ACCESS_TOKEN, expires_in:300 }, { now })
  expect(result.accessToken).toBe(ACCESS_TOKEN)
  // 300s menos 30s de folga.
  expect(result.expiresAt).toBe(now + 270_000)
})

test('expires_in ausente, invalido ou absurdo nao vira validade longa', () => {
  const now = 1_000_000
  for (const expiresIn of [undefined, 0, -10, 'abc', null]) {
    const result = normalizeTokenResponse({ access_token:ACCESS_TOKEN, expires_in:expiresIn }, { now })
    // Cai para 60s, nao para "para sempre".
    expect(result.expiresAt, String(expiresIn)).toBe(now + 30_000)
  }
  // Teto defensivo de 1 hora.
  const huge = normalizeTokenResponse({ access_token:ACCESS_TOKEN, expires_in:99_999 }, { now })
  expect(huge.expiresAt).toBe(now + (3600 - 30) * 1000)
})

test('resposta sem access_token e recusada', () => {
  expect(() => normalizeTokenResponse({ expires_in:300 })).toThrow(/token de acesso/)
  expect(() => normalizeTokenResponse({})).toThrow(/token de acesso/)
})

// ---------------------------------------------------------------------------
// Troca e cache
// ---------------------------------------------------------------------------

test('a troca usa client_credentials em form-urlencoded, no endpoint oficial', async () => {
  let captured = null
  const token = await getBryAccessToken(config(), {
    fetchImpl:async (url, init) => { captured = { url, init }; return tokenResponse() },
  })
  expect(token).toBe(ACCESS_TOKEN)
  expect(captured.url).toBe('https://cloud.bry.com.br/token-service/jwt')
  expect(captured.init.method).toBe('POST')
  expect(captured.init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  expect(captured.init.redirect).toBe('manual')

  const body = new URLSearchParams(captured.init.body)
  expect(body.get('grant_type')).toBe('client_credentials')
  expect(body.get('client_id')).toBe(CLIENT_ID)
  expect(body.get('client_secret')).toBe(CLIENT_SECRET)
  // A credencial nunca vai na URL.
  expect(captured.url).not.toContain(CLIENT_SECRET)
  expect(captured.url).not.toContain(CLIENT_ID)
})

test('o token e reaproveitado enquanto vale e renovado quando expira', async () => {
  let calls = 0
  const fetchImpl = async () => { calls += 1; return tokenResponse({ expires_in:300 }) }
  const settings = config()

  await getBryAccessToken(settings, { fetchImpl })
  await getBryAccessToken(settings, { fetchImpl })
  await getBryAccessToken(settings, { fetchImpl })
  expect(calls).toBe(1)

  // Passado o prazo util, pede outro em vez de reusar um token vencido.
  await getBryAccessToken(settings, { fetchImpl, now:Date.now() + 400_000 })
  expect(calls).toBe(2)
})

test('chamadas concorrentes compartilham uma unica troca de token', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    await new Promise(resolve => setTimeout(resolve, 20))
    return tokenResponse()
  }
  const settings = config()
  const tokens = await Promise.all([
    getBryAccessToken(settings, { fetchImpl }),
    getBryAccessToken(settings, { fetchImpl }),
    getBryAccessToken(settings, { fetchImpl }),
  ])
  expect(calls).toBe(1)
  expect(new Set(tokens)).toEqual(new Set([ACCESS_TOKEN]))
})

test('uma falha nao fica grudada no cache: a proxima chamada tenta de novo', async () => {
  let calls = 0
  const settings = config()
  const failing = async () => { calls += 1; throw new Error('ECONNREFUSED') }
  await expect(getBryAccessToken(settings, { fetchImpl:failing })).rejects.toThrow()

  const ok = await getBryAccessToken(settings, { fetchImpl:async () => { calls += 1; return tokenResponse() } })
  expect(ok).toBe(ACCESS_TOKEN)
  expect(calls).toBe(2)
})

test('token estatico nao dispara nenhuma chamada de rede', async () => {
  let called = false
  const token = await getBryAccessToken(
    bryTokenConfig({ BRY_EASY_SIGN_TOKEN:'jwt-do-quickstart' }),
    { fetchImpl:async () => { called = true } },
  )
  expect(token).toBe('jwt-do-quickstart')
  expect(called).toBe(false)
})

test('erros de autenticacao sao classificados e NUNCA ecoam o client_secret', async () => {
  for (const [status, kind] of [[400, 'auth'], [401, 'auth'], [403, 'auth'], [429, 'rate_limit'], [500, 'provider']]) {
    const error = await getBryAccessToken(config(), {
      fetchImpl:async () => ({
        ok:false,
        status,
        headers:new Map(),
        // A BRy pode ecoar a requisicao inteira no erro.
        text:async () => `erro em grant_type=client_credentials&client_secret=${CLIENT_SECRET}`,
      }),
    }).catch(nextError => nextError)
    expect(error, String(status)).toBeInstanceOf(BryTokenError)
    expect(error.kind, String(status)).toBe(kind)
    expect(error.message, String(status)).not.toContain(CLIENT_SECRET)
    expect(error.message, String(status)).not.toContain(CLIENT_ID)
  }
})

test('timeout, rede, redirecionamento e corpo ilegivel sao classificados', async () => {
  const aborting = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name:'AbortError' })))
  })
  const timedOut = await getBryAccessToken(config({ BRY_EASY_SIGN_TOKEN_TIMEOUT_MS:'1000' }), { fetchImpl:aborting })
    .catch(error => error)
  expect(timedOut.kind).toBe('timeout')

  const offline = await getBryAccessToken(config(), { fetchImpl:async () => { throw new Error('ECONNREFUSED') } })
    .catch(error => error)
  expect(offline.kind).toBe('network')

  const redirected = await getBryAccessToken(config(), {
    fetchImpl:async () => ({ ok:false, status:302, headers:new Map(), text:async () => '' }),
  }).catch(error => error)
  expect(redirected.kind).toBe('invalid_response')

  const garbled = await getBryAccessToken(config(), {
    fetchImpl:async () => ({ ok:true, status:200, headers:new Map(), text:async () => 'nao-json' }),
  }).catch(error => error)
  expect(garbled.kind).toBe('invalid_response')
})

test('sem configuracao valida nenhuma chamada acontece', async () => {
  let called = false
  const error = await getBryAccessToken(bryTokenConfig({}), { fetchImpl:async () => { called = true } })
    .catch(nextError => nextError)
  expect(error.kind).toBe('config')
  expect(called).toBe(false)
})
