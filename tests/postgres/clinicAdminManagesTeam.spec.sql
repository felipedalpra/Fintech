-- Executar somente em banco local descartavel e vazio:
--   createdb surgimetrics_clinic_admin_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_clinic_admin_test \
--     -f tests/postgres/clinicAdminManagesTeam.spec.sql

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- vitoria = dona; augusto = admin MEMBRO; jonas = equipe; estranho = outra clinica (dono).
insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002'),
  ('30000000-0000-4000-8000-000000000003'),
  ('40000000-0000-4000-8000-000000000004');

create table public.clinics(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text,
  created_at timestamptz not null default now()
);

create table public.clinic_members(
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  role text not null,
  member_email text,
  clinical_access boolean not null default false,
  professional_name text,
  professional_registration text,
  professional_council text,
  created_at timestamptz not null default now(),
  unique (clinic_id, user_id)
);

insert into public.clinics(id, owner_id, name) values
  ('c1111111-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Clinica Vitoria'),
  ('c2222222-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000004', 'Outra Clinica');

insert into public.clinic_members(clinic_id, user_id, role, member_email) values
  ('c1111111-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'admin', 'vitoria@x.com'),
  ('c1111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'admin', 'augusto@x.com'),
  ('c1111111-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'equipe', 'jonas@x.com'),
  ('c2222222-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000004', 'admin', 'estranho@x.com');

-- Funcoes e policies de producao (recorte fiel de access_control_schema.sql).
create or replace function public.data_owner_id()
returns uuid language sql stable security definer as $$
  select coalesce(
    (select owner_id from public.clinics where owner_id = auth.uid() order by created_at limit 1),
    (select c.owner_id from public.clinic_members cm
     join public.clinics c on c.id = cm.clinic_id
     where cm.user_id = auth.uid() order by cm.created_at limit 1)
  )
$$;

create or replace function public.is_clinic_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clinics where owner_id = auth.uid())
      or exists (
        select 1 from public.clinic_members cm
        join public.clinics c on c.id = cm.clinic_id
        where cm.user_id = auth.uid() and cm.role = 'admin'
          and c.owner_id = public.data_owner_id()
      )
$$;

alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;

create policy "Clinics owner" on public.clinics for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Clinic members admin" on public.clinic_members for all to authenticated
  using (clinic_id in (select id from public.clinics where owner_id = auth.uid()))
  with check (clinic_id in (select id from public.clinics where owner_id = auth.uid()));
create policy "Clinic members self" on public.clinic_members for select to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on all tables in schema public to authenticated;

-- ANTES da migration: o admin-membro enxerga so a propria linha. Este e o bug relatado.
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
do $$
begin
  if (select count(*) from public.clinic_members) <> 1 then
    raise exception 'Fixture nao reproduziu o bug: admin-membro deveria ver so a propria linha.';
  end if;
end $$;
reset role;

\ir ../../supabase/clinic_admin_manages_team.sql

-- ---------------------------------------------------------------------------
-- 1. Admin-membro passa a ver a equipe inteira da SUA clinica, e so dela.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
do $$
begin
  if (select count(*) from public.clinic_members) <> 3 then
    raise exception 'Admin-membro nao enxergou a equipe inteira: %', (select count(*) from public.clinic_members);
  end if;
  if exists (select 1 from public.clinic_members where member_email = 'estranho@x.com') then
    raise exception 'Admin-membro enxergou membro de OUTRA clinica.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Admin-membro liga o acesso clinico de quem precisa preencher dados.
-- ---------------------------------------------------------------------------
do $$
begin
  update public.clinic_members set clinical_access = true
  where member_email = 'jonas@x.com';
  if not found then
    raise exception 'Admin-membro nao conseguiu liberar o acesso clinico do Jonas.';
  end if;
  if not (select clinical_access from public.clinic_members where member_email = 'jonas@x.com') then
    raise exception 'O acesso clinico do Jonas nao persistiu.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. A linha da DONA e intocavel para um admin-membro.
-- ---------------------------------------------------------------------------
do $$
begin
  update public.clinic_members set role = 'equipe' where member_email = 'vitoria@x.com';
  if found then
    raise exception 'Admin-membro rebaixou a dona da clinica.';
  end if;
  delete from public.clinic_members where member_email = 'vitoria@x.com';
  if found then
    raise exception 'Admin-membro removeu a dona da clinica.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Admin-membro convida e remove membro comum, mas nunca em outra clinica.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.clinic_members(clinic_id, user_id, role, member_email)
  values ('c1111111-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004', 'equipe', 'novo@x.com');

  delete from public.clinic_members where member_email = 'novo@x.com';
  if not found then
    raise exception 'Admin-membro nao conseguiu remover um membro comum.';
  end if;

  begin
    insert into public.clinic_members(clinic_id, user_id, role, member_email)
    values ('c2222222-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'admin', 'invasao@x.com');
    raise exception 'Admin-membro inseriu membro em OUTRA clinica.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Equipe comum NAO ganhou nada: continua vendo so a propria linha.
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '30000000-0000-4000-8000-000000000003';
do $$
begin
  if (select count(*) from public.clinic_members) <> 1 then
    raise exception 'Membro comum passou a enxergar a equipe: %', (select count(*) from public.clinic_members);
  end if;
  begin
    update public.clinic_members set clinical_access = true where member_email = 'augusto@x.com';
    if found then raise exception 'Membro comum alterou outro membro.'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 6. A dona continua com poder total, inclusive sobre a propria linha.
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
do $$
begin
  if (select count(*) from public.clinic_members) <> 3 then
    raise exception 'A dona perdeu visibilidade da equipe: %', (select count(*) from public.clinic_members);
  end if;
  update public.clinic_members set professional_name = 'Dra. Vitoria' where member_email = 'vitoria@x.com';
  if not found then
    raise exception 'A dona perdeu o controle da propria linha.';
  end if;
  update public.clinic_members set clinical_access = true where member_email = 'augusto@x.com';
  if not found then
    raise exception 'A dona perdeu o controle sobre um membro.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Dono de outra clinica continua isolado.
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '40000000-0000-4000-8000-000000000004';
do $$
begin
  if (select count(*) from public.clinic_members) <> 1 then
    raise exception 'Vazamento entre clinicas: %', (select count(*) from public.clinic_members);
  end if;
end $$;
reset role;

select 'clinicAdminManagesTeam: OK' as resultado;
