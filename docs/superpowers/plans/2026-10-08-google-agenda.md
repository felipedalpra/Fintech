# Google Agenda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar a integração Google Calendar já implementada na branch `feat/google-calendar` ao projeto Google Cloud correto e fazer o deploy em produção.

**Pré-requisito:** O código está escrito — este plano é sobre configuração e deploy, não sobre nova implementação. A branch `feat/google-calendar` contém toda a lógica; este plano cobre: aplicar o schema SQL no Supabase, configurar o projeto Google Cloud correto, definir as env vars, e fazer o merge.

**Architecture:** OAuth 2.0 — o usuário autoriza o acesso ao próprio Google Calendar. O token é guardado no Supabase (tabela `google_calendar_tokens`). O backend (`api/google/calendar.js`) usa o token para criar/listar/deletar eventos via Google Calendar API. Sem sincronização bidirecional em tempo real — o frontend busca eventos ao abrir a agenda.

**Tech Stack:** React 18, Supabase, Vercel serverless, Google Calendar API v3

---

## Padrão e contexto (atualizado 2026-10-10)

> Alinha o plano à spec de arquitetura `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`. As Tasks abaixo (config e deploy) continuam válidas — o código já existe na branch `feat/google-calendar`.

**Contexto do cliente:** sincronização bidirecional com o Google Agenda da clínica — item da Fase 1. Já implementado; falta conectar ao projeto Google Cloud correto e publicar (checklist na Task 8 e no `PROJECT_MEMORY`).

**Área e navegação:** a **Agenda** vive na área **Pacientes (CRM & Jornada)** (todos usam); a **conexão/config do Google** vive na área **Automações & Integrações** (só admin). Mesma integração, dois lugares conforme o uso.

**Benchmark:** Google Calendar nativo (ida e volta de eventos). Sem reinventar — usar a Calendar API v3 já integrada.

**Modelo de dados e propagação ("um dado, várias portas"):**
- O evento do Google é **derivado** de um registro-fonte (cirurgia/consulta) — `start_time` e `duration_minutes` saem do registro. Não existe "evento solto" que divirja do atendimento.
- Propagação: mudar data/hora/duração de uma cirurgia/consulta deve **refletir no Google** (e vice-versa quando aplicável), sem criar duplicatas. Só sincroniza registros de hoje em diante ou já vinculados.
- Token OAuth por usuário em `google_calendar_tokens` (RLS por `auth.uid()`); nada cross-tenant.

**Pontos de integração:** é uma integração de terceiro (Serviços de Terceiros, Cláusula 8 do contrato) — custo zero de API, mas depende da liberação do projeto Google. Aplicar `supabase/google_calendar_schema.sql` **ANTES** do deploy.

**Checklist de fidedignidade (desta feature):**
1. Editar cirurgia/consulta (data/hora/duração) reflete no evento do Google sem duplicar.
2. Cancelar/arquivar o atendimento remove/atualiza o evento correspondente.
3. Não sincroniza registros passados não vinculados (evita poluir a agenda).
4. Token por usuário, isolado por `auth.uid()`; revogar token corta a sincronização.
5. Fuso horário correto (Brasília) nos eventos criados.
6. Testes: `npm run test:unit` e `npm run e2e` (conforme `PROJECT_MEMORY`).

---

## Referências obrigatórias

- Branch: `feat/google-calendar`
- `api/financial-assistant.js` — padrão de auth serverless (comparar estrutura)
- `src/context/AuthContext.jsx` — hook `useAuth()` com `session.access_token`
- `src/theme.js` — tokens de cor (`C.surface`, `C.text`, etc.)

---

## Mapa de arquivos da branch

| Arquivo | Status | Responsabilidade |
|---------|--------|-----------------|
| `supabase/google_calendar_schema.sql` | Já existe na branch | Tabela `google_calendar_tokens` |
| `api/google/calendar.js` | Já existe na branch | OAuth callback + CRUD de eventos |
| `src/components/GoogleCalendar.jsx` | Já existe na branch | UI de agenda e eventos |
| `src/pages/FinanceWorkspace.jsx` | Precisa verificar | Rota/nav para a agenda |
| `vercel.json` | Precisa verificar | Rota `/api/google/calendar` |

---

## Task 1: Inspecionar o código da branch

- [ ] **Step 1.1: Fazer checkout da branch e inspecionar**

```bash
git fetch origin
git checkout feat/google-calendar
git log --oneline -10
```

- [ ] **Step 1.2: Ler o schema SQL**

```bash
cat supabase/google_calendar_schema.sql
```

