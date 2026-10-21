-- WhatsApp · segurança operacional para até três números simultâneos.
-- Aditivo e idempotente. Executar DEPOIS de:
-- whatsapp_automations_schema.sql e whatsapp_evolution_provider_schema.sql.
-- Não remove nem reclassifica mensagens existentes.

begin;

-- Permite FKs compostas que provam que o número pertence à mesma clínica da
-- linha dependente. NOT VALID preserva dados legados, mas protege toda escrita
-- nova imediatamente.
create unique index if not exists uq_whatsapp_numbers_id_user
  on public.whatsapp_numbers(id, user_id);

alter table public.whatsapp_messages
  add column if not exists client_request_id uuid;

create unique index if not exists uq_whatsapp_messages_client_request
  on public.whatsapp_messages(user_id, client_request_id)
  where client_request_id is not null;

do $$ begin
  alter table public.whatsapp_messages
    add constraint whatsapp_messages_number_owner_fkey
    foreign key (whatsapp_number_id, user_id)
    references public.whatsapp_numbers(id, user_id)
    on delete restrict not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.whatsapp_webhook_events
    add constraint whatsapp_webhook_events_number_owner_fkey
    foreign key (whatsapp_number_id, user_id)
    references public.whatsapp_numbers(id, user_id)
    on delete restrict not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.whatsapp_automations
    add constraint whatsapp_automations_number_owner_fkey
    foreign key (whatsapp_number_id, user_id)
    references public.whatsapp_numbers(id, user_id)
    on delete restrict not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.whatsapp_automation_log
    add constraint whatsapp_automation_log_number_owner_fkey
    foreign key (whatsapp_number_id, user_id)
    references public.whatsapp_numbers(id, user_id)
    on delete restrict not valid;
exception when duplicate_object then null; end $$;

-- Requisição idempotente do compositor. A reserva nasce antes da chamada ao
-- provedor: repetição, duas abas ou timeout do navegador não disparam a mesma
-- tentativa novamente. Payload bruto não é armazenado aqui.
create table if not exists public.whatsapp_send_requests (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  whatsapp_number_id    uuid not null,
  request_id            uuid not null,
  payload_hash          text not null,
  provider              text not null check (provider in ('zapi', 'evolution')),
  status                text not null default 'pending'
                          check (status in ('pending', 'accepted', 'persisted', 'failed', 'unknown')),
  provider_message_id   text,
  whatsapp_message_id   uuid references public.whatsapp_messages(id) on delete set null,
  error_message         text,
  created_at            timestamptz not null default timezone('utc', now()),
  updated_at            timestamptz not null default timezone('utc', now()),
  unique (user_id, request_id),
  constraint whatsapp_send_requests_number_owner_fkey
    foreign key (whatsapp_number_id, user_id)
    references public.whatsapp_numbers(id, user_id)
    on delete restrict
);

create index if not exists idx_whatsapp_send_requests_recovery
  on public.whatsapp_send_requests(status, updated_at)
  where status in ('pending', 'accepted', 'unknown');

-- Duas abas/dispositivos enviando o mesmo conteúdo geram request_id diferentes,
-- então a unique (user_id, request_id) acima não os vê como duplicados. Este
-- índice parcial cobre exatamente essa lacuna: enquanto uma tentativa com o
-- mesmo conteúdo ainda está viva (reservada ou aceita pelo provedor), nenhuma
-- segunda reserva pode nascer — a segunda aba cai no fallback de espera em vez
-- de chamar o provedor de novo.
create unique index if not exists uq_whatsapp_send_requests_live_payload
  on public.whatsapp_send_requests(user_id, payload_hash)
  where status in ('pending', 'accepted');

alter table public.whatsapp_send_requests enable row level security;
revoke all on public.whatsapp_send_requests from anon, authenticated;

-- Configuração é administrativa. O cron usa service_role e continua imune à
-- RLS, enquanto membros comuns não podem trocar silenciosamente o remetente.
drop policy if exists "WhatsApp automations clinic access" on public.whatsapp_automations;
drop policy if exists "WhatsApp automations admin access" on public.whatsapp_automations;
create policy "WhatsApp automations admin access" on public.whatsapp_automations
  for all to authenticated
  using (user_id = public.data_owner_id() and public.is_clinic_admin())
  with check (user_id = public.data_owner_id() and public.is_clinic_admin());

drop policy if exists "WhatsApp automation log clinic access" on public.whatsapp_automation_log;
drop policy if exists "WhatsApp automation log admin read" on public.whatsapp_automation_log;
create policy "WhatsApp automation log admin read" on public.whatsapp_automation_log
  for select to authenticated
  using (user_id = public.data_owner_id() and public.is_clinic_admin());

comment on table public.whatsapp_send_requests is
  'Reserva idempotente de envios interativos; impede reenvio ao provedor após repetição ou timeout.';

commit;

-- Auditoria pós-migração (executar separadamente): deve retornar zero linhas.
-- select 'automations' as source, a.user_id, a.whatsapp_number_id
-- from public.whatsapp_automations a join public.whatsapp_numbers n on n.id = a.whatsapp_number_id
-- where a.user_id <> n.user_id
-- union all
-- select 'messages', m.user_id, m.whatsapp_number_id
-- from public.whatsapp_messages m join public.whatsapp_numbers n on n.id = m.whatsapp_number_id
-- where m.user_id <> n.user_id;
