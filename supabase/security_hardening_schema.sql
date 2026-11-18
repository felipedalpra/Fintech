-- Controles persistentes de segurança para APIs serverless.
-- Aplicar antes de ativar o rate limiting em produção.

begin;

create table if not exists public.api_rate_limit_buckets (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  actor_id uuid references auth.users(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  request_ip text,
  route text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.api_rate_limit_buckets enable row level security;
alter table public.security_events enable row level security;
revoke all on public.api_rate_limit_buckets from public, anon, authenticated;
revoke all on public.security_events from public, anon, authenticated;
grant select, insert, update, delete on public.api_rate_limit_buckets to service_role;
grant select, insert on public.security_events to service_role;

create index if not exists idx_security_events_created_at
  on public.security_events(created_at desc);
create index if not exists idx_security_events_type_created_at
  on public.security_events(event_type, created_at desc);

create or replace function public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_bucket public.api_rate_limit_buckets%rowtype;
  next_count integer;
  reset_at timestamptz;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit arguments' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));
  select * into current_bucket
    from public.api_rate_limit_buckets
   where key_hash = p_key_hash;

  if not found or current_bucket.window_started_at + make_interval(secs => p_window_seconds) <= clock_timestamp() then
    next_count := 1;
    insert into public.api_rate_limit_buckets(key_hash, window_started_at, request_count, updated_at)
    values (p_key_hash, clock_timestamp(), 1, clock_timestamp())
    on conflict (key_hash) do update set
      window_started_at = excluded.window_started_at,
      request_count = excluded.request_count,
      updated_at = excluded.updated_at;
    return query select true, greatest(p_limit - next_count, 0), p_window_seconds;
    return;
  end if;

  next_count := current_bucket.request_count + 1;
  update public.api_rate_limit_buckets
     set request_count = next_count, updated_at = clock_timestamp()
   where key_hash = p_key_hash;
  reset_at := current_bucket.window_started_at + make_interval(secs => p_window_seconds);
  return query select next_count <= p_limit,
    greatest(p_limit - next_count, 0),
    greatest(1, ceil(extract(epoch from (reset_at - clock_timestamp())))::integer);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;

commit;

