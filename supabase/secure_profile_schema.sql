create extension if not exists pgcrypto;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.secure_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_payload jsonb not null,
  payload_version integer not null default 1,
  payload_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_secure_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists secure_profiles_set_updated_at on public.secure_profiles;
create trigger secure_profiles_set_updated_at
before update on public.secure_profiles
for each row
execute function public.set_secure_profile_updated_at();

alter table public.secure_profiles enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "Users read own secure profile" on public.secure_profiles;
create policy "Users read own secure profile"
on public.secure_profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users insert own secure profile" on public.secure_profiles;
create policy "Users insert own secure profile"
on public.secure_profiles
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users update own secure profile" on public.secure_profiles;
create policy "Users update own secure profile"
on public.secure_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users read own audit logs" on public.audit_logs;
create policy "Users read own audit logs"
on public.audit_logs
for select
to authenticated
using (user_id = auth.uid());
