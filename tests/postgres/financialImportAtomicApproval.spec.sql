-- Executar somente em banco local descartavel e vazio:
--   createdb surgimetrics_financial_import_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_financial_import_test \
--     -f tests/postgres/financialImportAtomicApproval.spec.sql

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

create or replace function public.data_owner_id()
returns uuid language sql stable
as $$
  select case auth.uid()
    when '20000000-0000-4000-8000-000000000001'::uuid then '10000000-0000-4000-8000-000000000001'::uuid
    when '20000000-0000-4000-8000-000000000002'::uuid then '10000000-0000-4000-8000-000000000002'::uuid
    when '20000000-0000-4000-8000-000000000003'::uuid then '10000000-0000-4000-8000-000000000001'::uuid
    else null
  end
$$;

create or replace function public.finance_role_can_manage()
returns boolean language sql stable
as $$
  select auth.uid() in (
    '20000000-0000-4000-8000-000000000001'::uuid,
    '20000000-0000-4000-8000-000000000002'::uuid
  )
$$;

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000003');

create table public.financial_import_batches (
  id uuid primary key,
  user_id uuid not null,
  imported_by uuid not null,
  file_name text not null,
  file_hash text not null,
  sheet_name text,
  column_mapping jsonb not null default '{}'::jsonb,
  expected_line_count integer not null,
  line_count integer not null,
  status text not null,
  period_start date,
  period_end date,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  archived_at timestamptz
);

create table public.financial_import_lines (
  id uuid not null,
  user_id uuid not null,
  batch_id uuid not null references public.financial_import_batches(id),
  source_line_key text not null,
  line_index integer not null,
  posted_date date not null,
  amount numeric(14,2) not null,
  description text not null default '',
  normalized_description text not null default '',
  movement_fingerprint text not null,
  source_metadata jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending',
  chart_account_id uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  primary key(batch_id, id)
);

create table public.chart_accounts(
  id uuid primary key,
  user_id uuid not null,
  is_active boolean not null default true
);

create table public.extra_revenues(
  id uuid primary key,
  user_id uuid not null,
  description text not null,
  category text not null,
  value numeric(14,2) not null,
  date date not null,
  received_date date,
  status text,
  competence_date date,
  due_date date,
  cost_center text,
  origin_label text,
  chart_account_id uuid,
  archived_at timestamptz
);

create table public.expenses(
  id uuid primary key,
  user_id uuid not null,
  description text not null,
  category text not null,
  value numeric(14,2) not null,
  due_date date not null,
  payment_date date,
  status text,
  competence_date date,
  cost_center text,
  origin_label text,
  chart_account_id uuid,
  archived_at timestamptz
);

create table public.audit_logs(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  actor_id uuid not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.financial_entries(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  direction text not null,
  source_type text not null,
  source_id uuid not null,
  source_component text not null,
  description text,
  party_type text,
  party_id uuid,
  party_name_snapshot text,
  category text,
  cost_center text,
  origin_label text,
  chart_account_id uuid,
  competence_date date,
  issue_date date,
  total_amount numeric(14,2) not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique(user_id, source_type, source_id, source_component)
);

create table public.financial_installments(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  financial_entry_id uuid not null references public.financial_entries(id),
  installment_number integer not null,
  amount numeric(14,2) not null,
  paid_amount numeric(14,2) not null,
  due_date date,
  settlement_date date,
  payment_method text,
  fees_amount numeric(14,2) not null default 0,
  interest_amount numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique(financial_entry_id, installment_number)
);

grant select, insert, update on all tables in schema public to authenticated;

insert into public.financial_import_batches(id, user_id, imported_by, file_name, file_hash, expected_line_count, line_count, status) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'mesmo.xlsx', repeat('a',64), 2, 2, 'reviewing'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'mesmo.xlsx', repeat('a',64), 1, 1, 'reviewing'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'rollback.xlsx', repeat('b',64), 2, 2, 'reviewing');

