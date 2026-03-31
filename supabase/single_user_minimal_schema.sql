create extension if not exists pgcrypto;

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

create table if not exists public.recorrencias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('receita', 'despesa')),
  descricao text not null,
  valor numeric(12,2) not null default 0,
  categoria text not null default 'outros',
  frequencia text not null check (frequencia in ('mensal', 'semanal', 'anual')),
  dia_execucao int not null check (dia_execucao between 1 and 31),
  data_inicio date not null,
  data_fim date,
  auto_mark_as_paid boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

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
alter table public.recorrencias enable row level security;
alter table public.audit_logs enable row level security;

do $$
declare item text;
begin
  foreach item in array array['user_profiles','procedures','products','surgeries','consultations','product_sales','product_purchases','extra_revenues','expenses','assets','liabilities','goals','recorrencias']
  loop
    begin
      execute format('create policy "%s own rows" on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', initcap(replace(item, '_', ' ')), item);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

create policy "Users read own audit logs"
on public.audit_logs
for select
to authenticated
using (auth.uid() = user_id);

create index if not exists idx_recorrencias_user_ativo on public.recorrencias(user_id, ativo);
create index if not exists idx_recorrencias_data_inicio on public.recorrencias(data_inicio);

do $$
begin
  if to_regclass('public.transacoes') is not null then
    execute 'create index if not exists idx_transacoes_user_data on public.transacoes(user_id, data_pagamento)';
    execute 'create index if not exists idx_transacoes_data on public.transacoes(data_pagamento)';
  end if;
end $$;

create or replace function public.processar_recorrencias(
  p_reference_date date default (timezone('America/Sao_Paulo', now()))::date,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  due_date date;
  period_unit text;
  period_anchor date;
  transacoes_exists boolean;
  transacoes_has_user_id boolean;
  transacoes_has_created_at boolean;
  inserted_count int := 0;
  skipped_count int := 0;
  checked_count int := 0;
  already_exists boolean;
  month_start date;
  month_end date;
  start_of_year date;
  end_of_year date;
begin
  transacoes_exists := to_regclass('public.transacoes') is not null;
  if not transacoes_exists then
    return jsonb_build_object(
      'ok', false,
      'message', 'Tabela public.transacoes nao encontrada.',
      'processed', 0,
      'inserted', 0,
      'skipped', 0
    );
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transacoes'
      and column_name = 'user_id'
  ) into transacoes_has_user_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transacoes'
      and column_name = 'created_at'
  ) into transacoes_has_created_at;

  for rec in
    select *
    from public.recorrencias
    where ativo = true
      and data_inicio <= p_reference_date
      and (data_fim is null or data_fim >= p_reference_date)
      and (p_user_id is null or user_id = p_user_id)
    order by created_at asc
  loop
    checked_count := checked_count + 1;

    if rec.frequencia = 'mensal' then
      month_start := date_trunc('month', p_reference_date)::date;
      month_end := (date_trunc('month', p_reference_date) + interval '1 month - 1 day')::date;
      due_date := (month_start + ((least(greatest(rec.dia_execucao, 1), extract(day from month_end)::int) - 1) * interval '1 day'))::date;
      period_unit := 'month';
      period_anchor := month_start;
    elsif rec.frequencia = 'semanal' then
      due_date := (date_trunc('week', p_reference_date)::date + ((least(greatest(rec.dia_execucao, 1), 7) - 1) * interval '1 day'))::date;
      period_unit := 'week';
      period_anchor := date_trunc('week', due_date)::date;
    else
      start_of_year := make_date(extract(year from p_reference_date)::int, 1, 1);
      end_of_year := make_date(extract(year from p_reference_date)::int, 12, 31);
      month_end := (date_trunc('month', make_date(extract(year from p_reference_date)::int, extract(month from rec.data_inicio)::int, 1)) + interval '1 month - 1 day')::date;
      due_date := make_date(
        extract(year from p_reference_date)::int,
        extract(month from rec.data_inicio)::int,
        least(greatest(rec.dia_execucao, 1), extract(day from month_end)::int)
      );
      if due_date < start_of_year or due_date > end_of_year then
        skipped_count := skipped_count + 1;
        continue;
      end if;
      period_unit := 'year';
      period_anchor := date_trunc('year', due_date)::date;
    end if;

    if due_date is null or p_reference_date < due_date then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    if rec.data_fim is not null and due_date > rec.data_fim then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    if transacoes_has_user_id then
      execute format(
        'select exists (
          select 1
          from public.transacoes
          where user_id = $1
            and descricao = $2
            and valor = $3
            and date_trunc(''%s'', data_pagamento::timestamp) = date_trunc(''%s'', $4::timestamp)
        )',
        period_unit,
        period_unit
      )
      into already_exists
      using rec.user_id, rec.descricao, rec.valor, period_anchor;
    else
      execute format(
        'select exists (
          select 1
          from public.transacoes
          where descricao = $1
            and valor = $2
            and date_trunc(''%s'', data_pagamento::timestamp) = date_trunc(''%s'', $3::timestamp)
        )',
        period_unit,
        period_unit
      )
      into already_exists
      using rec.descricao, rec.valor, period_anchor;
    end if;

    if already_exists then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    if transacoes_has_user_id and transacoes_has_created_at then
      insert into public.transacoes (user_id, valor, tipo, categoria, descricao, data_pagamento, status, created_at)
      values (
        rec.user_id,
        rec.valor,
        rec.tipo,
        rec.categoria,
        rec.descricao,
        due_date::timestamp,
        case when rec.auto_mark_as_paid then 'pago' else 'pendente' end,
        timezone('utc', now())
      );
    elsif transacoes_has_user_id then
      insert into public.transacoes (user_id, valor, tipo, categoria, descricao, data_pagamento, status)
      values (
        rec.user_id,
        rec.valor,
        rec.tipo,
        rec.categoria,
        rec.descricao,
        due_date::timestamp,
        case when rec.auto_mark_as_paid then 'pago' else 'pendente' end
      );
    elsif transacoes_has_created_at then
      insert into public.transacoes (valor, tipo, categoria, descricao, data_pagamento, status, created_at)
      values (
        rec.valor,
        rec.tipo,
        rec.categoria,
        rec.descricao,
        due_date::timestamp,
        case when rec.auto_mark_as_paid then 'pago' else 'pendente' end,
        timezone('utc', now())
      );
    else
      insert into public.transacoes (valor, tipo, categoria, descricao, data_pagamento, status)
      values (
        rec.valor,
        rec.tipo,
        rec.categoria,
        rec.descricao,
        due_date::timestamp,
        case when rec.auto_mark_as_paid then 'pago' else 'pendente' end
      );
    end if;

    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', checked_count,
    'inserted', inserted_count,
    'skipped', skipped_count,
    'reference_date', p_reference_date
  );
end;
$$;

grant execute on function public.processar_recorrencias(date, uuid) to authenticated;

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
