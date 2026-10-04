# Integração Google Agenda — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar a Google Agenda de cada usuário na tela Agenda, enviando consultas/cirurgias como eventos e mostrando os eventos do Google no calendário da plataforma (dois sentidos).

**Architecture:** Um único endpoint serverless `api/google/calendar.js` (despachante por `?action=`) para não ultrapassar o limite de 12 funções do plano Hobby da Vercel. Tokens ficam criptografados no Supabase (acesso só pelo service role). O front calcula as diferenças (hash por registro) e chama `sync` com debounce; a Agenda busca os eventos do mês visível e aplica mudanças feitas no Google em eventos vinculados. Funções puras (payload, hash, mapeamento de eventos, assinatura de `state`) ficam isoladas e testadas.

**Tech Stack:** React 18 + Vite, Supabase (Postgres + RLS), Vercel serverless (Node, ESM), Google Calendar API v3 via `fetch`, Playwright (e2e e testes unitários via config separada).

**Spec:** `docs/superpowers/specs/2026-10-03-google-calendar-integration-design.md`

## Refinamentos em relação à spec (decididos ao escrever o plano)

1. **Endpoint único** `api/google/calendar.js` com `?action=status|connect|disconnect|events|sync`; o callback do Google é o mesmo endpoint (`GET` com `code`/`state`/`error`). Motivo: limite de 12 funções (hoje existem 11).
2. `google_calendar_connections.refresh_token_encrypted` é **`jsonb`** (formato `{iv, tag, data}` de `encryptPayload`).
3. `google_calendar_event_links` ganha `remote_snapshot text` (data|hora|duração do último estado enviado) para detectar alteração feita no Google sem confundir com edição local pendente.
4. **Só sincroniza com o Google registros com data de hoje em diante** (ou que já tenham vínculo). Evita inundar a agenda com anos de histórico na primeira conexão.
5. Exclusão automática no Google limitada a 25 itens por rodada (proteção contra falha de carregamento do dataset).
6. Eventos cancelados no Google são detectados na leitura (`showDeleted=true`) e marcam o vínculo como `detached`.
7. Eventos de dia inteiro de vários dias aparecem só no primeiro dia (limitação v1).

## Ordem de deploy (IMPORTANTE)

1. Aplicar `supabase/google_calendar_schema.sql` no Supabase **antes** de publicar o código: `financeStore` passa a gravar `start_time`/`duration_minutes`; sem as colunas o salvamento relacional falha.
2. Configurar variáveis de ambiente na Vercel e a Google Calendar API no Google Cloud (Task 8).
3. Publicar o código.

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `playwright.unit.config.js` | criar | Config do runner de testes unitários (sem servidor web) |
| `package.json` | modificar | Script `test:unit` |
| `src/lib/googleCalendarPayload.js` | criar | Funções puras do front: título, payload, hash, diferenças a sincronizar, aplicar mudanças do Google |
| `api/_lib/googleCalendar.js` | criar | Funções puras do servidor: evento do Google, normalização, snapshot, `state` assinado |
| `api/_lib/googleCalendarApi.js` | criar | IO: config, chamadas HTTP ao Google, tokens e vínculos no Supabase |
| `api/google/calendar.js` | criar | Handler único (roteia `action`, callback OAuth) |
| `supabase/google_calendar_schema.sql` | criar | Tabelas novas + colunas de horário |
| `src/lib/financeStore.js` | modificar | Ler/gravar `start_time` e `duration_minutes` |
| `src/components/Sales.jsx`, `Consultations.jsx` | modificar | Campos Horário e Duração |
| `src/lib/googleCalendarClient.js` | criar | Cliente HTTP das rotas |
| `src/lib/useGoogleCalendarSync.js` | criar | Hook: status, sync com debounce, conectar/desconectar |
| `src/pages/FinanceWorkspace.jsx` | modificar | Usa o hook e passa `google` para as páginas |
| `src/components/GoogleCalendarBar.jsx` | criar | Barra de conexão (conectar/reconectar/desconectar/avisos) |
| `src/components/Calendar.jsx` | modificar | Mostra eventos do Google, horário, aplica mudanças externas |
| `tests/unit/*.spec.js`, `tests/e2e/google-calendar.spec.js` | criar | Testes |
| `.env.example`, `CHANGELOG.md`, `PROJECT_MEMORY.md`, `docs/lgpd_compliance.md` | modificar | Documentação (regra 7 de `SYSTEM_RULES.md`) |

---

### Task 1: Infra de testes unitários + funções puras do front

**Files:**
- Create: `playwright.unit.config.js`
- Modify: `package.json` (scripts)
- Create: `src/lib/googleCalendarPayload.js`
- Test: `tests/unit/googleCalendarPayload.spec.js`

- [ ] **Step 1: Criar a config de testes unitários**

`playwright.unit.config.js`:

```js
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir:'./tests/unit',
  timeout:10_000,
  retries:0,
})
```

Em `package.json`, dentro de `"scripts"`, adicionar após `"e2e"`:

```json
    "e2e": "playwright test",
    "test:unit": "playwright test -c playwright.unit.config.js"
```

- [ ] **Step 2: Escrever os testes que falham**

`tests/unit/googleCalendarPayload.spec.js`:

```js
import { expect, test } from '@playwright/test'
import {
  applyExternalChanges,
  buildEventTitle,
  buildSyncPayload,
  collectSyncChanges,
  normalizeDuration,
} from '../../src/lib/googleCalendarPayload.js'

const procedures = [{ id:'p1', name:'Rinoplastia' }]
const TZ = 'America/Sao_Paulo'

test('titulo usa nome completo e procedimento', () => {
  const title = buildEventTitle('surgery', { patient:'Maria da Silva', procedureId:'p1' }, procedures)
  expect(title).toBe('Maria da Silva — Rinoplastia')
})

test('titulo de consulta usa o rotulo do tipo', () => {
  const title = buildEventTitle('consultation', { patient:'João Souza', consultationType:'retorno' }, procedures)
  expect(title).toBe('João Souza — Retorno')
})

test('payload sem horario vira dia inteiro (duracao 0)', () => {
  const payload = buildSyncPayload('consultation', { id:'c1', patient:'Ana', date:'2026-10-05', consultationType:'avaliacao' }, procedures, TZ)
  expect(payload).toMatchObject({ type:'consultation', id:'c1', date:'2026-10-05', startTime:'', durationMinutes:0, timeZone:TZ })
})

test('payload com horario usa duracao informada ou o padrao do tipo', () => {
  const surgery = buildSyncPayload('surgery', { id:'s1', patient:'Ana', date:'2026-10-05', startTime:'08:00:00', procedureId:'p1' }, procedures, TZ)
  expect(surgery.startTime).toBe('08:00')
  expect(surgery.durationMinutes).toBe(180)
  const consultation = buildSyncPayload('consultation', { id:'c1', patient:'Ana', date:'2026-10-05', startTime:'14:30', durationMinutes:45 }, procedures, TZ)
  expect(consultation.durationMinutes).toBe(45)
})

test('hash muda quando horario muda e e estavel caso contrario', () => {
  const base = { id:'c1', patient:'Ana', date:'2026-10-05', startTime:'14:30', durationMinutes:60 }
  const a = buildSyncPayload('consultation', base, procedures, TZ)
  const b = buildSyncPayload('consultation', { ...base }, procedures, TZ)
  const c = buildSyncPayload('consultation', { ...base, startTime:'15:00' }, procedures, TZ)
  expect(a.hash).toBe(b.hash)
  expect(a.hash).not.toBe(c.hash)
})

test('normalizeDuration rejeita valores invalidos', () => {
  expect(normalizeDuration(0, 'consultation')).toBe(60)
  expect(normalizeDuration(-5, 'surgery')).toBe(180)
  expect(normalizeDuration(5000, 'surgery')).toBe(180)
  expect(normalizeDuration('90', 'consultation')).toBe(90)
})

test('collectSyncChanges ignora passado sem vinculo e envia futuro novo', () => {
  const data = {
    procedures,
    surgeries:[],
    consultations:[
      { id:'old', patient:'A', date:'2026-01-01' },
      { id:'new', patient:'B', date:'2026-10-10' },
    ],
  }
  const { upserts, deletes } = collectSyncChanges({ data, links:{}, todayIso:'2026-10-03', timeZone:TZ })
  expect(upserts.map(item => item.id)).toEqual(['new'])
  expect(deletes).toEqual([])
})

test('collectSyncChanges pula itens ja sincronizados e detecta exclusoes', () => {
  const data = { procedures, surgeries:[], consultations:[{ id:'c1', patient:'B', date:'2026-10-10' }] }
  const synced = buildSyncPayload('consultation', data.consultations[0], procedures, TZ)
  const links = { 'consultation:c1':synced.hash, 'surgery:gone':'abc' }
  const { upserts, deletes } = collectSyncChanges({ data, links, todayIso:'2026-10-03', timeZone:TZ })
  expect(upserts).toEqual([])
  expect(deletes).toEqual([{ type:'surgery', id:'gone' }])
})

test('collectSyncChanges nao exclui em massa (mais de 25)', () => {
  const links = {}
  for (let i = 0; i < 26; i += 1) links[`consultation:x${i}`] = 'h'
  const { deletes } = collectSyncChanges({ data:{ procedures, surgeries:[], consultations:[] }, links, todayIso:'2026-10-03', timeZone:TZ })
  expect(deletes).toEqual([])
})

test('applyExternalChanges atualiza data e horario de evento vinculado alterado no Google', () => {
  const data = { surgeries:[], consultations:[{ id:'c1', patient:'B', date:'2026-10-10', startTime:'10:00', durationMinutes:60 }] }
  const events = [{ linked:true, externalChange:true, recordType:'consultation', recordId:'c1', date:'2026-10-11', startTime:'11:30', durationMinutes:45 }]
  const result = applyExternalChanges(data, events)
  expect(result.changed).toBe(1)
  expect(result.data.consultations[0]).toMatchObject({ date:'2026-10-11', startTime:'11:30', durationMinutes:45 })
})

test('applyExternalChanges ignora eventos sem mudanca externa', () => {
  const data = { surgeries:[], consultations:[{ id:'c1', patient:'B', date:'2026-10-10', startTime:'10:00', durationMinutes:60 }] }
  const events = [{ linked:true, externalChange:false, recordType:'consultation', recordId:'c1', date:'2026-10-11', startTime:'11:30', durationMinutes:45 }]
  const result = applyExternalChanges(data, events)
  expect(result.changed).toBe(0)
  expect(result.data).toBe(data)
})
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../src/lib/googleCalendarPayload.js'`.

