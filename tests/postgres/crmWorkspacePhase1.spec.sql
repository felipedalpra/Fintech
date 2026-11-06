-- Executar somente em banco local descartavel e vazio:
--   createdb surgi_crm_workspace_test
--   psql -v ON_ERROR_STOP=1 -d surgi_crm_workspace_test -f tests/postgres/crmWorkspacePhase1.spec.sql
\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
-- Clinica A: owner A, gestao G, equipe E. Clinica B: owner B.
insert into auth.users(id) values
  ('a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-0000000000a6'),
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
  ('c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-0000000000a6', 'gestao'),
  ('c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-0000000000e1', 'equipe');

create or replace function public.data_owner_id() returns uuid language sql stable security definer as $$
  select coalesce(
    (select owner_id from public.clinics where owner_id = auth.uid() limit 1),
    (select c.owner_id from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
      where cm.user_id = auth.uid() limit 1))
$$;

create table public.procedures(id uuid primary key default gen_random_uuid(), user_id uuid, name text);
create table public.patients(id uuid primary key default gen_random_uuid(), user_id uuid, full_name text);
create table public.crm_contacts(id uuid primary key default gen_random_uuid(), user_id uuid, full_name text);
create table public.opportunities(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  patient_id uuid references public.patients(id),
  contact_id uuid references public.crm_contacts(id),
  title text not null default 'Oportunidade',
  stage text not null default 'primeiro_contato',
  status text not null default 'aberto',
  value numeric(12,2), source text, responsible_user_id uuid, tags text[] not null default '{}',
  lost_reason text, stage_entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.whatsapp_messages(
  id uuid primary key default gen_random_uuid(), user_id uuid, patient_id uuid, contact_id uuid,
  created_at timestamptz not null default now()
);
create table public.tasks(
  id uuid primary key default gen_random_uuid(), user_id uuid, opportunity_id uuid, status text, done_at timestamptz
);
create table public.opportunity_notes(
  id uuid primary key default gen_random_uuid(), user_id uuid, opportunity_id uuid, created_at timestamptz not null default now()
);
create table public.crm_contact_notes(
  id uuid primary key default gen_random_uuid(), user_id uuid, contact_id uuid, patient_id uuid, opportunity_id uuid,
  created_at timestamptz not null default now()
);

do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select, insert, update on public.opportunities to authenticated;
grant select on public.whatsapp_messages, public.tasks, public.opportunity_notes, public.crm_contact_notes to authenticated;
alter table public.opportunities enable row level security;
create policy opp_clinic on public.opportunities for all to authenticated
  using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());
-- Fontes de contato sem RLS no teste (a RLS real de cada uma ja e testada nos specs proprios).

insert into public.patients(id, user_id, full_name) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Paciente A');
insert into public.opportunities(id, user_id, patient_id, value) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 1000),
  ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', null, 500);
update public.opportunities set contact_id = null where id = 'e0000000-0000-4000-8000-000000000002';

\ir ../../supabase/crm_workspace_phase1.sql
-- Reaplicar a migration nao pode falhar nem duplicar objeto.
\ir ../../supabase/crm_workspace_phase1.sql


-- 1. Colunas novas existem e nada foi preenchido.
do $$ begin
  if (select count(*) from information_schema.columns where table_name = 'opportunities'
      and column_name in ('procedure_id','probability','next_action','next_action_due','expected_surgery_date','custom_values')) <> 6 then
    raise exception 'Colunas novas ausentes em opportunities';
  end if;
  if exists (select 1 from public.opportunities where custom_values <> '{}'::jsonb or probability is not null) then
    raise exception 'Migration preencheu dados que deveriam ficar vazios';
  end if;
end $$;

-- 2. Probabilidade fora de 0-100 e custom_values nao-objeto sao rejeitados.
do $$ begin
  begin
    update public.opportunities set probability = 120 where id = 'e0000000-0000-4000-8000-000000000001';
    raise exception 'Probabilidade 120 foi aceita';
  exception when check_violation then null; end;
  begin
    update public.opportunities set custom_values = '[]'::jsonb where id = 'e0000000-0000-4000-8000-000000000001';
    raise exception 'custom_values array foi aceito';
  exception when check_violation then null; end;
end $$;

-- 3. Historico de campo: valor e custom_values geram linhas; etapa nao.
set test.uid = 'a0000000-0000-4000-8000-0000000000e1';
set role authenticated;
update public.opportunities
  set value = 2000, custom_values = '{"f1": "x"}'::jsonb, stage = 'consultado'
  where id = 'e0000000-0000-4000-8000-000000000001';
