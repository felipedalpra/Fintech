create table if not exists public.billing_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  status text not null default 'trialing',
  selected_plan text not null default 'mensal',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_checkout_session_id text,
  stripe_price_id text,
  trial_started_at timestamptz not null default timezone('utc', now()),
  trial_ends_at timestamptz not null default timezone('utc', now() + interval '30 days'),
  current_period_end timestamptz,
  access_expires_at timestamptz not null default timezone('utc', now() + interval '30 days'),
  last_event_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint billing_accounts_status_check check (
    status in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused')
  ),
  constraint billing_accounts_plan_check check (
    selected_plan in ('mensal', 'semestral', 'anual')
  )
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists billing_accounts_set_updated_at on public.billing_accounts;
create trigger billing_accounts_set_updated_at
before update on public.billing_accounts
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_billing_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.billing_accounts (
    user_id,
    email,
    status,
    selected_plan,
    trial_started_at,
    trial_ends_at,
    access_expires_at
  )
  values (
    new.id,
    new.email,
    'trialing',
    coalesce(new.raw_user_meta_data ->> 'selected_billing_cycle', 'mensal'),
    timezone('utc', now()),
    timezone('utc', now() + interval '30 days'),
    timezone('utc', now() + interval '30 days')
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_billing on auth.users;
create trigger on_auth_user_created_billing
after insert on auth.users
for each row
execute function public.handle_new_billing_account();

insert into public.billing_accounts (
  user_id,
  email,
  status,
  selected_plan,
  trial_started_at,
  trial_ends_at,
  access_expires_at
)
select
  u.id,
  u.email,
  'trialing',
  coalesce(u.raw_user_meta_data ->> 'selected_billing_cycle', 'mensal'),
  timezone('utc', now()),
  timezone('utc', now() + interval '30 days'),
  timezone('utc', now() + interval '30 days')
from auth.users u
where not exists (
  select 1 from public.billing_accounts b where b.user_id = u.id
);

alter table public.billing_accounts enable row level security;

drop policy if exists "Users read own billing account" on public.billing_accounts;
create policy "Users read own billing account"
on public.billing_accounts
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users insert own billing account" on public.billing_accounts;
create policy "Users insert own billing account"
on public.billing_accounts
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users update own billing account" on public.billing_accounts;
create policy "Users update own billing account"
on public.billing_accounts
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
