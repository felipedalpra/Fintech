# Conexão Meta Ads via OAuth — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o preenchimento manual de Ad Account ID/Page ID/token (em Configurações → Meta Ads) por um botão "Continuar com Facebook" self-serve, pra que conectar uma clínica nova ao Meta Ads não exija mais dar acesso de admin no Business Manager dela.

**Architecture:** Reaproveita 1:1 o padrão OAuth já implementado (e testado) pro Google Agenda nesta base — `state` HMAC assinada (CSRF), token sempre criptografado (`encryptPayload`/`decryptPayload`), tudo dentro do `api/whatsapp.js` já existente (zero função serverless nova — a Vercel Hobby já está em 12/12). Usa o produto "Login do Facebook para empresas" do Meta (`config_id`), que permite autorizar mais de uma Página/Conta de Anúncio de uma vez; como o modelo de dados só suporta uma de cada por clínica, um estado intermediário `selecionando` entra em cena quando isso acontece, com uma telinha de confirmação própria (nunca expõe token de Página ao navegador).

**Tech Stack:** React 18 + Vite, Supabase (Postgres + RLS), Vercel serverless (Node, ESM), Meta Graph API v26.0 via `fetch`, Playwright (unit + e2e via configs separadas).

**Spec:** `docs/superpowers/specs/2026-10-21-meta-oauth-connection-design.md`

## Refinamentos em relação à spec (decididos ao escrever o plano)

1. **Mais uma variável de ambiente que a spec não citou:** `META_APP_ID` (o App ID, `2320852098755834` — não é segredo, mas precisa estar no servidor pra montar a URL do diálogo e pras trocas de token). A spec só citava `META_CLIENT_CONFIG_ID`/`META_OAUTH_REDIRECT_URI` como novas; essa é a terceira.
2. **`?action=meta-connect` é POST que devolve `{ url }`, não um redirect de servidor.** O botão precisa mandar o Bearer token (sessão Supabase) pra assinar a `state`, e isso não dá pra fazer numa navegação de browser simples. O front chama `fetch` autenticado e só então faz `window.location.assign(url)` — exatamente como o Google Agenda já faz (`useGoogleCalendarSync.js:95-97`), que é o padrão já comprovado nesta base.
3. **Novo endpoint `?action=meta-pending`:** durante `status:'selecionando'`, o front precisa mostrar o NOME das Páginas/Contas pra pessoa escolher, mas o token de cada uma fica criptografado no servidor. Esse endpoint devolve só `{id, name}` de cada opção, nunca o token — não dava pra resolver isso só com `meta-select` (que só recebe a escolha, não lista as opções).
4. **`meta_connections` deixa de ser gravável pelo frontend.** Hoje (`meta_integration_schema.sql`) o frontend tem `insert`/`update` liberado em `ad_account_id`/`page_id`/`access_token`. Com o OAuth, só o backend (service role) escreve nessa tabela — igual ao `google_calendar_connections`, que já segue esse modelo. Os grants de INSERT/UPDATE pra `authenticated` são revogados.
5. **`signState`/`verifyState` saem de `api/_lib/googleCalendar.js` para um novo `api/_lib/oauthState.js` genérico**, reexportado de volta em `googleCalendar.js` pra não quebrar `api/google/calendar.js` nem `tests/unit/googleCalendarServer.spec.js`. Evita duplicar lógica de CSRF/criptografia entre Google e Meta.

## Pré-requisito (fora deste plano, já em andamento)

O app novo do Meta ("SurgiMetrics", dentro do Business Manager verificado da Zentri Tech) e o webhook de `leadgen` já foram configurados manualmente numa sessão anterior. `META_APP_SECRET`, `META_VERIFY_TOKEN` e `META_GRAPH_VERSION` já estão cadastrados na Vercel. Falta, antes do deploy desta feature:
- Criar a configuração **"Login do Facebook para empresas"** no painel do app (Casos de uso → Login do Facebook para empresas → Criar configuração), com as permissões `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `leads_retrieval`, `ads_read`, `business_management` — anotar o `config_id` gerado.
- Cadastrar a URL de redirecionamento válida no painel: `https://www.surgimetrics.com.br/api/whatsapp?action=meta-callback`.

## Ordem de deploy (IMPORTANTE)

1. Aplicar `supabase/meta_oauth_connection_schema.sql` no Supabase **antes** de publicar o código (o backend novo lê/grava colunas que só existem depois dessa migration).
2. Cadastrar na Vercel (Production): `META_APP_ID`, `META_CLIENT_CONFIG_ID`, `META_OAUTH_REDIRECT_URI`.
3. Publicar o código.

## Mapa de arquivos

**Criar:**
- `supabase/meta_oauth_connection_schema.sql`
- `api/_lib/oauthState.js`
- `api/_lib/metaOAuth.js`
- `src/lib/metaOAuthClient.js`
- `tests/unit/metaOAuth.spec.js`
- `tests/unit/metaInsightsExpiry.spec.js`
- `tests/e2e/meta-connection.spec.js`

**Modificar:**
- `api/_lib/googleCalendar.js` (reexporta `signState`/`verifyState` de `oauthState.js`)
- `api/whatsapp.js` (5 ações novas + decrypt no webhook)
- `api/_lib/metaInsights.js` (decrypt no sync)
- `src/components/MetaConnection.jsx` (reescrita completa)
- `src/components/Settings.jsx` (auto-seleciona a aba `meta` quando a URL volta com `?meta=`)
- `CHANGELOG.md`, `PROJECT_MEMORY.md`, `docs/PENDENCIAS_CLIENTE.md`

---

### Task 1: Migration SQL

