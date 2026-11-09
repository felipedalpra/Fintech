-- Executar somente em banco local descartavel e vazio:
--   createdb surgi_crm_workspace3_test
--   psql -v ON_ERROR_STOP=1 -d surgi_crm_workspace3_test -f tests/postgres/crmWorkspacePhase3.spec.sql
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

create table public.opportunities(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text not null default 'Oportunidade',
  stage text not null default 'primeiro_contato',
  status text not null default 'aberto'
);
-- Espelha tasks_timeline_schema.sql (tabela e politica reais).
create table public.opportunity_notes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  body           text not null,
  author_id      uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default timezone('utc', now())
);
-- Espelha crm_workspace_phase1.sql (crm_views).
create table public.crm_views (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name        text not null check (length(trim(name)) between 1 and 60),
  scope       text not null default 'personal' check (scope in ('personal','shared')),
  view_type   text not null default 'table' check (view_type in ('table','kanban','agenda')),
  config      jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  position    int not null default 0,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select, insert, update, delete on public.opportunities, public.opportunity_notes, public.crm_views to authenticated;
alter table public.opportunities enable row level security;
create policy opp_clinic on public.opportunities for all to authenticated
  using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());
alter table public.opportunity_notes enable row level security;
create policy "Opportunity notes clinic access" on public.opportunity_notes for all to authenticated
  using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());
alter table public.crm_views enable row level security;
create policy "CRM views read" on public.crm_views for select to authenticated
  using (user_id = public.data_owner_id() and (scope = 'shared' or owner_id = auth.uid()));

insert into public.opportunities(id, user_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001');
-- Nota antiga (antes da migration) e uma visualizacao pessoal existente.
insert into public.opportunity_notes(id, user_id, opportunity_id, body, author_id) values
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Nota antiga', 'a0000000-0000-4000-8000-000000000001');
insert into public.crm_views(user_id, owner_id, name, scope, position) values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000e1', 'Minha', 'personal', 5);

\ir ../../supabase/crm_workspace_phase3.sql
-- Reaplicar a migration nao pode falhar nem duplicar objeto.
\ir ../../supabase/crm_workspace_phase3.sql

-- 1. Nada existente foi alterado.
do $$ begin
  if (select count(*) from public.opportunity_notes where parent_id is not null or mentions <> '{}') <> 0 then
    raise exception 'Migration alterou notas existentes';
  end if;
  if (select body from public.opportunity_notes where id = 'f0000000-0000-4000-8000-000000000001') <> 'Nota antiga' then
    raise exception 'Nota antiga alterada';
  end if;
  if (select count(*) from public.crm_views) <> 1 then raise exception 'Migration criou visualizacao'; end if;
  if (select count(*) from pg_trigger where tgname = 'trg_opportunity_notes_guard') <> 1 then
    raise exception 'Trigger duplicado ou ausente';
  end if;
end $$;

-- 2. Equipe comenta: autor forcado, mencoes limpas (so equipe da clinica, sem repeticao).
set test.uid = 'a0000000-0000-4000-8000-0000000000e1';
set role authenticated;
do $$
declare n public.opportunity_notes;
begin
  insert into public.opportunity_notes(user_id, opportunity_id, body, author_id, mentions)
  values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Oi @dra',
          'a0000000-0000-4000-8000-000000000001',
          array['a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',
                'b0000000-0000-4000-8000-000000000001','99999999-0000-4000-8000-000000000001']::uuid[])
  returning * into n;
  if n.author_id <> 'a0000000-0000-4000-8000-0000000000e1' then raise exception 'Autor nao foi forcado: %', n.author_id; end if;
  if n.mentions <> array['a0000000-0000-4000-8000-000000000001']::uuid[] then
    raise exception 'Mencoes nao foram limpas: %', n.mentions;
  end if;
end $$;

