-- Executar somente em banco local descartavel e vazio:
--   createdb surgimetrics_bank_claim_release_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_bank_claim_release_test \
--     -f tests/postgres/bankClaimRelease.spec.sql

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create extension if not exists pgcrypto;
create extension if not exists dblink;
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function public.data_owner_id()
returns uuid language sql stable
as $$
  select case auth.uid()
    when '20000000-0000-4000-8000-000000000001'::uuid then '10000000-0000-4000-8000-000000000001'::uuid
    when '20000000-0000-4000-8000-000000000002'::uuid then '10000000-0000-4000-8000-000000000001'::uuid
    when '20000000-0000-4000-8000-000000000003'::uuid then '10000000-0000-4000-8000-000000000001'::uuid
    when '20000000-0000-4000-8000-000000000004'::uuid then '10000000-0000-4000-8000-000000000002'::uuid
    else null
  end
$$;

create or replace function public.bank_reconciliation_can_manage()
returns boolean language sql stable
as $$
  select auth.uid() in (
    '20000000-0000-4000-8000-000000000001'::uuid,
    '20000000-0000-4000-8000-000000000002'::uuid,
    '20000000-0000-4000-8000-000000000004'::uuid
  )
$$;

create table public.bank_statement_lines(
  id uuid primary key,
  user_id uuid not null,
  archived_at timestamptz,
  review_status text not null,
  review_reason text,
  review_claim_token uuid,
  reviewed_by uuid,
  reviewed_at timestamptz
);
create table public.bank_reconciliations(
  statement_line_id uuid not null,
  user_id uuid not null,
  reversed_at timestamptz
);
create table public.financial_entries(
  user_id uuid not null,
  source_id uuid not null,
  archived_at timestamptz
);
create table public.extra_revenues(
  id uuid primary key,
  user_id uuid not null,
  archived_at timestamptz
);
create table public.expenses(
  id uuid primary key,
  user_id uuid not null,
  archived_at timestamptz
);

\ir ../../supabase/bank_reconciliation_idempotent_claim_release.sql

insert into auth.users(id) values
  ('20000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000004');

