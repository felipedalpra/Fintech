-- access_control_schema.sql
-- Executar DEPOIS de patients_schema.sql e erp_relational_schema.sql.
-- Executar no Supabase SQL Editor.

-- 1. Clínicas — cada conta owner é dona de uma clínica virtual.
create table if not exists public.clinics (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'Minha Clínica',
  created_at timestamptz not null default timezone('utc', now())
);

-- 2. Membros — usuários convidados e seu role.
create table if not exists public.clinic_members (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'equipe'
              check (role in ('admin', 'gestao', 'equipe')),
  invited_by  uuid references auth.users(id),
  created_at  timestamptz not null default timezone('utc', now()),
  unique (clinic_id, user_id)
);

-- 3. RLS das novas tabelas.
alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;

do $$ begin
  begin
    create policy "Clinics owner" on public.clinics
      for all to authenticated
      using (auth.uid() = owner_id)
      with check (auth.uid() = owner_id);
  exception when duplicate_object then null; end;

  begin
    -- Admin (owner) gerencia membros da sua clínica.
    create policy "Clinic members admin" on public.clinic_members
      for all to authenticated
      using (
        clinic_id in (select id from public.clinics where owner_id = auth.uid())
      )
      with check (
        clinic_id in (select id from public.clinics where owner_id = auth.uid())
      );
  exception when duplicate_object then null; end;

  begin
    -- Membros veem o próprio registro.
    create policy "Clinic members self" on public.clinic_members
      for select to authenticated
      using (user_id = auth.uid());
  exception when duplicate_object then null; end;
end $$;

-- 4. Função helper: retorna o user_id do owner dos dados para o usuário logado.
--    Owner → próprio user_id. Membro → user_id do owner da clínica.
create or replace function public.data_owner_id()
returns uuid language sql stable security definer as $$
  select coalesce(
    (select owner_id from public.clinics where owner_id = auth.uid() limit 1),
    (select c.owner_id
     from public.clinic_members cm
     join public.clinics c on c.id = cm.clinic_id
     where cm.user_id = auth.uid()
     limit 1)
  )
$$;

-- 5. RPC para buscar user_id por e-mail (usada na aba Equipe de Settings).
create or replace function public.get_user_id_by_email(lookup_email text)
returns uuid language sql security definer as $$
  select id from auth.users
  where lower(email) = lower(lookup_email)
  limit 1
$$;

-- 6. Atualizar RLS de patients para aceitar membros da mesma clínica.
drop policy if exists "Patients own rows" on public.patients;

do $$ begin
  begin
    create policy "Patients clinic access" on public.patients
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- 7. Índices para performance.
create index if not exists idx_clinic_members_user  on public.clinic_members(user_id);
create index if not exists idx_clinic_members_clinic on public.clinic_members(clinic_id);
create index if not exists idx_clinics_owner         on public.clinics(owner_id);