-- 3. Resposta a uma resposta vai para o fio original; resposta de outra oportunidade e rejeitada.
do $$
declare root uuid; r1 public.opportunity_notes; r2 public.opportunity_notes;
begin
  root := 'f0000000-0000-4000-8000-000000000001';
  insert into public.opportunity_notes(user_id, opportunity_id, body, parent_id)
  values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'r1', root) returning * into r1;
  insert into public.opportunity_notes(user_id, opportunity_id, body, parent_id)
  values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'r2', r1.id) returning * into r2;
  if r1.parent_id <> root or r2.parent_id <> root then raise exception 'Fio nao normalizado'; end if;
  begin
    insert into public.opportunity_notes(user_id, opportunity_id, body, parent_id)
    values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'x', root);
    raise exception 'Resposta em outra oportunidade aceita';
  exception when raise_exception then
    if sqlerrm <> 'Atualização original não encontrada nesta oportunidade' then raise; end if;
  end;
end $$;

-- 4. Isolamento: comentar na oportunidade da clinica B com o user_id da clinica A e rejeitado.
do $$ begin
  begin
    insert into public.opportunity_notes(user_id, opportunity_id, body)
    values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'x');
    raise exception 'Nota em oportunidade de outra clinica aceita';
  exception when raise_exception then
    if sqlerrm <> 'Oportunidade não encontrada nesta clínica' then raise; end if;
  end;
end $$;

-- 5. Vinculos, autoria e mencoes imutaveis.
do $$ begin
  begin
    update public.opportunity_notes set opportunity_id = 'e0000000-0000-4000-8000-000000000002'
      where id = 'f0000000-0000-4000-8000-000000000001';
    raise exception 'Mover nota aceito';
  exception when raise_exception then
    if sqlerrm not like 'Não é permitido%' then raise; end if;
  end;
  begin
    update public.opportunity_notes set mentions = array['a0000000-0000-4000-8000-0000000000e1']::uuid[]
      where body = 'Oi @dra';
    raise exception 'Alterar mencoes aceito';
  exception when raise_exception then
    if sqlerrm not like 'Não é permitido%' then raise; end if;
  end;
end $$;

-- 6. Visualizacoes iniciais: criadas uma vez por clinica, compartilhadas, com os filtros certos.
do $$
declare n int;
begin
  n := public.crm_ensure_default_views();
  if n <> 3 then raise exception 'Deveria criar 3 visualizacoes, criou %', n; end if;
  n := public.crm_ensure_default_views();
  if n <> 0 then raise exception 'Reexecutar criou % visualizacoes', n; end if;
  if (select count(*) from public.crm_views where preset_key is not null and scope = 'shared'
        and owner_id = 'a0000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'Visualizacoes iniciais com escopo/dono errados';
  end if;
  if (select config #> '{filters,responsible}' from public.crm_views where preset_key = 'my_leads') <> '["me"]'::jsonb then
    raise exception 'Meus leads sem filtro do usuario atual';
  end if;
  if (select config #>> '{filters,openTasks}' from public.crm_views where preset_key = 'pending_followups') <> 'true' then
    raise exception 'Follow-ups sem filtro de tarefa aberta';
  end if;
  if (select config #> '{filters,stage}' from public.crm_views where preset_key = 'quotes_in_negotiation') <> '["orcamento_enviado"]'::jsonb then
    raise exception 'Orcamentos sem filtro de etapa';
  end if;
  if (select min(position) from public.crm_views where preset_key is not null) <= 5 then
    raise exception 'Visualizacoes iniciais nao foram para o fim';
  end if;
end $$;
reset role;

-- Excluida pela gestao, nao volta sozinha.
delete from public.crm_views where preset_key = 'my_leads';
set test.uid = 'a0000000-0000-4000-8000-000000000001';
set role authenticated;
do $$ begin
  if public.crm_ensure_default_views() <> 0 then raise exception 'Visualizacao excluida voltou'; end if;
end $$;
-- Clinica B recebe as suas, sem tocar nas da A.
set test.uid = 'b0000000-0000-4000-8000-000000000001';
do $$ begin
  if public.crm_ensure_default_views() <> 3 then raise exception 'Clinica B sem visualizacoes'; end if;
  if (select count(*) from public.crm_views) <> 3 then raise exception 'Clinica B enxerga visualizacoes da A'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.crm_views where user_id = 'a0000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'Visualizacoes da clinica A alteradas';
  end if;
end $$;

select 'crmWorkspacePhase3 OK' as resultado;
