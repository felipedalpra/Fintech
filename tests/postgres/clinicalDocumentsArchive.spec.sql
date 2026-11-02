-- Executar somente em banco local descartavel e vazio:
--   createdb surgimetrics_clinical_documents_archive_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_clinical_documents_archive_test \
--     -f tests/postgres/clinicalDocumentsArchive.spec.sql

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.clinics(
  id uuid primary key,
  owner_id uuid not null references auth.users(id)
);
create table public.clinic_members(
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  role text not null,
  clinical_access boolean not null default false
);

create or replace function public.data_owner_id()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select c.owner_id
     from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
     where cm.user_id = auth.uid()
     limit 1),
    auth.uid()
  )
$$;

create or replace function public.has_clinical_access()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.data_owner_id() is not null
    and (
      auth.uid() = public.data_owner_id()
      or exists (
        select 1
        from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
        where cm.user_id = auth.uid()
          and cm.clinical_access is true
          and c.owner_id = public.data_owner_id()
      )
    )
$$;

create or replace function public.can_issue_clinical_prescription()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.has_clinical_access()
    and (
      auth.uid() = public.data_owner_id()
      or exists (
        select 1
        from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
        where cm.user_id = auth.uid()
          and cm.role = 'admin'
          and cm.clinical_access is true
          and c.owner_id = public.data_owner_id()
      )
    )
$$;

create table public.clinical_documents(
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  patient_id uuid not null,
  created_by uuid references auth.users(id),
  patient_name text not null,
  document_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.prevent_clinical_record_mutation()
returns trigger language plpgsql
as $$
begin
  raise exception 'Registros clinicos sao imutaveis; registre um adendo.' using errcode = '55000';
end
$$;
create trigger trg_clinical_documents_immutable
before update or delete on public.clinical_documents
for each row execute function public.prevent_clinical_record_mutation();

\ir ../../supabase/clinical_documents_archive.sql

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000003');
insert into public.clinics(id, owner_id) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id, user_id, role, clinical_access) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'team', true),
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'team', true),
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'admin', true);
insert into public.clinical_documents(id, user_id, patient_id, created_by, patient_name) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Paciente 1'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Paciente 2'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Paciente 3'),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'Paciente 4');

-- O autor arquiva o proprio documento; repetir nao reescreve a trilha.
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
select public.archive_clinical_document('40000000-0000-4000-8000-000000000001', 'original');
select public.archive_clinical_document('40000000-0000-4000-8000-000000000001', 'nao pode substituir');
reset role;

do $$
begin
  if not exists (
    select 1 from public.clinical_documents
    where id = '40000000-0000-4000-8000-000000000001'
      and archived_at is not null
      and archived_by = '20000000-0000-4000-8000-000000000001'
      and archive_reason = 'original'
  ) then
    raise exception 'O arquivamento do autor ou a idempotencia falhou.';
  end if;
end $$;

-- Membro clinico comum nao pode arquivar documento de outro profissional.
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
do $$
begin
  begin
    perform public.archive_clinical_document('40000000-0000-4000-8000-000000000002', null);
    raise exception 'Membro comum arquivou documento de outro autor.';
  exception when sqlstate '42501' then
    null;
  end;
end $$;
reset role;

-- Owner e admin clinico podem corrigir documento de outro profissional.
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select public.archive_clinical_document('40000000-0000-4000-8000-000000000002', 'owner');
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000003';
select public.archive_clinical_document('40000000-0000-4000-8000-000000000003', 'admin');
reset role;

-- Conteudo e DELETE continuam imutaveis, inclusive depois do arquivamento.
do $$
begin
  begin
    update public.clinical_documents
    set patient_name = 'Alterado'
    where id = '40000000-0000-4000-8000-000000000004';
    raise exception 'Conteudo clinico foi alterado.';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    update public.clinical_documents
    set archive_reason = 'reescrito'
    where id = '40000000-0000-4000-8000-000000000001';
    raise exception 'Trilha de arquivamento foi reescrita.';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from public.clinical_documents
    where id = '40000000-0000-4000-8000-000000000004';
    raise exception 'Documento clinico foi apagado.';
  exception when sqlstate '55000' then
    null;
  end;
end $$;

select 'clinicalDocumentsArchive.spec.sql: ok' as result;