**Files:**
- Create: `supabase/meta_oauth_connection_schema.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- meta_oauth_connection_schema.sql
-- Conexão Meta Ads via OAuth ("Login do Facebook para empresas"), substituindo o
-- preenchimento manual de Ad Account ID / Page ID / token. Aditivo e idempotente.
-- Executar DEPOIS de meta_integration_schema.sql.

begin;

alter table public.meta_connections
  add column if not exists access_token_encrypted jsonb,
  add column if not exists token_expires_at timestamptz,
  add column if not exists connected_by uuid references auth.users(id) on delete set null,
  add column if not exists fb_user_id text;

-- Linhas antigas com token em texto puro (configuração manual anterior) nunca são
-- "promovidas" silenciosamente a criptografadas: força reconexão explícita.
update public.meta_connections
set status = 'erro'
where access_token is not null
  and access_token_encrypted is null;

alter table public.meta_connections drop column if exists access_token;

alter table public.meta_connections drop constraint if exists meta_connections_status_check;
do $$ begin
  alter table public.meta_connections
    add constraint meta_connections_status_check
    check (status in ('desconectado', 'configurado', 'conectado', 'erro', 'selecionando', 'expirando'));
exception when duplicate_object then null; end $$;

-- O frontend deixa de escrever nesta tabela: tudo passa pelo backend (service role),
-- igual ao padrão já usado em google_calendar_connections.
revoke insert, update, delete on public.meta_connections from authenticated;
revoke select on public.meta_connections from authenticated;
grant select (id, user_id, ad_account_id, page_id, status, token_expires_at, created_at, updated_at)
  on public.meta_connections to authenticated;
grant all on public.meta_connections to service_role;

commit;

-- Verificação pós-migração (executar separadamente): deve retornar zero linhas.
-- select id, user_id from public.meta_connections where status = 'erro' and access_token_encrypted is null;
```

- [ ] **Step 2: Confirmar que não quebra nada que já lê `meta_connections`**

Rode:
```bash
grep -rn "from('meta_connections')\|\"meta_connections\"" api src --include="*.js" --include="*.jsx"
```
Expected: só aparecem `api/whatsapp.js` (`handleMetaWebhook`, e as novas funções que você vai criar nas próximas tasks) e `api/_lib/metaInsights.js` (`syncMetaInsights`) — ambos serão corrigidos nas Tasks 5 e 6 pra não usar mais `access_token`. Se aparecer algum outro arquivo lendo `access_token` diretamente, pare e trate antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add supabase/meta_oauth_connection_schema.sql
git commit -m "docs: migration da conexão Meta Ads via OAuth"
```

(Não execute esta migration no Supabase ainda — isso é feito manualmente, na ordem descrita em "Ordem de deploy" acima, depois que todo o código deste plano estiver pronto e revisado.)

---

### Task 2: Extrair `signState`/`verifyState` para um módulo genérico

**Files:**
- Create: `api/_lib/oauthState.js`
- Modify: `api/_lib/googleCalendar.js:1-3, 77-98`
- Test (já existe, não muda): `tests/unit/googleCalendarServer.spec.js`

- [ ] **Step 1: Criar o módulo genérico com o código movido de `googleCalendar.js`**

```js
// api/_lib/oauthState.js
// CSRF state genérica pra fluxos OAuth (Google Agenda, Meta Ads, etc.): HMAC assinado
// com TTL curto. Carrega só o id do usuário que iniciou o fluxo — nunca dado sensível.
import crypto from 'crypto'

const STATE_TTL_MS = 10 * 60 * 1000

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url')
}

export function signState(userId, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ uid:userId, exp:now + STATE_TTL_MS })).toString('base64url')
  return `${body}.${sign(body, secret)}`
}

