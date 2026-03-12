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
alter table public.audit_logs enable row level security;

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

create policy "Users read own audit logs"
on public.audit_logs
for select
to authenticated
using (auth.uid() = user_id);
