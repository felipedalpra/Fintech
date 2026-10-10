-- whatsapp_schema.sql
-- Mensagens de WhatsApp por paciente (Fase 2 — WhatsApp no CRM).
-- Executar DEPOIS de access_control_schema.sql (precisa da função data_owner_id()).
-- Executar no Supabase SQL Editor.

create table if not exists public.whatsapp_messages (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  patient_id          uuid references public.patients(id) on delete set null,
  phone               text not null,                 -- só dígitos, ex: 5511999999999
  direction           text not null check (direction in ('outbound', 'inbound')),
  body                text not null,
  status              text not null default 'sent'
                        check (status in ('sent', 'delivered', 'read', 'failed')),
  provider_message_id text,                          -- id do provider (correlação + idempotência)
  created_at          timestamptz not null default timezone('utc', now())
);

alter table public.whatsapp_messages enable row level security;

-- RLS por clínica: membro (Lunara/Jonas) lê/escreve as mensagens do dono (data_owner_id()),
-- não só as próprias — igual às outras tabelas do controle de acesso.
drop policy if exists "WhatsApp messages own rows" on public.whatsapp_messages;
do $$ begin
  begin
    create policy "WhatsApp messages clinic access" on public.whatsapp_messages
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- Idempotência: a mesma mensagem (mesmo provider_message_id, por usuário) não entra 2x.
-- Índice único parcial (ignora linhas sem provider_message_id).
create unique index if not exists uq_whatsapp_provider_msg
  on public.whatsapp_messages(user_id, provider_message_id)
  where provider_message_id is not null;

create index if not exists idx_whatsapp_patient on public.whatsapp_messages(patient_id, created_at desc);
create index if not exists idx_whatsapp_phone   on public.whatsapp_messages(user_id, phone, created_at desc);