insert into public.bank_statement_lines(id, user_id, review_status, review_claim_token, reviewed_by) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'processing', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'processing', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'processing', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'processing', '40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'processing', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'processing', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'processing', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', 'processing', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000002', 'processing', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004'),
  ('30000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', 'processing', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');

insert into public.bank_reconciliations(statement_line_id, user_id)
values ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001');
insert into public.financial_entries(user_id, source_id)
values ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000006');
insert into public.extra_revenues(id, user_id)
values ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001');
insert into public.expenses(id, user_id)
values ('30000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001');

set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';

-- A primeira chamada libera; repetir devolve a mesma quantidade sem nova mudanca.
select public.release_bank_statement_line_claims(
  array['30000000-0000-4000-8000-000000000001'::uuid],
  '40000000-0000-4000-8000-000000000001'
);
select public.release_bank_statement_line_claims(
  array['30000000-0000-4000-8000-000000000001'::uuid],
  '40000000-0000-4000-8000-000000000001'
);

-- Token incorreto e lote misto retornam sucesso sem tocar a reserva alheia.
select public.release_bank_statement_line_claims(
  array['30000000-0000-4000-8000-000000000002'::uuid],
  '40000000-0000-4000-8000-000000000002'
);
select public.release_bank_statement_line_claims(
  array[
    '30000000-0000-4000-8000-000000000003'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid
  ],
  '40000000-0000-4000-8000-000000000001'
);

-- Linhas protegidas por origens financeiras permanecem reservadas.
select public.release_bank_statement_line_claims(
  array[
    '30000000-0000-4000-8000-000000000005'::uuid,
    '30000000-0000-4000-8000-000000000006'::uuid,
    '30000000-0000-4000-8000-000000000007'::uuid,
    '30000000-0000-4000-8000-000000000008'::uuid
  ],
  '40000000-0000-4000-8000-000000000001'
);

-- Linha de outro tenant nao e alterada.
select public.release_bank_statement_line_claims(
  array['30000000-0000-4000-8000-000000000009'::uuid],
  '40000000-0000-4000-8000-000000000001'
);
reset role;

do $$
begin
  if not exists (
    select 1 from public.bank_statement_lines
    where id = '30000000-0000-4000-8000-000000000001'
      and review_status = 'pending' and review_claim_token is null
  ) then raise exception 'A primeira liberacao ou sua repeticao falhou.'; end if;

  if not exists (
    select 1 from public.bank_statement_lines
    where id = '30000000-0000-4000-8000-000000000002'
      and review_status = 'processing'
      and review_claim_token = '40000000-0000-4000-8000-000000000001'
  ) then raise exception 'Token incorreto alterou uma reserva valida.'; end if;

  if not exists (
    select 1 from public.bank_statement_lines
    where id = '30000000-0000-4000-8000-000000000003'
      and review_status = 'pending' and review_claim_token is null
  ) or not exists (
    select 1 from public.bank_statement_lines
    where id = '30000000-0000-4000-8000-000000000004'
      and review_status = 'processing'
      and review_claim_token = '40000000-0000-4000-8000-000000000002'
  ) then raise exception 'O lote misto nao preservou a reserva de outro token.'; end if;

  if (select count(*) from public.bank_statement_lines
      where id = any(array[
        '30000000-0000-4000-8000-000000000005'::uuid,
        '30000000-0000-4000-8000-000000000006'::uuid,
        '30000000-0000-4000-8000-000000000007'::uuid,
        '30000000-0000-4000-8000-000000000008'::uuid
      ]) and review_status = 'processing') <> 4 then
    raise exception 'Uma linha com origem financeira foi liberada.';
  end if;

  if not exists (
    select 1 from public.bank_statement_lines
    where id = '30000000-0000-4000-8000-000000000009'
      and review_status = 'processing'
  ) then raise exception 'Uma linha de outro tenant foi alterada.'; end if;
end $$;

-- Perfil sem permissao continua recusado.
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000003';
do $$
begin
  begin
    perform public.release_bank_statement_line_claims(
      array['30000000-0000-4000-8000-000000000002'::uuid],
      '40000000-0000-4000-8000-000000000001'
    );
    raise exception 'Perfil sem permissao liberou uma reserva.';
  exception when sqlstate '42501' then
    null;
  end;
end $$;
reset role;

-- Duas sessoes liberando o mesmo token terminam sem 40001.
create or replace function public.delay_concurrent_claim_release()
returns trigger language plpgsql
as $$
begin
  if old.id = '30000000-0000-4000-8000-000000000010'::uuid then
    perform pg_sleep(0.2);
  end if;
  return new;
end
$$;
create trigger trg_delay_concurrent_claim_release
before update on public.bank_statement_lines
for each row execute function public.delay_concurrent_claim_release();

select dblink_connect('release_one', 'dbname=' || current_database());
select dblink_connect('release_two', 'dbname=' || current_database());
select dblink_exec('release_one', 'set role authenticated');
select dblink_exec('release_two', 'set role authenticated');
select dblink_exec('release_one', $$set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001'$$);
select dblink_exec('release_two', $$set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001'$$);
select dblink_send_query('release_one', $$
  select public.release_bank_statement_line_claims(
    array['30000000-0000-4000-8000-000000000010'::uuid],
    '40000000-0000-4000-8000-000000000001'
  )
$$);
select dblink_send_query('release_two', $$
  select public.release_bank_statement_line_claims(
    array['30000000-0000-4000-8000-000000000010'::uuid],
    '40000000-0000-4000-8000-000000000001'
  )
$$);
select * from dblink_get_result('release_one') as result(released integer);
select * from dblink_get_result('release_two') as result(released integer);
select dblink_disconnect('release_one');
select dblink_disconnect('release_two');

do $$
begin
  if not exists (
    select 1 from public.bank_statement_lines
    where id = '30000000-0000-4000-8000-000000000010'
      and review_status = 'pending' and review_claim_token is null
  ) then raise exception 'A liberacao concorrente nao terminou corretamente.'; end if;
end $$;

select 'bankClaimRelease.spec.sql: ok' as result;
