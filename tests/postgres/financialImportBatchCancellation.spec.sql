-- Executar somente em banco local descartavel e vazio:
--   createdb surgimetrics_import_cancel_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_import_cancel_test \
--     -f tests/postgres/financialImportBatchCancellation.spec.sql
--
-- PRE-REQUISITO DE PRODUCAO: cancel_financial_import_batch referencia
-- public.bank_reconciliations e public.billing_charges estaticamente. As duas devem existir no
-- banco (bank_reconciliation_schema.sql e billing_charges_schema.sql). O vinculo fiscal e
-- dinamico de proposito: fiscal_documents_schema.sql pode nao estar aplicado.

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

-- ator 1 = gestao da clinica 1; ator 2 = gestao da clinica 2; ator 3 = equipe da clinica 1.
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
  expected_line_count integer not null,
  line_count integer not null,
  status text not null constraint financial_import_batches_status_check
    check (status in ('creating', 'reviewing', 'ready', 'archived')),
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  archived_at timestamptz
);
create unique index uq_financial_import_active_file
  on public.financial_import_batches(user_id, file_hash, coalesce(sheet_name, ''))
  where archived_at is null and status <> 'archived';

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
  id uuid primary key, user_id uuid not null,
  node_type text not null default 'account',
  nature text not null default 'unclassified',
  is_active boolean not null default true
);

create table public.extra_revenues(
  id uuid primary key, user_id uuid not null, description text not null, category text not null,
  value numeric(14,2) not null, date date not null, received_date date, status text,
  competence_date date, due_date date, cost_center text, origin_label text,
  chart_account_id uuid, archived_at timestamptz
);

create table public.expenses(
  id uuid primary key, user_id uuid not null, description text not null, category text not null,
  value numeric(14,2) not null, due_date date not null, payment_date date, status text,
  competence_date date, cost_center text, origin_label text,
  chart_account_id uuid, archived_at timestamptz
);

create table public.audit_logs(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, actor_id uuid not null,
  action text not null, entity_type text not null, entity_id uuid,
  details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table public.financial_entries(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, direction text not null,
  source_type text not null, source_id uuid not null, source_component text not null,
  description text, party_type text, party_id uuid, party_name_snapshot text, category text,
  cost_center text, origin_label text, chart_account_id uuid, competence_date date,
  issue_date date, total_amount numeric(14,2) not null, status text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  archived_at timestamptz, unique(user_id, source_type, source_id, source_component)
);

create table public.financial_installments(
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  financial_entry_id uuid not null references public.financial_entries(id),
  installment_number integer not null, amount numeric(14,2) not null,
  paid_amount numeric(14,2) not null, due_date date, settlement_date date, payment_method text,
  fees_amount numeric(14,2) not null default 0, interest_amount numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0, status text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  archived_at timestamptz, unique(financial_entry_id, installment_number)
);

create table public.bank_reconciliations(
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  financial_installment_id uuid not null references public.financial_installments(id),
  reversed_at timestamptz
);

create table public.billing_charges(
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  financial_entry_id uuid not null references public.financial_entries(id),
  financial_installment_id uuid not null references public.financial_installments(id),
  status text not null
);

grant select, insert, update on all tables in schema public to authenticated;

insert into public.chart_accounts(id, user_id, nature) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'revenue'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'operating_expense');

