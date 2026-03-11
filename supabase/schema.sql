create table if not exists public.user_finance_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{"procedures":[],"surgeries":[],"consultations":[],"products":[],"productSales":[],"productPurchases":[],"extraRevenues":[],"expenses":[],"assets":[],"liabilities":[],"goals":[]}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.user_finance_data enable row level security;

do $$
begin
  execute 'create policy "Users can read own finance data" on public.user_finance_data for select to authenticated using (auth.uid() = user_id)';
exception when duplicate_object then null;
end $$;

do $$
begin
  execute 'create policy "Users can insert own finance data" on public.user_finance_data for insert to authenticated with check (auth.uid() = user_id)';
exception when duplicate_object then null;
end $$;

do $$
begin
  execute 'create policy "Users can update own finance data" on public.user_finance_data for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)';
exception when duplicate_object then null;
end $$;
