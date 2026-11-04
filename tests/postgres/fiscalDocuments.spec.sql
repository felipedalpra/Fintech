-- Executar somente em banco local descartável e vazio:
--   createdb surgimetrics_fiscal_documents_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_fiscal_documents_test \
--     -f tests/postgres/fiscalDocuments.spec.sql
\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.data_owner_id() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.owner', true), '')::uuid $$;
create function public.finance_role_can_manage() returns boolean language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claim.finance_manage', true), '')::boolean, false) $$;

create table public.financial_entries(
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  direction text not null,
  source_type text not null,
  source_id uuid not null,
  source_component text not null,
  description text,
  total_amount numeric(12,2) not null,
  status text not null,
  archived_at timestamptz
);

insert into auth.users values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');
insert into public.financial_entries values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'receivable','surgery','30000000-0000-4000-8000-000000000001','revenue',
  'Cirurgia fiscal',100,'pending',null
);

\ir ../../supabase/fiscal_documents_schema.sql
-- Reaplicação deve substituir policies antigas, não preservar uma versão permissiva.
\ir ../../supabase/fiscal_documents_schema.sql
grant select on public.fiscal_documents, public.fiscal_document_allocations to authenticated;

set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';
set request.jwt.claim.owner = '10000000-0000-4000-8000-000000000001';
set request.jwt.claim.finance_manage = 'false';

do $$ begin
  perform public.create_fiscal_document_for_entry(
    '20000000-0000-4000-8000-000000000001',
    '{"document_type":"nfse","number":"NEGADA","issue_date":"2026-11-04","total_amount":100,"allocated_amount":100,"status":"issued"}'
  );
  raise exception 'Perfil operacional criou documento fiscal.';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  if (select count(*) from public.fiscal_documents) <> 0 then
    raise exception 'RLS expôs documentos ao perfil operacional.';
  end if;
end $$;

set request.jwt.claim.finance_manage = 'true';

do $$ begin
  perform public.create_fiscal_document_for_entry(
    '20000000-0000-4000-8000-000000000001',
    '{"document_type":"nfse","number":"VALOR-INVALIDO","issue_date":"2026-11-04","total_amount":1,"allocated_amount":100,"status":"issued"}'
  );
  raise exception 'Alocação maior que a nota foi aceita.';
exception when check_violation then null;
end $$;

select public.create_fiscal_document_for_entry(
  '20000000-0000-4000-8000-000000000001',
  '{"document_type":"nfse","number":"NF-1","issue_date":"2026-11-04","total_amount":100,"allocated_amount":100,"status":"issued"}'
);
select public.set_fiscal_document_status(
  (select id from public.fiscal_documents where number = 'NF-1'), 'canceled'
);
select public.create_fiscal_document_for_entry(
  '20000000-0000-4000-8000-000000000001',
  '{"document_type":"nfse","number":"NF-2","issue_date":"2026-11-04","total_amount":100,"allocated_amount":100,"status":"issued"}'
);

do $$ begin
  perform public.set_fiscal_document_status(
    (select id from public.fiscal_documents where number = 'NF-1'), 'issued'
  );
  raise exception 'Documento cancelado foi reativado e excedeu o título.';
exception when check_violation then null;
end $$;

do $$ begin
  if (select count(*) from public.fiscal_documents) <> 2 then
    raise exception 'Persistência fiscal final divergente.';
  end if;
  if (select count(*) from public.fiscal_documents where status <> 'canceled' and number = 'NF-1') <> 0 then
    raise exception 'Documento cancelado mudou de estado.';
  end if;
end $$;

set request.jwt.claim.owner = '10000000-0000-4000-8000-000000000003';
do $$ begin
  if (select count(*) from public.fiscal_documents) <> 0 then
    raise exception 'RLS expôs documentos de outra clínica.';
  end if;
end $$;

reset role;
select 'fiscal_documents_postgres_tests_ok' as result;
