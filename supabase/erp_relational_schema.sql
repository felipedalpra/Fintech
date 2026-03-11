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
  insurance text,
  payment_status text not null default 'pendente',
  forecast_payment_date date,
  payment_date date,
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

create or replace view public.accounts_receivable as
select
  s.user_id,
  'surgery'::text as source,
  s.id as source_id,
  s.patient,
  coalesce(p.name, 'Sem procedimento') as description,
  s.total_value as value,
  s.date as due_date,
  s.payment_status as status
from public.surgeries s
left join public.procedures p on p.id = s.procedure_id
where s.payment_status <> 'pago' and s.payment_status <> 'cancelado'
union all
select
  c.user_id,
  'consultation'::text as source,
  c.id as source_id,
  c.patient,
  c.consultation_type as description,
  c.value,
  coalesce(c.forecast_payment_date, c.date) as due_date,
  c.payment_status
from public.consultations c
where c.payment_status <> 'pago' and c.payment_status <> 'cancelado';

create or replace view public.accounts_payable as
select
  e.user_id,
  e.id as source_id,
  e.description,
  e.category,
  e.value,
  e.due_date,
  e.status
from public.expenses e
where e.status <> 'pago' and e.status <> 'cancelado';

create or replace view public.cash_flow_entries as
select s.user_id, coalesce(s.payment_date, s.date) as date, 'entrada'::text as type, 'cirurgia'::text as category, s.total_value as value, 'surgery'::text as origin, s.id as reference_id
from public.surgeries s
where s.payment_status = 'pago'
union all
select s.user_id, s.date, 'saida', 'hospital', s.hospital_cost, 'surgery_cost', s.id from public.surgeries s where s.hospital_cost > 0
union all
select s.user_id, s.date, 'saida', 'anestesia', s.anesthesia_cost, 'surgery_cost', s.id from public.surgeries s where s.anesthesia_cost > 0
union all
select s.user_id, s.date, 'saida', 'material', s.material_cost, 'surgery_cost', s.id from public.surgeries s where s.material_cost > 0
union all
select s.user_id, s.date, 'saida', 'outros', s.other_costs, 'surgery_cost', s.id from public.surgeries s where s.other_costs > 0
union all
select c.user_id, coalesce(c.payment_date, c.date), 'entrada', 'consulta', c.value, 'consultation', c.id from public.consultations c where c.payment_status = 'pago'
union all
select r.user_id, r.date, 'entrada', r.category, r.value, 'extra_revenue', r.id from public.extra_revenues r
union all
select e.user_id, coalesce(e.payment_date, e.due_date), 'saida', e.category, e.value, 'expense', e.id from public.expenses e where e.status = 'pago';

alter table public.user_profiles enable row level security;
alter table public.procedures enable row level security;
alter table public.surgeries enable row level security;
alter table public.consultations enable row level security;
alter table public.extra_revenues enable row level security;
alter table public.expenses enable row level security;
alter table public.goals enable row level security;

do $$
begin
  execute 'create policy "Profiles own rows" on public.user_profiles for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)';
exception when duplicate_object then null;
end $$;

do $$
begin
  execute 'create policy "Procedures own rows" on public.procedures for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)';
exception when duplicate_object then null;
end $$;

do $$
begin
  execute 'create policy "Surgeries own rows" on public.surgeries for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)';
exception when duplicate_object then null;
end $$;

do $$
begin
  execute 'create policy "Consultations own rows" on public.consultations for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)';
exception when duplicate_object then null;
end $$;

do $$
begin
  execute 'create policy "Extra revenues own rows" on public.extra_revenues for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)';
exception when duplicate_object then null;
end $$;

do $$
begin
  execute 'create policy "Expenses own rows" on public.expenses for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)';
exception when duplicate_object then null;
end $$;

do $$
begin
  execute 'create policy "Goals own rows" on public.goals for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)';
exception when duplicate_object then null;
end $$;
