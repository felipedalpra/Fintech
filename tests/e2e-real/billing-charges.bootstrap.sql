create extension if not exists pgcrypto;
create schema if not exists auth;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create table auth.users (id uuid primary key, email text);
create table public.patients (id uuid primary key, user_id uuid not null references auth.users(id), full_name text, cpf text, email text, phone text);
create table public.surgeries (id uuid primary key, user_id uuid not null, payment_status text, payment_date date);
create table public.consultations (id uuid primary key, user_id uuid not null, payment_status text, payment_date date);
create table public.product_sales (id uuid primary key, user_id uuid not null, status text, received_date date, payment_method text);
create table public.extra_revenues (id uuid primary key, user_id uuid not null, status text, received_date date);
create table public.expenses (
  id uuid primary key, user_id uuid not null, description text, category text, value numeric,
  due_date date, competence_date date, payment_date date, status text, cost_center text,
  origin_label text, chart_account_id uuid, archived_at timestamptz
);
create table public.chart_accounts (
  id uuid primary key, user_id uuid not null, code text, is_active boolean default true,
  created_at timestamptz default now()
);
create table public.financial_entries (
  id uuid primary key, user_id uuid not null, direction text, source_type text, source_id uuid,
  source_component text, description text, party_id uuid, party_name_snapshot text,
  total_amount numeric, status text, updated_at timestamptz default now(), archived_at timestamptz
);
create table public.financial_installments (
  id uuid primary key, user_id uuid not null, financial_entry_id uuid references public.financial_entries(id),
  installment_number integer, amount numeric, paid_amount numeric default 0, due_date date,
  settlement_date date, payment_method text, status text, updated_at timestamptz default now(), archived_at timestamptz
);
create table public.whatsapp_automations (
  user_id uuid primary key,
  payment_template text not null default 'Olá {patient_name}! Consta um pagamento de {value} com vencimento em {date}. Qualquer dúvida sobre o pagamento, estamos à disposição.'
);

create or replace function public.data_owner_id() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.finance_role_can_manage() returns boolean language sql stable as $$ select true $$;

insert into auth.users values ('11111111-1111-4111-8111-111111111111', 'owner@test.local');
insert into public.patients values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Ana', '12345678901', null, '5511999999999');
insert into public.surgeries values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'pendente', null);
insert into public.chart_accounts values ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '8.02.04', true, now());
insert into public.financial_entries values (
  '55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'receivable', 'surgery',
  '33333333-3333-4333-8333-333333333333', 'revenue', 'Cirurgia Ana', '22222222-2222-4222-8222-222222222222', 'Ana', 100, 'pending', now(), null
);
insert into public.financial_installments values (
  '66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555555', 1, 100, 0, '2026-10-20', null, null, 'pending', now(), null
);
