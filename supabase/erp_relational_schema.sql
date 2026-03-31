create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.procedures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null default 0,
  duration_hours numeric(6,2) not null default 0,
  color text,
  description text,
  checklist jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  description text,
  purchase_price numeric(12,2) not null default 0,
  sale_price numeric(12,2) not null default 0,
  opening_stock numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.surgeries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  procedure_id uuid references public.procedures(id) on delete set null,
  patient text not null,
  total_value numeric(12,2) not null default 0,
  date date not null,
  payment_method text,
  payment_status text not null default 'pendente',
  surgeon text,
  payment_date date,
  hospital_cost numeric(12,2) not null default 0,
  anesthesia_cost numeric(12,2) not null default 0,
  material_cost numeric(12,2) not null default 0,
  other_costs numeric(12,2) not null default 0,
  invoice_issuance_percent numeric(5,2) not null default 0,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient text not null,
  date date not null,
  consultation_type text not null,
  value numeric(12,2) not null default 0,
  payment_type text not null,
  payment_method text,
  invoice_issuance_percent numeric(5,2) not null default 0,
  insurance text,
  payment_status text not null default 'pendente',
  forecast_payment_date date,
  payment_date date,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.product_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  patient_name text,
  quantity numeric(12,2) not null default 1,
  unit_value numeric(12,2) not null default 0,
  total_value numeric(12,2) not null default 0,
  sale_date date not null,
  payment_method text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.product_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric(12,2) not null default 1,
  total_value numeric(12,2) not null default 0,
  supplier text,
  purchase_date date not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.extra_revenues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  category text not null,
  value numeric(12,2) not null default 0,
  date date not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  category text not null,
  value numeric(12,2) not null default 0,
  due_date date not null,
  payment_date date,
  status text not null default 'aberto',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'banco',
  value numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.liabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'outros',
  value numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  metric text not null,
  target numeric(12,2) not null default 0,
  period text not null,
  due_date date,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace view public.entries_financial as
select s.user_id, s.id, concat('Cirurgia - ', s.patient) as description, 'cirurgia'::text as category, s.total_value as value, coalesce(s.payment_date, s.date) as date, 'cirurgia'::text as origin, s.id as reference_id
from public.surgeries s
where s.payment_status = 'pago'
union all
select c.user_id, c.id, concat('Consulta - ', c.patient), 'consulta', c.value, coalesce(c.payment_date, c.date), 'consulta', c.id
from public.consultations c
where c.payment_status = 'pago'
union all
select ps.user_id, ps.id, concat('Venda de produto - ', p.name), 'venda_produto', ps.total_value, ps.sale_date, 'venda_produto', ps.id
from public.product_sales ps
join public.products p on p.id = ps.product_id
union all
select r.user_id, r.id, r.description, r.category, r.value, r.date, 'outra_receita', r.id
from public.extra_revenues r;

create or replace view public.exits_financial as
select s.user_id, gen_random_uuid() as id, concat('Custo cirúrgico - ', s.patient) as description, 'hospital'::text as category, s.hospital_cost as value, s.date, 'custo_cirurgico'::text as origin, s.id as reference_id
from public.surgeries s where s.hospital_cost > 0
union all
select s.user_id, gen_random_uuid(), concat('Custo cirúrgico - ', s.patient), 'anestesia', s.anesthesia_cost, s.date, 'custo_cirurgico', s.id from public.surgeries s where s.anesthesia_cost > 0
union all
select s.user_id, gen_random_uuid(), concat('Custo cirúrgico - ', s.patient), 'material', s.material_cost, s.date, 'custo_cirurgico', s.id from public.surgeries s where s.material_cost > 0
union all
select s.user_id, gen_random_uuid(), concat('Custo cirúrgico - ', s.patient), 'outros', s.other_costs, s.date, 'custo_cirurgico', s.id from public.surgeries s where s.other_costs > 0
union all
select pp.user_id, pp.id, concat('Compra de produto - ', p.name), 'compra_produto', pp.total_value, pp.purchase_date, 'compra_produto', pp.id
from public.product_purchases pp
join public.products p on p.id = pp.product_id
union all
select e.user_id, e.id, e.description, e.category, e.value, coalesce(e.payment_date, e.due_date), 'despesa', e.id
from public.expenses e
where e.status = 'pago';

create or replace view public.accounts_receivable as
select s.user_id, 'surgery'::text as source, s.id as source_id, s.patient, coalesce(p.name, 'Sem procedimento') as description, s.total_value as value, s.date as due_date, s.payment_status as status
from public.surgeries s
left join public.procedures p on p.id = s.procedure_id
where s.payment_status not in ('pago', 'cancelado')
union all
select c.user_id, 'consultation'::text as source, c.id as source_id, c.patient, c.consultation_type as description, c.value, coalesce(c.forecast_payment_date, c.date) as due_date, c.payment_status
from public.consultations c
where c.payment_status not in ('pago', 'cancelado');

create or replace view public.accounts_payable as
select e.user_id, e.id as source_id, e.description, e.category, e.value, e.due_date, e.status
from public.expenses e
where e.status not in ('pago', 'cancelado');

create or replace view public.cash_flow_entries as
select user_id, date, 'entrada'::text as type, category, value, origin, reference_id from public.entries_financial
union all
select user_id, date, 'saida'::text, category, value, origin, reference_id from public.exits_financial;

