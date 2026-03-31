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
