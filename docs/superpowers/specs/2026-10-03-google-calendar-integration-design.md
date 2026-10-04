# Integração Google Agenda (sincronização nos dois sentidos)

Data: 2026-10-03
Status: aguardando revisão do usuário

## Objetivo

Permitir que cada usuário conecte a própria Google Agenda na tela **Agenda** (`src/components/Calendar.jsx`):

- **Plataforma → Google:** consultas e cirurgias viram eventos na agenda principal do Google.
- **Google → Plataforma:** os eventos do Google aparecem no calendário da plataforma, e mudanças de horário em eventos criados pela plataforma voltam para o registro.

## Decisões já tomadas com o usuário

| Tema | Decisão |
|---|---|
| Direção | Os dois sentidos |
| Horário | Novos campos opcionais `horário` e `duração` em consulta e cirurgia. Com horário: evento com hora marcada. Sem horário: evento de dia inteiro |
| Título do evento | `Nome completo — Procedimento` (cirurgia) e `Nome completo — Tipo de consulta` (consulta) |
| Eventos do Google na plataforma | Somente leitura, em cor própria; não viram consulta/cirurgia automaticamente |
| Abordagem | Sincronização sob demanda (sem webhooks, sem cron novo) |

## Fora de escopo

- Webhooks/push notifications do Google e sincronização em segundo plano.
- Criar consulta/cirurgia a partir de evento do Google.
- Várias agendas por usuário (usa só a agenda principal, `primary`).
- Eventos recorrentes criados pela plataforma.

## Arquitetura

```
Calendar.jsx ──► googleCalendarClient.js ──► /api/google/calendar/* ──► Google Calendar API
   │                                              │
   └─ formulários (horário/duração)               └─ Supabase: conexões + vínculos (service role)
```

### Backend (`api/google/calendar/`)

Todas as rotas exigem o usuário autenticado (`Authorization: Bearer <jwt do Supabase>`, mesmo padrão de `api/secure-profile/_lib.js`).

| Rota | Método | Função |
|---|---|---|
| `connect` | POST | Devolve a URL de consentimento do Google, com `state` assinado (HMAC) contendo o `user_id` |
| `callback` | GET | Troca o `code` por tokens, valida o `state`, grava a conexão e redireciona para `/app/calendar?google=connected` |
| `status` | GET | Informa se há conexão, e-mail da conta e se o token ainda é válido |
| `disconnect` | POST | Revoga o token no Google e apaga a conexão e os vínculos do usuário |
| `events` | GET | Lista eventos do Google de um intervalo (`timeMin`, `timeMax`), com `singleEvents=true` |
| `sync` | POST | Recebe `upserts[]` e `deletes[]` de registros e aplica no Google |

Biblioteca compartilhada `api/google/calendar/_lib.js`: autenticação, refresh do access token, cliente HTTP do Google, criptografia do refresh token (reaproveitando a criptografia de `secure-profile/_lib.js`).

Escopos solicitados: `calendar.events` e `userinfo.email`. A conexão do Gmail usada pelos alertas (`google_oauth_tokens`) **não é alterada**.

### Banco (`supabase/google_calendar_schema.sql`)

Nova migração, sem alterar tabelas existentes além das colunas de horário:

```sql
-- Conexão por usuário (token criptografado, acessível só pelo service role)
create table public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_email text,
  refresh_token_encrypted text not null,
  status text not null default 'connected',  -- connected | needs_reconnect
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Vínculo registro da plataforma <-> evento do Google
create table public.google_calendar_event_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('surgery','consultation')),
  record_id uuid not null,
  google_event_id text not null,
  synced_hash text not null,           -- hash dos campos enviados, para evitar reenvio
  detached boolean not null default false,  -- evento apagado no Google
  primary key (user_id, record_type, record_id)
);

alter table public.surgeries      add column start_time time, add column duration_minutes integer;
alter table public.consultations  add column start_time time, add column duration_minutes integer;
```

- RLS ativada nas duas tabelas novas, **sem política** para `authenticated` (apenas o service role acessa). O navegador nunca lê o token.
- O vínculo fica numa tabela separada, e não em `surgeries`/`consultations`, porque o front regrava o dataset inteiro a cada alteração (`syncTable` em `financeStore.js`); assim o id do evento não entra no ciclo de salvamento nem é perdido.

### Frontend

