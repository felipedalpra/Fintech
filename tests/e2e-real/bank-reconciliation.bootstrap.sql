-- Banco descartável para o E2E real da conciliação bancária.
-- O runner cria uma database isolada e aplica este bootstrap antes do schema da feature.

create extension if not exists pgcrypto;
create schema if not exists auth;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator login password 'surgimetrics-e2e'; exception when duplicate_object then alter role authenticator password 'surgimetrics-e2e'; end $$;
grant anon, authenticated to authenticator;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null
);

create table public.clinic_members (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  role text not null
);

create or replace function public.data_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select owner_id from public.clinics where owner_id = auth.uid() limit 1),
    (select c.owner_id from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id where cm.user_id = auth.uid() limit 1)
  )
$$;

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  account_type text not null default 'checking',
  opening_balance numeric(12,2) not null default 0,
  opening_balance_date date,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  direction text not null,
  source_type text not null,
  source_id uuid not null,
  source_component text not null default 'revenue',
  description text,
  party_type text,
  party_id uuid,
  party_name_snapshot text,
  category text,
  chart_account_id uuid,
  cost_center text,
  origin_label text,
  competence_date date,
  issue_date date,
  total_amount numeric(12,2) not null,
  status text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);
create unique index financial_entries_source_e2e on public.financial_entries(user_id, source_type, source_id, source_component);

create table public.financial_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  financial_entry_id uuid not null references public.financial_entries(id),
  installment_number integer not null,
  amount numeric(12,2) not null,
  paid_amount numeric(12,2) not null default 0,
  due_date date,
  settlement_date date,
  payment_method text,
  financial_account_id uuid references public.financial_accounts(id),
  fees_amount numeric(12,2) not null default 0,
  interest_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  status text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);
create unique index financial_installments_entry_e2e on public.financial_installments(financial_entry_id, installment_number);

-- Tabelas operacionais mínimas consultadas pelo workspace durante o teste.
create table public.procedures (id uuid primary key, user_id uuid not null, name text, price numeric, duration_hours numeric, color text, description text, checklist jsonb, chart_account_id uuid, archived_at timestamptz);
create table public.products (id uuid primary key, user_id uuid not null, name text, category text, description text, purchase_price numeric, sale_price numeric, opening_stock numeric, active boolean, archived_at timestamptz);
create table public.surgeries (id uuid primary key, user_id uuid not null, archived_at timestamptz);
create table public.consultations (id uuid primary key, user_id uuid not null, archived_at timestamptz);
create table public.product_sales (id uuid primary key, user_id uuid not null, archived_at timestamptz);
create table public.product_purchases (id uuid primary key, user_id uuid not null, archived_at timestamptz);
create table public.extra_revenues (id uuid primary key, user_id uuid not null, description text, category text, value numeric, date date, received_date date, due_date date, competence_date date, status text, patient_id uuid, cost_center text, origin_label text, chart_account_id uuid, archived_at timestamptz);
create table public.expenses (id uuid primary key, user_id uuid not null, description text, category text, value numeric, due_date date, payment_date date, competence_date date, status text, chart_account_id uuid, archived_at timestamptz);
create table public.assets (id uuid primary key, user_id uuid not null, archived_at timestamptz);
create table public.liabilities (id uuid primary key, user_id uuid not null, archived_at timestamptz);
create table public.goals (id uuid primary key, user_id uuid not null, archived_at timestamptz);
create table public.chart_accounts (id uuid primary key, user_id uuid not null, archived_at timestamptz);
create table public.recorrencias (id uuid primary key, user_id uuid not null, tipo text, descricao text, valor numeric, categoria text, frequencia text, dia_execucao integer, data_inicio date, data_fim date, auto_mark_as_paid boolean, ativo boolean, chart_account_id uuid);
create table public.patients (id uuid primary key, user_id uuid not null, full_name text, archived_at timestamptz);
create table public.suppliers (id uuid primary key, user_id uuid not null, name text, archived_at timestamptz);
create table public.audit_logs (id uuid primary key default gen_random_uuid(), user_id uuid not null, actor_id uuid, action text, entity_type text, details jsonb, created_at timestamptz default now());

alter table public.financial_accounts enable row level security;
alter table public.financial_entries enable row level security;
alter table public.financial_installments enable row level security;
create policy financial_accounts_e2e on public.financial_accounts for all to authenticated using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());
create policy financial_entries_e2e on public.financial_entries for all to authenticated using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());
create policy financial_installments_e2e on public.financial_installments for all to authenticated using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());

grant usage on schema public, auth to anon, authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

insert into auth.users(id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@surgimetrics.local'),
  ('33333333-3333-4333-8333-333333333333', 'other@surgimetrics.local');
insert into public.clinics(id, owner_id, name) values
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Clínica E2E'),
  ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'Outra Clínica');

insert into public.financial_accounts(id, user_id, name, account_type) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Banco E2E Real', 'checking'),
  ('abababab-abab-4bab-8bab-abababababab', '33333333-3333-4333-8333-333333333333', 'Banco Outra Clínica', 'checking');

insert into public.extra_revenues(id, user_id, description, category, value, date, received_date, due_date, competence_date, status)
values ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'Consulta Maria E2E', 'Consultas', 500, '2026-10-13', '2026-10-13', '2026-10-13', '2026-10-13', 'recebido');
insert into public.financial_entries(id, user_id, direction, source_type, source_id, source_component, description, party_name_snapshot, category, competence_date, issue_date, total_amount, status)
values ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 'receivable', 'extra_revenue', '55555555-5555-4555-8555-555555555555', 'revenue', 'Consulta Maria E2E', 'Maria', 'Consultas', '2026-10-13', '2026-10-13', 500, 'paid');
insert into public.financial_installments(id, user_id, financial_entry_id, installment_number, amount, paid_amount, due_date, settlement_date, payment_method, status)
values ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666666', 1, 500, 500, '2026-10-13', '2026-10-13', 'pix', 'paid');