export function verifyState(state, secret, now = Date.now()) {
  const [body, signature] = String(state || '').split('.')
  if (!body || !signature) return null
  const expected = Buffer.from(sign(body, secret))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return parsed.exp > now ? parsed.uid : null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Remover o código duplicado de `googleCalendar.js` e reexportar**

Em `api/_lib/googleCalendar.js`, linha 1 (`import crypto from 'crypto'`) e linhas 77-98 (a função `sign` local e `signState`/`verifyState`) saem. No lugar, logo abaixo da linha 3 (`const STATE_TTL_MS = ...`, que também sai por não ser mais usada aqui), adicione:

```js
export { signState, verifyState } from './oauthState.js'
```

O `import crypto from 'crypto'` no topo do arquivo só pode ser removido se nada mais em `googleCalendar.js` usar `crypto` — confira com `grep -n "crypto\." api/_lib/googleCalendar.js` antes de remover o import; se algo mais no arquivo (fora de `sign`/`signState`/`verifyState`) ainda usar `crypto`, mantenha o import.

- [ ] **Step 3: Rodar o teste existente pra confirmar que nada quebrou (não é feature nova, é extração)**

```bash
npx playwright test -c playwright.unit.config.js tests/unit/googleCalendarServer.spec.js
```
Expected: PASS, mesmos testes de antes (`signState`/`verifyState` continuam se comportando idêntico, só mudou de onde o código mora).

- [ ] **Step 4: Commit**

```bash
git add api/_lib/oauthState.js api/_lib/googleCalendar.js
git commit -m "refactor: extrai signState/verifyState pra módulo OAuth genérico"
```

---

### Task 3: `api/_lib/metaOAuth.js` (funções puras do OAuth do Meta)

**Files:**
- Create: `api/_lib/metaOAuth.js`
- Test: `tests/unit/metaOAuth.spec.js`

- [ ] **Step 1: Escrever o teste (vai falhar — o módulo ainda não existe)**

```js
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
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha (módulo não existe ainda)**

```bash
npx playwright test -c playwright.unit.config.js tests/unit/metaOAuth.spec.js
```
Expected: FAIL — `Cannot find module '../../api/_lib/metaOAuth.js'`.

- [ ] **Step 3: Implementar `api/_lib/metaOAuth.js`**

```js
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
```

- [ ] **Step 4: Rodar o teste de novo, confirmar que passa**

```bash
npx playwright test -c playwright.unit.config.js tests/unit/metaOAuth.spec.js
```
Expected: todos os testes PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/metaOAuth.js tests/unit/metaOAuth.spec.js
git commit -m "feat: cliente OAuth do Meta (login do Facebook para empresas)"
```

---

### Task 4: 5 ações novas em `api/whatsapp.js`

**Files:**
- Modify: `api/whatsapp.js` (imports no topo, dispatcher em `handler`, novas funções)

- [ ] **Step 1: Adicionar os imports novos no topo do arquivo**

Logo abaixo da linha `import { parseLeadgenWebhook, verifyWebhookSignature, mapLeadFields, fetchLeadData } from './_lib/meta.js'` (linha 33), adicione:

```js
import { decryptPayload, encryptPayload } from './_lib/secureProfile.js'
import { signState, verifyState } from './_lib/oauthState.js'
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
} from './_lib/metaOAuth.js'
```

- [ ] **Step 2: Registrar as 5 novas ações no dispatcher**

Em `handler`, logo após a linha `if (action === 'meta-sync') return handleMetaSync(req, res)` (linha 397), adicione:

```js
  if (action === 'meta-connect') return handleMetaConnect(req, res)
  if (action === 'meta-callback') return handleMetaOAuthCallback(req, res)
  if (action === 'meta-pending') return handleMetaPending(req, res)
  if (action === 'meta-select') return handleMetaSelect(req, res)
  if (action === 'meta-disconnect') return handleMetaDisconnect(req, res)
```

- [ ] **Step 3: Implementar as 5 funções**

Logo acima do comentário `// ---- Meta Ads: webhook de Lead Ads (leadgen) → cria oportunidade no pipeline ----` (linha 949), adicione:

```js
// ---- Meta Ads: conexão OAuth ("Login do Facebook para empresas") ----
// Mesmo padrão do Google Agenda (api/google/calendar.js): state HMAC assinada, token sempre
// criptografado, frontend nunca lê nem escreve token. Fica aqui (não em api/meta.js) pelo mesmo
// motivo do webhook/sync acima — teto de 12 funções serverless do Vercel Hobby (já no limite).

async function handleMetaConnect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await authenticatedAdmin(req)
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message })
  const config = getMetaOAuthConfig()
  if (!isMetaOAuthConfigured(config)) return res.status(503).json({ error: 'Integração Meta Ads não configurada.' })
  const state = signState(auth.user.id, config.stateSecret)
  return res.status(200).json({ url: buildMetaAuthUrl(config, state) })
}

async function handleMetaOAuthCallback(req, res) {
  const config = getMetaOAuthConfig()
  const back = result => res.redirect(`${config.appUrl}/app/configuracoes?meta=${result}`)
  try {
    if (req.query.error) return back('denied')
    const actorUserId = verifyState(String(req.query.state || ''), config.stateSecret)
    if (!actorUserId) return back('error')

    const supabase = adminSupabase()
    const ownerId = await resolveOwnerId(supabase, actorUserId)
    if (!await resolveClinicAdmin(supabase, { id: actorUserId }, ownerId)) return back('error')

    const shortToken = await exchangeMetaCode(config, String(req.query.code || ''))
    if (!shortToken.access_token) return back('error')
    const longToken = await exchangeMetaLongLivedToken(config, shortToken.access_token)
    if (!longToken.access_token) return back('error')

    const [pages, adAccounts] = await Promise.all([
      fetchMetaGrantedPages(config, longToken.access_token),
      fetchMetaGrantedAdAccounts(config, longToken.access_token),
    ])
    if (!pages.length) return back('no_page')

    const base = {
      user_id: ownerId,
      connected_by: actorUserId,
      token_expires_at: computeMetaTokenExpiresAt(longToken.expires_in),
      updated_at: new Date().toISOString(),
    }

    if (pages.length === 1 && adAccounts.length <= 1) {
      const page = pages[0]
      const { error } = await supabase.from('meta_connections').upsert({
        ...base,
        page_id: page.id,
        ad_account_id: adAccounts[0]?.id || null,
        access_token_encrypted: encryptPayload({ pageToken: page.access_token, userToken: longToken.access_token }),
        status: 'conectado',
      }, { onConflict: 'user_id' })
      if (error) return back('error')
      return back('connected')
    }

    const { error } = await supabase.from('meta_connections').upsert({
      ...base,
      page_id: null,
      ad_account_id: null,
      access_token_encrypted: encryptPayload({ userToken: longToken.access_token, pendingPages: pages, pendingAdAccounts: adAccounts }),
      status: 'selecionando',
    }, { onConflict: 'user_id' })
    if (error) return back('error')
    return back('selecting')
  } catch (e) {
    console.error('meta oauth callback error:', e?.message)
    return back('error')
  }
}

async function handleMetaPending(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await authenticatedAdmin(req)
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message })
  const { data: conn } = await auth.supabase.from('meta_connections')
    .select('access_token_encrypted, status').eq('user_id', auth.ownerId).maybeSingle()
  if (!conn || conn.status !== 'selecionando') return res.status(200).json({ pages: [], adAccounts: [] })
  const decrypted = decryptPayload(conn.access_token_encrypted)
  return res.status(200).json({
    pages: (decrypted?.pendingPages || []).map(p => ({ id: p.id, name: p.name })),
    adAccounts: (decrypted?.pendingAdAccounts || []).map(a => ({ id: a.id, name: a.name })),
  })
}

async function handleMetaSelect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await authenticatedAdmin(req)
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message })
  const pageId = String(req.body?.pageId || '')
  const adAccountId = req.body?.adAccountId ? String(req.body.adAccountId) : null
  if (!pageId) return res.status(400).json({ error: 'Selecione uma Página.' })

  const { data: conn, error: readError } = await auth.supabase.from('meta_connections')
    .select('access_token_encrypted, status').eq('user_id', auth.ownerId).maybeSingle()
  if (readError || !conn || conn.status !== 'selecionando') {
    return res.status(409).json({ error: 'Nenhuma seleção pendente para esta clínica.' })
  }
  const decrypted = decryptPayload(conn.access_token_encrypted)
  const page = (decrypted?.pendingPages || []).find(p => p.id === pageId)
  if (!page) return res.status(400).json({ error: 'Página não encontrada na lista autorizada.' })
  if (adAccountId && !(decrypted?.pendingAdAccounts || []).some(a => a.id === adAccountId)) {
    return res.status(400).json({ error: 'Conta de anúncios não encontrada na lista autorizada.' })
  }

  const { error: writeError } = await auth.supabase.from('meta_connections').update({
    page_id: pageId,
    ad_account_id: adAccountId,
    access_token_encrypted: encryptPayload({ pageToken: page.access_token, userToken: decrypted.userToken }),
    status: 'conectado',
    updated_at: new Date().toISOString(),
  }).eq('user_id', auth.ownerId)
  if (writeError) return res.status(500).json({ error: 'Não foi possível salvar a seleção.' })
  return res.status(200).json({ ok: true })
}

async function handleMetaDisconnect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await authenticatedAdmin(req)
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message })
  const config = getMetaOAuthConfig()
  const { data: conn } = await auth.supabase.from('meta_connections')
    .select('access_token_encrypted').eq('user_id', auth.ownerId).maybeSingle()
  const decrypted = conn?.access_token_encrypted ? decryptPayload(conn.access_token_encrypted) : null
  if (decrypted?.userToken) await revokeMetaToken(config, decrypted.userToken)
  const { error } = await auth.supabase.from('meta_connections').delete().eq('user_id', auth.ownerId)
  if (error) return res.status(500).json({ error: 'Não foi possível desconectar.' })
  return res.status(200).json({ ok: true })
}

```

- [ ] **Step 4: Confirmar que o arquivo ainda é um JS válido**

```bash
node --check api/whatsapp.js
```
Expected: sem saída (sem erro de sintaxe).

- [ ] **Step 5: Commit**

```bash
git add api/whatsapp.js
git commit -m "feat: rotas de conexão OAuth do Meta Ads em api/whatsapp.js"
```

---

### Task 5: `handleMetaWebhook` passa a descriptografar o token

**Files:**
- Modify: `api/whatsapp.js:983-993` (dentro de `handleMetaWebhook`)

- [ ] **Step 1: Trocar a leitura da coluna e descriptografar**

Troque:
```js
      const { data: conn, error: connectionError } = await supabase
        .from('meta_connections')
        .select('user_id, access_token')
        .eq('page_id', lead.pageId)
        .in('status', ['configurado', 'conectado'])
        .maybeSingle()
      if (connectionError) throw connectionError
      if (!conn?.access_token) {
        console.warn('meta lead ignored: page is not configured', lead.pageId)
        continue
      }

      const full = await fetchLeadData(lead.leadgenId, conn.access_token, graphVersion)
```

Por:
```js
      const { data: conn, error: connectionError } = await supabase
        .from('meta_connections')
        .select('user_id, access_token_encrypted')
        .eq('page_id', lead.pageId)
        .in('status', ['conectado', 'expirando'])
        .maybeSingle()
      if (connectionError) throw connectionError
      const pageToken = conn?.access_token_encrypted ? decryptPayload(conn.access_token_encrypted)?.pageToken : null
      if (!pageToken) {
        console.warn('meta lead ignored: page is not configured', lead.pageId)
        continue
      }

      const full = await fetchLeadData(lead.leadgenId, pageToken, graphVersion)
```

(O status `'configurado'` não existe mais nesse fluxo — era o estado "token colado mas não validado" da configuração manual, que deixou de existir. `'expirando'` entra porque um token perto do vencimento ainda é válido pra ler leads até expirar de verdade.)

- [ ] **Step 2: Conferir visualmente que não sobrou nenhuma outra referência a `conn.access_token` (sem `_encrypted`) nessa função**

```bash
grep -n "conn.access_token\b" api/whatsapp.js
```
Expected: nenhuma ocorrência (só `conn.access_token_encrypted` deve aparecer).

- [ ] **Step 3: Commit**

```bash
git add api/whatsapp.js
git commit -m "fix: webhook de leadgen do Meta descriptografa o token da Página"
```

---

### Task 6: `syncMetaInsights` passa a descriptografar o token e marca `'expirando'` perto do vencimento

**Files:**
- Modify: `api/_lib/metaInsights.js` (imports + linhas 215-245)
- Test: `tests/unit/metaInsightsExpiry.spec.js` (novo, só a função pura de decisão)

O cron diário que já roda `syncMetaInsights` (via `api/alerts/process.js`) é o lugar certo pra checar
vencimento — não precisa de cron novo (a spec exige isso explicitamente; não tinha ficado implementado
em nenhuma outra task).

- [ ] **Step 1: Escrever o teste da função pura de decisão (vai falhar — a função não existe ainda)**

```js
// tests/unit/metaInsightsExpiry.spec.js
import { expect, test } from '@playwright/test'
import { metaConnectionStatusAfterSync } from '../../api/_lib/metaInsights.js'

const DAY_MS = 24 * 60 * 60 * 1000

test('sem token_expires_at: sync bem-sucedido mantém "conectado"', () => {
  expect(metaConnectionStatusAfterSync(null, Date.now())).toBe('conectado')
})

test('vencimento a mais de 7 dias: continua "conectado"', () => {
  const now = Date.now()
  const expiresAt = new Date(now + 10 * DAY_MS).toISOString()
  expect(metaConnectionStatusAfterSync(expiresAt, now)).toBe('conectado')
})

test('vencimento em até 7 dias: vira "expirando"', () => {
  const now = Date.now()
  const expiresAt = new Date(now + 3 * DAY_MS).toISOString()
  expect(metaConnectionStatusAfterSync(expiresAt, now)).toBe('expirando')
})

test('já vencido: vira "erro" (nunca usa token morto)', () => {
  const now = Date.now()
  const expiresAt = new Date(now - DAY_MS).toISOString()
  expect(metaConnectionStatusAfterSync(expiresAt, now)).toBe('erro')
})
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

```bash
npx playwright test -c playwright.unit.config.js tests/unit/metaInsightsExpiry.spec.js
```
Expected: FAIL — `metaConnectionStatusAfterSync is not a function`.

- [ ] **Step 3: Importar `decryptPayload` e adicionar a função pura**

No topo de `api/_lib/metaInsights.js`, adicione:
```js
import { decryptPayload } from './secureProfile.js'
```

Na seção `// ---------- Puro ----------` (perto do topo do arquivo, junto de `num()`), adicione:
```js
const TOKEN_EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000

// Decide o status pós-sync bem-sucedido a partir do vencimento do token. Nunca deixa a
// clínica "conectada" com um token já vencido, e avisa com 7 dias de antecedência.
export function metaConnectionStatusAfterSync(tokenExpiresAt, now = Date.now()) {
  if (!tokenExpiresAt) return 'conectado'
  const expiresAtMs = new Date(tokenExpiresAt).getTime()
  if (!Number.isFinite(expiresAtMs)) return 'conectado'
  if (expiresAtMs <= now) return 'erro'
  if (expiresAtMs - now <= TOKEN_EXPIRY_WARNING_MS) return 'expirando'
  return 'conectado'
}
```

- [ ] **Step 4: Rodar o teste de novo, confirmar que passa**

```bash
npx playwright test -c playwright.unit.config.js tests/unit/metaInsightsExpiry.spec.js
```
Expected: todos PASS.

- [ ] **Step 5: Descriptografar o token e usar `metaConnectionStatusAfterSync` no fluxo real**

Troque:
```js
  let query = supabase
    .from('meta_connections')
    .select('user_id, ad_account_id, access_token')
    .in('status', ['configurado', 'conectado'])
    .not('access_token', 'is', null)
    .not('ad_account_id', 'is', null)
  if (opts.owner) query = query.eq('user_id', opts.owner)

  const { data: conns, error } = await query
  if (error) throw error

  const summary = { ok: true, owners: 0, synced: 0, failures: 0, since, until, details: [] }
  for (const conn of conns || []) {
    summary.owners += 1
    try {
      const counts = await syncOwner(supabase, conn, { version, since, until, reachPeriods })
      summary.synced += 1
      summary.details.push({ owner: conn.user_id, ...counts })
      // Sync real bem-sucedido valida a conexão (torna "conectado" visível na tela de config).
      await supabase.from('meta_connections')
        .update({ status: 'conectado', updated_at: new Date().toISOString() })
        .eq('user_id', conn.user_id)
    } catch (e) {
```

Por:
```js
  let query = supabase
    .from('meta_connections')
    .select('user_id, ad_account_id, access_token_encrypted, token_expires_at')
    .in('status', ['conectado', 'expirando'])
    .not('access_token_encrypted', 'is', null)
    .not('ad_account_id', 'is', null)
  if (opts.owner) query = query.eq('user_id', opts.owner)

  const { data: rawConns, error } = await query
  if (error) throw error

  const conns = (rawConns || [])
    .map(row => ({
      user_id: row.user_id,
      ad_account_id: row.ad_account_id,
      access_token: decryptPayload(row.access_token_encrypted)?.pageToken,
      token_expires_at: row.token_expires_at,
    }))
    .filter(conn => conn.access_token)

  const summary = { ok: true, owners: 0, synced: 0, failures: 0, since, until, details: [] }
  for (const conn of conns) {
    summary.owners += 1
    try {
      const counts = await syncOwner(supabase, conn, { version, since, until, reachPeriods })
      summary.synced += 1
      summary.details.push({ owner: conn.user_id, ...counts })
      // Sync real bem-sucedido valida a conexão; ainda assim, nunca mostra "conectado"
      // com um token vencido ou perto de vencer (ver metaConnectionStatusAfterSync).
      await supabase.from('meta_connections')
        .update({ status: metaConnectionStatusAfterSync(conn.token_expires_at), updated_at: new Date().toISOString() })
        .eq('user_id', conn.user_id)
    } catch (e) {
```

(`syncOwner` continua recebendo `conn.access_token` como antes, já descriptografado — nenhuma outra linha em `syncOwner` precisa mudar.)

- [ ] **Step 6: Commit**

```bash
git add api/_lib/metaInsights.js tests/unit/metaInsightsExpiry.spec.js
git commit -m "fix: sync do Meta descriptografa o token e avisa antes do vencimento"
```

---

### Task 7: Cliente frontend `src/lib/metaOAuthClient.js`

**Files:**
- Create: `src/lib/metaOAuthClient.js`

- [ ] **Step 1: Escrever o cliente (mesmo padrão de `src/lib/googleCalendarClient.js`)**

```js
// src/lib/metaOAuthClient.js
import { supabase } from './supabase.js'

const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'
const ENDPOINT = '/api/whatsapp'

async function getAccessToken() {
  if (E2E_BYPASS_AUTH) return 'e2e-token'
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sessão expirada. Entre novamente.')
  return token
}

async function request(action, { method = 'GET', body } = {}) {
  const token = await getAccessToken()
  const res = await fetch(`${ENDPOINT}?action=${action}`, {
    method,
    headers:{
      Authorization:`Bearer ${token}`,
      ...(body ? { 'Content-Type':'application/json' } : {}),
    },
    body:body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

export const startMetaConnection = () => request('meta-connect', { method:'POST' })
export const fetchMetaPendingAssets = () => request('meta-pending')
export const selectMetaAssets = ({ pageId, adAccountId }) => request('meta-select', { method:'POST', body:{ pageId, adAccountId } })
export const disconnectMeta = () => request('meta-disconnect', { method:'POST' })
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/metaOAuthClient.js
git commit -m "feat: cliente frontend da conexão OAuth do Meta Ads"
```

---

### Task 8: Reescrever `src/components/MetaConnection.jsx`

**Files:**
- Modify: `src/components/MetaConnection.jsx` (reescrita completa do arquivo)

- [ ] **Step 1: Substituir o conteúdo inteiro do arquivo**

```jsx
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Btn } from './UI.jsx'
import { disconnectMeta, fetchMetaPendingAssets, selectMetaAssets, startMetaConnection } from '../lib/metaOAuthClient.js'

const RESULT_MESSAGES = {
  connected:{ text:'Meta Ads conectado com sucesso.', tone:'ok' },
  selecting:{ text:'Escolha a Página e a Conta de Anúncios abaixo para concluir a conexão.', tone:'warn' },
  denied:{ text:'Conexão cancelada. Nenhuma permissão foi concedida.', tone:'warn' },
  no_page:{ text:'Nenhuma Página foi autorizada. Tente novamente e marque pelo menos uma Página do Facebook.', tone:'bad' },
  error:{ text:'Não foi possível conectar ao Meta. Tente novamente.', tone:'bad' },
}

const STATUS_META = {
  conectado:{ label:'● Conectado', ok:true },
  selecionando:{ label:'◐ Escolha a Página/Conta', ok:false },
  expirando:{ label:'⚠ Expirando — reconecte', ok:false },
  erro:{ label:'⚠ Erro de conexão', ok:false },
  configurado:{ label:'◐ Reconexão necessária', ok:false },
  desconectado:{ label:'○ Não conectado', ok:false },
}

export function MetaConnection() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id

  const [cfg, setCfg] = useState(null)
  const [pending, setPending] = useState({ pages:[], adAccounts:[] })
  const [selectedPage, setSelectedPage] = useState('')
  const [selectedAdAccount, setSelectedAdAccount] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    const { data, error:err } = await supabase.from('meta_connections')
      .select('ad_account_id, page_id, status, token_expires_at').maybeSingle()
    if (err) { setError(err.message); setLoading(false); return }
    setCfg(data)
    if (data?.status === 'selecionando') {
      try {
        const assets = await fetchMetaPendingAssets()
        setPending({ pages:assets.pages || [], adAccounts:assets.adAccounts || [] })
      } catch (e) { setError(e.message) }
    }
    setLoading(false)
  }

  useEffect(() => { if (effectiveUserId) load() }, [effectiveUserId])

  useEffect(() => {
    const code = new URLSearchParams(location.search).get('meta')
    if (!code) return
    setResult(RESULT_MESSAGES[code] || null)
    navigate(location.pathname, { replace:true })
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  async function run(action) {
    setBusy(true); setError(null)
    try { await action() } catch (e) { setError(e.message || 'Não foi possível concluir a ação.') }
    finally { setBusy(false) }
  }

  async function connect() {
    const { url } = await startMetaConnection()
    window.location.assign(url)
  }

  async function confirmSelection() {
    if (!selectedPage) { setError('Selecione uma Página.'); return }
    await selectMetaAssets({ pageId:selectedPage, adAccountId:selectedAdAccount || null })
    await load()
  }

  async function disconnect() {
    await disconnectMeta()
    await load()
  }

  if (loading) return <div style={{ color: C.textSub, fontSize: 13, padding: 20 }}>Carregando…</div>

  const s = {
    intro: { fontSize: 13, color: C.textSub, marginBottom: 16, lineHeight: 1.45 },
    card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 12 },
    label: { fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4, display: 'block' },
    note: { fontSize: 11.5, color: C.textDim, lineHeight: 1.5 },
    status: ok => ({ fontSize: 12, fontWeight: 700, color: ok ? (C.green || '#16a34a') : C.textSub }),
    select: { width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', color: C.text, fontSize: 13 },
  }
  const toneColor = { ok:C.green || '#16a34a', warn:C.yellow || '#eab308', bad:C.red || '#ef4444' }
  const status = cfg?.status || 'desconectado'
  const statusMeta = STATUS_META[status] || STATUS_META.desconectado

  return (
    <div>
      <div style={s.intro}>
        Conecte os anúncios do Meta (Facebook/Instagram) da clínica. Os <strong>leads dos formulários
        (Lead Ads) entram automaticamente no funil</strong> em "Primeiro Contato", etiquetados com a
        campanha de origem.
      </div>
      {error && <div style={{ color: C.red || '#ef4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
      {result && <div style={{ color: toneColor[result.tone], fontSize: 12, marginBottom: 10 }}>{result.text}</div>}

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 14, color: C.text }}>Conexão</strong>
          <span style={s.status(statusMeta.ok)}>{statusMeta.label}</span>
        </div>

        {status === 'selecionando' && (
          <>
            <div>
              <label style={s.label}>Página do Facebook</label>
              <select style={s.select} value={selectedPage} onChange={e => setSelectedPage(e.target.value)}>
                <option value="">Selecione…</option>
                {pending.pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Conta de Anúncios (opcional por enquanto)</label>
              <select style={s.select} value={selectedAdAccount} onChange={e => setSelectedAdAccount(e.target.value)}>
                <option value="">Nenhuma</option>
                {pending.adAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <Btn onClick={() => run(confirmSelection)} disabled={busy}>{busy ? 'Salvando…' : 'Confirmar seleção'}</Btn>
          </>
        )}

        {status !== 'selecionando' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {status === 'conectado'
              ? <Btn onClick={() => run(disconnect)} disabled={busy}>{busy ? 'Aguarde…' : 'Desconectar'}</Btn>
              : <Btn onClick={() => run(connect)} disabled={busy}>{busy ? 'Redirecionando…' : 'Continuar com Facebook'}</Btn>}
          </div>
        )}

        {status === 'conectado' && cfg?.token_expires_at && (
          <div style={s.note}>
            Token válido até {new Date(cfg.token_expires_at).toLocaleDateString('pt-BR')}.
            Perto do vencimento, um aviso aparece aqui pedindo reconexão.
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar que não há import não usado nem erro óbvio**

```bash
node --check src/lib/metaOAuthClient.js
```
(O `.jsx` não roda em `node --check` por causa do JSX; a validação real desse arquivo acontece no build, no Step 2 da Task 11.)

- [ ] **Step 3: Commit**

```bash
git add src/components/MetaConnection.jsx
git commit -m "feat: tela de conexão Meta Ads via OAuth, substitui campos manuais"
```

---

### Task 9: `Settings.jsx` abre direto na aba Meta Ads ao voltar do OAuth

**Files:**
- Modify: `src/components/Settings.jsx:1, 45-47`

- [ ] **Step 1: Importar `useLocation`**

Linha 1, troque:
```js
import { useEffect, useMemo, useState } from 'react'
```
Por:
```js
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
```

- [ ] **Step 2: Ler `?meta=` na URL e já abrir na aba certa**

Logo após a linha `const [tab, setTab] = useState('perfil')` (linha 46), adicione:
```js
  const location = useLocation()
  useEffect(() => {
    if (new URLSearchParams(location.search).get('meta')) setTab('meta')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

(Roda só na montagem — o próprio `MetaConnection.jsx`, na Task 8, já limpa o `?meta=` da URL depois de ler o resultado, então não precisa reagir a mudanças subsequentes aqui.)

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings.jsx
git commit -m "fix: Configurações abre na aba Meta Ads ao voltar da conexão OAuth"
```

---

### Task 10: Testes e2e

**Files:**
- Create: `tests/e2e/meta-connection.spec.js`

- [ ] **Step 1: Escrever os testes**

```js
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
})

test('mostra "Continuar com Facebook" quando desconectado', async ({ page }) => {
  await page.route('**/rest/v1/meta_connections*', route => route.fulfill({ status:200, contentType:'application/json', body:'null' }))
  await page.goto('/app/configuracoes')
  await page.getByRole('button', { name:'Meta Ads' }).click()
  await expect(page.getByRole('button', { name:'Continuar com Facebook' })).toBeVisible()
})

test('clicar em conectar chama meta-connect e navega pra URL do Meta', async ({ page }) => {
  await page.route('**/rest/v1/meta_connections*', route => route.fulfill({ status:200, contentType:'application/json', body:'null' }))
  await page.route('**/api/whatsapp?action=meta-connect', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ url:'https://www.facebook.com/v26.0/dialog/oauth?mock=1' }) }))
  await page.goto('/app/configuracoes')
  await page.getByRole('button', { name:'Meta Ads' }).click()
  const navigation = page.waitForURL(/facebook\.com/, { timeout:5000 }).catch(() => null)
  await page.getByRole('button', { name:'Continuar com Facebook' }).click()
  await navigation
  expect(page.url()).toContain('facebook.com')
})

