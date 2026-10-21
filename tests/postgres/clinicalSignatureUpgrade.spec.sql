-- Simula upgrade da primeira versão da migration em banco local descartável.
--   createdb surgimetrics_signature_upgrade_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_signature_upgrade_test -f tests/postgres/clinicalSignatureUpgrade.spec.sql

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key);

create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.clinics (
  id uuid primary key,
  owner_id uuid not null references auth.users(id)
);

create table public.clinic_members (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  clinical_access boolean not null default false
);

create table public.clinical_documents (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  patient_id uuid not null,
  created_by uuid references auth.users(id),
  author_name text not null,
  author_registration text not null,
  author_council text not null
);

create or replace function public.data_owner_id()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$ select auth.uid() $$;

create or replace function public.has_clinical_access()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select true $$;

insert into auth.users(id) values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002');

insert into public.clinics(id, owner_id)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');

insert into public.clinic_members(clinic_id, user_id, clinical_access)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', true);

insert into public.clinical_documents(id, user_id, patient_id, created_by, author_name, author_registration, author_council)
values (
  '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
  'Dra. Legada', 'CRM-RS 200', 'CRM'
);

-- Estrutura antiga: referência livre, sem snapshot profissional e UNIQUE
-- permanente que impediria uma reconexão com o mesmo provedor.
create table public.clinical_signature_connections (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  professional_user_id uuid not null references auth.users(id),
  provider text not null,
  signing_mode text not null,
  credential_reference text not null,
  status text not null default 'pending',
  certificate_subject text,
  certificate_serial text,
  certificate_issuer text,
  certificate_valid_from timestamptz,
  certificate_valid_until timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, professional_user_id, provider)
);

create table public.clinical_document_signatures (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  document_id uuid not null references public.clinical_documents(id),
  requested_by uuid references auth.users(id),
  signer_user_id uuid not null references auth.users(id),
  connection_id uuid not null references public.clinical_signature_connections(id),
  request_id uuid not null,
  provider text not null,
  provider_request_id text,
  status text not null default 'pending',
  rendering_version text not null,
  document_payload_sha256 text not null,
  signed_file_path text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, document_id, request_id)
);

insert into public.clinical_signature_connections(
  id, user_id, professional_user_id, provider, signing_mode, credential_reference, status
) values (
  '50000000-0000-4000-8000-000000000001', '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002', 'provedor', 'a1_vault', 'MinhaSenha123', 'active'
);

insert into public.clinical_document_signatures(
  id, user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
  provider, provider_request_id, status, rendering_version, document_payload_sha256, signed_file_path
) values (
  '60000000-0000-4000-8000-000000000001', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002', '50000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001', 'provedor', 'legacy-request', 'signed',
  'clinical-pdf-v1', repeat('a', 64), 'legacy/document.pdf'
), (
  '60000000-0000-4000-8000-000000000002', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002', '50000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002', 'provedor', 'legacy-request-2', 'signed',
  'clinical-pdf-v1', repeat('b', 64), 'legacy/document-2.pdf'
), (
  '60000000-0000-4000-8000-000000000003', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002', '50000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000003', 'provedor', 'legacy-request-3', 'pending',
  'clinical-pdf-v1', repeat('c', 64), null
), (
  '60000000-0000-4000-8000-000000000004', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002', '50000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000004', 'provedor', 'legacy-request-4', 'pending',
  'clinical-pdf-v1', repeat('d', 64), null
);

\ir ../../supabase/clinical_signature_readiness_schema.sql

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_signature_connections'
      and column_name = 'professional_registration'
  ) then
    raise exception 'Upgrade não adicionou o snapshot profissional.';
  end if;

  if (select status from public.clinical_signature_connections where id = '50000000-0000-4000-8000-000000000001') <> 'error' then
    raise exception 'Conexão antiga insegura deveria exigir reconfiguração.';
  end if;

  if (select credential_reference from public.clinical_signature_connections where id = '50000000-0000-4000-8000-000000000001')
     <> 'vault://50000000-0000-4000-8000-000000000001' then
    raise exception 'Referência antiga não foi substituída por identificador seguro.';
  end if;

  if (select count(*) from public.clinical_document_signatures where status = 'signed' and rule_version = 1) <> 2 then
    raise exception 'Evidências legadas duplicadas foram apagadas ou alteradas.';
  end if;

  if (select count(*) from public.clinical_document_signatures where status = 'failed' and failure_code = 'credential_reconfiguration_required' and rule_version = 1) <> 2 then
    raise exception 'Pendências inseguras não foram terminalizadas com motivo auditável.';
  end if;
end $$;

-- O UNIQUE antigo foi removido: a reconexão cria nova linha e mantém o histórico.
insert into public.clinical_signature_connections(
  id, user_id, professional_user_id, provider, signing_mode, credential_reference, status,
  professional_name, professional_registration, professional_council
) values (
  '50000000-0000-4000-8000-000000000002', '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002', 'provedor', 'a1_vault',
  'vault://50000000-0000-4000-8000-000000000002', 'active', 'Dra. Legada', 'CRM-RS 200', 'CRM'
);

-- Reaplicação continua idempotente e não altera evidência legada.
\ir ../../supabase/clinical_signature_readiness_schema.sql

select 'clinical signature upgrade postgres tests passed' as result;
