-- whatsapp_evolution_provider_schema.sql
-- Migração aditiva para Z-API + Evolution API, auditoria de webhooks e
-- idempotência por número/provedor. Não remove mensagens nem credenciais.
-- Executar DEPOIS de whatsapp_numbers_schema.sql, whatsapp_ownership_schema.sql
-- whatsapp_group_participant_schema.sql, whatsapp_media_schema.sql e
-- whatsapp_media_storage.sql.

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

-- Novos registros sempre nascem com segredo criptograficamente aleatório. Linhas
-- legadas nulas continuam migráveis, mas não podem ser ativadas até a reconexão
-- administrativa configurar o mesmo segredo no provider.
alter table public.whatsapp_numbers
  alter column webhook_secret set default encode(gen_random_bytes(32), 'hex');

do $$ begin
  alter table public.whatsapp_numbers
    add constraint whatsapp_numbers_active_webhook_secret_check check (
      active is not true or nullif(btrim(webhook_secret), '') is not null
    ) not valid;
exception when duplicate_object then null; end $$;

-- Segredos nunca são legíveis pelo cliente. A tela administrativa recebe o
-- webhook_secret por endpoint autenticado; membros comuns só leem metadados.
revoke select on public.whatsapp_numbers from anon, authenticated;
grant select (
  id, user_id, label, phone, active, created_at, assigned_user_id, provider,
  provider_instance_name, connection_state, connected_at, last_health_at,
  last_webhook_at, last_webhook_event, webhook_verified_at
) on public.whatsapp_numbers to authenticated;

do $$ begin
  alter table public.whatsapp_numbers
    add constraint whatsapp_numbers_provider_check check (provider in ('zapi', 'evolution'));
exception when duplicate_object then null; end $$;

-- O limite de três ativos é garantido no banco (inclusive sob duas requisições
-- concorrentes), não apenas pela conferência da interface/API.
create or replace function public.enforce_whatsapp_active_number_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  should_check boolean := new.active;
begin
  if tg_op = 'UPDATE' then
    should_check := new.active and (old.active is distinct from true or old.user_id is distinct from new.user_id);
  end if;
  if should_check then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text)::bigint);
    if (
      select count(*) from public.whatsapp_numbers n
      where n.user_id = new.user_id and n.active and n.id is distinct from new.id
    ) >= 3 then
      raise exception 'A clínica já possui o limite de 3 números ativos.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.enforce_whatsapp_active_number_limit() from public, anon, authenticated;
drop trigger if exists trg_whatsapp_active_number_limit on public.whatsapp_numbers;
create trigger trg_whatsapp_active_number_limit
before insert or update of active, user_id on public.whatsapp_numbers
for each row execute function public.enforce_whatsapp_active_number_limit();

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
  whatsapp_number_id  uuid not null references public.whatsapp_numbers(id) on delete restrict,
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
  processed_at        timestamptz,
  expires_at          timestamptz not null default (timezone('utc', now()) + interval '90 days')
);

alter table public.whatsapp_webhook_events
  add column if not exists expires_at timestamptz not null default (timezone('utc', now()) + interval '90 days');

alter table public.whatsapp_webhook_events
  drop constraint if exists whatsapp_webhook_events_whatsapp_number_id_fkey;
alter table public.whatsapp_webhook_events
  add constraint whatsapp_webhook_events_whatsapp_number_id_fkey
  foreign key (whatsapp_number_id) references public.whatsapp_numbers(id) on delete restrict;

create unique index if not exists uq_whatsapp_webhook_event_dedup
  on public.whatsapp_webhook_events(whatsapp_number_id, dedup_key);
create index if not exists idx_whatsapp_webhook_event_retry
  on public.whatsapp_webhook_events(processing_status, received_at)
  where processing_status in ('received', 'failed');
create index if not exists idx_whatsapp_webhook_event_number
  on public.whatsapp_webhook_events(user_id, whatsapp_number_id, received_at desc);
create index if not exists idx_whatsapp_webhook_event_expiry
  on public.whatsapp_webhook_events(expires_at);

-- Entrega durável das automações: falha no provider pode ser tentada de novo;
-- provider_message_id impede reenvio quando só a persistência local falhou.
alter table if exists public.whatsapp_automation_log add column if not exists patient_id uuid references public.patients(id) on delete set null;
alter table if exists public.whatsapp_automation_log add column if not exists whatsapp_number_id uuid references public.whatsapp_numbers(id) on delete set null;
alter table if exists public.whatsapp_automation_log add column if not exists provider text;
alter table if exists public.whatsapp_automation_log add column if not exists message_body text;
alter table if exists public.whatsapp_automation_log add column if not exists attempts integer not null default 1;
alter table if exists public.whatsapp_automation_log add column if not exists last_attempt_at timestamptz not null default timezone('utc', now());
alter table if exists public.whatsapp_automation_log add column if not exists provider_message_id text;
alter table if exists public.whatsapp_automation_log add column if not exists provider_accepted_at timestamptz;
alter table if exists public.whatsapp_automation_log add column if not exists error_message text;
do $$ begin
  if to_regclass('public.whatsapp_automation_log') is not null then
    create index if not exists idx_wa_automation_log_retry
      on public.whatsapp_automation_log(user_id, status, last_attempt_at)
      where status in ('failed', 'accepted');
  end if;
end $$;

alter table public.whatsapp_webhook_events enable row level security;

-- Payloads brutos podem conter dados clínicos e ficam disponíveis somente ao
-- backend com service role. A interface lê apenas a saúde agregada do número.
revoke all on public.whatsapp_webhook_events from anon, authenticated;

-- Mídias recebidas podem conter documentos clínicos. Diferentemente do bucket
-- público usado para o provedor buscar anexos de saída, este bucket é privado e
-- só entrega URLs assinadas depois da autorização no backend.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wa-media-inbound', 'wa-media-inbound', false, 16777216,
  null
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anexos enviados também podem ser clínicos. O provider recebe uma URL assinada
-- de 15 minutos; o histórico guarda apenas storage://wa-media/<path>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wa-media', 'wa-media', false, 16777216, null)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

update public.whatsapp_messages
set media_url = 'storage://wa-media/' || split_part(media_url, '/storage/v1/object/public/wa-media/', 2)
where media_url ~ '^https://[^/]+/storage/v1/object/public/wa-media/[^/]+/.+$'
  and split_part(split_part(media_url, '/storage/v1/object/public/wa-media/', 2), '/', 1) = user_id::text;

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
