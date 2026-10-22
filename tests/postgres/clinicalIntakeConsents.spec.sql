-- Executar somente em banco local descartavel e vazio:
--   createdb surgimetrics_clinical_intake_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_clinical_intake_test -f tests/postgres/clinicalIntakeConsents.spec.sql

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

create table public.clinics(id uuid primary key, owner_id uuid not null references auth.users(id), name text not null);
create table public.clinic_members(
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  clinical_access boolean not null default false
);
create table public.patients(id uuid primary key, user_id uuid not null references auth.users(id), full_name text not null);
create table public.clinical_record_access_logs(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, patient_id uuid not null,
  actor_id uuid, action text not null
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
create or replace function public.prevent_clinical_record_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin raise exception 'Registros clinicos sao imutaveis.' using errcode = '55000'; end $$;

\ir ../../supabase/clinical_intake_consents_schema.sql

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');
insert into public.clinics(id, owner_id, name) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Clínica A'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'Clínica B');
insert into public.clinic_members(clinic_id, user_id, clinical_access) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', true);
insert into public.patients(id, user_id, full_name) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Paciente A'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'Paciente B');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
select public.create_clinical_intake_template(
  'Pré-anamnese', 'Responda antes da consulta.',
  '{"fields":[{"id":"queixa","label":"Queixa","type":"textarea","required":true,"soap_field":"chief_complaint"}]}'::jsonb,
  null
) as template_id \gset
select public.create_clinical_consent_template(
  'TCLE de avaliação', 'Texto completo do termo de consentimento para avaliação clínica.',
  'tcle', true, null
) as consent_id \gset
select request_id, access_token, expires_at
from public.create_clinical_intake_request(
  '30000000-0000-4000-8000-000000000001', :'template_id'::uuid,
  array[:'consent_id'::uuid], 3
) \gset
select set_config('test.clinical_access_token', :'access_token', false);
select set_config('test.clinical_consent_id', :'consent_id', false);

do $$
begin
  if exists (
    select 1 from public.clinical_intake_requests
    where encode(token_hash, 'hex') = current_setting('test.clinical_access_token')
  ) then
    raise exception 'O token foi persistido em claro.';
  end if;
end $$;

-- O frontend autenticado pode listar convites, mas nunca ler o hash secreto.
set role authenticated;
do $$
begin
  begin
    execute 'select token_hash from public.clinical_intake_requests limit 1';
    raise exception 'Era esperado ocultar o hash do token do frontend.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Editar um modelo cria uma nova versão; o registro anterior continua intacto.
select public.create_clinical_intake_template(
  'Pré-anamnese atualizada', 'Nova orientação.',
  '{"fields":[{"id":"queixa","label":"Queixa principal","type":"textarea","required":true,"soap_field":"chief_complaint"}]}'::jsonb,
  :'template_id'::uuid
) as template_v2_id \gset
select set_config('test.clinical_template_v2_id', :'template_v2_id', false);
do $$
declare
  original public.clinical_intake_templates;
  revision public.clinical_intake_templates;
begin
  select * into revision from public.clinical_intake_templates where id = current_setting('test.clinical_template_v2_id')::uuid;
  select * into original from public.clinical_intake_templates where id = revision.replaces_template_id;
  if revision.version <> 2 or revision.family_id <> original.family_id then
    raise exception 'Versionamento imutável do modelo incorreto.';
  end if;
  if original.title <> 'Pré-anamnese' then
    raise exception 'A versão anterior foi alterada.';
  end if;
end $$;

set role anon;
do $$
declare payload jsonb;
begin
  payload := public.get_public_clinical_intake(current_setting('test.clinical_access_token'));
  if payload ->> 'title' <> 'Pré-anamnese' then raise exception 'Payload público incorreto.'; end if;
  if payload ? 'patientId' or payload ? 'patientName' or payload ? 'cpf' or payload ? 'phone' then
    raise exception 'Payload público expôs identificação do paciente.';
  end if;
end $$;
select public.submit_public_clinical_intake(
  :'access_token', '40000000-0000-4000-8000-000000000001', '{"queixa":"Avaliação"}'::jsonb,
  'Paciente A', array[:'consent_id'::uuid]
) as submission_id \gset
reset role;

-- A mesma tentativa é idempotente, mas outro envio não reutiliza o token consumido.
set role anon;
select public.submit_public_clinical_intake(
  :'access_token', '40000000-0000-4000-8000-000000000001', '{"queixa":"Avaliação"}'::jsonb,
  'Paciente A', array[:'consent_id'::uuid]
);
do $$
begin
  begin
    perform public.submit_public_clinical_intake(
      current_setting('test.clinical_access_token'), '40000000-0000-4000-8000-000000000002', '{"queixa":"Duplicada"}'::jsonb,
      'Paciente A', array[current_setting('test.clinical_consent_id')::uuid]
    );
    raise exception 'Era esperado bloquear o segundo envio.';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

do $$
begin
  if (select count(*) from public.clinical_intake_submissions) <> 1 then raise exception 'Resposta duplicada.'; end if;
  if (select count(*) from public.clinical_consent_acceptances) <> 1 then raise exception 'Aceite duplicado.'; end if;
  begin
    update public.clinical_intake_submissions set respondent_name = 'Alterado';
    raise exception 'Era esperado bloquear mutação da resposta.';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- A outra clínica não lê resposta, convite nem aceite.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$
begin
  if (select count(*) from public.clinical_intake_requests) <> 0 then raise exception 'RLS expôs convite cross-clínica.'; end if;
  if (select count(*) from public.clinical_intake_submissions) <> 0 then raise exception 'RLS expôs resposta cross-clínica.'; end if;
  if (select count(*) from public.clinical_consent_acceptances) <> 0 then raise exception 'RLS expôs aceite cross-clínica.'; end if;
end $$;
reset role;

-- Reaplicar não apaga nem reescreve histórico.
\ir ../../supabase/clinical_intake_consents_schema.sql
do $$
begin
  if (select count(*) from public.clinical_intake_submissions) <> 1 then raise exception 'Reaplicação alterou a resposta.'; end if;
  if (select count(*) from public.clinical_consent_acceptances) <> 1 then raise exception 'Reaplicação alterou o aceite.'; end if;
end $$;

select 'clinical intake and consents postgres tests passed' as result;
