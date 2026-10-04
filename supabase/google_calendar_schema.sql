-- Integração Google Agenda (por usuário).
-- Aplicar ANTES de publicar o código que lê/grava start_time e duration_minutes.

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_email text,
  refresh_token_encrypted jsonb not null,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.google_calendar_event_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('surgery', 'consultation')),
  record_id uuid not null,
  google_event_id text not null,
  synced_hash text not null,
  remote_snapshot text not null default '',
  detached boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, record_type, record_id)
);

-- RLS ligada e sem policies: somente o service role (API serverless) acessa.
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_event_links enable row level security;

alter table public.surgeries
  add column if not exists start_time time,
  add column if not exists duration_minutes integer;

alter table public.consultations
  add column if not exists start_time time,
  add column if not exists duration_minutes integer;