test('callback com 1 Página conecta direto e mostra status conectado', async ({ page }) => {
  let selectCount = 0
  await page.route('**/rest/v1/meta_connections*', route => {
    const body = JSON.stringify({ ad_account_id:'act_1', page_id:'page-1', status:'conectado', token_expires_at:'2026-12-20T00:00:00Z' })
    return route.fulfill({ status:200, contentType:'application/json', body })
  })
  await page.route('**/api/whatsapp?action=meta-pending', () => { selectCount += 1 })
  await page.goto('/app/configuracoes?meta=connected')
  await expect(page.getByText('Meta Ads conectado com sucesso.')).toBeVisible()
  await page.getByRole('button', { name:'Meta Ads' }).click()
  await expect(page.getByText('● Conectado')).toBeVisible()
  await expect(page.getByRole('button', { name:'Desconectar' })).toBeVisible()
  expect(selectCount).toBe(0)
})

test('callback com múltiplas Páginas mostra a tela de seleção e confirma com meta-select', async ({ page }) => {
  await page.route('**/rest/v1/meta_connections*', route => route.fulfill({
    status:200, contentType:'application/json',
    body:JSON.stringify({ ad_account_id:null, page_id:null, status:'selecionando', token_expires_at:null }),
  }))
  await page.route('**/api/whatsapp?action=meta-pending', route => route.fulfill({
    status:200, contentType:'application/json',
    body:JSON.stringify({ pages:[{ id:'page-1', name:'Clínica A' }, { id:'page-2', name:'Clínica B' }], adAccounts:[{ id:'act_1', name:'Conta Principal' }] }),
  }))
  let selectPayload = null
  await page.route('**/api/whatsapp?action=meta-select', async route => {
    selectPayload = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' })
  })

  await page.goto('/app/configuracoes?meta=selecting')
  await page.getByRole('button', { name:'Meta Ads' }).click()
  await expect(page.getByText('Escolha a Página e a Conta de Anúncios abaixo para concluir a conexão.')).toBeVisible()
  await page.getByLabel('Página do Facebook').selectOption('page-2')
  await page.getByLabel('Conta de Anúncios (opcional por enquanto)').selectOption('act_1')
  await page.getByRole('button', { name:'Confirmar seleção' }).click()

  await expect.poll(() => selectPayload).toEqual({ pageId:'page-2', adAccountId:'act_1' })
})