- [ ] **Step 4: Implementar o módulo**

`src/lib/googleCalendarPayload.js`:

```js
const CONSULTATION_LABELS = {
  avaliacao:'Avaliação',
  retorno:'Retorno',
  pos_operatorio:'Pós-operatório',
  procedimento_estetico:'Procedimento estético',
}

export const DEFAULT_DURATION_MINUTES = { surgery:180, consultation:60 }
export const MAX_SYNC_BATCH = 50
const MAX_AUTO_DELETES = 25
const FALLBACK_TIME_ZONE = 'America/Sao_Paulo'

export function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE
  } catch {
    return FALLBACK_TIME_ZONE
  }
}

export function localTodayIso(now = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function normalizeTime(value) {
  const text = String(value || '')
  return /^\d{2}:\d{2}/.test(text) ? text.slice(0, 5) : ''
}

export function normalizeDuration(value, type) {
  const minutes = Math.round(Number(value))
  return minutes > 0 && minutes <= 1440 ? minutes : DEFAULT_DURATION_MINUTES[type]
}

export function buildEventTitle(type, record, procedures = []) {
  const patient = String(record.patient || '').trim() || 'Paciente'
  if (type === 'surgery') {
    const procedureName = procedures.find(item => item.id === record.procedureId)?.name || 'Cirurgia'
    return `${patient} — ${procedureName}`
  }
  return `${patient} — ${CONSULTATION_LABELS[record.consultationType] || 'Consulta'}`
}

export function hashPayload(payload) {
  const text = JSON.stringify([
    payload.type,
    payload.id,
    payload.title,
    payload.date,
    payload.startTime,
    payload.durationMinutes,
    payload.timeZone,
  ])
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

export function buildSyncPayload(type, record, procedures, timeZone) {
  const startTime = normalizeTime(record.startTime)
  const payload = {
    type,
    id:record.id,
    title:buildEventTitle(type, record, procedures),
    date:record.date,
    startTime,
    durationMinutes:startTime ? normalizeDuration(record.durationMinutes, type) : 0,
    timeZone,
  }
  return { ...payload, hash:hashPayload(payload) }
}

// links: { 'surgery:<id>': hashSincronizado }. Só envia registros de hoje em diante
// (ou que já tenham vínculo) para não inundar a agenda com histórico antigo.
export function collectSyncChanges({ data, links, todayIso, timeZone }) {
  const upserts = []
  const seen = new Set()
  const groups = [
    ['surgery', data.surgeries || []],
    ['consultation', data.consultations || []],
  ]

  for (const [type, records] of groups) {
    for (const record of records) {
      if (!record.id) continue
      const key = `${type}:${record.id}`
      seen.add(key)
      if (!record.date) continue
      const linked = key in links
      if (!linked && record.date < todayIso) continue
      const payload = buildSyncPayload(type, record, data.procedures || [], timeZone)
      if (links[key] !== payload.hash) upserts.push(payload)
    }
  }

  const staleKeys = Object.keys(links).filter(key => !seen.has(key))
  const deletes = staleKeys.length <= MAX_AUTO_DELETES
    ? staleKeys.map(key => {
      const [type, ...rest] = key.split(':')
      return { type, id:rest.join(':') }
    })
    : []

  return { upserts, deletes }
}

// Aplica nos registros locais as mudanças de data/horário feitas diretamente no Google.
export function applyExternalChanges(data, events) {
  let changed = 0

  function patch(records, type) {
    return records.map(record => {
      const event = events.find(item => item.linked && item.externalChange && item.recordType === type && item.recordId === record.id)
      if (!event || !event.date) return record
      const next = { ...record, date:event.date, startTime:event.startTime || '' }
      if (event.startTime && event.durationMinutes > 0) next.durationMinutes = event.durationMinutes
      const same = next.date === record.date
        && (next.startTime || '') === (record.startTime || '')
        && (next.durationMinutes || 0) === (record.durationMinutes || 0)
      if (same) return record
      changed += 1
      return next
    })
  }

  const next = {
    ...data,
    surgeries:patch(data.surgeries || [], 'surgery'),
    consultations:patch(data.consultations || [], 'consultation'),
  }
  return { data:changed > 0 ? next : data, changed }
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run test:unit`
Expected: PASS — 11 testes.

- [ ] **Step 6: Commit**

```bash
git add playwright.unit.config.js package.json src/lib/googleCalendarPayload.js tests/unit/googleCalendarPayload.spec.js
git commit -m "feat(calendar): funcoes puras de sincronizacao com Google Agenda"
```

---

### Task 2: Funções puras do servidor

**Files:**
- Create: `api/_lib/googleCalendar.js`
- Test: `tests/unit/googleCalendarServer.spec.js`

- [ ] **Step 1: Escrever os testes que falham**

`tests/unit/googleCalendarServer.spec.js`:

```js
import { expect, test } from '@playwright/test'
import {
  buildGoogleEvent,
  normalizeGoogleEvent,
  signState,
  snapshotOf,
  verifyState,
} from '../../api/_lib/googleCalendar.js'

const base = { type:'consultation', id:'c1', title:'Ana — Avaliação', timeZone:'America/Sao_Paulo' }

test('buildGoogleEvent com horario', () => {
  const event = buildGoogleEvent({ ...base, date:'2026-10-05', startTime:'14:30', durationMinutes:90 })
  expect(event.summary).toBe('Ana — Avaliação')
  expect(event.start).toEqual({ dateTime:'2026-10-05T14:30:00', timeZone:'America/Sao_Paulo' })
  expect(event.end).toEqual({ dateTime:'2026-10-05T16:00:00', timeZone:'America/Sao_Paulo' })
  expect(event.extendedProperties.private).toEqual({ surgimetricsType:'consultation', surgimetricsId:'c1' })
})

test('buildGoogleEvent cruzando meia-noite', () => {
  const event = buildGoogleEvent({ ...base, date:'2026-10-05', startTime:'23:30', durationMinutes:90 })
  expect(event.end.dateTime).toBe('2026-10-06T01:00:00')
})

test('buildGoogleEvent dia inteiro termina no dia seguinte', () => {
  const event = buildGoogleEvent({ ...base, date:'2026-12-31', startTime:'', durationMinutes:0 })
  expect(event.start).toEqual({ date:'2026-12-31' })
  expect(event.end).toEqual({ date:'2027-01-01' })
})

test('normalizeGoogleEvent evento com horario', () => {
  const normalized = normalizeGoogleEvent({
    id:'g1',
    summary:'Reunião',
    start:{ dateTime:'2026-10-05T14:30:00-03:00' },
    end:{ dateTime:'2026-10-05T16:00:00-03:00' },
    extendedProperties:{ private:{ surgimetricsType:'consultation', surgimetricsId:'c1' } },
  })
  expect(normalized).toMatchObject({
    googleId:'g1', title:'Reunião', date:'2026-10-05', startTime:'14:30',
    durationMinutes:90, allDay:false, cancelled:false, recordType:'consultation', recordId:'c1',
  })
})

test('normalizeGoogleEvent dia inteiro e cancelado', () => {
  const allDay = normalizeGoogleEvent({ id:'g2', summary:'Feriado', start:{ date:'2026-10-12' }, end:{ date:'2026-10-13' } })
  expect(allDay).toMatchObject({ date:'2026-10-12', startTime:'', durationMinutes:0, allDay:true })
  const cancelled = normalizeGoogleEvent({ id:'g3', status:'cancelled' })
  expect(cancelled.cancelled).toBe(true)
})

test('snapshotOf trata dia inteiro sem duracao', () => {
  expect(snapshotOf({ date:'2026-10-05', startTime:'14:30', durationMinutes:60 })).toBe('2026-10-05|14:30|60')
  expect(snapshotOf({ date:'2026-10-05', startTime:'', durationMinutes:0 })).toBe('2026-10-05||')
})

test('state assinado valida, rejeita adulterado e expirado', () => {
  const now = 1_000_000
  const state = signState('user-1', 'segredo', now)
  expect(verifyState(state, 'segredo', now + 1000)).toBe('user-1')
  expect(verifyState(state, 'outro-segredo', now + 1000)).toBeNull()
  expect(verifyState(`${state}x`, 'segredo', now + 1000)).toBeNull()
  expect(verifyState(state, 'segredo', now + 11 * 60 * 1000)).toBeNull()
  expect(verifyState('', 'segredo', now)).toBeNull()
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test:unit -- googleCalendarServer`
Expected: FAIL — módulo `api/_lib/googleCalendar.js` não encontrado.

- [ ] **Step 3: Implementar**

`api/_lib/googleCalendar.js`:

```js
import crypto from 'crypto'

const STATE_TTL_MS = 10 * 60 * 1000

function addDaysIso(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Trata data/hora como horário de parede (sem fuso), evitando efeitos de horário de verão.
function addMinutesToLocal(isoDate, time, minutes) {
  const date = new Date(`${isoDate}T${time}:00Z`)
  date.setUTCMinutes(date.getUTCMinutes() + minutes)
  return date.toISOString().slice(0, 19)
}

export function snapshotOf({ date, startTime, durationMinutes }) {
  return `${date}|${startTime || ''}|${startTime ? durationMinutes : ''}`
}

export function buildGoogleEvent(payload) {
  const base = {
    summary:payload.title,
    description:'Criado pelo SurgiMetrics',
    extendedProperties:{
      private:{ surgimetricsType:payload.type, surgimetricsId:payload.id },
    },
  }

  if (!payload.startTime) {
    return { ...base, start:{ date:payload.date }, end:{ date:addDaysIso(payload.date, 1) } }
  }

  return {
    ...base,
    start:{ dateTime:`${payload.date}T${payload.startTime}:00`, timeZone:payload.timeZone },
    end:{
      dateTime:addMinutesToLocal(payload.date, payload.startTime, payload.durationMinutes),
      timeZone:payload.timeZone,
    },
  }
}

// O Google devolve dateTime já no fuso pedido em `timeZone`, então basta fatiar a string.
export function normalizeGoogleEvent(item) {
  const priv = item.extendedProperties?.private || {}
  const allDay = Boolean(item.start?.date && !item.start?.dateTime)
  let date = ''
  let startTime = ''
  let durationMinutes = 0

  if (allDay) {
    date = item.start.date
  } else if (item.start?.dateTime) {
    const start = item.start.dateTime
    date = start.slice(0, 10)
    startTime = start.slice(11, 16)
    if (item.end?.dateTime) {
      durationMinutes = Math.max(0, Math.round((Date.parse(item.end.dateTime) - Date.parse(start)) / 60000))
    }
  }

  return {
    googleId:item.id,
    title:item.summary || '(sem título)',
    date,
    startTime,
    durationMinutes,
    allDay,
    cancelled:item.status === 'cancelled',
    recordType:priv.surgimetricsType || '',
    recordId:priv.surgimetricsId || '',
  }
}

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

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test:unit`
Expected: PASS — todos os testes (Task 1 + Task 2).

- [ ] **Step 5: Commit**

```bash
git add api/_lib/googleCalendar.js tests/unit/googleCalendarServer.spec.js
git commit -m "feat(calendar): funcoes puras do servidor para Google Agenda"
```

---

### Task 3: Banco (migração) e campos de horário/duração nos formulários

**Files:**
- Create: `supabase/google_calendar_schema.sql`
- Modify: `src/lib/financeStore.js` (leitura ~linhas 133-165, gravação `mapSurgeriesRows`/`mapConsultationsRows`)
- Modify: `src/components/Sales.jsx`, `src/components/Consultations.jsx`

- [ ] **Step 1: Criar a migração**

`supabase/google_calendar_schema.sql`:

```sql
-- Integração Google Agenda (por usuário).
-- Aplicar ANTES de publicar o código que lê/grava start_time e duration_minutes.

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_email text,
  refresh_token_encrypted jsonb not null,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.google_calendar_event_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('surgery', 'consultation')),
  record_id uuid not null,
  google_event_id text not null,
  synced_hash text not null,
  remote_snapshot text not null default '',
  detached boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, record_type, record_id)
);

-- RLS ligada e sem policies: somente o service role (API serverless) acessa.
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_event_links enable row level security;

alter table public.surgeries
  add column if not exists start_time time,
  add column if not exists duration_minutes integer;

alter table public.consultations
  add column if not exists start_time time,
  add column if not exists duration_minutes integer;
```

- [ ] **Step 2: Mapear leitura em `financeStore.js`**

Em `fetchRelationalData`, no objeto de `surgeries`, após `date:item.date || '',` adicionar:

```js
      startTime:String(item.start_time || '').slice(0, 5),
      durationMinutes:Number(item.duration_minutes || 0),
```

No objeto de `consultations`, após `date:item.date || '',` adicionar as mesmas duas linhas.

- [ ] **Step 3: Mapear gravação em `financeStore.js`**

Em `mapSurgeriesRows`, após `date:item.date,` adicionar:

```js
    start_time:item.startTime || null,
    duration_minutes:Number(item.durationMinutes) || null,
```

Em `mapConsultationsRows`, após `date:item.date,` adicionar as mesmas duas linhas.

- [ ] **Step 4: Campos no formulário de cirurgia (`Sales.jsx`)**

No objeto `empty`, após `date:today(),` (primeira ocorrência, dentro de `empty`) adicionar:

```js
    startTime:'',
    durationMinutes:180,
```

Em `openEdit`, no `setForm({ ...item, ...payment, ...` adicionar após `...payment,`:

```js
      startTime:item.startTime || '',
      durationMinutes:item.durationMinutes || 180,
```

No JSX do modal, logo após a linha do `FInput label="Data"` (`type="date"` com `date:value`) inserir:

```jsx
          <FInput label="Horário (opcional)" value={form.startTime} onChange={value => setForm(current => ({ ...current, startTime:value }))} type="time" />
          <FInput label="Duração (min)" value={form.durationMinutes} onChange={value => setForm(current => ({ ...current, durationMinutes:value }))} type="number" placeholder="180" />
```

- [ ] **Step 5: Campos no formulário de consulta (`Consultations.jsx`)**

No objeto `empty`, após `date:today(),` adicionar:

```js
    startTime:'',
    durationMinutes:60,
```

Em `openEdit`, após `...payment,` adicionar:

```js
      startTime:item.startTime || '',
      durationMinutes:item.durationMinutes || 60,
```

No JSX do modal, logo após a linha `FInput label="Data"` inserir:

```jsx
          <FInput label="Horário (opcional)" value={form.startTime} onChange={value => setForm(current => ({ ...current, startTime:value }))} type="time" />
          <FInput label="Duração (min)" value={form.durationMinutes} onChange={value => setForm(current => ({ ...current, durationMinutes:value }))} type="number" placeholder="60" />
```

- [ ] **Step 6: Verificar build e e2e existentes**

Run: `npm run build && npm run e2e`
Expected: build OK; os 3 testes existentes de `session-restore.spec.js` passam.

- [ ] **Step 7: Commit**

```bash
git add supabase/google_calendar_schema.sql src/lib/financeStore.js src/components/Sales.jsx src/components/Consultations.jsx
git commit -m "feat(calendar): horario e duracao em cirurgias e consultas + schema Google Agenda"
```

