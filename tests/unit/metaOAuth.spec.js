// tests/unit/metaOAuth.spec.js
import { expect, test } from '@playwright/test'
import {
  buildMetaAuthUrl,
  computeMetaTokenExpiresAt,
  exchangeMetaCode,
  exchangeMetaLongLivedToken,
  fetchMetaGrantedAdAccounts,
  fetchMetaGrantedPages,
  getMetaOAuthConfig,
  isMetaOAuthConfigured,
  revokeMetaToken,
} from '../../api/_lib/metaOAuth.js'

const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }

test.afterEach(() => {
  globalThis.fetch = originalFetch
  process.env = { ...originalEnv }
})

const CONFIG = {
  clientId:'app-id-123',
  clientSecret:'app-secret-xyz',
  configId:'config-id-456',
  redirectUri:'https://www.surgimetrics.com.br/api/whatsapp?action=meta-callback',
  graphVersion:'v26.0',
  stateSecret:'segredo',
  appUrl:'https://www.surgimetrics.com.br',
}

test('getMetaOAuthConfig lê das env vars certas; isMetaOAuthConfigured exige todas', () => {
  process.env.META_APP_ID = 'app-id-123'
  process.env.META_APP_SECRET = 'app-secret-xyz'
  process.env.META_CLIENT_CONFIG_ID = 'config-id-456'
  process.env.META_OAUTH_REDIRECT_URI = 'https://www.surgimetrics.com.br/api/whatsapp?action=meta-callback'
  process.env.META_GRAPH_VERSION = 'v26.0'
  process.env.APP_DATA_ENCRYPTION_KEY = 'segredo'
  const config = getMetaOAuthConfig()
  expect(config).toMatchObject({ clientId:'app-id-123', configId:'config-id-456', graphVersion:'v26.0' })
  expect(isMetaOAuthConfigured(config)).toBe(true)
  expect(isMetaOAuthConfigured({ ...config, configId:'' })).toBe(false)
})

test('buildMetaAuthUrl monta a URL do diálogo "Login do Facebook para empresas"', () => {
  const url = buildMetaAuthUrl(CONFIG, 'state-assinada')
  expect(url).toContain('https://www.facebook.com/v26.0/dialog/oauth?')
  expect(url).toContain('client_id=app-id-123')
  expect(url).toContain('config_id=config-id-456')
  expect(url).toContain(`state=${encodeURIComponent('state-assinada')}`)
  expect(url).toContain(`redirect_uri=${encodeURIComponent(CONFIG.redirectUri)}`)
})

test('exchangeMetaCode troca o code pelo token curto', async () => {
  let requestedUrl
  globalThis.fetch = async url => { requestedUrl = String(url); return new Response(JSON.stringify({ access_token:'short-token', token_type:'bearer' }), { status:200 }) }
  const result = await exchangeMetaCode(CONFIG, 'code-abc')
  expect(result.access_token).toBe('short-token')
  expect(requestedUrl).toContain('/oauth/access_token?')
  expect(requestedUrl).toContain('code=code-abc')
})

test('exchangeMetaCode propaga erro da Graph API com o status HTTP', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error:{ message:'Invalid verification code format.' } }), { status:400 })
  await expect(exchangeMetaCode(CONFIG, 'code-invalido')).rejects.toThrow(/Invalid verification code format/)
})

test('exchangeMetaLongLivedToken troca o token curto pelo de longa duração', async () => {
  let requestedUrl
  globalThis.fetch = async url => { requestedUrl = String(url); return new Response(JSON.stringify({ access_token:'long-token', expires_in:5184000 }), { status:200 }) }
  const result = await exchangeMetaLongLivedToken(CONFIG, 'short-token')
  expect(result).toEqual({ access_token:'long-token', expires_in:5184000 })
  expect(requestedUrl).toContain('grant_type=fb_exchange_token')
  expect(requestedUrl).toContain('fb_exchange_token=short-token')
})

test('fetchMetaGrantedPages devolve a lista de Páginas com o token de cada uma', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data:[{ id:'page-1', name:'Clínica A', access_token:'page-token-1' }] }), { status:200 })
  const pages = await fetchMetaGrantedPages(CONFIG, 'long-token')
  expect(pages).toEqual([{ id:'page-1', name:'Clínica A', access_token:'page-token-1' }])
})

test('fetchMetaGrantedPages devolve lista vazia quando a resposta não tem data[]', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status:200 })
  expect(await fetchMetaGrantedPages(CONFIG, 'long-token')).toEqual([])
})

test('fetchMetaGrantedAdAccounts devolve a lista de contas de anúncio', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data:[{ id:'act_1', name:'Conta Principal', account_id:'1' }] }), { status:200 })
  const accounts = await fetchMetaGrantedAdAccounts(CONFIG, 'long-token')
  expect(accounts).toEqual([{ id:'act_1', name:'Conta Principal', account_id:'1' }])
})

test('revokeMetaToken nunca lança, mesmo se a chamada falhar (best-effort)', async () => {
  globalThis.fetch = async () => { throw new Error('rede fora do ar') }
  await expect(revokeMetaToken(CONFIG, 'qualquer-token')).resolves.toBeUndefined()
})

test('computeMetaTokenExpiresAt calcula a partir de expires_in; rejeita valor inválido', () => {
  const now = Date.UTC(2026, 9, 21, 12, 0, 0)
  expect(computeMetaTokenExpiresAt(5184000, now)).toBe(new Date(now + 5184000000).toISOString())
  expect(computeMetaTokenExpiresAt(0, now)).toBeNull()
  expect(computeMetaTokenExpiresAt('não é número', now)).toBeNull()
  expect(computeMetaTokenExpiresAt(undefined, now)).toBeNull()
})
