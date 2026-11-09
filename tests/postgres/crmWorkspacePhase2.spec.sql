-- Executar somente em banco local descartavel e vazio:
--   createdb surgi_crm_workspace2_test
--   psql -v ON_ERROR_STOP=1 -d surgi_crm_workspace2_test -f tests/postgres/crmWorkspacePhase2.spec.sql
\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
-- Clinica A: owner A, equipe E. Clinica B: owner B.
insert into auth.users(id) values
  ('a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-0000000000e1'),
  ('b0000000-0000-4000-8000-000000000001');
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.clinics(id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id));
create table public.clinic_members(
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  role text not null
);
insert into public.clinics(id, owner_id) values
  ('c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id, user_id, role) values
  ('c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-0000000000e1', 'equipe');

create or replace function public.data_owner_id() returns uuid language sql stable security definer as $$
  select coalesce(
    (select owner_id from public.clinics where owner_id = auth.uid() limit 1),
    (select c.owner_id from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
      where cm.user_id = auth.uid() limit 1))
$$;

create table public.patients(id uuid primary key default gen_random_uuid(), user_id uuid, full_name text);
-- Espelha a tabela real: check de status INLINE (nome gerado), colunas da Fase 1 e do Meta.
create table public.opportunities(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  patient_id uuid references public.patients(id),
  contact_id uuid,
  title text not null default 'Oportunidade',
  stage text not null default 'primeiro_contato',
  status text not null default 'aberto' check (status in ('aberto','ganho','perdido')),
  value numeric(12,2), source text, responsible_user_id uuid, tags text[] not null default '{}',
  lost_reason text, stage_entered_at timestamptz not null default now(),
  first_response_at timestamptz,
  suggested_stage text, suggestion_status text not null default 'none',
  meta_lead_id text,
  procedure_id uuid, probability numeric(5,2), next_action text, next_action_due date,
  expected_surgery_date date, custom_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.tasks(
  id uuid primary key default gen_random_uuid(), user_id uuid, opportunity_id uuid,
  title text not null default 't',
  status text not null default 'pendente' check (status in ('pendente','feita')),
  outcome text, done_at timestamptz
);
alter table public.tasks add constraint tasks_outcome_requires_done check (outcome is null or status = 'feita');

do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select, insert, update on public.opportunities, public.tasks to authenticated;
alter table public.opportunities enable row level security;
create policy opp_clinic on public.opportunities for all to authenticated
  using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());

insert into public.patients(id, user_id, full_name) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Paciente A');
insert into public.opportunities(id, user_id, patient_id, value, status, tags, stage, meta_lead_id, suggestion_status, first_response_at, probability, custom_values) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 1000, 'aberto', '{vip}', 'orcamento_enviado', 'lead-1', 'pending', now(), 60, '{"f1":"x"}'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 800, 'ganho', '{}', 'consultado', null, 'none', null, null, '{}'),
  ('e0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', null, 500, 'aberto', '{}', 'consultado', null, 'none', null, null, '{}');
insert into public.tasks(user_id, opportunity_id, status) values
  ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'pendente');

\ir ../../supabase/crm_workspace_phase2.sql
-- Reaplicar a migration nao pode falhar nem duplicar objeto.
\ir ../../supabase/crm_workspace_phase2.sql

-- 1. Nada existente foi alterado; checks unicos (sem duplicata apos reaplicar).
do $$ begin
  if (select count(*) from public.opportunities where archived_at is not null or archived_from_status is not null) <> 0 then
    raise exception 'Migration preencheu arquivamento';
  end if;
  if (select status from public.opportunities where id = 'e0000000-0000-4000-8000-000000000002') <> 'ganho' then
    raise exception 'Status existente foi alterado';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.tasks'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%pendente%' and pg_get_constraintdef(oid) not ilike '%outcome%') <> 1 then
    raise exception 'Check de status de tasks duplicado ou ausente';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.opportunities'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%ganho%' and pg_get_constraintdef(oid) not ilike '%archived%') <> 1 then
    raise exception 'Check de status de opportunities duplicado ou ausente';
  end if;
end $$;

-- 2. Tarefa aceita 'aguardando'; status desconhecido e rejeitado; outcome segue exigindo 'feita'.
do $$ begin
  update public.tasks set status = 'aguardando';
  begin
    update public.tasks set status = 'xpto';
    raise exception 'Status de tarefa invalido aceito';
  exception when check_violation then null; end;
  begin
    update public.tasks set outcome = 'concluido';
    raise exception 'Outcome aceito em tarefa nao concluida';
  exception when check_violation then null; end;
end $$;

-- 3. Arquivar direto sem metadados e rejeitado (consistencia).
do $$ begin
  begin
    update public.opportunities set status = 'arquivado' where id = 'e0000000-0000-4000-8000-000000000001';
    raise exception 'Arquivamento sem archived_at aceito';
  exception when check_violation then null; end;