---

### Task 4: Camada de IO e endpoint do servidor

**Files:**
- Create: `api/_lib/googleCalendarApi.js`
- Create: `api/google/calendar.js`

- [ ] **Step 1: Criar `api/_lib/googleCalendarApi.js`**

```js
import { decryptPayload, encryptPayload, getAdminSupabase } from '../secure-profile/_lib.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const CALENDAR_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary'
export const CALENDAR_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email'
const CONNECTIONS = 'google_calendar_connections'
const LINKS = 'google_calendar_event_links'

export class NeedsReconnectError extends Error {
  constructor() {
    super('needs_reconnect')
    this.name = 'NeedsReconnectError'
  }
}

export function getCalendarConfig() {
  return {
    clientId:process.env.GOOGLE_CLIENT_ID || '',
    clientSecret:process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri:process.env.GOOGLE_CALENDAR_REDIRECT_URI || '',
    appUrl:(process.env.APP_URL || process.env.VITE_APP_URL || '').replace(/\/+$/, ''),
    stateSecret:process.env.APP_DATA_ENCRYPTION_KEY || '',
  }
}

export function isConfigured(config) {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri && config.stateSecret)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function googleFetch(url, options = {}, attempt = 0) {
  const res = await fetch(url, options)
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw:text } }
  if (res.ok) return json

  if ((res.status === 429 || res.status === 503) && attempt < 2) {
    await sleep(400 * Math.pow(2, attempt))
    return googleFetch(url, options, attempt + 1)
  }

  const error = new Error(json.error_description || json.error?.message || json.error || `HTTP ${res.status}`)
  error.status = res.status
  error.code = typeof json.error === 'string' ? json.error : json.error?.status
  throw error
}

function bearer(accessToken) {
  return { Authorization:`Bearer ${accessToken}` }
}

// ---------- OAuth ----------

export function buildAuthUrl(config, state) {
  const params = new URLSearchParams({
    client_id:config.clientId,
    redirect_uri:config.redirectUri,
    response_type:'code',
    access_type:'offline',
    prompt:'consent',
    scope:CALENDAR_SCOPES,
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function exchangeCode(config, code) {
  return googleFetch(TOKEN_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body:new URLSearchParams({
      code,
      client_id:config.clientId,
      client_secret:config.clientSecret,
      redirect_uri:config.redirectUri,
      grant_type:'authorization_code',
    }),
  })
}

export function fetchAccountEmail(accessToken) {
  return googleFetch(USERINFO_URL, { headers:bearer(accessToken) })
}

async function refreshAccessToken(config, refreshToken) {
  try {
    const token = await googleFetch(TOKEN_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body:new URLSearchParams({
        client_id:config.clientId,
        client_secret:config.clientSecret,
        refresh_token:refreshToken,
        grant_type:'refresh_token',
      }),
    })
    return token.access_token
  } catch (error) {
    if (error.code === 'invalid_grant') throw new NeedsReconnectError()
    throw error
  }
}

export async function revokeToken(refreshToken) {
  try {
    await googleFetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method:'POST' })
  } catch {
    // Revogação é best effort: a conexão local é removida de qualquer forma.
  }
}

// ---------- Conexão e vínculos (service role) ----------

export async function getConnection(userId) {
  const { data, error } = await getAdminSupabase().from(CONNECTIONS).select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

export async function saveConnection(userId, { email, refreshToken }) {
  const { error } = await getAdminSupabase().from(CONNECTIONS).upsert({
    user_id:userId,
    account_email:email || null,
    refresh_token_encrypted:encryptPayload({ refreshToken }),
    status:'connected',
    updated_at:new Date().toISOString(),
  }, { onConflict:'user_id' })
  if (error) throw error
}

async function markNeedsReconnect(userId) {
  const { error } = await getAdminSupabase()
    .from(CONNECTIONS)
    .update({ status:'needs_reconnect', updated_at:new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw error
}

export async function deleteConnection(userId) {
  const admin = getAdminSupabase()
  const connection = await getConnection(userId)
  if (connection?.refresh_token_encrypted) {
    const decrypted = decryptPayload(connection.refresh_token_encrypted)
    if (decrypted?.refreshToken) await revokeToken(decrypted.refreshToken)
  }
  const links = await admin.from(LINKS).delete().eq('user_id', userId)
  if (links.error) throw links.error
  const removed = await admin.from(CONNECTIONS).delete().eq('user_id', userId)
  if (removed.error) throw removed.error
}

export async function getAccessToken(config, userId) {
  const connection = await getConnection(userId)
  if (!connection || connection.status !== 'connected') throw new NeedsReconnectError()
  const decrypted = decryptPayload(connection.refresh_token_encrypted)
  if (!decrypted?.refreshToken) throw new NeedsReconnectError()
  try {
    return await refreshAccessToken(config, decrypted.refreshToken)
  } catch (error) {
    if (error instanceof NeedsReconnectError) await markNeedsReconnect(userId)
    throw error
  }
}

export async function getLinks(userId) {
  const { data, error } = await getAdminSupabase().from(LINKS).select('*').eq('user_id', userId)
  if (error) throw error
  return data || []
}

export async function upsertLink(userId, { type, id, googleEventId, hash, snapshot }) {
  const { error } = await getAdminSupabase().from(LINKS).upsert({
    user_id:userId,
    record_type:type,
    record_id:id,
    google_event_id:googleEventId,
    synced_hash:hash,
    remote_snapshot:snapshot,
    detached:false,
    updated_at:new Date().toISOString(),
  }, { onConflict:'user_id,record_type,record_id' })
  if (error) throw error
}

export async function deleteLink(userId, type, id) {
  const { error } = await getAdminSupabase().from(LINKS).delete().eq('user_id', userId).eq('record_type', type).eq('record_id', id)
  if (error) throw error
}

export async function markDetached(userId, type, id) {
  const { error } = await getAdminSupabase()
    .from(LINKS)
    .update({ detached:true, updated_at:new Date().toISOString() })
    .eq('user_id', userId).eq('record_type', type).eq('record_id', id)
  if (error) throw error
}

// ---------- Google Calendar ----------

export async function listEvents(accessToken, { timeMin, timeMax, timeZone }) {
  const items = []
  let pageToken = ''
  for (let page = 0; page < 4; page += 1) {
    const params = new URLSearchParams({
      singleEvents:'true',
      showDeleted:'true',
      orderBy:'startTime',
      maxResults:'250',
      timeMin,
      timeMax,
      timeZone,
    })
    if (pageToken) params.set('pageToken', pageToken)
    const result = await googleFetch(`${CALENDAR_URL}/events?${params.toString()}`, { headers:bearer(accessToken) })
    items.push(...(result.items || []))
    pageToken = result.nextPageToken || ''
    if (!pageToken) break
  }
  return items
}

export function insertEvent(accessToken, event) {
  return googleFetch(`${CALENDAR_URL}/events`, {
    method:'POST',
    headers:{ ...bearer(accessToken), 'Content-Type':'application/json' },
    body:JSON.stringify(event),
  })
}

export function updateEvent(accessToken, eventId, event) {
  return googleFetch(`${CALENDAR_URL}/events/${encodeURIComponent(eventId)}`, {
    method:'PUT',
    headers:{ ...bearer(accessToken), 'Content-Type':'application/json' },
    body:JSON.stringify(event),
  })
}

export async function deleteEvent(accessToken, eventId) {
  try {
    await googleFetch(`${CALENDAR_URL}/events/${encodeURIComponent(eventId)}`, {
      method:'DELETE',
      headers:bearer(accessToken),
    })
  } catch (error) {
    if (error.status !== 404 && error.status !== 410) throw error
  }
}
```

- [ ] **Step 2: Criar o handler `api/google/calendar.js`**

