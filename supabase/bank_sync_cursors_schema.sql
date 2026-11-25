-- Cursor durável para futura sincronização bancária automática.
-- Não conecta nenhum provedor por si só; guarda apenas progresso e falhas de um conector autorizado.
begin;

create table if not exists public.bank_sync_cursors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  financial_account_id uuid not null references public.financial_accounts(id) on delete cascade,
  provider text not null check (length(trim(provider)) between 2 and 80),
  connection_id uuid,
  cursor text,
  last_successful_sync_at timestamptz,
  last_attempted_sync_at timestamptz,
  status text not null default 'ready' check (status in ('ready','syncing','error','paused')),
  last_error_code text,
  last_error_message text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, financial_account_id, provider)
);

create index if not exists idx_bank_sync_cursors_due
  on public.bank_sync_cursors(status, last_successful_sync_at);
alter table public.bank_sync_cursors enable row level security;
do $$ begin
  create policy "Bank sync cursors clinic access" on public.bank_sync_cursors
    for all to authenticated using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());
exception when duplicate_object then null; end $$;
revoke all on public.bank_sync_cursors from anon;
grant select on public.bank_sync_cursors to authenticated;
commit;
