-- Persistência dos campos manuais usados nos indicadores do Financeiro.
-- Aditivo e idempotente. Executar depois de access_control_schema.sql e
-- finance_role_access_schema.sql.

begin;

create table if not exists public.finance_indicator_inputs (
  user_id                    uuid primary key references auth.users(id) on delete cascade,
  indicator_inputs           jsonb not null default '{}'::jsonb,
  indicator_inputs_by_period jsonb not null default '{}'::jsonb,
  updated_at                 timestamptz not null default timezone('utc', now()),
  constraint finance_indicator_inputs_current_object
    check (jsonb_typeof(indicator_inputs) = 'object'),
  constraint finance_indicator_inputs_period_object
    check (jsonb_typeof(indicator_inputs_by_period) = 'object')
);

alter table public.finance_indicator_inputs enable row level security;

drop policy if exists "Finance indicator inputs access" on public.finance_indicator_inputs;
create policy "Finance indicator inputs access" on public.finance_indicator_inputs
  for all to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_manage())
  with check (user_id = public.data_owner_id() and public.finance_role_can_manage());

revoke all on table public.finance_indicator_inputs from public, anon;
grant select, insert, update on table public.finance_indicator_inputs to authenticated;

commit;