-- O mesmo id deterministico existia legitimamente em duas clinicas antes da correcao.
insert into public.financial_import_lines(id, user_id, batch_id, source_line_key, line_index, posted_date, amount, description, normalized_description, movement_fingerprint, review_status) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'linha-1', 2, '2026-09-01', 100, 'Receita antiga', 'receita antiga', 'fp-1', 'approved'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'linha-2', 3, '2026-09-02', -50, 'Despesa nova', 'despesa nova', 'fp-2', 'pending'),
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'linha-1', 2, '2026-09-01', 100, 'Receita outra clinica', 'receita outra clinica', 'fp-1', 'pending'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'linha-3', 2, '2026-10-01', 80, 'Primeira do rollback', 'primeira rollback', 'fp-3', 'pending'),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'linha-4', 3, '2026-10-02', 90, 'Segunda do rollback', 'segunda rollback', 'fp-4', 'pending');

insert into public.extra_revenues(id, user_id, description, category, value, date, origin_label)
values ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Receita antiga', 'outras_receitas', 100, '2026-09-01', 'Importacao mesmo.xlsx · linha 2');

\ir ../../supabase/financial_import_atomic_approval.sql

do $$
declare
  source_owner_one uuid;
  source_owner_two uuid;
begin
  select source_id into source_owner_one from public.financial_import_lines
  where batch_id = '30000000-0000-4000-8000-000000000001' and id = '40000000-0000-4000-8000-000000000001';
  select source_id into source_owner_two from public.financial_import_lines
  where batch_id = '30000000-0000-4000-8000-000000000002' and id = '40000000-0000-4000-8000-000000000001';
  if source_owner_one <> '40000000-0000-4000-8000-000000000001' then
    raise exception 'Origem historica aprovada trocou de id.';
  end if;
  if source_owner_two = source_owner_one then
    raise exception 'Clinicas diferentes continuaram compartilhando source_id.';
  end if;
end $$;

set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';

-- Aprova a despesa e confirma origem + progresso na mesma chamada.
select * from public.approve_financial_import_lines(
  '30000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'line_id', '40000000-0000-4000-8000-000000000002',
    'source_id', (select source_id from public.financial_import_lines where batch_id = '30000000-0000-4000-8000-000000000001' and id = '40000000-0000-4000-8000-000000000002'),
    'collection', 'expenses',
    'record', jsonb_build_object('category','Administrativo','costCenter','Clinica')
  ))
);

-- Repetir e idempotente: nao cria segunda origem e continua confirmado.
select * from public.approve_financial_import_lines(
  '30000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'line_id', '40000000-0000-4000-8000-000000000002',
    'source_id', (select source_id from public.financial_import_lines where batch_id = '30000000-0000-4000-8000-000000000001' and id = '40000000-0000-4000-8000-000000000002'),
    'collection', 'expenses',
    'record', jsonb_build_object('category','Administrativo')
  ))
);

-- Arquivamento implicito da origem importada e recusado pelo banco.
do $$
begin
  begin
    update public.expenses set archived_at = now()
    where id = (select source_id from public.financial_import_lines where batch_id = '30000000-0000-4000-8000-000000000001' and id = '40000000-0000-4000-8000-000000000002');
    raise exception 'Origem importada foi arquivada sem acao explicita.';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.financial_entries set archived_at = now()
    where source_id = (select source_id from public.financial_import_lines where batch_id = '30000000-0000-4000-8000-000000000001' and id = '40000000-0000-4000-8000-000000000002');
    raise exception 'Titulo importado foi arquivado sem acao explicita.';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- Um bloco invalido no segundo item reverte tambem o primeiro item.
do $$
declare
  source_first uuid;
