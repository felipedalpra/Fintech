-- Executar somente em banco local descartável e vazio:
--   createdb surgimetrics_clinical_workspace_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_clinical_workspace_test -f tests/postgres/clinicalWorkspaceViews.spec.sql

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.clinics(id uuid primary key, owner_id uuid not null references auth.users(id));
create table public.clinic_members(
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  clinical_access boolean not null default false
);
create table public.patients(id uuid primary key, user_id uuid not null references auth.users(id));
create table public.medical_records(
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  patient_id uuid not null references public.patients(id),
  session_date date not null,
  evolution_notes text not null,
  procedures_applied text,
  next_appointment_date date,
  author_name text not null,
  recorded_at timestamptz not null,
  archived boolean not null default false
);

create or replace function public.data_owner_id()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select c.owner_id from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id where cm.user_id = auth.uid() limit 1),
    auth.uid()
  )
$$;
create or replace function public.has_clinical_access()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() = public.data_owner_id()
    or exists (
      select 1 from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
      where cm.user_id = auth.uid() and cm.clinical_access is true and c.owner_id = public.data_owner_id()
    )
$$;

alter table public.medical_records enable row level security;
create policy clinical_record_read on public.medical_records for select to authenticated
using (user_id = public.data_owner_id() and public.has_clinical_access());
grant usage on schema public to authenticated;
grant select on public.medical_records to authenticated;

\ir ../../supabase/clinical_workspace_views_schema.sql

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000004');
insert into public.clinics(id, owner_id) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003');
insert into public.clinic_members(clinic_id, user_id, clinical_access) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', true),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', false);
insert into public.patients(id, user_id) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003');
insert into public.medical_records(id, user_id, patient_id, session_date, evolution_notes, procedures_applied, next_appointment_date, author_name, recorded_at, archived) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', current_date, 'Conteúdo A', 'Conduta A', current_date + 7, 'Dra. A', now(), false),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', current_date, 'Conteúdo B', 'Conduta B', current_date + 10, 'Dra. B', now(), false),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', current_date - 1, 'Arquivado', null, null, 'Dra. A', now(), true);

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
do $$
begin
  if (select count(*) from public.list_clinical_workspace_record_metadata()) <> 1 then
    raise exception 'A projeção não respeitou clínica, acesso ou arquivamento.';
  end if;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
do $$
begin
  if (select count(*) from public.list_clinical_workspace_record_metadata()) <> 0 then
    raise exception 'Membro sem acesso clínico recebeu metadados do prontuário.';
  end if;
end $$;
reset role;

set role anon;
do $$
begin
  perform * from public.list_clinical_workspace_record_metadata();
  raise exception 'Anon executou a projeção clínica.';
exception when insufficient_privilege then
  null;
end $$;
reset role;

\ir ../../supabase/clinical_workspace_views_schema.sql

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$
begin
  if (select count(*) from public.list_clinical_workspace_record_metadata()) <> 1 then
    raise exception 'A reaplicação alterou a RLS da projeção.';
  end if;
end $$;
reset role;

select 'clinical workspace views postgres tests passed' as result;
