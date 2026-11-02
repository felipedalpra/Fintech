-- Executar somente em banco local descartavel e vazio:
--   createdb surgimetrics_clinical_identity_sync_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_clinical_identity_sync_test \
--     -f tests/postgres/clinicalProfessionalIdentitySync.spec.sql

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
  owner_id uuid not null references auth.users(id),
  clinical_professional_name text,
  clinical_professional_registration text,
  clinical_professional_council text not null default 'CRM'
);
create table public.clinic_members(
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  clinical_access boolean not null default false,
  professional_name text,
  professional_registration text,
  professional_council text not null default 'CRM'
);

create or replace function public.data_owner_id()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select c.owner_id
     from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
     where cm.user_id = auth.uid()
     limit 1),
    (select c.owner_id from public.clinics c where c.owner_id = auth.uid() limit 1),
    auth.uid()
  )
$$;

create or replace function public.has_clinical_access()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.data_owner_id() is not null
    and (
      exists (select 1 from public.clinics c where c.owner_id = auth.uid())
      or exists (
        select 1
        from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
        where cm.user_id = auth.uid()
          and cm.clinical_access is true
          and c.owner_id = public.data_owner_id()
      )
    )
$$;

\ir ../../supabase/clinical_professional_identity_sync.sql

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000003');
insert into public.clinics(id, owner_id) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id, user_id, clinical_access) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', true),
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', false);

-- Owner grava a identidade no registro da clinica.
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select public.sync_clinical_professional_identity('Dra. Owner', 'CRM-RS 100', 'CRM');
reset role;

do $$
begin
  if not exists (
    select 1 from public.clinics
    where owner_id = '10000000-0000-4000-8000-000000000001'
      and clinical_professional_name = 'Dra. Owner'
      and clinical_professional_registration = 'CRM-RS 100'
  ) then
    raise exception 'A identidade do owner nao foi persistida.';
  end if;
end $$;

-- Membro clinico grava somente a propria linha.
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
select public.sync_clinical_professional_identity('Dr. Membro', 'CRM-RS 200', 'CRM');
reset role;

do $$
begin
  if not exists (
    select 1 from public.clinic_members
    where user_id = '20000000-0000-4000-8000-000000000001'
      and professional_name = 'Dr. Membro'
      and professional_registration = 'CRM-RS 200'
  ) then
    raise exception 'A identidade do membro clinico nao foi persistida.';
  end if;
  if exists (
    select 1 from public.clinic_members
    where user_id = '20000000-0000-4000-8000-000000000002'
      and professional_name is not null
  ) then
    raise exception 'A identidade de outro membro foi alterada.';
  end if;
end $$;

-- Membro sem acesso clinico e usuario sem vinculo falham fechados.
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
do $$
begin
  begin
    perform public.sync_clinical_professional_identity('Sem acesso', 'CRM-RS 300', 'CRM');
    raise exception 'Membro sem acesso clinico conseguiu sincronizar identidade.';
  exception when sqlstate '42501' then
    null;
  end;
end $$;

set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000003';
do $$
begin
  begin
    perform public.sync_clinical_professional_identity('Sem vinculo', 'CRM-RS 400', 'CRM');
    raise exception 'Usuario sem vinculo conseguiu sincronizar identidade.';
  exception when sqlstate '42501' then
    null;
  end;
end $$;

-- Valor vazio falha e nunca apaga identidade ja persistida.
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
do $$
begin
  begin
    perform public.sync_clinical_professional_identity('', '', 'CRM');
    raise exception 'Identidade vazia foi aceita.';
  exception when sqlstate '22023' then
    null;
  end;
end $$;
reset role;

do $$
begin
  if not exists (
    select 1 from public.clinic_members
    where user_id = '20000000-0000-4000-8000-000000000001'
      and professional_name = 'Dr. Membro'
      and professional_registration = 'CRM-RS 200'
  ) then
    raise exception 'Uma tentativa vazia apagou a identidade existente.';
  end if;
end $$;

select 'clinicalProfessionalIdentitySync.spec.sql: ok' as result;