```js
import { getAuthenticatedUser } from '../secure-profile/_lib.js'
import {
  NeedsReconnectError,
  buildAuthUrl,
  deleteConnection,
  deleteEvent,
  deleteLink,
  exchangeCode,
  fetchAccountEmail,
  getAccessToken,
  getCalendarConfig,
  getConnection,
  getLinks,
  insertEvent,
  isConfigured,
  listEvents,
  markDetached,
  saveConnection,
  updateEvent,
  upsertLink,
} from '../_lib/googleCalendarApi.js'
import { buildGoogleEvent, normalizeGoogleEvent, signState, snapshotOf, verifyState } from '../_lib/googleCalendar.js'

const MAX_ITEMS_PER_SYNC = 50
const MAX_EVENTS_RANGE_MS = 62 * 24 * 60 * 60 * 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

function linkKey(type, id) {
  return `${type}:${id}`
}

function isValidUpsert(item) {
  return item
    && (item.type === 'surgery' || item.type === 'consultation')
    && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
    && typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 300
    && DATE_RE.test(item.date || '')
    && (item.startTime === '' || TIME_RE.test(item.startTime || ''))
    && Number.isInteger(item.durationMinutes) && item.durationMinutes >= 0 && item.durationMinutes <= 1440
    && typeof item.timeZone === 'string' && item.timeZone.length > 0 && item.timeZone.length <= 64
    && typeof item.hash === 'string' && item.hash.length > 0 && item.hash.length <= 64
}

function isValidDelete(item) {
  return item
    && (item.type === 'surgery' || item.type === 'consultation')
    && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
}

function sendError(res, error) {
  if (error instanceof NeedsReconnectError) return res.status(409).json({ error:'needs_reconnect' })
  const unauthorized = /bearer token|auth token/i.test(error.message || '')
  return res.status(unauthorized ? 401 : 500).json({ error:error.message || 'Erro na integracao com a Google Agenda.' })
}

async function handleCallback(req, res, config) {
  const back = result => res.redirect(`${config.appUrl}/app/calendar?google=${result}`)
  try {
    if (req.query.error) return back('denied')
    const userId = verifyState(req.query.state, config.stateSecret)
    if (!userId) return res.status(400).send('Estado de autorizacao invalido ou expirado.')

    const token = await exchangeCode(config, String(req.query.code))
    if (!String(token.scope || '').includes('calendar.events')) return back('scope')
    if (!token.refresh_token) return back('error')

    const profile = await fetchAccountEmail(token.access_token).catch(() => ({}))
    await saveConnection(userId, { email:profile.email || '', refreshToken:token.refresh_token })
    return back('connected')
  } catch {
    return back('error')
  }
}

async function handleStatus(req, res, config) {
  if (!isConfigured(config)) return res.status(200).json({ configured:false, connected:false })
  const user = await getAuthenticatedUser(req)
  const connection = await getConnection(user.id)
  const links = connection ? await getLinks(user.id) : []
  return res.status(200).json({
    configured:true,
    connected:connection?.status === 'connected',
    needsReconnect:connection?.status === 'needs_reconnect',
    email:connection?.account_email || '',
    links:Object.fromEntries(links.map(link => [linkKey(link.record_type, link.record_id), link.synced_hash])),
  })
}

async function handleConnect(req, res, config) {
  if (!isConfigured(config)) return res.status(503).json({ error:'Integracao Google Agenda nao configurada.' })
  const user = await getAuthenticatedUser(req)
  const state = signState(user.id, config.stateSecret)
  return res.status(200).json({ url:buildAuthUrl(config, state) })
}

async function handleDisconnect(req, res) {
  const user = await getAuthenticatedUser(req)
  await deleteConnection(user.id)
  return res.status(200).json({ ok:true })
}

async function handleEvents(req, res, config) {
  const user = await getAuthenticatedUser(req)
  const timeMin = String(req.query.timeMin || '')
  const timeMax = String(req.query.timeMax || '')
  const timeZone = String(req.query.timeZone || 'America/Sao_Paulo')
  const from = Date.parse(timeMin)
  const to = Date.parse(timeMax)
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > MAX_EVENTS_RANGE_MS) {
    return res.status(400).json({ error:'Intervalo invalido.' })
  }

  const accessToken = await getAccessToken(config, user.id)
  const items = await listEvents(accessToken, { timeMin, timeMax, timeZone })
  const links = await getLinks(user.id)
  const linkByEvent = new Map(links.map(link => [link.google_event_id, link]))

  const events = []
  for (const item of items) {
    const event = normalizeGoogleEvent(item)
    const link = linkByEvent.get(event.googleId)
    if (event.cancelled) {
      if (link && !link.detached) await markDetached(user.id, link.record_type, link.record_id)
      continue
    }
    if (!link) {
      events.push({ ...event, linked:false, externalChange:false })
      continue
    }
    events.push({ ...event, linked:true, externalChange:snapshotOf(event) !== link.remote_snapshot })
  }

  return res.status(200).json({ events })
}

async function handleSync(req, res, config) {
  const user = await getAuthenticatedUser(req)
  const upserts = Array.isArray(req.body?.upserts) ? req.body.upserts : []
  const deletes = Array.isArray(req.body?.deletes) ? req.body.deletes : []
  if (upserts.length > MAX_ITEMS_PER_SYNC || deletes.length > MAX_ITEMS_PER_SYNC) {
    return res.status(400).json({ error:'Lote grande demais.' })
  }
  if (!upserts.every(isValidUpsert) || !deletes.every(isValidDelete)) {
    return res.status(400).json({ error:'Payload invalido.' })
  }

  const accessToken = await getAccessToken(config, user.id)
  const existing = new Map((await getLinks(user.id)).map(link => [linkKey(link.record_type, link.record_id), link]))
  const result = { links:{}, deleted:[], errors:[] }

  for (const item of upserts) {
    const key = linkKey(item.type, item.id)
    try {
      const link = existing.get(key)
      if (link && !link.detached && link.synced_hash === item.hash) {
        result.links[key] = item.hash
        continue
      }

      const event = buildGoogleEvent(item)
      let eventId = link && !link.detached ? link.google_event_id : null
      if (eventId) {
        try {
          await updateEvent(accessToken, eventId, event)
        } catch (error) {
          if (error.status === 404 || error.status === 410) eventId = null
          else throw error
        }
      }
      if (!eventId) eventId = (await insertEvent(accessToken, event)).id

      await upsertLink(user.id, { type:item.type, id:item.id, googleEventId:eventId, hash:item.hash, snapshot:snapshotOf(item) })
      result.links[key] = item.hash
    } catch (error) {
      if (error instanceof NeedsReconnectError) throw error
      result.errors.push({ key, message:error.message })
    }
  }

  for (const item of deletes) {
    const key = linkKey(item.type, item.id)
    try {
      const link = existing.get(key)
      if (link && !link.detached) await deleteEvent(accessToken, link.google_event_id)
      if (link) await deleteLink(user.id, item.type, item.id)
      result.deleted.push(key)
    } catch (error) {
      if (error instanceof NeedsReconnectError) throw error
      result.errors.push({ key, message:error.message })
    }
  }

  return res.status(200).json(result)
}

export default async function handler(req, res) {
  const config = getCalendarConfig()
  try {
    if (req.method === 'GET' && (req.query?.code || req.query?.error)) return await handleCallback(req, res, config)

    const action = String(req.query?.action || '')
    const routes = {
      status:{ method:'GET', run:handleStatus },
      events:{ method:'GET', run:handleEvents },
      connect:{ method:'POST', run:handleConnect },
      disconnect:{ method:'POST', run:handleDisconnect },
      sync:{ method:'POST', run:handleSync },
    }
    const route = routes[action]
    if (!route) return res.status(404).json({ error:'Acao desconhecida.' })
    if (req.method !== route.method) {
      res.setHeader('Allow', route.method)
      return res.status(405).json({ error:'Method not allowed' })
    }
    if (action !== 'status' && action !== 'connect' && !isConfigured(config)) {
      return res.status(503).json({ error:'Integracao Google Agenda nao configurada.' })
    }
    return await route.run(req, res, config)
  } catch (error) {
    return sendError(res, error)
  }
}
```

- [ ] **Step 3: Verificar sintaxe (ESM) sem rodar no Google**

Run: `node --input-type=module -e "import('./api/google/calendar.js').then(m => console.log(typeof m.default))"`
Expected: `function` (se aparecer erro de `Cannot use import statement`, rode com `node --experimental-default-type=module` ou ignore e valide pelo `npm run build` + teste na Vercel; os arquivos de `api/` já usam ESM no resto do projeto).

- [ ] **Step 4: Verificar roteamento básico com handler simulado**

Run:
```bash
node --input-type=module -e "
import handler from './api/google/calendar.js'
const res = { statusCode:0, headers:{}, setHeader(k,v){this.headers[k]=v}, status(c){this.statusCode=c;return this}, json(b){console.log(this.statusCode, JSON.stringify(b))}, send(b){console.log(this.statusCode,b)}, redirect(u){console.log('redirect',u)} }
await handler({ method:'GET', query:{ action:'status' }, headers:{} }, res)
await handler({ method:'GET', query:{ action:'foo' }, headers:{} }, res)
await handler({ method:'GET', query:{ action:'sync' }, headers:{} }, res)
"
```
Expected (sem variáveis de ambiente do Google): `200 {"configured":false,"connected":false}`, `404 {"error":"Acao desconhecida."}`, `405 {"error":"Method not allowed"}`.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/googleCalendarApi.js api/google/calendar.js
git commit -m "feat(calendar): endpoint de Google Agenda (conectar, sincronizar, listar eventos)"
```

---

### Task 5: Cliente HTTP, hook de sincronização e ligação no workspace

**Files:**
- Create: `src/lib/googleCalendarClient.js`
- Create: `src/lib/useGoogleCalendarSync.js`
- Modify: `src/pages/FinanceWorkspace.jsx`

- [ ] **Step 1: Criar `src/lib/googleCalendarClient.js`**

```js
import { supabase } from './supabase.js'

