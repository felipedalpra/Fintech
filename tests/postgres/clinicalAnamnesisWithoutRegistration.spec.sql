-- Executar somente em banco local descartavel e vazio:
--   createdb surgi_anam_test
--   psql -v ON_ERROR_STOP=1 -d surgi_anam_test -f tests/postgres/clinicalAnamnesisWithoutRegistration.spec.sql
--
-- Tabelas e funcoes abaixo sao COPIA FIEL dos arquivos de producao (extraidas do repo), para o
-- teste exercitar a funcao real e nao uma reconstrucao aproximada.

\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;

insert into auth.users(id, email) values
  ('10000000-0000-4000-8000-000000000001','vitoria@x.com'),
  ('20000000-0000-4000-8000-000000000002','jonas@x.com'),
  ('30000000-0000-4000-8000-000000000003','semacesso@x.com');

create table public.clinics(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text,
  clinical_professional_name text,
  clinical_professional_registration text,
  clinical_professional_council text,
  created_at timestamptz not null default now()
);
create table public.clinic_members(
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  role text not null,
  member_email text,
  clinical_access boolean not null default false,
  professional_name text,
  professional_registration text,
  professional_council text,
  created_at timestamptz not null default now(),
  unique (clinic_id, user_id)
);
create table public.patients(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null
);

create or replace function public.data_owner_id()
returns uuid language sql stable security definer as $$
  select coalesce(
    (select owner_id from public.clinics where owner_id = auth.uid() order by created_at limit 1),
    (select c.owner_id from public.clinic_members cm
     join public.clinics c on c.id = cm.clinic_id
     where cm.user_id = auth.uid() order by cm.created_at limit 1))
$$;

create or replace function public.has_clinical_access()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.data_owner_id() is not null
    and (
    auth.uid() = public.data_owner_id()
    or exists (
      select 1
      from public.clinic_members cm
      join public.clinics c on c.id = cm.clinic_id
      where cm.user_id = auth.uid()
        and cm.clinical_access is true
        and c.owner_id = public.data_owner_id()
    )
  )
$$;

create or replace function public.clinical_author_identity()
returns table(author_name text, author_registration text, author_council text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select identity.author_name, identity.author_registration, identity.author_council
  from (
    select
      c.clinical_professional_name as author_name,
      c.clinical_professional_registration as author_registration,
      c.clinical_professional_council as author_council,
      1 as priority
    from public.clinics c
    where c.owner_id = auth.uid()
      and c.owner_id = public.data_owner_id()
    union all
    select
      cm.professional_name,
      cm.professional_registration,
      cm.professional_council,
      2 as priority
    from public.clinic_members cm
    join public.clinics c on c.id = cm.clinic_id
    where cm.user_id = auth.uid()
      and cm.clinical_access is true
      and c.owner_id = public.data_owner_id()
  ) identity
  where nullif(btrim(identity.author_name), '') is not null
    and nullif(btrim(identity.author_registration), '') is not null
  order by identity.priority
  limit 1
$$;

create table if not exists public.clinical_anamneses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  session_date date not null,
  chief_complaint text not null check (length(btrim(chief_complaint)) between 1 and 20000),
  history_present_illness text not null check (length(btrim(history_present_illness)) between 1 and 20000),
  personal_history text check (personal_history is null or length(btrim(personal_history)) between 1 and 20000),
  family_history text check (family_history is null or length(btrim(family_history)) between 1 and 20000),
  review_of_systems text check (review_of_systems is null or length(btrim(review_of_systems)) between 1 and 20000),
  physical_exam text not null check (length(btrim(physical_exam)) between 1 and 20000),
  diagnostic_hypotheses text not null check (length(btrim(diagnostic_hypotheses)) between 1 and 20000),
  therapeutic_plan text not null check (length(btrim(therapeutic_plan)) between 1 and 20000),
  systolic_bp smallint check (systolic_bp is null or systolic_bp between 30 and 300),
  diastolic_bp smallint check (diastolic_bp is null or diastolic_bp between 20 and 200),
  temperature_c numeric(4,1) check (temperature_c is null or temperature_c between 25 and 45),
  heart_rate smallint check (heart_rate is null or heart_rate between 20 and 300),
  respiratory_rate smallint check (respiratory_rate is null or respiratory_rate between 4 and 100),
  oxygen_saturation numeric(5,2) check (oxygen_saturation is null or oxygen_saturation between 0 and 100),
  pain_score smallint check (pain_score is null or pain_score between 0 and 10),
  weight_kg numeric(6,2) check (weight_kg is null or weight_kg between 0.1 and 500),
  height_cm numeric(5,2) check (height_cm is null or height_cm between 20 and 250),
  author_name text not null,
  author_registration text not null,
  author_council text not null default 'CRM',
  authorship_source text not null default 'authenticated_user'
    check (authorship_source in ('authenticated_user')),
  recorded_at timestamptz not null default timezone('utc', now())
);

alter table public.clinical_anamneses
  add column if not exists request_id uuid,
  add column if not exists recorded_at timestamptz not null default timezone('utc', now()),
  add column if not exists protocol_id uuid,
  add column if not exists protocol_version_id uuid,
  add column if not exists protocol_name text,
  add column if not exists protocol_snapshot jsonb,
  add column if not exists protocol_responses jsonb;

create table if not exists public.clinical_protocols(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null
);

