-- chart_of_accounts_schema.sql
-- Plano de contas editável por clínica. Aditivo e idempotente.
-- Executar DEPOIS de access_control_schema.sql, erp_relational_schema.sql,
-- e financial_ledger_schema.sql.

begin;

create table if not exists public.chart_accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  parent_id   uuid references public.chart_accounts(id) on delete restrict,
  code        text not null,
  name        text not null,
  node_type   text not null default 'account'
                check (node_type in ('group', 'account')),
  nature      text not null
                check (nature in (
                  'asset', 'liability', 'equity', 'revenue', 'revenue_deduction',
                  'direct_cost', 'operating_expense', 'depreciation',
                  'financial_revenue', 'financial_expense', 'income_tax', 'unclassified'
                )),
  dre_section text not null default 'unclassified'
                check (dre_section in (
                  'balance', 'gross_revenue', 'revenue_deductions', 'direct_costs',
                  'personnel', 'administrative', 'operations', 'marketing',
                  'depreciation', 'financial_result', 'income_taxes', 'unclassified'
                )),
  description text,
  system_key  text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

create unique index if not exists uq_chart_accounts_code
  on public.chart_accounts(user_id, lower(code));
create unique index if not exists uq_chart_accounts_system_key
  on public.chart_accounts(user_id, system_key)
  where system_key is not null;
create index if not exists idx_chart_accounts_tree
  on public.chart_accounts(user_id, parent_id, sort_order);
create index if not exists idx_chart_accounts_active
  on public.chart_accounts(user_id, is_active);

create or replace function public.validate_chart_account_tree()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_owner uuid;
  parent_type text;
  cycle_found boolean;
begin
  new.code := pg_catalog.btrim(new.code);
  new.name := pg_catalog.btrim(new.name);
  if new.code = '' or new.name = '' then
    raise exception 'code and name are required' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' and new.node_type = 'account'
     and exists(select 1 from public.chart_accounts where parent_id = new.id) then
    raise exception 'a group with children cannot become an account' using errcode = '23514';
  end if;

  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'an account cannot be its own parent' using errcode = '23514';
  end if;

  select user_id, node_type into parent_owner, parent_type
  from public.chart_accounts
  where id = new.parent_id;
  if parent_owner is null or parent_owner <> new.user_id then
    raise exception 'parent account must belong to the same clinic' using errcode = '23514';
  end if;
  if parent_type <> 'group' then
    raise exception 'parent account must be a group' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    with recursive descendants as (
      select id from public.chart_accounts where parent_id = new.id
      union all
      select child.id
      from public.chart_accounts child
      join descendants d on child.parent_id = d.id
    )
    select exists(select 1 from descendants where id = new.parent_id) into cycle_found;
    if cycle_found then
      raise exception 'moving this account would create a cycle' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_chart_account_tree on public.chart_accounts;
create trigger trg_validate_chart_account_tree
before insert or update of parent_id, user_id, code, name, node_type
on public.chart_accounts
for each row execute function public.validate_chart_account_tree();

create or replace function public.touch_chart_account_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_touch_chart_account on public.chart_accounts;
create trigger trg_touch_chart_account
before update on public.chart_accounts
for each row execute function public.touch_chart_account_updated_at();

alter table public.chart_accounts enable row level security;
do $$ begin
  begin
    create policy "Chart accounts clinic access" on public.chart_accounts
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

grant select, insert, update, delete on public.chart_accounts to authenticated;
grant all on public.chart_accounts to service_role;

alter table public.extra_revenues add column if not exists chart_account_id uuid;
alter table public.expenses add column if not exists chart_account_id uuid;
alter table public.recorrencias add column if not exists chart_account_id uuid;
alter table public.financial_entries add column if not exists chart_account_id uuid;
alter table public.procedures add column if not exists chart_account_id uuid;

do $$ begin
  begin
    alter table public.procedures
      add constraint procedures_chart_account_fk
      foreign key (chart_account_id) references public.chart_accounts(id) on delete restrict;
  exception when duplicate_object then null; end;
  begin
    alter table public.extra_revenues
      add constraint extra_revenues_chart_account_fk
      foreign key (chart_account_id) references public.chart_accounts(id) on delete restrict;
  exception when duplicate_object then null; end;
  begin
    alter table public.expenses
      add constraint expenses_chart_account_fk
      foreign key (chart_account_id) references public.chart_accounts(id) on delete restrict;
  exception when duplicate_object then null; end;
  begin
    alter table public.recorrencias
      add constraint recorrencias_chart_account_fk
      foreign key (chart_account_id) references public.chart_accounts(id) on delete restrict;
  exception when duplicate_object then null; end;
  begin
    alter table public.financial_entries
      add constraint financial_entries_chart_account_fk
      foreign key (chart_account_id) references public.chart_accounts(id) on delete restrict;
  exception when duplicate_object then null; end;
end $$;

create index if not exists idx_extra_revenues_chart_account on public.extra_revenues(chart_account_id);
create index if not exists idx_procedures_chart_account on public.procedures(chart_account_id);
create index if not exists idx_expenses_chart_account on public.expenses(chart_account_id);
create index if not exists idx_recorrencias_chart_account on public.recorrencias(chart_account_id);
create index if not exists idx_financial_entries_chart_account on public.financial_entries(chart_account_id);

commit;

-- A árvore padrão é criada pelo aplicativo no primeiro acesso à aba Plano de contas.
-- A aplicação preserva `category` como snapshot legado e passa a usar chart_account_id como vínculo estável.