create or replace function public.get_financial_analysis(
  start_date timestamptz,
  end_date timestamptz,
  granularity text default 'month'
)
returns table (
  periodo text,
  receita numeric,
  despesa numeric,
  lucro numeric,
  variacao_receita numeric,
  variacao_despesa numeric,
  variacao_lucro numeric,
  despesa_percent numeric,
  lucro_percent numeric
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized_granularity text := lower(coalesce(granularity, 'month'));
  trunc_unit text;
  step_interval text;
  source_sql text;
  transacoes_user_filter text := '';
begin
  if start_date is null or end_date is null then
    raise exception 'start_date and end_date are required';
  end if;
  if end_date < start_date then
    raise exception 'end_date must be greater than or equal to start_date';
  end if;
  if normalized_granularity not in ('month', 'quarter', 'year') then
    raise exception 'granularity must be month, quarter or year';
  end if;

  trunc_unit := case normalized_granularity
    when 'quarter' then 'quarter'
    when 'year' then 'year'
    else 'month'
  end;

  step_interval := case normalized_granularity
    when 'quarter' then '3 months'
    when 'year' then '1 year'
    else '1 month'
  end;

  if to_regclass('public.transacoes') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'transacoes'
        and column_name = 'user_id'
    ) then
      transacoes_user_filter := 'and user_id = auth.uid()';
    end if;

    source_sql := format('
      select
        data_pagamento::timestamptz as data_pagamento,
        valor::numeric as valor,
        tipo::text as tipo
      from public.transacoes
      where 1 = 1
        %s
        and data_pagamento >= $1
        and data_pagamento < $2
    ', transacoes_user_filter);
  else
    source_sql := '
      select
        date::timestamptz as data_pagamento,
        value::numeric as valor,
        case when type = ''entrada'' then ''receita'' else ''despesa'' end as tipo
      from public.cash_flow_entries
      where user_id = auth.uid()
        and date >= $1::date
        and date < $2::date
    ';
  end if;

  return query execute format($q$
    with base as (
      %s
    ),
    period_series as (
      select generate_series(
        date_trunc(%L, $1),
        date_trunc(%L, $2),
        %L::interval
      ) as period_start
    ),
    aggregated as (
      select
        date_trunc(%L, data_pagamento) as period_start,
        sum(case when tipo = 'receita' then valor else 0 end)::numeric as receita,
        sum(case when tipo = 'despesa' then valor else 0 end)::numeric as despesa
      from base
      group by 1
    ),
    with_zeros as (
      select
        ps.period_start,
        coalesce(a.receita, 0)::numeric as receita,
        coalesce(a.despesa, 0)::numeric as despesa
      from period_series ps
      left join aggregated a on a.period_start = ps.period_start
    ),
    calculated as (
      select
        period_start,
        receita,
        despesa,
        (receita - despesa)::numeric as lucro,
        lag(receita) over (order by period_start) as receita_anterior,
        lag(despesa) over (order by period_start) as despesa_anterior,
        lag(receita - despesa) over (order by period_start) as lucro_anterior
      from with_zeros
    )
    select
      case
        when %L = 'month' then to_char(period_start, 'YYYY-MM')
        when %L = 'quarter' then concat(extract(year from period_start)::int, '-Q', extract(quarter from period_start)::int)
        else to_char(period_start, 'YYYY')
      end as periodo,
      receita,
      despesa,
      lucro,
      round(((receita - receita_anterior) / nullif(receita_anterior, 0)) * 100, 2) as variacao_receita,
      round(((despesa - despesa_anterior) / nullif(despesa_anterior, 0)) * 100, 2) as variacao_despesa,
      round(((lucro - lucro_anterior) / nullif(lucro_anterior, 0)) * 100, 2) as variacao_lucro,
      round((despesa / nullif(receita, 0)) * 100, 2) as despesa_percent,
      round((lucro / nullif(receita, 0)) * 100, 2) as lucro_percent
    from calculated
    order by period_start
  $q$, source_sql, trunc_unit, trunc_unit, step_interval, trunc_unit, normalized_granularity, normalized_granularity)
  using start_date, end_date + interval '1 day';
end;
$$;

grant execute on function public.get_financial_analysis(timestamptz, timestamptz, text) to authenticated;

do $$
begin
  if to_regclass('public.transacoes') is not null then
    execute 'create index if not exists idx_transacoes_data on public.transacoes(data_pagamento)';
  end if;
end $$;

alter table public.user_profiles enable row level security;
alter table public.procedures enable row level security;
alter table public.products enable row level security;
alter table public.surgeries enable row level security;
alter table public.consultations enable row level security;
alter table public.product_sales enable row level security;
alter table public.product_purchases enable row level security;
alter table public.extra_revenues enable row level security;
alter table public.expenses enable row level security;
alter table public.assets enable row level security;
alter table public.liabilities enable row level security;
alter table public.goals enable row level security;

do $$
declare item text;
begin
  foreach item in array array['user_profiles','procedures','products','surgeries','consultations','product_sales','product_purchases','extra_revenues','expenses','assets','liabilities','goals']
  loop
    begin
      execute format('create policy "%s own rows" on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', initcap(replace(item, '_', ' ')), item);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