reset role;
do $$ begin
  if (select count(*) from public.opportunity_field_history where opportunity_id = 'e0000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'Historico esperado: value + custom:f1 (etapa fica no stage_history)';
  end if;
  if not exists (select 1 from public.opportunity_field_history where field = 'custom:f1'
      and changed_by = 'a0000000-0000-4000-8000-0000000000e1') then
    raise exception 'Historico sem autor';
  end if;
end $$;

-- 4. Historico e somente leitura para o app.
set test.uid = 'a0000000-0000-4000-8000-000000000001';
set role authenticated;
do $$ begin
  begin
    delete from public.opportunity_field_history;
    raise exception 'Historico aceitou delete';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 5. Campos personalizados: equipe nao cria; gestao cria; tipo incompativel bloqueado; sem delete.
set test.uid = 'a0000000-0000-4000-8000-0000000000e1';
set role authenticated;
do $$ begin
  begin
    insert into public.crm_custom_fields(user_id, label, field_type)
      values ('a0000000-0000-4000-8000-000000000001', 'Indicacao', 'text');
    raise exception 'Equipe criou campo personalizado';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set test.uid = 'a0000000-0000-4000-8000-0000000000a6';
set role authenticated;
insert into public.crm_custom_fields(id, user_id, label, field_type)
  values ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Valor sinal', 'number');
update public.crm_custom_fields set field_type = 'currency' where id = 'f0000000-0000-4000-8000-000000000001';
do $$ begin
  begin
    update public.crm_custom_fields set field_type = 'date' where id = 'f0000000-0000-4000-8000-000000000001';
    raise exception 'Mudanca de tipo incompativel aceita';
  exception when raise_exception then
    if sqlerrm not like 'Tipo de campo incompat%' then raise; end if;
  end;
  begin
    delete from public.crm_custom_fields where id = 'f0000000-0000-4000-8000-000000000001';
    raise exception 'Campo personalizado aceitou delete';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 6. Isolamento: clinica B nao ve campos nem oportunidades da clinica A.
set test.uid = 'b0000000-0000-4000-8000-000000000001';
set role authenticated;
do $$ begin
  if exists (select 1 from public.crm_custom_fields) then raise exception 'Clinica B viu campo da clinica A'; end if;
  if (select count(*) from public.opportunities) <> 1 then raise exception 'Clinica B viu oportunidade da A'; end if;
  begin
    insert into public.crm_custom_fields(user_id, label, field_type)
      values ('a0000000-0000-4000-8000-000000000001', 'Invasor', 'text');
    raise exception 'Clinica B gravou campo na clinica A';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 7. Visoes: equipe cria pessoal, nao cria compartilhada; pessoal de um nao aparece para outro.
set test.uid = 'a0000000-0000-4000-8000-0000000000e1';
set role authenticated;
insert into public.crm_views(user_id, name, scope, config)
  values ('a0000000-0000-4000-8000-000000000001', 'Minha visao', 'personal', '{"groupBy":"stage"}');
do $$ begin
  begin
    insert into public.crm_views(user_id, name, scope) values ('a0000000-0000-4000-8000-000000000001', 'Time', 'shared');
    raise exception 'Equipe criou visao compartilhada';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set test.uid = 'a0000000-0000-4000-8000-0000000000a6';
set role authenticated;
insert into public.crm_views(user_id, name, scope) values ('a0000000-0000-4000-8000-000000000001', 'Comercial', 'shared');
do $$ begin
  if (select count(*) from public.crm_views) <> 1 then
    raise exception 'Gestao deveria ver so a compartilhada (a pessoal da equipe e privada)';
  end if;
end $$;
reset role;

-- 8. Etapas: so admin/gestao configura; chave fora das 8 e cor invalida rejeitadas.
set test.uid = 'a0000000-0000-4000-8000-0000000000e1';
set role authenticated;
do $$ begin
  begin
    insert into public.crm_stage_settings(user_id, stage_key, color) values ('a0000000-0000-4000-8000-000000000001', 'consultado', '#112233');
    raise exception 'Equipe configurou etapa';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set test.uid = 'a0000000-0000-4000-8000-000000000001';
set role authenticated;
insert into public.crm_stage_settings(user_id, stage_key, color, probability)
  values ('a0000000-0000-4000-8000-000000000001', 'consultado', '#112233', 45);
do $$ begin
  begin
    insert into public.crm_stage_settings(user_id, stage_key) values ('a0000000-0000-4000-8000-000000000001', 'em_negociacao');
    raise exception 'Etapa inexistente aceita';
  exception when check_violation then null; end;
end $$;
reset role;

-- 9. Ultimo contato derivado: pega o evento mais recente entre as fontes; clinica B nao le a A.
insert into public.whatsapp_messages(user_id, patient_id, created_at)
  values ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '2026-11-01T10:00:00Z');
insert into public.tasks(user_id, opportunity_id, status, done_at)
  values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'feita', '2026-11-03T10:00:00Z');
insert into public.opportunity_notes(user_id, opportunity_id, created_at)
  values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', '2026-11-02T10:00:00Z');
set test.uid = 'a0000000-0000-4000-8000-0000000000e1';
set role authenticated;
do $$
declare r record;
begin
  select * into r from public.crm_last_contact(array['e0000000-0000-4000-8000-000000000001'::uuid]);
  if r.last_contact_at <> '2026-11-03T10:00:00Z'::timestamptz or r.last_contact_source <> 'tarefa' then
    raise exception 'Ultimo contato incorreto: % %', r.last_contact_at, r.last_contact_source;
  end if;
end $$;
reset role;
set test.uid = 'b0000000-0000-4000-8000-000000000001';
set role authenticated;
do $$ begin
  if exists (select 1 from public.crm_last_contact(array['e0000000-0000-4000-8000-000000000001'::uuid])) then
    raise exception 'Clinica B leu ultimo contato da clinica A';
  end if;
end $$;
reset role;

select 'crmWorkspacePhase1 OK' as resultado;
