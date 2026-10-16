-- whatsapp_evolution_provider_schema.sql
-- Migração aditiva para Z-API + Evolution API, auditoria de webhooks e
-- idempotência por número/provedor. Não remove mensagens nem credenciais.
-- Executar DEPOIS de whatsapp_numbers_schema.sql, whatsapp_ownership_schema.sql
-- e whatsapp_group_participant_schema.sql.

begin;

alter table public.whatsapp_numbers
  add column if not exists provider text not null default 'zapi',
  add column if not exists provider_instance_name text,
  add column if not exists connection_state text not null default 'unknown',
  add column if not exists connected_at timestamptz,
  add column if not exists last_health_at timestamptz,
  add column if not exists last_webhook_at timestamptz,
  add column if not exists last_webhook_event text,
  add column if not exists webhook_verified_at timestamptz;

do $$ begin
  alter table public.whatsapp_numbers
    add constraint whatsapp_numbers_provider_check check (provider in ('zapi', 'evolution'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.whatsapp_numbers
    add constraint whatsapp_numbers_provider_instance_check check (
      provider <> 'evolution' or nullif(btrim(provider_instance_name), '') is not null
    ) not valid;
exception when duplicate_object then null; end $$;

create unique index if not exists uq_whatsapp_evolution_instance
  on public.whatsapp_numbers(provider, provider_instance_name)
  where provider = 'evolution' and provider_instance_name is not null;

create index if not exists idx_whatsapp_numbers_provider_health
  on public.whatsapp_numbers(user_id, provider, active, last_health_at desc);

alter table public.whatsapp_messages
  add column if not exists provider text not null default 'zapi';

do $$ begin
  alter table public.whatsapp_messages
    add constraint whatsapp_messages_provider_check check (provider in ('zapi', 'evolution'));
exception when duplicate_object then null; end $$;

-- O mesmo ID pode existir em instâncias/provedores diferentes. A identidade
-- correta da mensagem inclui o número da clínica; linhas legadas sem número
-- continuam protegidas por um índice separado.
drop index if exists public.uq_whatsapp_provider_msg;
create unique index if not exists uq_whatsapp_provider_msg_by_number
  on public.whatsapp_messages(user_id, whatsapp_number_id, provider, provider_message_id)
  where provider_message_id is not null and whatsapp_number_id is not null;
create unique index if not exists uq_whatsapp_provider_msg_legacy
  on public.whatsapp_messages(user_id, provider, provider_message_id)
  where provider_message_id is not null and whatsapp_number_id is null;

create table if not exists public.whatsapp_webhook_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  whatsapp_number_id  uuid not null references public.whatsapp_numbers(id) on delete cascade,
  provider            text not null check (provider in ('zapi', 'evolution')),
  provider_instance   text,
  event_type          text not null,
  dedup_key           text not null,
  payload             jsonb not null,
  processing_status   text not null default 'received'
                        check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  attempts            integer not null default 1 check (attempts > 0),
  error_message       text,
  received_at         timestamptz not null default timezone('utc', now()),
  processed_at        timestamptz
);

create unique index if not exists uq_whatsapp_webhook_event_dedup
  on public.whatsapp_webhook_events(whatsapp_number_id, dedup_key);
create index if not exists idx_whatsapp_webhook_event_retry
  on public.whatsapp_webhook_events(processing_status, received_at)
  where processing_status in ('received', 'failed');
create index if not exists idx_whatsapp_webhook_event_number
  on public.whatsapp_webhook_events(user_id, whatsapp_number_id, received_at desc);

alter table public.whatsapp_webhook_events enable row level security;

-- Payloads brutos podem conter dados clínicos e ficam disponíveis somente ao
-- backend com service role. A interface lê apenas a saúde agregada do número.
revoke all on public.whatsapp_webhook_events from anon, authenticated;

comment on column public.whatsapp_numbers.provider is
  'Provedor ativo do número. A troca não altera nem remove o histórico.';
comment on column public.whatsapp_numbers.provider_instance_name is
  'Nome público da instância na Evolution; a chave global permanece apenas no backend.';
comment on table public.whatsapp_webhook_events is
  'Inbox append-only de webhooks para auditoria, deduplicação e reprocessamento sem perda.';
comment on column public.whatsapp_webhook_events.payload is
  'Payload bruto sensível; acesso exclusivo do service_role e sujeito à política de retenção.';

commit;

-- Verificação pós-migração (executar separadamente):
-- select provider, count(*) from public.whatsapp_numbers group by provider;
-- select provider, count(*) from public.whatsapp_messages group by provider;
-- select indexname from pg_indexes where tablename in ('whatsapp_messages','whatsapp_webhook_events');