end $$;

-- 4. Equipe da clinica A arquiva (inclusive uma ganha) e restaura devolvendo o status original.
set test.uid = 'a0000000-0000-4000-8000-0000000000e1';
set role authenticated;
do $$
declare n int;
begin
  n := public.crm_archive_opportunities(array['e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000003']::uuid[]);
  if n <> 2 then raise exception 'Arquivar deveria afetar 2 (clinica B fora), afetou %', n; end if;
  if (select archived_by from public.opportunities where id = 'e0000000-0000-4000-8000-000000000001') <> 'a0000000-0000-4000-8000-0000000000e1' then
    raise exception 'archived_by incorreto';
  end if;
  -- Reaplicar nao muda nada nem perde o status original.
  n := public.crm_archive_opportunities(array['e0000000-0000-4000-8000-000000000002']::uuid[]);
  if n <> 0 then raise exception 'Arquivar de novo alterou linha'; end if;
  n := public.crm_restore_opportunities(array['e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002']::uuid[]);
  if n <> 2 then raise exception 'Restaurar deveria afetar 2, afetou %', n; end if;
  if (select status from public.opportunities where id = 'e0000000-0000-4000-8000-000000000002') <> 'ganho' then
    raise exception 'Restaurar nao devolveu o status ganho';
  end if;
  if (select status from public.opportunities where id = 'e0000000-0000-4000-8000-000000000001') <> 'aberto' then
    raise exception 'Restaurar nao devolveu o status aberto';
  end if;
end $$;
reset role;
do $$ begin
  if (select status from public.opportunities where id = 'e0000000-0000-4000-8000-000000000003') <> 'aberto' then
    raise exception 'Clinica A arquivou oportunidade da clinica B';
  end if;
end $$;

-- 5. Tags: acrescenta sem duplicar, ignora vazias, nao remove existentes.
set test.uid = 'a0000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
declare n int;
begin
  n := public.crm_add_opportunity_tags(array['e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002']::uuid[], array[' vip ', 'retorno', '', 'retorno']);
  if n <> 2 then raise exception 'Tags deveria afetar 2, afetou %', n; end if;
  if (select tags from public.opportunities where id = 'e0000000-0000-4000-8000-000000000001') <> array['vip','retorno'] then
    raise exception 'Tags da 1 incorretas: %', (select tags from public.opportunities where id = 'e0000000-0000-4000-8000-000000000001');
  end if;
  if (select tags from public.opportunities where id = 'e0000000-0000-4000-8000-000000000002') <> array['vip','retorno'] then
    raise exception 'Tags da 2 incorretas';
  end if;
  n := public.crm_add_opportunity_tags(array['e0000000-0000-4000-8000-000000000001']::uuid[], array['vip']);
  if n <> 0 then raise exception 'Tag repetida alterou linha'; end if;
  n := public.crm_add_opportunity_tags(array['e0000000-0000-4000-8000-000000000003']::uuid[], array['x']);
  if n <> 0 then raise exception 'Clinica A alterou tags da clinica B'; end if;
end $$;

-- 6. Duplicar: mesmo paciente/etapa/campos comerciais; NADA de vinculo Meta, sugestao, SLA, tarefas.
do $$
declare d public.opportunities;
begin
  d := public.crm_duplicate_opportunity('e0000000-0000-4000-8000-000000000001');
  if d.id = 'e0000000-0000-4000-8000-000000000001' or d.patient_id <> 'd0000000-0000-4000-8000-000000000001' then
    raise exception 'Duplicata com id/paciente errados';
  end if;
  if d.stage <> 'orcamento_enviado' or d.status <> 'aberto' or d.value <> 1000 or d.probability <> 60
     or d.custom_values <> '{"f1":"x"}'::jsonb or d.tags <> array['vip','retorno'] then
    raise exception 'Duplicata sem os campos comerciais';
  end if;
  if d.meta_lead_id is not null or d.suggestion_status <> 'none' or d.first_response_at is not null then
    raise exception 'Duplicata copiou vinculo Meta/sugestao/SLA';
  end if;
  if exists (select 1 from public.tasks where opportunity_id = d.id) then
    raise exception 'Duplicata copiou tarefas';
  end if;
  if (select count(*) from public.patients) <> 1 then raise exception 'Duplicata criou paciente'; end if;
  begin
    perform public.crm_duplicate_opportunity('e0000000-0000-4000-8000-000000000003');
    raise exception 'Clinica A duplicou oportunidade da clinica B';
  exception when raise_exception then
    if sqlerrm <> 'Oportunidade não encontrada' then raise; end if;
  end;
end $$;
reset role;

select 'crmWorkspacePhase2 OK' as resultado;
