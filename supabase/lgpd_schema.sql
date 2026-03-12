create extension if not exists pgcrypto;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'medico', 'secretaria', 'financeiro')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.patients_identity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_code text not null unique,
  full_name text not null,
  email_ciphertext bytea,
  phone_ciphertext bytea,
  cpf_ciphertext bytea,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.patients_health_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients_identity(id) on delete cascade,
  clinical_notes text,
  history jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.financial_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid references public.patients_identity(id) on delete set null,
  record_type text not null,
  amount numeric(14,2) not null default 0,
  occurred_at date not null,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.analytics_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_code text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients_identity(id) on delete cascade,
  consent_type text not null,
  policy_version text not null,
  granted boolean not null default true,
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

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select role from public.user_roles where user_id = auth.uid()
$$;

create or replace function public.export_patient_data(target_patient_id uuid)
returns jsonb
language sql
security definer
as $$
  select jsonb_build_object(
    'identity', (select to_jsonb(pi) - 'email_ciphertext' - 'phone_ciphertext' - 'cpf_ciphertext' from public.patients_identity pi where pi.id = target_patient_id and pi.user_id = auth.uid()),
    'health', (select coalesce(jsonb_agg(to_jsonb(phd)), '[]'::jsonb) from public.patients_health_data phd where phd.patient_id = target_patient_id and phd.user_id = auth.uid()),
    'financial', (select coalesce(jsonb_agg(to_jsonb(fr)), '[]'::jsonb) from public.financial_records fr where fr.patient_id = target_patient_id and fr.user_id = auth.uid()),
    'consents', (select coalesce(jsonb_agg(to_jsonb(cr)), '[]'::jsonb) from public.consent_records cr where cr.patient_id = target_patient_id and cr.user_id = auth.uid())
  )
$$;

create or replace function public.anonymize_patient_data(target_patient_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.patients_identity
    set full_name = 'ANONIMIZADO',
        email_ciphertext = null,
        phone_ciphertext = null,
        cpf_ciphertext = null,
        updated_at = timezone('utc', now())
  where id = target_patient_id and user_id = auth.uid();

  update public.patients_health_data
    set clinical_notes = null,
        history = '{}'::jsonb,
        updated_at = timezone('utc', now())
  where patient_id = target_patient_id and user_id = auth.uid();

  update public.financial_records
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('anonymized', true)
  where patient_id = target_patient_id and user_id = auth.uid();
end;
$$;

create or replace function public.delete_patient_data(target_patient_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  delete from public.consent_records where patient_id = target_patient_id and user_id = auth.uid();
  delete from public.financial_records where patient_id = target_patient_id and user_id = auth.uid();
  delete from public.patients_health_data where patient_id = target_patient_id and user_id = auth.uid();
  delete from public.patients_identity where id = target_patient_id and user_id = auth.uid();
end;
$$;

alter table public.user_roles enable row level security;
alter table public.patients_identity enable row level security;
alter table public.patients_health_data enable row level security;
alter table public.financial_records enable row level security;
alter table public.analytics_data enable row level security;
alter table public.consent_records enable row level security;
alter table public.audit_logs enable row level security;

create policy "Users read own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "Users manage own identity" on public.patients_identity for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage own health data" on public.patients_health_data for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage own financial records" on public.financial_records for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage own analytics data" on public.analytics_data for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage own consent records" on public.consent_records for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users read own audit logs" on public.audit_logs for select to authenticated using (user_id = auth.uid());
