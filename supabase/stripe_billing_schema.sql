-- Billing + recurring transactions support schema
-- Safe to run multiple times.

create extension if not exists pgcrypto;

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.billing_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  status text not null default 'trialing',
  selected_plan text not null default 'mensal',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  access_expires_at timestamptz,
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  stripe_price_id text,
  last_event_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists billing_accounts_stripe_customer_id_key
  on public.billing_accounts (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists billing_accounts_stripe_subscription_id_key
  on public.billing_accounts (stripe_subscription_id)
  where stripe_subscription_id is not null;

create unique index if not exists billing_accounts_stripe_checkout_session_id_key
  on public.billing_accounts (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create index if not exists billing_accounts_status_idx on public.billing_accounts (status);
create index if not exists billing_accounts_access_expires_at_idx on public.billing_accounts (access_expires_at);

drop trigger if exists set_billing_accounts_updated_at on public.billing_accounts;
create trigger set_billing_accounts_updated_at
before update on public.billing_accounts
for each row
execute function public.update_updated_at_column();

alter table public.billing_accounts enable row level security;

drop policy if exists "Users read own billing account" on public.billing_accounts;
create policy "Users read own billing account"
on public.billing_accounts
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users insert own billing account" on public.billing_accounts;
create policy "Users insert own billing account"
on public.billing_accounts
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users update own billing account" on public.billing_accounts;
create policy "Users update own billing account"
on public.billing_accounts
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.transacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  valor numeric(12,2) not null default 0,
  tipo text not null check (tipo in ('receita', 'despesa')),
  categoria text not null default 'outros',
  descricao text not null,
  data_pagamento timestamptz not null,
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'cancelado')),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists transacoes_user_id_idx on public.transacoes (user_id);
create index if not exists transacoes_data_pagamento_idx on public.transacoes (data_pagamento);
create index if not exists transacoes_user_data_idx on public.transacoes (user_id, data_pagamento);

alter table public.transacoes enable row level security;

drop policy if exists "Users read own transacoes" on public.transacoes;
create policy "Users read own transacoes"
on public.transacoes
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users insert own transacoes" on public.transacoes;
create policy "Users insert own transacoes"
on public.transacoes
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users update own transacoes" on public.transacoes;
create policy "Users update own transacoes"
on public.transacoes
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users delete own transacoes" on public.transacoes;
create policy "Users delete own transacoes"
on public.transacoes
for delete
to authenticated
using (auth.uid() = user_id);