test('token perto do vencimento mostra aviso de reconexão em vez de "Conectado"', async ({ page }) => {
  await page.route('**/rest/v1/meta_connections*', route => route.fulfill({
    status:200, contentType:'application/json',
    body:JSON.stringify({ ad_account_id:'act_1', page_id:'page-1', status:'expirando', token_expires_at:'2026-10-24T00:00:00Z' }),
  }))
  await page.goto('/app/configuracoes')
  await page.getByRole('button', { name:'Meta Ads' }).click()
  await expect(page.getByText('⚠ Expirando — reconecte')).toBeVisible()
  await expect(page.getByRole('button', { name:'Continuar com Facebook' })).toBeVisible()
})

test('desconectar chama meta-disconnect e some o status conectado', async ({ page }) => {
  let disconnected = false
  await page.route('**/rest/v1/meta_connections*', route => route.fulfill({
    status:200, contentType:'application/json',
    body:disconnected
      ? 'null'
      : JSON.stringify({ ad_account_id:'act_1', page_id:'page-1', status:'conectado', token_expires_at:'2026-12-20T00:00:00Z' }),
  }))
  await page.route('**/api/whatsapp?action=meta-disconnect', async route => {
    disconnected = true
    await route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' })
  })

  await page.goto('/app/configuracoes')
  await page.getByRole('button', { name:'Meta Ads' }).click()
  await expect(page.getByText('● Conectado')).toBeVisible()
  await page.getByRole('button', { name:'Desconectar' }).click()
  await expect(page.getByRole('button', { name:'Continuar com Facebook' })).toBeVisible()
})
```

- [ ] **Step 2: Rodar os testes novos**

```bash
npx playwright test tests/e2e/meta-connection.spec.js
```
Expected: 6 PASS. Se o `getByRole('button', { name:'Meta Ads' })` não encontrar nada, confira o texto exato da aba em `Settings.jsx` (linha ~137, array de tabs) antes de ajustar o teste — não mude o texto do app pra fazer o teste passar sem necessidade.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/meta-connection.spec.js
git commit -m "test: cobertura e2e da conexão Meta Ads via OAuth"
```

