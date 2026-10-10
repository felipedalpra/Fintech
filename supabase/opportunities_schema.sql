-- opportunities_schema.sql
-- CRM — Oportunidades (negócios) e histórico de estágio (Fase 2, sub-projeto 1).
-- Um contato (paciente) pode ter N oportunidades. Substitui patients.funnel_stage como fonte do estágio.
-- Executar DEPOIS de access_control_schema.sql (usa data_owner_id()) e patient_funnel_schema.sql.
-- Executar no Supabase SQL Editor.

-- 1. Oportunidades (negócios).
create table if not exists public.opportunities (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,  -- dono/clínica
  patient_id          uuid not null references public.patients(id) on delete cascade,
  title               text not null default 'Oportunidade',
  stage               text not null default 'consulta_agendada'
                        check (stage in ('consulta_agendada','consultado','orcamento_enviado','reserva_paga','follow_up')),
  status              text not null default 'aberto'
                        check (status in ('aberto','ganho','perdido')),
  value               numeric(12,2),
  source              text,
  responsible_user_id uuid references auth.users(id) on delete set null,
  tags                text[] not null default '{}',
  lost_reason         text,
  stage_entered_at    timestamptz not null default timezone('utc', now()),
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);

-- 2. Histórico de estágio — toda mudança é auditável (quem, quando, manual vs automação).
create table if not exists public.opportunity_stage_history (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.opportunities(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,  -- dono/clínica
  from_stage      text,
  to_stage        text not null,
  moved_by        uuid references auth.users(id) on delete set null,          -- quem moveu
  source          text not null default 'manual' check (source in ('manual','automacao')),
  created_at      timestamptz not null default timezone('utc', now())
);

-- 3. Ligar os atendimentos à oportunidade (nullable, retrocompatível).
alter table public.surgeries
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;
alter table public.consultations
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;

-- 4. RLS por clínica (membro acessa as do dono).
alter table public.opportunities enable row level security;
alter table public.opportunity_stage_history enable row level security;

do $$ begin
  begin
    create policy "Opportunities clinic access" on public.opportunities
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
  begin
    create policy "Opportunity history clinic access" on public.opportunity_stage_history
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- 5. Índices.
create index if not exists idx_opportunities_pipeline on public.opportunities(user_id, status, stage);
create index if not exists idx_opportunities_patient  on public.opportunities(patient_id);
create index if not exists idx_opp_history_opp        on public.opportunity_stage_history(opportunity_id, created_at desc);
create index if not exists idx_surgeries_opportunity     on public.surgeries(opportunity_id);
create index if not exists idx_consultations_opportunity on public.consultations(opportunity_id);

-- 6. Migração: cada paciente ativo vira 1 oportunidade no estágio atual (idempotente).
insert into public.opportunities (user_id, patient_id, title, stage, status, stage_entered_at, created_at)
select p.user_id, p.id, coalesce(nullif(p.full_name, ''), 'Oportunidade'),
       coalesce(p.funnel_stage, 'consulta_agendada'), 'aberto',
       timezone('utc', now()), p.created_at
from public.patients p
where p.active = true
  and not exists (select 1 from public.opportunities o where o.patient_id = p.id);

-- Verificação (rodar separado):
-- select stage, count(*) from public.opportunities group by stage;
