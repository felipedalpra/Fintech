create table if not exists public.alert_subscribers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.alert_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  reference_date date not null,
  risk_level text not null default 'info',
  trigger_keys text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'sent',
  error_message text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.alert_risk_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  reference_date date not null,
  risk_level text not null,
  trigger_keys text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, reference_date)
);

create table if not exists public.google_oauth_tokens (
  provider text primary key,
  account_email text,
  refresh_token text not null,
  scope text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_alert_dispatch_log_user_created on public.alert_dispatch_log(user_id, created_at desc);
create index if not exists idx_alert_risk_daily_user_date on public.alert_risk_daily(user_id, reference_date desc);

alter table public.alert_subscribers enable row level security;
alter table public.alert_dispatch_log enable row level security;
alter table public.alert_risk_daily enable row level security;
alter table public.google_oauth_tokens enable row level security;

create policy "Users read own alert subscriber" on public.alert_subscribers
for select to authenticated using (auth.uid() = user_id);

create policy "Users upsert own alert subscriber" on public.alert_subscribers
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users read own alert dispatch logs" on public.alert_dispatch_log
for select to authenticated using (auth.uid() = user_id);

create policy "Users read own alert daily risk" on public.alert_risk_daily
for select to authenticated using (auth.uid() = user_id);

create policy "Service role manages google oauth tokens" on public.google_oauth_tokens
for all to authenticated using (false) with check (false);