---

### Task 11: Variáveis de ambiente, docs e verificação final

**Files:**
- Modify: `CHANGELOG.md`, `PROJECT_MEMORY.md`, `docs/PENDENCIAS_CLIENTE.md`

- [ ] **Step 1: Adicionar entrada no `CHANGELOG.md`**

Na seção `### Added` do bloco `[Unreleased]` mais recente, adicione:
```markdown
- **Conexão Meta Ads via OAuth ("Continuar com Facebook")**: Configurações → Meta Ads deixa de pedir Ad Account ID/Page ID/token colados manualmente — o admin loga com o Facebook, autoriza, e a clínica fica conectada automaticamente (ou escolhe a Página/Conta certa, se autorizou mais de uma). Token sempre criptografado no servidor (nunca chega ao navegador); reutiliza o mesmo padrão OAuth já implementado pro Google Agenda. Aplicar `supabase/meta_oauth_connection_schema.sql` e cadastrar `META_APP_ID`, `META_CLIENT_CONFIG_ID`, `META_OAUTH_REDIRECT_URI` na Vercel antes do deploy. (`api/whatsapp.js`, `api/_lib/metaOAuth.js`, `api/_lib/oauthState.js`, `api/_lib/metaInsights.js`, `src/components/MetaConnection.jsx`, `src/components/Settings.jsx`, `src/lib/metaOAuthClient.js`, `supabase/meta_oauth_connection_schema.sql`.)
```

