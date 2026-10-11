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
  automation_type text not null,                 -- 'reminder' | 'followup'
  ref_type        text not null,                 -- 'consultation' | 'surgery'
  ref_id          uuid not null,
  target_date     date not null,                 -- data-alvo (evento) que gerou o envio
  phone           text,
  status          text not null default 'pending', -- 'pending' | 'sent' | 'failed'
  created_at      timestamptz not null default timezone('utc', now())
);

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

-- Verificação (rodar separado): depois de um disparo,
-- select automation_type, ref_type, target_date, status from public.whatsapp_automation_log order by created_at desc;