begin
  select source_id into source_first from public.financial_import_lines
  where batch_id = '30000000-0000-4000-8000-000000000003' and id = '40000000-0000-4000-8000-000000000003';
  begin
    perform public.approve_financial_import_lines(
      '30000000-0000-4000-8000-000000000003',
      jsonb_build_array(
        jsonb_build_object('line_id','40000000-0000-4000-8000-000000000003','source_id',source_first,'collection','extraRevenues','record','{}'::jsonb),
        jsonb_build_object('line_id','40000000-0000-4000-8000-000000000004','source_id','ffffffff-ffff-4fff-8fff-ffffffffffff','collection','extraRevenues','record','{}'::jsonb)
      )
    );
    raise exception 'Bloco invalido foi aceito.';
  exception when sqlstate '22023' then null;
  end;
  if exists (select 1 from public.extra_revenues where id = source_first) then
    raise exception 'Primeiro item do bloco invalido nao sofreu rollback.';
  end if;
  if exists (select 1 from public.financial_import_lines where batch_id = '30000000-0000-4000-8000-000000000003' and review_status = 'approved') then
    raise exception 'Progresso parcial sobreviveu ao rollback.';
  end if;
end $$;

reset role;

do $$
begin
  if (select count(*) from public.expenses) <> 1 then
    raise exception 'A aprovacao idempotente criou quantidade errada de despesas.';
  end if;
  if (select count(*) from public.financial_entries where source_type = 'expense') <> 1
     or (select count(*) from public.financial_installments) <> 1 then
    raise exception 'Razao e parcela nao foram persistidos atomicamente.';
  end if;
  if not exists (
    select 1 from public.financial_import_lines
    where batch_id = '30000000-0000-4000-8000-000000000001'
      and id = '40000000-0000-4000-8000-000000000002'
      and review_status = 'approved'
      and reviewed_by = '20000000-0000-4000-8000-000000000001'
  ) then raise exception 'Progresso da linha nao foi confirmado.'; end if;
  if (select count(*) from public.audit_logs where action = 'approve_financial_import_lines') <> 2 then
    raise exception 'Auditoria das aprovacoes nao foi registrada.';
  end if;
end $$;

-- Outro tenant e perfil sem gestao nao conseguem aprovar o lote.
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
do $$
begin
  begin
    perform public.approve_financial_import_lines(
      '30000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'line_id','40000000-0000-4000-8000-000000000002',
        'source_id',(select source_id from public.financial_import_lines where batch_id = '30000000-0000-4000-8000-000000000001' and id = '40000000-0000-4000-8000-000000000002'),
        'collection','expenses',
        'record','{}'::jsonb
      ))
    );
    raise exception 'Outro tenant acessou o lote.';
  exception when sqlstate '42501' then null; end;
end $$;

-- A mesma linha do mesmo arquivo entra normalmente na segunda clinica, com outra origem.
select * from public.approve_financial_import_lines(
  '30000000-0000-4000-8000-000000000002',
  jsonb_build_array(jsonb_build_object(
    'line_id','40000000-0000-4000-8000-000000000001',
    'source_id',(select source_id from public.financial_import_lines where batch_id = '30000000-0000-4000-8000-000000000002' and id = '40000000-0000-4000-8000-000000000001'),
    'collection','extraRevenues',
    'record',jsonb_build_object('category','Consultas')
  ))
);

do $$
begin
  if not exists (
    select 1 from public.extra_revenues revenue
    join public.financial_import_lines line on line.source_id = revenue.id
    where line.batch_id = '30000000-0000-4000-8000-000000000002'
      and revenue.user_id = '10000000-0000-4000-8000-000000000002'
  ) then raise exception 'Segunda clinica nao conseguiu importar o mesmo arquivo.'; end if;
end $$;

set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000003';
do $$
begin
  begin
    perform public.approve_financial_import_lines('30000000-0000-4000-8000-000000000001', '[{}]'::jsonb);
    raise exception 'Perfil sem gestao aprovou o lote.';
  exception when sqlstate '42501' then null; end;
end $$;
reset role;

select 'financialImportAtomicApproval.spec.sql: ok' as result;