- `src/lib/googleCalendarClient.js` (novo): chama as rotas acima com o token da sessão.
- `src/components/Calendar.jsx`:
  - Barra de conexão no topo: "Conectar Google Agenda" / e-mail conectado + "Desconectar" / "Reconectar".
  - Aviso de privacidade na primeira conexão (o nome completo do paciente passa a ficar no Google).
  - Busca os eventos do Google do mês visível ao abrir e ao navegar entre meses; mostra com cor própria e rótulo "Google". Eventos que já são vínculos de consultas/cirurgias não são duplicados na tela.
- `src/dataModel.js` e `src/lib/financeStore.js`: incluir `startTime` e `durationMinutes` na normalização e nos mapeamentos de leitura/gravação (sem isso o horário se perderia ao recarregar).
- `src/components/Sales.jsx` e `Consultations.jsx`: campos opcionais "Horário" e "Duração (min)" (padrão: 60 para consulta, 180 para cirurgia).
- Após salvar, um efeito no workspace compara os registros com o último estado sincronizado e chama `sync` só para o que mudou ou foi excluído.

## Fluxo de dados

**Conectar:** botão → `connect` → Google → `callback` (grava conexão) → volta para a Agenda → `status`.

**Plataforma → Google:**
1. O dataset é salvo normalmente (comportamento atual, inalterado).
2. Se há conexão ativa, o front calcula os registros novos/alterados/excluídos de consultas e cirurgias.
3. Chama `sync` com `upserts` (id, tipo, nome, procedimento, data, horário, duração, fuso do navegador) e `deletes` (ids).
4. O servidor cria/atualiza/apaga o evento, grava o vínculo e o hash. O evento recebe a propriedade privada `surgimetricsRecordId` para identificação.
5. A falha do `sync` nunca bloqueia o salvamento: mostra aviso discreto e tenta de novo na próxima alteração ou ao abrir a Agenda.

**Google → Plataforma:**
1. Ao abrir a Agenda, `events` devolve os eventos do intervalo.
2. Eventos sem `surgimetricsRecordId` aparecem como eventos do Google (somente leitura).
3. Eventos com `surgimetricsRecordId` cujo horário/data diferem do registro **atualizam o registro** (data, horário, duração) e exibem um aviso "Atualizado a partir do Google Agenda".
4. Evento vinculado apagado no Google: o registro **não é apagado**. O vínculo vira `detached` e não é recriado até o usuário editar o registro na plataforma.

**Conflito:** a última alteração vence. Como a leitura do Google só roda ao abrir/navegar na Agenda, e o envio roda no salvamento, o hash em `synced_hash` evita ciclos de ida e volta.

## Tratamento de erros

- Token revogado ou expirado (`invalid_grant`): conexão passa a `needs_reconnect`, a Agenda mostra "Reconectar" e a plataforma segue normal.
- Limite de requisições (429/5xx): até 3 tentativas com espera crescente; depois, aviso e nova tentativa na próxima alteração.
- Variáveis de ambiente ausentes: rotas respondem com mensagem clara e a Agenda esconde o botão de conectar.
- Fuso horário: o front envia o fuso do navegador; eventos com hora usam esse fuso.

## Requisitos de ambiente e riscos

- Reutiliza `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. Precisa de um novo `GOOGLE_CALENDAR_REDIRECT_URI` (autorizado no Google Cloud) e da **Google Calendar API** ativada no projeto.
- **Verificação do Google:** `calendar.events` é escopo sensível. Em modo de teste só contas cadastradas como testadoras conectam, e o token expira a cada 7 dias. Para liberar a todos os clientes é preciso submeter o app à verificação do Google (dias a semanas). Isso é um passo operacional fora do código.
- **LGPD:** nome completo de paciente vai para o Google do médico. É dado de saúde sensível; exige aviso na conexão e atualização de `docs/lgpd_compliance.md` e da política de privacidade. A escolha do usuário foi nome completo.
- Mexe em `api/*` e em SQL do Supabase, autorizado pelo usuário em 2026-10-03.

## Testes

- Playwright (e2e) com chamadas ao Google simuladas por interceptação de rede: conectar, ver eventos do Google, salvar consulta com horário e verificar o `sync`, cenário de `needs_reconnect`.
- Verificar manualmente o fluxo real de OAuth com uma conta testadora.
- Regressão: rotas `/app/*`, salvamento do dataset e exportações continuam iguais para quem não conectou o Google.

## Documentação

Atualizar `CHANGELOG.md` (regra 7 de `SYSTEM_RULES.md`), `PROJECT_MEMORY.md` e `.env.example`.