- [ ] **Step 2: Adicionar entrada no `PROJECT_MEMORY.md`**

Na seção "Histórico recente (resumo)", adicione (data de hoje):
```markdown
- 2026-10-21 (branch a definir): conexão Meta Ads passa a ser self-serve via OAuth ("Login do Facebook para empresas"), eliminando o processo manual que exigiria dar acesso de admin no Business Manager de cada clínica nova. Reaproveita o padrão já implementado pro Google Agenda (state assinada, token criptografado). App único da Zentri Tech reutilizado por todas as clínicas — nunca um app por cliente. Aplicar `supabase/meta_oauth_connection_schema.sql` e cadastrar `META_APP_ID`/`META_CLIENT_CONFIG_ID`/`META_OAUTH_REDIRECT_URI` na Vercel antes do deploy. Pendência: o App Review (`leads_retrieval`/`ads_read`) do app novo ainda não foi aprovado — enquanto isso, só funciona em modo desenvolvimento (contas/Páginas como testadoras).
```

- [ ] **Step 3: Atualizar `docs/PENDENCIAS_CLIENTE.md`**

Adicione um item novo na lista de pendências:
```markdown
- [ ] **Aplicar `supabase/meta_oauth_connection_schema.sql`** antes do deploy da conexão Meta Ads via OAuth; cadastrar `META_APP_ID`, `META_CLIENT_CONFIG_ID` (da configuração "Login do Facebook para empresas") e `META_OAUTH_REDIRECT_URI` na Vercel
```