-- Lote A: cancelamento feliz. B: bloqueado por conciliacao. C: bloqueado por cobranca.
-- D: bloqueado por documento fiscal. E: sem linha aprovada. F: outra clinica.
insert into public.financial_import_batches(id, user_id, imported_by, file_name, file_hash, expected_line_count, line_count, status) values
  ('30000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'cancelar.xlsx', repeat('a',64), 2, 2, 'reviewing'),
  ('30000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'conciliado.xlsx', repeat('b',64), 1, 1, 'reviewing'),
  ('30000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'cobranca.xlsx', repeat('c',64), 1, 1, 'reviewing'),
  ('30000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'fiscal.xlsx', repeat('d',64), 1, 1, 'reviewing'),
  ('30000000-0000-4000-8000-00000000000e', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'vazio.xlsx', repeat('e',64), 1, 1, 'reviewing'),
  ('30000000-0000-4000-8000-00000000000f', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'outra.xlsx', repeat('f',64), 1, 1, 'reviewing');

insert into public.financial_import_lines(id, user_id, batch_id, source_line_key, line_index, posted_date, amount, description, normalized_description, movement_fingerprint) values
  ('40000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-00000000000a', 'a-1', 2, '2026-09-01', 1500, 'Receita do lote', 'receita do lote', 'fp-a1'),
  ('40000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-00000000000a', 'a-2', 3, '2026-09-02', -300, 'Despesa do lote', 'despesa do lote', 'fp-a2'),
  ('40000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-00000000000b', 'b-1', 2, '2026-09-03', 700, 'Receita conciliada', 'receita conciliada', 'fp-b1'),
  ('40000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-00000000000c', 'c-1', 2, '2026-09-04', 800, 'Receita cobrada', 'receita cobrada', 'fp-c1'),
  ('40000000-0000-4000-8000-00000000000e', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-00000000000d', 'd-1', 2, '2026-09-05', 900, 'Receita com nota', 'receita com nota', 'fp-d1'),
  ('40000000-0000-4000-8000-00000000000f', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-00000000000e', 'e-1', 2, '2026-09-06', 400, 'Receita sem aprovar', 'receita sem aprovar', 'fp-e1'),
  ('40000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-00000000000f', 'f-1', 2, '2026-09-07', 500, 'Receita outra clinica', 'receita outra clinica', 'fp-f1');

\ir ../../supabase/financial_import_atomic_approval.sql
\ir ../../supabase/financial_import_batch_cancellation.sql

-- ---------------------------------------------------------------------------
-- Aprova de verdade, pela RPC real, tudo o que sera cancelado depois.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';

do $$
declare
  rec record;
begin
  for rec in
    select batch_id, id, source_id, case when amount > 0 then 'extraRevenues' else 'expenses' end as collection
    from public.financial_import_lines
    where user_id = '10000000-0000-4000-8000-000000000001'
      and batch_id <> '30000000-0000-4000-8000-00000000000e'
    order by batch_id, line_index
  loop
    perform public.approve_financial_import_lines(
      rec.batch_id,
      jsonb_build_array(jsonb_build_object(
        'line_id', rec.id, 'source_id', rec.source_id,
        'collection', rec.collection, 'record', '{}'::jsonb
      ))
    );
  end loop;
end $$;

reset role;

do $$
begin
  if (select count(*) from public.extra_revenues where archived_at is null) <> 4
     or (select count(*) from public.expenses where archived_at is null) <> 1 then
    raise exception 'Fixture nao aprovou as origens esperadas.';
  end if;
end $$;

-- Vinculos vivos que devem BLOQUEAR o cancelamento.
insert into public.bank_reconciliations(user_id, financial_installment_id)
select '10000000-0000-4000-8000-000000000001', installment.id
from public.financial_installments installment
join public.financial_entries entry on entry.id = installment.financial_entry_id
join public.financial_import_lines line on line.source_id = entry.source_id
where line.batch_id = '30000000-0000-4000-8000-00000000000b';

insert into public.billing_charges(user_id, financial_entry_id, financial_installment_id, status)
select '10000000-0000-4000-8000-000000000001', entry.id, installment.id, 'pending'
from public.financial_installments installment
join public.financial_entries entry on entry.id = installment.financial_entry_id
join public.financial_import_lines line on line.source_id = entry.source_id
where line.batch_id = '30000000-0000-4000-8000-00000000000c';

-- ---------------------------------------------------------------------------
-- 1. Sem o schema fiscal aplicado, o bloqueio fiscal vale 0 e nada quebra.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
do $$
begin
  if public.financial_import_fiscal_block_count('30000000-0000-4000-8000-00000000000d') <> 0 then
    raise exception 'Banco sem schema fiscal deveria contar 0 vinculos.';
  end if;
  if (select count(*) from public.list_financial_import_history(100)) <> 5 then
    raise exception 'O historico nao listou os lotes da clinica (ou vazou de outra).';
  end if;
end $$;
reset role;

-- Agora o schema fiscal existe e o lote D passa a ter nota vinculada.
create table public.fiscal_documents(
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  status text not null default 'issued', archived_at timestamptz
);
create table public.fiscal_document_allocations(
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  fiscal_document_id uuid not null references public.fiscal_documents(id),
  financial_entry_id uuid not null references public.financial_entries(id),
  allocated_amount numeric(12,2) not null
);
grant select, insert, update on public.fiscal_documents, public.fiscal_document_allocations to authenticated;

insert into public.fiscal_documents(id, user_id) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
insert into public.fiscal_document_allocations(user_id, fiscal_document_id, financial_entry_id, allocated_amount)
select '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', entry.id, 900
from public.financial_entries entry
join public.financial_import_lines line on line.source_id = entry.source_id
where line.batch_id = '30000000-0000-4000-8000-00000000000d';

-- ---------------------------------------------------------------------------
-- 2. Cada vinculo vivo bloqueia, e NADA e arquivado na tentativa recusada.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';

do $$
declare
  blocked uuid[] := array[
    '30000000-0000-4000-8000-00000000000b',
    '30000000-0000-4000-8000-00000000000c',
    '30000000-0000-4000-8000-00000000000d'
  ];
  target uuid;
begin
  foreach target in array blocked loop
    begin
      perform public.cancel_financial_import_batch(target, 'tentativa bloqueada');
      raise exception 'Lote com vinculo vivo (%) foi cancelado.', target;
    exception when sqlstate '55000' then null;
    end;
  end loop;
end $$;

do $$
begin
  if (select count(*) from public.extra_revenues where archived_at is not null) <> 0
     or (select count(*) from public.financial_entries where archived_at is not null) <> 0
     or (select count(*) from public.financial_installments where archived_at is not null) <> 0 then
    raise exception 'Uma tentativa bloqueada arquivou registro financeiro.';
  end if;
  if exists (select 1 from public.financial_import_batches where status = 'canceled') then
    raise exception 'Uma tentativa bloqueada marcou o lote como cancelado.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Motivo, escopo, papel, status e lote sem aprovacao sao recusados.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform public.cancel_financial_import_batch('30000000-0000-4000-8000-00000000000a', 'xx');
    raise exception 'Motivo curto foi aceito.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.cancel_financial_import_batch('30000000-0000-4000-8000-00000000000a', repeat('x', 501));
    raise exception 'Motivo longo foi aceito.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.cancel_financial_import_batch('30000000-0000-4000-8000-00000000000e', 'lote sem aprovacao');
    raise exception 'Lote sem linha aprovada foi cancelado.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.cancel_financial_import_batch('30000000-0000-4000-8000-00000000000f', 'lote de outra clinica');
    raise exception 'Lote de outra clinica foi cancelado.';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- Equipe (sem papel financeiro) nao cancela nem le o historico.
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000003';
do $$
begin
  begin
    perform public.cancel_financial_import_batch('30000000-0000-4000-8000-00000000000a', 'equipe tentando');
    raise exception 'Perfil sem papel financeiro cancelou a importacao.';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform count(*) from public.list_financial_import_history(10);
    raise exception 'Perfil sem papel financeiro leu o historico.';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Cancelamento feliz: o lote inteiro sai do financeiro, sem apagar nada.
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
do $$
declare
  summary jsonb;
  revenues_before integer;
  expenses_before integer;
begin
  select count(*) into revenues_before from public.extra_revenues;
  select count(*) into expenses_before from public.expenses;

  summary := public.cancel_financial_import_batch(
    '30000000-0000-4000-8000-00000000000a', 'planilha da clinica errada');

  if (summary->>'approved_count')::integer <> 2 then
    raise exception 'O resumo nao contou as duas linhas aprovadas: %', summary;
  end if;
  if jsonb_array_length(summary->'source_ids') <> 2 then
    raise exception 'O resumo nao devolveu as origens retiradas: %', summary;
  end if;

  -- Nenhuma linha desapareceu: o cancelamento e arquivamento, nao DELETE.
  if (select count(*) from public.extra_revenues) <> revenues_before
     or (select count(*) from public.expenses) <> expenses_before then
    raise exception 'O cancelamento apagou registro fisicamente.';
  end if;

  -- Origem, titulo e parcela das DUAS linhas sairam do financeiro.
  if (select count(*) from public.extra_revenues where archived_at is null) <> 3 then
    raise exception 'A receita do lote cancelado continua ativa.';
  end if;
  if (select count(*) from public.expenses where archived_at is null) <> 0 then
    raise exception 'A despesa do lote cancelado continua ativa.';
  end if;
  if (select count(*) from public.financial_entries where archived_at is not null) <> 2
     or (select count(*) from public.financial_installments where archived_at is not null) <> 2 then
    raise exception 'Titulo e parcela do lote cancelado nao foram arquivados juntos.';
  end if;

  -- Os lotes bloqueados continuam intocados.
  if (select count(*) from public.financial_entries where archived_at is null) <> 3 then
    raise exception 'O cancelamento alcancou titulo de outro lote.';
  end if;

  if not exists (
    select 1 from public.financial_import_batches
    where id = '30000000-0000-4000-8000-00000000000a'
      and status = 'canceled' and canceled_at is not null
      and canceled_by = '20000000-0000-4000-8000-000000000001'
      and cancellation_reason = 'planilha da clinica errada'
  ) then raise exception 'O lote nao registrou o cancelamento.'; end if;

  if not exists (
    select 1 from public.audit_logs
    where action = 'cancel_financial_import_batch'
      and entity_id = '30000000-0000-4000-8000-00000000000a'
      and details->>'reason' = 'planilha da clinica errada'
  ) then raise exception 'O cancelamento nao foi auditado.'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Repetir o cancelamento e idempotente e nao rearquiva nada.
-- ---------------------------------------------------------------------------
do $$
declare
  first_canceled_at timestamptz;
  summary jsonb;
begin
  select canceled_at into first_canceled_at from public.financial_import_batches
  where id = '30000000-0000-4000-8000-00000000000a';

  summary := public.cancel_financial_import_batch(
    '30000000-0000-4000-8000-00000000000a', 'tentando de novo');

  if coalesce((summary->>'already_canceled')::boolean, false) is not true then
    raise exception 'O segundo cancelamento nao se identificou como repeticao: %', summary;
  end if;
  if (select canceled_at from public.financial_import_batches where id = '30000000-0000-4000-8000-00000000000a')
     <> first_canceled_at then
    raise exception 'A repeticao reescreveu a data do cancelamento original.';
  end if;
  if (select cancellation_reason from public.financial_import_batches where id = '30000000-0000-4000-8000-00000000000a')
     <> 'planilha da clinica errada' then
    raise exception 'A repeticao reescreveu o motivo original.';
  end if;
  if (select count(*) from public.audit_logs where action = 'cancel_financial_import_batch') <> 1 then
    raise exception 'A repeticao gravou auditoria duplicada.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. O historico reflete o cancelamento e os bloqueios com numeros reais.
-- ---------------------------------------------------------------------------
do $$
declare
  row_a record;
  row_d record;
begin
  select * into row_a from public.list_financial_import_history(100)
  where id = '30000000-0000-4000-8000-00000000000a';
  if row_a.status <> 'canceled' or row_a.approved_count <> 2
     or row_a.imported_receipts <> 1500 or row_a.imported_expenses <> 300 then
    raise exception 'O historico do lote cancelado veio errado: %', row_a;
  end if;

  select * into row_d from public.list_financial_import_history(100)
  where id = '30000000-0000-4000-8000-00000000000d';
  if row_d.active_fiscal_document_count <> 1 then
    raise exception 'O historico nao expos o vinculo fiscal: %', row_d;
  end if;

  if (select active_reconciliation_count from public.list_financial_import_history(100)
      where id = '30000000-0000-4000-8000-00000000000b') <> 1 then
    raise exception 'O historico nao expos a conciliacao viva.';
  end if;
  if (select active_charge_count from public.list_financial_import_history(100)
      where id = '30000000-0000-4000-8000-00000000000c') <> 1 then
    raise exception 'O historico nao expos a cobranca viva.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Cancelar libera o arquivo: a mesma planilha pode ser importada de novo.
-- ---------------------------------------------------------------------------
reset role;
insert into public.financial_import_batches(id, user_id, imported_by, file_name, file_hash, expected_line_count, line_count, status)
values ('30000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'cancelar.xlsx', repeat('a',64), 2, 2, 'reviewing');

do $$
begin
  -- E o indice unico continua impedindo DOIS lotes ativos do mesmo arquivo.
  begin
    insert into public.financial_import_batches(id, user_id, imported_by, file_name, file_hash, expected_line_count, line_count, status)
    values ('30000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'cancelar.xlsx', repeat('a',64), 2, 2, 'reviewing');
    raise exception 'Dois lotes ativos do mesmo arquivo foram aceitos.';
  exception when unique_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Persistencia incompleta aborta antes de arquivar qualquer coisa.
-- ---------------------------------------------------------------------------
update public.extra_revenues set archived_at = null where archived_at is not null;
update public.financial_entries set archived_at = null where archived_at is not null;
update public.financial_installments set archived_at = null where archived_at is not null;
update public.financial_import_batches set status = 'ready', canceled_at = null, canceled_by = null,
  cancellation_reason = null, cancellation_summary = '{}'::jsonb
where id = '30000000-0000-4000-8000-00000000000b';
-- Some a parcela do titulo: o lote fica com persistencia financeira incompleta.
delete from public.bank_reconciliations;
delete from public.financial_installments installment
where exists (
  select 1 from public.financial_entries entry
  join public.financial_import_lines line on line.source_id = entry.source_id
  where entry.id = installment.financial_entry_id
    and line.batch_id = '30000000-0000-4000-8000-00000000000b'
);

set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
do $$
begin
  begin
    perform public.cancel_financial_import_batch('30000000-0000-4000-8000-00000000000b', 'persistencia incompleta');
    raise exception 'Lote com persistencia incompleta foi cancelado.';
  exception when sqlstate '40001' then null;
  end;
  if exists (
    select 1 from public.extra_revenues source
    join public.financial_import_lines line on line.source_id = source.id
    where line.batch_id = '30000000-0000-4000-8000-00000000000b' and source.archived_at is not null
  ) then raise exception 'A recusa por persistencia incompleta ainda arquivou a origem.'; end if;
end $$;
reset role;

select 'financialImportBatchCancellation: OK' as resultado;