Confirmar que a tabela `google_calendar_tokens` existe com colunas: `user_id`, `access_token`, `refresh_token`, `expiry_date`.

- [ ] **Step 1.3: Ler o endpoint serverless**

```bash
cat api/google/calendar.js
```

Anotar:
- Quais env vars são usadas (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`?)
- Qual é a URL de callback OAuth (ex: `/api/google/calendar?action=callback`)
- Quais escopos são solicitados

- [ ] **Step 1.4: Verificar vercel.json**

```bash
cat vercel.json
```

Confirmar se a rota `/api/google/calendar` está mapeada. Se não, adicionar no Task 5.

- [ ] **Step 1.5: Verificar integração no FinanceWorkspace**

```bash
grep -n "google\|Calendar\|calendar" src/pages/FinanceWorkspace.jsx
```

Confirmar se a tab/rota já está registrada.

---

## Task 2: Aplicar o schema SQL no Supabase

- [ ] **Step 2.1: Abrir SQL Editor no Supabase**

Acessar: https://supabase.com → projeto SurgiMetrics → SQL Editor

- [ ] **Step 2.2: Executar o schema**

Copiar o conteúdo de `supabase/google_calendar_schema.sql` e executar.

- [ ] **Step 2.3: Verificar que a tabela foi criada com RLS**

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'google_calendar_tokens';
```

Esperado: `rowsecurity = true`

```sql
select policyname, cmd, qual
from pg_policies
where tablename = 'google_calendar_tokens';
```

Esperado: pelo menos 1 policy restringindo por `auth.uid() = user_id`.

Se a policy não existir, criar:

```sql
do $$ begin
  begin
    create policy "Calendar tokens own rows" on public.google_calendar_tokens
      for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;
```

---

## Task 3: Configurar o projeto Google Cloud

- [ ] **Step 3.1: Identificar o projeto Google Cloud correto**

O client ID começa com `530038901215`. Acessar:
https://console.cloud.google.com/ → selecionar o projeto com esse client ID.

Se não souber qual projeto é, ir em: APIs & Services → Credentials → procurar o OAuth 2.0 Client ID que começa com `530038901215-`.

- [ ] **Step 3.2: Verificar se Google Calendar API está ativada**

APIs & Services → Library → pesquisar "Google Calendar API" → confirmar "Enabled".

Se não estiver ativada: clicar "Enable".

- [ ] **Step 3.3: Configurar Authorized redirect URIs**

APIs & Services → Credentials → clicar no OAuth 2.0 Client ID com prefixo `530038901215-`.

Em "Authorized redirect URIs", adicionar:
- `https://surgimetrics.com.br/api/google/calendar?action=callback` (produção)
- `http://localhost:5173/api/google/calendar?action=callback` (dev local, se necessário)

Clicar "Save".

- [ ] **Step 3.4: Configurar OAuth consent screen (se necessário)**

Se o app estiver em status "Testing", adicionar o email da Dra. Vitoria como test user:
APIs & Services → OAuth consent screen → Test users → Add Users.

Para produção real: publicar o app (requer verificação pelo Google se usar escopos sensíveis). O escopo `https://www.googleapis.com/auth/calendar` é sensível — pode exigir verificação.

**Alternativa para evitar verificação:** usar escopo mais restrito:
- `https://www.googleapis.com/auth/calendar.events` — só criar/editar eventos (não lê todos os calendários)

Verificar qual escopo o `api/google/calendar.js` solicita (Step 1.3) e decidir.

- [ ] **Step 3.5: Anotar as credenciais**

No painel do OAuth Client ID, copiar:
- Client ID: `530038901215-xxxxxxxx.apps.googleusercontent.com`
- Client Secret: `GOCSPX-xxxxxxxx`

---

## Task 4: Configurar env vars na Vercel

- [ ] **Step 4.1: Adicionar variáveis no painel Vercel**

https://vercel.com → projeto SurgiMetrics → Settings → Environment Variables

Adicionar (Production + Preview):

```
GOOGLE_CLIENT_ID=530038901215-xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
GOOGLE_CALENDAR_REDIRECT_URI=https://surgimetrics.com.br/api/google/calendar?action=callback
```

> **Nunca commitar estas credenciais.** Confirmar que `.env.local` está no `.gitignore`.

- [ ] **Step 4.2: Adicionar ao `.env.local` para desenvolvimento**

```bash
cat .env.local | grep GOOGLE
```

Se as variáveis não existirem, adicionar ao `.env.local`:

```
GOOGLE_CLIENT_ID=530038901215-xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:5173/api/google/calendar?action=callback
```

---

## Task 5: Ajustes de integração (se necessários)

Esta task só executa se Step 1.4 ou 1.5 revelaram itens faltando.

- [ ] **Step 5.1: Adicionar rota no vercel.json (se faltando)**

Se `/api/google/calendar` não estiver mapeado em `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/api/google/calendar", "destination": "/api/google/calendar.js" }
  ]
}
```

Verificar o padrão existente no arquivo antes de editar — não sobrescrever rewrites já configurados.

- [ ] **Step 5.2: Adicionar tab na FinanceWorkspace (se faltando)**

Se o Google Calendar não aparecer na nav de `FinanceWorkspace.jsx`, adicionar seguindo o padrão existente de `NAV_SECTIONS`:

```jsx
// Em NAV_SECTIONS (FinanceWorkspace.jsx)
{ id: 'calendar', label: 'Agenda', icon: '📅' }

// Em TITLES
calendar: 'Google Agenda',

// Em renderSection() ou switch(section):
case 'calendar':
  return <GoogleCalendar />
```

Importar o componente no topo do arquivo:
```jsx
import { GoogleCalendar } from '../components/GoogleCalendar.jsx'
```

---

## Task 6: Merge e teste

- [ ] **Step 6.1: Testar localmente**

```bash
npm run dev
```

1. Navegar até a tab Agenda
2. Clicar "Conectar Google Calendar"
3. Completar o fluxo OAuth (redirect para Google → autorizar → redirect de volta)
4. Confirmar que o token é salvo: checar no Supabase → Table Editor → `google_calendar_tokens`
5. Criar um evento de teste no componente
6. Confirmar que o evento aparece no Google Calendar real da Dra. Vitoria

- [ ] **Step 6.2: Verificar limite de funções Vercel (free tier: 12)**

```bash
find api/ -name "*.js" ! -path "api/_lib/*" | wc -l
```

Se ≥ 12, verificar se `api/google/calendar.js` usa roteamento interno por `action` (já é o padrão da branch). Se não, reorganizar.

- [ ] **Step 6.3: Fazer merge da branch**

```bash
git checkout main
git merge feat/google-calendar --no-ff -m "feat: integração Google Calendar — conectar agenda da clínica

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Se houver conflitos em `vercel.json` ou `FinanceWorkspace.jsx`, resolver manualmente preservando as mudanças de ambas as branches.

- [ ] **Step 6.4: Commit de configuração (se houve ajustes no Task 5)**

```bash
git add vercel.json src/pages/FinanceWorkspace.jsx
git commit -m "feat: registrar rota e tab do Google Calendar no workspace

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 6.5: Atualizar CHANGELOG.md**

```
### Added
- Google Agenda: integração OAuth 2.0 com Google Calendar — criar, visualizar e deletar eventos da clínica direto do sistema. Schema SQL aplicado, branch `feat/google-calendar` mergeada.
```

- [ ] **Step 6.6: Push e verificar deploy**

```bash
git push origin main
```

Acompanhar o deploy no painel Vercel. Após deploy, testar o fluxo OAuth em produção:
1. Acessar `https://surgimetrics.com.br`
2. Navegar para Agenda
3. Conectar Google Calendar
4. Confirmar que o redirect URI de produção funciona (`surgimetrics.com.br/api/google/calendar?action=callback`)

---

## Self-review

### Cobertura
- ✅ Schema SQL aplicado com RLS
- ✅ Google Cloud configurado (APIs, redirect URIs)
- ✅ Env vars na Vercel
- ✅ Merge da branch existente
- ✅ Teste end-to-end do fluxo OAuth

### Riscos
- Se o app Google estiver em "Testing" (não publicado), apenas usuários adicionados como test users podem autorizar. Dra. Vitoria precisa ser adicionada (Step 3.4).
- O escopo `calendar` completo pode exigir verificação do Google para uso em produção com usuários externos. Se a clínica tiver apenas 1-2 usuários, manter em "Testing" é uma opção viável.
- O refresh token só é retornado na primeira autorização (`access_type=offline`). Se o token não for salvo corretamente no banco, a integração expira após 1h. Verificar que o `refresh_token` é persistido no Step 6.1.

### Fora do escopo
- Sincronização bidirecional em tempo real (webhooks do Google → push para Supabase)
- Acesso ao calendário de outros usuários (cada usuário conecta o próprio)
- Notificações de lembrete automático (spec separada — `automacoes-whatsapp.md` cobre isso por WhatsApp)