- [ ] **Step 4: Rodar a suíte de testes unitários inteira**

```bash
npm run test:unit
```
Expected: todos PASS (inclui os novos `metaOAuth.spec.js` e o `googleCalendarServer.spec.js` já existente, intacto).

- [ ] **Step 5: Rodar o build de produção**

```bash
npm run build
```
Expected: `✓ built` sem erro.

- [ ] **Step 6: Rodar os e2e novos mais os de WhatsApp/Meta já existentes (garantir que nada quebrou por perto)**

```bash
npx playwright test tests/e2e/meta-connection.spec.js tests/e2e/whatsapp-inbox.spec.js tests/e2e/whatsapp-evolution-settings.spec.js
```
Expected: todos PASS.

- [ ] **Step 7: Commit final**

```bash
git add CHANGELOG.md PROJECT_MEMORY.md docs/PENDENCIAS_CLIENTE.md
git commit -m "docs: changelog e pendências da conexão Meta Ads via OAuth"
```

- [ ] **Step 8: Seguir o fluxo de git do projeto**

Esse plano inteiro deve rodar numa branch própria (`feat/meta-oauth-connection`, criada a partir da `main` atualizada — ver SYSTEM_RULES regra 8), nunca direto na `main`. Ao final de todas as tasks, reportar: nome da branch, lista de commits, e que falta (aplicar a migration no Supabase, cadastrar as 3 variáveis na Vercel, criar a configuração "Login do Facebook para empresas" no painel do Meta se ainda não existir, e então push/PR/merge — só quando pedido).