create table if not exists public.clinical_protocol_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  protocol_id uuid not null references public.clinical_protocols(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  name text not null check (length(btrim(name)) between 1 and 160),
  procedure_name text not null check (length(btrim(procedure_name)) between 1 and 160),
  description text check (description is null or length(description) <= 2000),
  indication text not null check (length(btrim(indication)) between 1 and 5000),
  objectives text not null check (length(btrim(objectives)) between 1 and 5000),
  planned_treatment text not null check (length(btrim(planned_treatment)) between 1 and 10000),
  guidance text not null check (length(btrim(guidance)) between 1 and 5000),
  anamnesis_prompts jsonb not null default '[]'::jsonb check (jsonb_typeof(anamnesis_prompts) = 'array'),
  exam_kit jsonb not null default '[]'::jsonb check (jsonb_typeof(exam_kit) = 'array'),
  medication_favorites jsonb not null default '[]'::jsonb check (jsonb_typeof(medication_favorites) = 'array'),
  photo_requirements jsonb not null default '[]'::jsonb check (jsonb_typeof(photo_requirements) = 'array'),
  return_schedule jsonb not null default '[]'::jsonb check (jsonb_typeof(return_schedule) = 'array'),
  created_by uuid not null references auth.users(id) on delete restrict,
  author_name text not null,
  author_registration text not null,
  author_council text not null default 'CRM',
  request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(protocol_id, version_number),
  unique(user_id, request_id)
);

create table if not exists public.clinical_record_access_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('view_record', 'create_record', 'create_addendum')),
  occurred_at timestamptz not null default timezone('utc', now())
);

-- Em producao o catalogo de acoes do log foi estendido por migration posterior; aqui so o
-- constraint atrapalha e nao e o objeto do teste.
alter table public.clinical_record_access_logs
  drop constraint if exists clinical_record_access_logs_action_check;

insert into public.clinics(id, owner_id, name, clinical_professional_name, clinical_professional_registration, clinical_professional_council)
values ('c1111111-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Clinica Vitoria','Dra. Vitoria Ribeiro','CRM-DF 12345','CRM');

insert into public.clinic_members(clinic_id, user_id, role, member_email, clinical_access, professional_name, professional_registration)
values
  ('c1111111-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','equipe','jonas@x.com', true,  null, null),
  ('c1111111-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','equipe','semacesso@x.com', false, null, null);

insert into public.patients(id, user_id, name)
values ('a1111111-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Ana Paula');

grant select, insert, update on all tables in schema public to authenticated;

-- ANTES da migration: Jonas (sem registro) NAO consegue registrar anamnese.
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
do $$
declare ident record;
begin
  select * into ident from public.clinical_author_identity();
  if ident.author_name is not null then
    raise exception 'Fixture nao reproduziu o bug: equipe sem registro ja tinha identidade.';
  end if;
end $$;
reset role;

\ir ../../supabase/clinical_anamnesis_without_registration.sql

-- ---------------------------------------------------------------------------
-- 1. Equipe autorizada, SEM registro, registra anamnese nominal e nao-profissional.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
do $$
declare novo uuid; linha public.clinical_anamneses%rowtype;
begin
  novo := public.create_clinical_anamnesis(
    'a1111111-0000-4000-8000-000000000001', current_date,
    jsonb_build_object(
      'chief_complaint','Queixa','history_present_illness','Historia',
      'physical_exam','Exame','diagnostic_hypotheses','Hipotese','therapeutic_plan','Plano'),
    gen_random_uuid());
  select * into linha from public.clinical_anamneses where id = novo;
  if linha.author_name <> 'jonas@x.com' then
    raise exception 'Autoria da equipe nao ficou nominal: %', linha.author_name;
  end if;
  if linha.author_registration is not null then
    raise exception 'Registro inventado para quem nao tem: %', linha.author_registration;
  end if;
  if linha.author_is_professional is not false then
    raise exception 'Anamnese da equipe foi marcada como profissional.';
  end if;
  if linha.created_by <> '20000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'created_by nao guardou quem escreveu.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Quem NAO tem acesso clinico continua barrado.
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '30000000-0000-4000-8000-000000000003';
do $$
begin
  begin
    perform public.create_clinical_anamnesis(
      'a1111111-0000-4000-8000-000000000001', current_date,
      jsonb_build_object('chief_complaint','a','history_present_illness','b',
        'physical_exam','c','diagnostic_hypotheses','d','therapeutic_plan','e'),
      gen_random_uuid());
    raise exception 'Membro sem acesso clinico registrou anamnese.';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Profissional com registro continua assinando como profissional.
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
do $$
declare novo uuid; linha public.clinical_anamneses%rowtype;
begin
  novo := public.create_clinical_anamnesis(
    'a1111111-0000-4000-8000-000000000001', current_date,
    jsonb_build_object('chief_complaint','Q','history_present_illness','H',
      'physical_exam','E','diagnostic_hypotheses','D','therapeutic_plan','P'),
    gen_random_uuid());
  select * into linha from public.clinical_anamneses where id = novo;
  if linha.author_registration <> 'CRM-DF 12345' then
    raise exception 'Profissional perdeu o registro na autoria: %', linha.author_registration;
  end if;
  if linha.author_is_professional is not true then
    raise exception 'Anamnese da profissional nao ficou marcada como profissional.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. A identidade ESTRITA nao foi afrouxada: evolucao e receita seguem exigindo registro.
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
do $$
declare ident record;
begin
  select * into ident from public.clinical_author_identity();
  if ident.author_name is not null then
    raise exception 'clinical_author_identity() passou a aceitar quem nao tem registro.';
  end if;
end $$;
reset role;

select 'clinicalAnamnesisWithoutRegistration: OK' as resultado;
