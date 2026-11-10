\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;

create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.patients(
  id uuid primary key, user_id uuid not null, active boolean not null default true,
  full_name text not null, cpf text, address_street text, address_number text,
  address_complement text, address_district text, address_city text,
  address_state text, address_zip text
);

create table public.clinical_assets(
  id uuid primary key, user_id uuid not null, patient_id uuid not null,
  created_by uuid not null, asset_kind text not null, captured_on date not null,
  file_name text not null, expected_mime_type text not null,
  observed_mime_type text, file_size bigint, client_sha256 text not null,
  status text not null
);

create table public.clinical_documents(
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  patient_id uuid not null, created_by uuid, document_type text not null,
  issue_date date not null, document_data jsonb not null, patient_name text not null,
  patient_cpf text, patient_address text, author_name text not null,
  author_registration text not null, author_council text not null,
  issuer_contact text not null, issuer_address text not null, request_id uuid not null,
  request_fingerprint text not null, archived_at timestamptz,
  constraint clinical_documents_document_type_check
    check (document_type in ('exam_request', 'simple_prescription')),
  unique(user_id, patient_id, request_id)
);

create table public.clinical_record_access_logs(
  user_id uuid, patient_id uuid, actor_id uuid, action text
);

create or replace function public.data_owner_id() returns uuid language sql stable as $$
  select '10000000-0000-4000-8000-000000000001'::uuid
$$;
create or replace function public.has_clinical_access() returns boolean language sql stable as $$ select true $$;
create or replace function public.clinical_author_identity()
returns table(author_name text, author_registration text, author_council text)
language sql stable as $$ select 'Dra. Teste'::text, 'CRM-RS 123'::text, 'CRM'::text $$;

insert into auth.users(id) values ('20000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', false);
insert into public.patients(id,user_id,full_name,cpf,address_street,address_number,address_city,address_state)
values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Ana Teste','52998224725','Rua A','10','Porto Alegre','RS');
insert into public.clinical_assets(id,user_id,patient_id,created_by,asset_kind,captured_on,file_name,expected_mime_type,observed_mime_type,file_size,client_sha256,status)
values ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','document','2026-11-10','laudo.pdf','application/pdf','application/pdf',100,repeat('a',64),'available');

\ir ../../supabase/clinical_asset_signature_bridge.sql
\ir ../../supabase/clinical_asset_signature_bridge.sql

do $$
declare first_id uuid; second_id uuid;
begin
  first_id := public.prepare_clinical_asset_signature('40000000-0000-4000-8000-000000000001');
  second_id := public.prepare_clinical_asset_signature('40000000-0000-4000-8000-000000000001');
  if first_id is null or first_id is distinct from second_id then
    raise exception 'Preparacao do anexo nao foi idempotente.';
  end if;
  if (select count(*) from public.clinical_documents where source_asset_id = '40000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Snapshot do anexo foi duplicado.';
  end if;
  if (select document_type from public.clinical_documents where id = first_id) <> 'uploaded_pdf' then
    raise exception 'Snapshot nao recebeu o tipo uploaded_pdf.';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', false);
do $$
begin
  perform public.prepare_clinical_asset_signature('40000000-0000-4000-8000-000000000001');
  raise exception 'Outro profissional conseguiu preparar o PDF.';
exception when insufficient_privilege then null;
end $$;
