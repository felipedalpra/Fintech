-- Executar somente em banco local descartável e vazio:
--   createdb surgimetrics_receivable_reversal_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_receivable_reversal_test \
--     -f tests/postgres/receivablePaymentReversal.spec.sql
\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create extension if not exists pgcrypto;
create schema auth;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.data_owner_id() returns uuid language sql stable as $$ select auth.uid() $$;
create function public.finance_role_can_manage() returns boolean language sql stable as $$ select auth.uid() is not null $$;

create table public.surgeries(
  id uuid primary key, user_id uuid not null, payment_method text,
  receipt_settlements jsonb default '{}'::jsonb, payment_status text, payment_date date
);
create table public.consultations(
  id uuid primary key, user_id uuid not null, payment_method text,
  receipt_settlements jsonb default '{}'::jsonb, payment_status text, payment_date date
);
create table public.product_sales(
  id uuid primary key, user_id uuid not null, payment_method text,
  receipt_settlements jsonb default '{}'::jsonb, status text, received_date date
);
create table public.financial_entries(
  id uuid primary key, user_id uuid not null, direction text, source_type text,
  source_id uuid, source_component text, archived_at timestamptz, status text,
  updated_at timestamptz
);
create table public.financial_installments(
  id uuid primary key, user_id uuid not null,
  financial_entry_id uuid references public.financial_entries(id),
  installment_number integer, amount numeric, paid_amount numeric,
  settlement_date date, status text, archived_at timestamptz, updated_at timestamptz
);
create table public.billing_charges(id uuid);

-- Simula a versão instalada antes do upgrade.
create function public.apply_billing_webhook_event(
  p_provider text, p_environment text, p_user_id uuid, p_provider_event_id text,
  p_event_type text, p_provider_charge_id text, p_payload_hash text, p_status text,
  p_paid_at timestamptz default null, p_gross_amount numeric default null,
  p_net_amount numeric default null, p_payment_method text default null
) returns public.billing_charges language plpgsql security definer set search_path=public as $$
declare
  installment_now public.financial_installments;
  settlement_key text;
  latest_receipt_date date;
  settlements_after jsonb := '{}'::jsonb;
  legacy_settlements jsonb;
begin
  settlement_key := installment_now.installment_number::text;
  select coalesce(jsonb_object_agg(
      installment_number::text,
      jsonb_build_object('receivedDate', settlement_date)
    ), '{}'::jsonb) into legacy_settlements
  from public.financial_installments;
  select max((value ->> 'receivedDate')::date) into latest_receipt_date from jsonb_each(settlements_after);
  return null;
end $$;

insert into public.surgeries(id,user_id,payment_method,payment_status) values (
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000001',
  'pagamentos:%5B%7B%22date%22%3A%222026-12-03%22%2C%22amount%22%3A200%2C%22method%22%3A%22cartao%22%7D%2C%7B%22date%22%3A%222026-11-03%22%2C%22amount%22%3A100%2C%22method%22%3A%22pix%22%7D%5D',
  'pendente'
);
insert into public.financial_entries values (
  '20000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000001',
  'receivable','surgery','10000000-0000-4000-8000-000000000010','revenue',null,'pending',now()
);
insert into public.financial_installments values
  ('30000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000010',1,100,0,null,'pending',null,now()),
  ('30000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000010',2,200,0,null,'pending',null,now());

\ir ../../supabase/receivable_payment_reversal.sql

update public.surgeries
set payment_status = 'pago', payment_date = '2026-11-04',
    receipt_settlements = '{"2":{"receivedDate":"2026-11-04","amount":100,"method":"pix","status":"received"}}'
where id = '10000000-0000-4000-8000-000000000010';
update public.financial_installments
set status = 'paid', paid_amount = 100, settlement_date = '2026-11-04'
where id = '30000000-0000-4000-8000-000000000011';

set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
do $$
begin
  perform public.reverse_receivable_installment(
    'surgery', '10000000-0000-4000-8000-000000000010', 1, 1,
    '{"2":{"receivedDate":"2026-11-04","amount":100,"method":"pix","status":"received"}}',
    'pago', '2026-11-04',
    '{"1":{"receivedDate":"2026-11-04","amount":100,"method":"pix","status":"reversed","reversedAt":"2026-11-05T10:00:00Z"},"2":{"receivedDate":"2026-11-04","amount":100,"method":"pix","status":"received"}}'
  );
  raise exception 'RPC aceitou source e ledger de parcelas diferentes.';
exception when sqlstate '40001' then null;
end $$;

select public.reverse_receivable_installment(
  'surgery', '10000000-0000-4000-8000-000000000010', 2, 1,
  '{"2":{"receivedDate":"2026-11-04","amount":100,"method":"pix","status":"received"}}',
  'pago', '2026-11-04',
  '{"2":{"receivedDate":"2026-11-04","amount":100,"method":"pix","status":"reversed","reversedAt":"2026-11-05T10:00:00Z"}}'
);
reset role;

do $$
declare definition text;
begin
  if not exists (
    select 1 from public.financial_installments
    where financial_entry_id = '20000000-0000-4000-8000-000000000010'
      and installment_number = 1 and source_installment_number = 2
  ) or not exists (
    select 1 from public.financial_installments
    where financial_entry_id = '20000000-0000-4000-8000-000000000010'
      and installment_number = 2 and source_installment_number = 1
  ) then
    raise exception 'Backfill não preservou a identidade original fora de ordem.';
  end if;

  select pg_get_functiondef('public.apply_billing_webhook_event(text,text,uuid,text,text,text,text,text,timestamptz,numeric,numeric,text)'::regprocedure)
  into definition;
  if position('coalesce(installment_now.source_installment_number, installment_now.installment_number)' in definition) = 0
     or position('coalesce(source_installment_number, installment_number)' in definition) = 0
     or position('latest_active_receipt_date(settlements_after)' in definition) = 0 then
    raise exception 'Upgrade não atualizou o webhook instalado.';
  end if;
  if not exists (
    select 1 from public.financial_installments
    where id = '30000000-0000-4000-8000-000000000011'
      and status = 'pending' and settlement_date is null and paid_amount = 0
  ) or not exists (
    select 1 from public.surgeries
    where id = '10000000-0000-4000-8000-000000000010'
      and payment_status = 'pendente'
      and payment_date is null
      and receipt_settlements -> '2' ->> 'status' = 'reversed'
      and receipt_settlements -> '2' ->> 'reversedBy' = '10000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Estorno correto não atualizou origem e parcela atomicamente.';
  end if;
end $$;