const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'
const ENDPOINT = '/api/google/calendar'

async function getAccessToken() {
  if (E2E_BYPASS_AUTH) return 'e2e-token'
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sessao expirada. Entre novamente.')
  return token
}

async function request(action, { method = 'GET', query = {}, body } = {}) {
  const token = await getAccessToken()
  const params = new URLSearchParams({ action, ...query })
  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    method,
    headers:{
      Authorization:`Bearer ${token}`,
      ...(body ? { 'Content-Type':'application/json' } : {}),
    },
    body:body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(json.error || `HTTP ${res.status}`)
    error.status = res.status
    error.needsReconnect = json.error === 'needs_reconnect'
    throw error
  }
  return json
}

export const getGoogleCalendarStatus = () => request('status')
export const startGoogleCalendarConnection = () => request('connect', { method:'POST' })
export const disconnectGoogleCalendar = () => request('disconnect', { method:'POST' })
export const fetchGoogleEvents = ({ timeMin, timeMax, timeZone }) => request('events', { query:{ timeMin, timeMax, timeZone } })
export const syncGoogleCalendar = ({ upserts, deletes }) => request('sync', { method:'POST', body:{ upserts, deletes } })
```

- [ ] **Step 2: Criar `src/lib/useGoogleCalendarSync.js`**

```js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  startGoogleCalendarConnection,
  syncGoogleCalendar,
} from './googleCalendarClient.js'
import { MAX_SYNC_BATCH, collectSyncChanges, getBrowserTimeZone, localTodayIso } from './googleCalendarPayload.js'

const SYNC_DEBOUNCE_MS = 1500
const INITIAL_STATUS = { loading:true, configured:false, connected:false, needsReconnect:false, email:'' }

// `enabled` deve ser true somente depois que o dataset foi carregado, para nunca
// interpretar "ainda não carregou" como "o usuário apagou tudo".
export function useGoogleCalendarSync({ data, enabled }) {
  const [status, setStatus] = useState(INITIAL_STATUS)
  const [syncError, setSyncError] = useState('')
  const [tick, setTick] = useState(0)
  const linksRef = useRef({})
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  const timeZone = useMemo(() => getBrowserTimeZone(), [])

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getGoogleCalendarStatus()
      linksRef.current = next.links || {}
      setStatus({
        loading:false,
        configured:Boolean(next.configured),
        connected:Boolean(next.connected),
        needsReconnect:Boolean(next.needsReconnect),
        email:next.email || '',
      })
    } catch {
      setStatus(current => ({ ...current, loading:false }))
    }
  }, [])

  const markNeedsReconnect = useCallback(() => {
    setStatus(current => ({ ...current, connected:false, needsReconnect:true }))
  }, [])

  useEffect(() => {
    if (enabled) refreshStatus()
  }, [enabled, refreshStatus])

  useEffect(() => {
    if (!enabled || !status.connected) return undefined

    const timer = setTimeout(async () => {
      if (inFlightRef.current) {
        pendingRef.current = true
        return
      }

      const { upserts, deletes } = collectSyncChanges({
        data,
        links:linksRef.current,
        todayIso:localTodayIso(),
        timeZone,
      })
      if (upserts.length === 0 && deletes.length === 0) return

      inFlightRef.current = true
      try {
        const result = await syncGoogleCalendar({
          upserts:upserts.slice(0, MAX_SYNC_BATCH),
          deletes:deletes.slice(0, MAX_SYNC_BATCH),
        })
        const nextLinks = { ...linksRef.current, ...result.links }
        for (const key of result.deleted || []) delete nextLinks[key]
        linksRef.current = nextLinks
        setSyncError(result.errors?.length ? 'Alguns itens não foram enviados à Google Agenda.' : '')
        if (upserts.length > MAX_SYNC_BATCH || deletes.length > MAX_SYNC_BATCH) pendingRef.current = true
      } catch (error) {
        if (error.needsReconnect) markNeedsReconnect()
        setSyncError('Não foi possível sincronizar com a Google Agenda.')
      } finally {
        inFlightRef.current = false
        if (pendingRef.current) {
          pendingRef.current = false
          setTick(value => value + 1)
        }
      }
    }, SYNC_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [data, enabled, status.connected, timeZone, tick, markNeedsReconnect])

  const connect = useCallback(async () => {
    const { url } = await startGoogleCalendarConnection()
    window.location.assign(url)
  }, [])

  const disconnect = useCallback(async () => {
    await disconnectGoogleCalendar()
    linksRef.current = {}
    setSyncError('')
    setStatus(current => ({ ...current, connected:false, needsReconnect:false, email:'' }))
  }, [])

  return { status, syncError, timeZone, connect, disconnect, refreshStatus, markNeedsReconnect }
}
```

- [ ] **Step 3: Ligar no `FinanceWorkspace.jsx`**

Adicionar o import junto dos outros imports de `../lib/`:

```js
import { useGoogleCalendarSync } from '../lib/useGoogleCalendarSync.js'
```

Logo após a linha `const setData = updater => setRaw(...)` (antes de `const hasData = useMemo(...)`), adicionar:

```js
  const google = useGoogleCalendarSync({ data:safeData, enabled:!loading })
```

Na renderização da página, trocar:

```jsx
<Page data={safeData} setData={setData} saveError={saveError} />
```

por:

```jsx
<Page data={safeData} setData={setData} saveError={saveError} google={google} />
```

- [ ] **Step 4: Verificar build e e2e existentes**

Run: `npm run build && npm run e2e`
Expected: build OK; 3 testes existentes passam (a chamada `status` em ambiente sem endpoint falha silenciosamente e o hook fica desconectado).

- [ ] **Step 5: Commit**

```bash
git add src/lib/googleCalendarClient.js src/lib/useGoogleCalendarSync.js src/pages/FinanceWorkspace.jsx
git commit -m "feat(calendar): hook de sincronizacao com Google Agenda no workspace"
```

---

### Task 6: Interface — barra de conexão e Agenda com eventos do Google

**Files:**
- Create: `src/components/GoogleCalendarBar.jsx`
- Modify: `src/components/Calendar.jsx`

- [ ] **Step 1: Criar `src/components/GoogleCalendarBar.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { C } from '../theme.js'
import { Btn, Card, ConfirmModal } from './UI.jsx'

function getResultMessages() {
  return {
    connected:{ text:'Google Agenda conectada com sucesso.', color:C.green },
    denied:{ text:'Conexão cancelada. Nenhuma permissão foi concedida.', color:C.yellow },
    scope:{ text:'A permissão de agenda não foi concedida. Marque a opção de gerenciar eventos ao conectar.', color:C.yellow },
    error:{ text:'Não foi possível conectar à Google Agenda. Tente novamente.', color:C.red },
  }
}

export function GoogleCalendarBar({ google }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [result, setResult] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    const code = new URLSearchParams(location.search).get('google')
    if (!code) return
    setResult(getResultMessages()[code] || null)
    navigate(location.pathname, { replace:true })
  }, [location.search, location.pathname, navigate])

  if (!google || !google.status.configured) return null
  const { status, syncError } = google

  async function run(action) {
    setBusy(true)
    setActionError('')
    try {
      await action()
    } catch (error) {
      setActionError(error.message || 'Não foi possível concluir a ação.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ padding:'14px 18px' }}>
      <div style={{ display:'flex', gap:14, alignItems:'center', justifyContent:'space-between', flexWrap:'wrap' }}>
        {status.connected ? (
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text }}>
              <span style={{ color:C.green, marginRight:6 }}>●</span>Google Agenda conectada
            </div>
            <div style={{ fontSize:12, color:C.textDim, marginTop:2 }}>
              {status.email ? `${status.email} · ` : ''}consultas e cirurgias futuras são enviadas automaticamente.
            </div>
          </div>
        ) : (
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text }}>
              {status.needsReconnect ? 'A conexão com a Google Agenda expirou' : 'Conecte sua Google Agenda'}
            </div>
            <div style={{ fontSize:12, color:C.textDim, marginTop:2, lineHeight:1.5 }}>
              Envie consultas e cirurgias para a sua agenda e veja seus eventos do Google aqui.
              Ao conectar, o nome completo do paciente e o procedimento passam a constar nos eventos da sua Google Agenda.
            </div>
          </div>
        )}

        {status.connected ? (
          <Btn variant="ghost" disabled={busy} onClick={() => setConfirmOpen(true)}>Desconectar</Btn>
        ) : (
          <Btn disabled={busy} onClick={() => run(google.connect)}>
            {status.needsReconnect ? 'Reconectar' : 'Conectar Google Agenda'}
          </Btn>
        )}
      </div>

      {result && <div style={{ marginTop:10, fontSize:12, color:result.color }}>{result.text}</div>}
      {syncError && status.connected && <div style={{ marginTop:10, fontSize:12, color:C.yellow }}>{syncError}</div>}
      {actionError && <div style={{ marginTop:10, fontSize:12, color:C.red }}>{actionError}</div>}

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => run(google.disconnect)}
        title="Desconectar Google Agenda"
        message="Os eventos já criados continuam na sua Google Agenda, mas deixam de ser atualizados pela plataforma."
        confirmLabel="Desconectar"
      />
    </Card>
  )
}
```

- [ ] **Step 2: Editar imports e assinatura de `Calendar.jsx`**

Substituir o bloco de imports do topo por:

```jsx
import { useMemo, useState, useRef, useEffect } from 'react'
import { C } from '../theme.js'
import { fmt } from '../utils.js'
import { Card } from './UI.jsx'
import { GoogleCalendarBar } from './GoogleCalendarBar.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { fetchGoogleEvents } from '../lib/googleCalendarClient.js'
import { applyExternalChanges } from '../lib/googleCalendarPayload.js'
```

Logo antes de `export function Calendar`, adicionar:

```jsx
function eventColor(type) {
  if (type === 'surgery') return C.accent
  if (type === 'google') return C.yellow
  return C.cyan
}

