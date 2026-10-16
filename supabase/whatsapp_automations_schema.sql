-- whatsapp_automations_schema.sql
-- CRM Fase 2 · sub-projeto 4 (parte 2) — Automações de saída de WhatsApp.
-- Lembrete de consulta/cirurgia (N dias antes) e follow-up pós-consulta (N dias depois).
-- O disparo diário roda dentro do cron de alertas (08:00 BRT); envio idempotente por índice único.
-- Executar DEPOIS de: access_control_schema.sql, patients_schema.sql, whatsapp_schema.sql,
-- whatsapp_numbers_schema.sql. Rodar no Supabase SQL Editor.

-- 1. Configuração por clínica (1 linha por dono). Toggles nascem DESLIGADOS.
create table if not exists public.whatsapp_automations (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references auth.users(id) on delete cascade,  -- dono/clínica
  whatsapp_number_id   uuid references public.whatsapp_numbers(id) on delete set null,    -- número de envio

  -- Lembrete de consulta/cirurgia.
  reminder_enabled     boolean not null default false,
  reminder_days_before int     not null default 1,
  reminder_template    text    not null default
    'Olá {patient_name}! Passando para lembrar do seu atendimento no dia {date}. Qualquer dúvida, é só chamar por aqui. 😊',

  -- Follow-up pós-consulta.
  followup_enabled     boolean not null default false,
  followup_days_after  int     not null default 2,
  followup_template    text    not null default
    'Olá {patient_name}! Como você está depois da sua consulta? Se tiver qualquer dúvida, estamos à disposição. 🌿',

  updated_at           timestamptz not null default timezone('utc', now())
);

-- Cobrança no vencimento (4b-2). Alters idempotentes: valem para base nova ou já existente.
alter table public.whatsapp_automations
  add column if not exists payment_enabled     boolean not null default false;
alter table public.whatsapp_automations
  add column if not exists payment_offset_days int not null default 0;   -- dias após o vencimento (0 = no dia; negativo = antes)
alter table public.whatsapp_automations
  add column if not exists payment_template    text not null default
    'Olá {patient_name}! Consta um pagamento de {value} com vencimento em {date}. Qualquer dúvida sobre o pagamento, estamos à disposição.';

-- Link de anamnese (4b-3). Base do link é configurada pela clínica; sem link, nada é enviado.
alter table public.whatsapp_automations
  add column if not exists anamnese_enabled     boolean not null default false;
alter table public.whatsapp_automations
  add column if not exists anamnese_days_before int not null default 2;   -- enviar N dias antes da consulta
alter table public.whatsapp_automations
  add column if not exists anamnese_link        text not null default '';  -- URL do formulário de anamnese (interno/externo)
alter table public.whatsapp_automations
  add column if not exists anamnese_template    text not null default
    'Olá {patient_name}! Antes da sua consulta no dia {date}, por favor preencha sua ficha de anamnese: {link}';

alter table public.whatsapp_automations enable row level security;
do $$ begin
  begin
    create policy "WhatsApp automations clinic access" on public.whatsapp_automations
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- 2. Log de envios — dedupe (idempotência) + auditoria. NÃO é registro financeiro.
create table if not exists public.whatsapp_automation_log (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  automation_type text not null,                 -- 'reminder' | 'followup' | 'payment' | 'anamnese'
  ref_type        text not null,                 -- 'consultation' | 'surgery'
  ref_id          uuid not null,
  target_date     date not null,                 -- data-alvo (evento) que gerou o envio
  phone           text,
  patient_id      uuid references public.patients(id) on delete set null,
  whatsapp_number_id uuid references public.whatsapp_numbers(id) on delete set null,
  provider        text,
  message_body    text,
  status          text not null default 'pending', -- 'pending' | 'accepted' | 'sent' | 'failed'
  attempts        integer not null default 1,
  last_attempt_at timestamptz not null default timezone('utc', now()),
  provider_message_id text,
  provider_accepted_at timestamptz,
  error_message   text,
  created_at      timestamptz not null default timezone('utc', now())
);

alter table public.whatsapp_automation_log add column if not exists patient_id uuid references public.patients(id) on delete set null;
alter table public.whatsapp_automation_log add column if not exists whatsapp_number_id uuid references public.whatsapp_numbers(id) on delete set null;
alter table public.whatsapp_automation_log add column if not exists provider text;
alter table public.whatsapp_automation_log add column if not exists message_body text;
alter table public.whatsapp_automation_log add column if not exists attempts integer not null default 1;
alter table public.whatsapp_automation_log add column if not exists last_attempt_at timestamptz not null default timezone('utc', now());
alter table public.whatsapp_automation_log add column if not exists provider_message_id text;
alter table public.whatsapp_automation_log add column if not exists provider_accepted_at timestamptz;
alter table public.whatsapp_automation_log add column if not exists error_message text;

alter table public.whatsapp_automation_log enable row level security;
do $$ begin
  begin
    create policy "WhatsApp automation log clinic access" on public.whatsapp_automation_log
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- Garante envio ÚNICO por evento/tipo/dia mesmo com re-execução do cron (guard-log antes de enviar).
create unique index if not exists idx_wa_automation_log_dedup
  on public.whatsapp_automation_log(user_id, automation_type, ref_id, target_date);
create index if not exists idx_wa_automation_log_retry
  on public.whatsapp_automation_log(user_id, status, last_attempt_at)
  where status in ('failed', 'accepted');

-- Verificação (rodar separado): depois de um disparo,
-- select automation_type, ref_type, target_date, status from public.whatsapp_automation_log order by created_at desc;