function eventTypeLabel(type) {
  if (type === 'surgery') return 'Cirurgia'
  if (type === 'google') return 'Google Agenda'
  return 'Consulta'
}
```

Trocar a assinatura e adicionar estado/efeito logo após `const popoverRef = useRef(null)`:

```jsx
export function Calendar({ data, setData, google }) {
```

```jsx
  const { toast } = useToast()
  const dataRef = useRef(data)
  dataRef.current = data
  const [googleEvents, setGoogleEvents] = useState([])
  const googleConnected = Boolean(google?.status.connected)

  useEffect(() => {
    if (!googleConnected) {
      setGoogleEvents([])
      return undefined
    }
    let active = true
    const timeMin = new Date(year, month, 1).toISOString()
    const timeMax = new Date(year, month + 1, 1).toISOString()
    fetchGoogleEvents({ timeMin, timeMax, timeZone:google.timeZone })
      .then(({ events = [] }) => {
        if (!active) return
        setGoogleEvents(events)
        const { changed } = applyExternalChanges(dataRef.current, events)
        if (changed > 0) {
          setData(current => applyExternalChanges(current, events).data)
          toast(`${changed} item(ns) atualizado(s) a partir da Google Agenda.`, 'success')
        }
      })
      .catch(error => {
        if (active && error.needsReconnect) google.markNeedsReconnect()
      })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleConnected, year, month])
```

- [ ] **Step 3: Incluir horário e eventos do Google em `eventsByDay`**

Nos dois `map[day].push({...})` existentes (cirurgias e consultas), adicionar a propriedade `time:item.startTime || '',` após `id:item.id,`.

Após o `forEach` de consultas e antes de `return map`, inserir:

```jsx
    const localIds = new Set([...(data.surgeries || []), ...(data.consultations || [])].map(item => item.id))
    googleEvents.forEach(event => {
      if (!event.date || !event.date.startsWith(monthStr)) return
      if (event.recordId && localIds.has(event.recordId)) return
      const day = parseInt(event.date.slice(8, 10), 10)
      if (!map[day]) map[day] = []
      map[day].push({ type:'google', label:event.title, value:0, id:`google:${event.googleId}`, time:event.startTime || '' })
    })

    Object.values(map).forEach(list => list.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')))
```

Trocar a lista de dependências `}, [data, year, month])` desse `useMemo` por `}, [data, year, month, googleEvents])`.

- [ ] **Step 4: Contadores, legenda e subtítulo**

Após a linha de `consultationCount`, adicionar:

```jsx
  const googleCount = Object.values(eventsByDay).reduce((acc, arr) => acc + arr.filter(e => e.type === 'google').length, 0)
  const totalCount = surgeryCount + consultationCount + googleCount
```

Na legenda, após o bloco da consulta (o `<div>` com `consultationCount`), inserir:

```jsx
        {googleConnected && (
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ width:10, height:10, borderRadius:'50%', background:C.yellow, display:'inline-block', flexShrink:0 }} />
            <span style={{ fontSize:12, color:C.textSub }}>{googleCount} evento{googleCount !== 1 ? 's' : ''} do Google</span>
          </div>
        )}
```

No subtítulo do cabeçalho do mês, trocar `{surgeryCount + consultationCount} evento{(surgeryCount + consultationCount) !== 1 ? 's' : ''} neste mês` por `{totalCount} evento{totalCount !== 1 ? 's' : ''} neste mês`.

- [ ] **Step 5: Barra de conexão, ponto do Google no dia e popover**

No início do `return (` do componente, antes do bloco `{/* Legend + summary */}`, inserir:

```jsx
      <GoogleCalendarBar google={google} />
```

Na célula do dia, após `const hasConsultation = ...` adicionar `const hasGoogle = dayEvents.some(e => e.type === 'google')`; trocar a condição `{(hasSurgery || hasConsultation) && (` por `{(hasSurgery || hasConsultation || hasGoogle) && (`; e, após o bloco `{hasConsultation && (...)}`, adicionar:

```jsx
                        {hasGoogle && (
                          <span style={{
                            width:7,
                            height:7,
                            borderRadius:'50%',
                            background:C.yellow,
                            display:'inline-block',
                            boxShadow:`0 0 4px ${C.yellow}88`,
                          }} title="Google Agenda" />
                        )}
```

No popover, substituir os usos binários de cor/rótulo:
- `background: ev.type === 'surgery' ? C.accent + '10' : C.cyan + '10',` → `background: eventColor(ev.type) + '10',`
- `border:\`1px solid ${ev.type === 'surgery' ? C.accent : C.cyan}22\`,` → `border:\`1px solid ${eventColor(ev.type)}22\`,`
- `background:ev.type === 'surgery' ? C.accent : C.cyan,` (o ponto de 8px) → `background:eventColor(ev.type),`
- `{ev.type === 'surgery' ? 'Cirurgia' : 'Consulta'}` → `{ev.time ? \`${ev.time} · \` : ''}{eventTypeLabel(ev.type)}`

- [ ] **Step 6: Verificar build e e2e existentes**

Run: `npm run build && npm run e2e`
Expected: build OK; 3 testes existentes passam.

- [ ] **Step 7: Commit**

```bash
git add src/components/GoogleCalendarBar.jsx src/components/Calendar.jsx
git commit -m "feat(calendar): conectar Google Agenda e exibir eventos na Agenda"
```

---

### Task 7: Testes e2e (Google simulado por interceptação de rede)

**Files:**
- Create: `tests/e2e/google-calendar.spec.js`

- [ ] **Step 1: Escrever os testes**

```js
import { expect, test } from '@playwright/test'

const CONNECTED = { configured:true, connected:true, needsReconnect:false, email:'medico@example.com', links:{} }

async function mockGoogleCalendar(page, { status, events = [] }) {
  const syncBodies = []
  await page.addInitScript(() => {
    window.localStorage.setItem('surgimetrics_onboarded', 'true')
  })
  await page.route(/\/api\/google\/calendar\?/, async route => {
    const action = new URL(route.request().url()).searchParams.get('action')
    if (action === 'status') return route.fulfill({ json:status })
    if (action === 'events') return route.fulfill({ json:{ events } })
    if (action === 'sync') {
      syncBodies.push(route.request().postDataJSON())
      return route.fulfill({ json:{ links:{}, deleted:[], errors:[] } })
    }
    if (action === 'connect') return route.fulfill({ json:{ url:'/app/calendar?google=connected' } })
    if (action === 'disconnect') return route.fulfill({ json:{ ok:true } })
    return route.fulfill({ status:404, json:{ error:'not found' } })
  })
  return syncBodies
}

function todayIso() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

test('mostra botao de conectar e confirma conexao ao voltar do Google', async ({ page }) => {
  await mockGoogleCalendar(page, { status:{ configured:true, connected:false, needsReconnect:false, email:'', links:{} } })
  await page.goto('/app/calendar')

  await expect(page.getByText('Conecte sua Google Agenda')).toBeVisible()
  await page.getByRole('button', { name:'Conectar Google Agenda' }).click()

  await expect(page.getByText('Google Agenda conectada com sucesso.')).toBeVisible()
  await expect(page).toHaveURL(/\/app\/calendar$/)
})

test('mostra Reconectar quando a conexao expirou', async ({ page }) => {
  await mockGoogleCalendar(page, { status:{ configured:true, connected:false, needsReconnect:true, email:'', links:{} } })
  await page.goto('/app/calendar')

  await expect(page.getByText('A conexão com a Google Agenda expirou')).toBeVisible()
  await expect(page.getByRole('button', { name:'Reconectar' })).toBeVisible()
})

test('mostra eventos do Google no calendario', async ({ page }) => {
  await mockGoogleCalendar(page, {
    status:CONNECTED,
    events:[{
      googleId:'g1', title:'Reunião de equipe', date:todayIso(), startTime:'10:00', durationMinutes:60,
      allDay:false, cancelled:false, recordType:'', recordId:'', linked:false, externalChange:false,
    }],
  })
  await page.goto('/app/calendar')

  await expect(page.getByText('Google Agenda conectada', { exact:true })).toBeVisible()
  await expect(page.getByText('medico@example.com', { exact:false })).toBeVisible()
  await expect(page.getByText('1 evento do Google')).toBeVisible()
})

test('envia consulta com horario para a Google Agenda ao salvar', async ({ page }) => {
  const syncBodies = await mockGoogleCalendar(page, { status:CONNECTED })
  await page.goto('/app/consultations')

  await page.getByRole('button', { name:'+ Nova Consulta' }).click()
  await page.getByPlaceholder('Use somente o dado mínimo necessário').fill('Maria da Silva')
  await page.locator('input[type="date"]').first().fill('2099-01-10')
  await page.locator('input[type="time"]').fill('14:30')
  await page.getByRole('button', { name:'Salvar consulta' }).click()

  await expect.poll(() => syncBodies.length, { timeout:8000 }).toBeGreaterThan(0)
  expect(syncBodies[0].upserts[0]).toMatchObject({
    type:'consultation',
    title:'Maria da Silva — Avaliação',
    date:'2099-01-10',
    startTime:'14:30',
    durationMinutes:60,
  })
})
```

- [ ] **Step 2: Rodar os e2e**

Run: `npm run e2e`
Expected: PASS — 3 testes antigos + 4 novos. Se `mostra eventos do Google` falhar por o dia atual cair fora do mês exibido, conferir `todayIso()` (usa data local, igual ao calendário).

- [ ] **Step 3: Rodar tudo**

Run: `npm run test:unit && npm run e2e && npm run build`
Expected: tudo verde.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/google-calendar.spec.js
git commit -m "test(calendar): e2e da integracao com Google Agenda"
```

---

### Task 8: Documentação, variáveis de ambiente e checklist de publicação

**Files:**
- Modify: `.env.example`, `CHANGELOG.md`, `PROJECT_MEMORY.md`, `docs/lgpd_compliance.md`
- Modify: `docs/superpowers/specs/2026-10-03-google-calendar-integration-design.md` (nota de refinamentos)

- [ ] **Step 1: `.env.example`** — adicionar ao final:

```
GOOGLE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=seu-client-secret
GOOGLE_CALENDAR_REDIRECT_URI=https://surgimetrics.com.br/api/google/calendar
```

- [ ] **Step 2: `CHANGELOG.md`** — dentro de `## [Unreleased] - 2026-10-03`, em `### Added`, acrescentar:

```
- Integração com Google Agenda na tela Agenda: botão "Conectar Google Agenda", envio automático de consultas e cirurgias (de hoje em diante) como eventos com `Nome completo — Procedimento`, exibição dos eventos do Google no calendário (somente leitura) e atualização do registro quando o horário de um evento vinculado é alterado no Google. Novos campos opcionais "Horário" e "Duração" em consultas e cirurgias. Endpoint único `api/google/calendar.js`, tabelas `google_calendar_connections` e `google_calendar_event_links` e colunas `start_time`/`duration_minutes` (migração `supabase/google_calendar_schema.sql`).
```

- [ ] **Step 3: `docs/lgpd_compliance.md`** — adicionar seção:

```
## Integração Google Agenda

- Quando o usuário conecta a Google Agenda, o nome completo do paciente e o procedimento/tipo de consulta são enviados como título de evento para a conta Google do próprio usuário (controlador). O aviso é exibido na tela de conexão.
- O refresh token é armazenado criptografado (AES-256-GCM) em `google_calendar_connections`, com RLS sem policies (acesso apenas pelo service role).
- Ao desconectar, o token é revogado no Google e conexão e vínculos são apagados; eventos já criados permanecem na agenda do usuário.
- Escopos solicitados: `calendar.events` e `userinfo.email`.
```

- [ ] **Step 4: `PROJECT_MEMORY.md`** — registrar em seção de integrações (ou ao final): integração Google Agenda, arquivos principais (`api/google/calendar.js`, `api/_lib/googleCalendar*.js`, `src/lib/useGoogleCalendarSync.js`, `src/components/GoogleCalendarBar.jsx`), regra de sincronizar só registros de hoje em diante, limite de 12 funções Vercel (endpoint único) e a ordem de deploy (migração antes do código).

- [ ] **Step 5: Spec** — no topo de `docs/superpowers/specs/2026-10-03-google-calendar-integration-design.md`, logo após a linha `Status:`, adicionar: `Refinamentos feitos no plano de implementação: ver docs/superpowers/plans/2026-10-03-google-calendar-integration.md (endpoint único, remote_snapshot, token jsonb, sincronização só de hoje em diante).`

- [ ] **Step 6: Commit**

```bash
git add .env.example CHANGELOG.md PROJECT_MEMORY.md docs/lgpd_compliance.md docs/superpowers/specs/2026-10-03-google-calendar-integration-design.md
git commit -m "docs: documentar integracao Google Agenda"
```

- [ ] **Step 7: Checklist de publicação (executar manualmente, nesta ordem)**

1. Supabase → SQL Editor: executar `supabase/google_calendar_schema.sql`. Conferir: `select column_name from information_schema.columns where table_name in ('surgeries','consultations') and column_name in ('start_time','duration_minutes');` retorna 4 linhas.
2. Google Cloud Console (mesmo projeto do `GOOGLE_CLIENT_ID`): ativar **Google Calendar API**; em Credenciais → OAuth client → adicionar o URI de redirecionamento `https://<dominio>/api/google/calendar`; em Tela de consentimento → adicionar o escopo `calendar.events` e, enquanto em modo de teste, cadastrar as contas testadoras.
3. Vercel → variáveis de ambiente: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` (idêntico ao URI autorizado), além de `APP_URL` e `APP_DATA_ENCRYPTION_KEY` (já existentes).
4. Publicar (`git push`).
5. Teste manual com conta testadora: conectar; criar consulta com horário futuro e ver o evento no Google; mover o evento no Google, reabrir a Agenda e ver o registro atualizado com aviso; excluir a consulta e ver o evento sumir; apagar o evento no Google e confirmar que o registro permanece; desconectar e confirmar que os eventos antigos continuam no Google.
6. Para liberar a clientes: submeter o app à verificação do Google (escopo sensível).

---

## Auto-revisão do plano

- **Cobertura da spec:** conectar/status/desconectar/callback (Task 4, 6), plataforma→Google com horário/duração e título completo (Tasks 1, 3, 4, 5), Google→plataforma somente leitura + atualização de vinculados + `detached` (Tasks 4, 6), erros/`needs_reconnect`/retries/config ausente (Tasks 4, 5, 6), LGPD e aviso (Tasks 6, 8), testes (Tasks 1, 2, 7), docs/CHANGELOG (Task 8).
- **Consistência de nomes:** `collectSyncChanges`, `applyExternalChanges`, `buildSyncPayload`, `MAX_SYNC_BATCH` (Task 1) usados em Tasks 5 e 6; `snapshotOf`, `buildGoogleEvent`, `normalizeGoogleEvent`, `signState`, `verifyState` (Task 2) usados em Task 4; `google` = `{ status, syncError, timeZone, connect, disconnect, refreshStatus, markNeedsReconnect }` (Task 5) usado em Task 6.
- **Sem placeholders:** todos os passos de código trazem o código completo.
