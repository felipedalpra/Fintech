-- Reproduz e corrige a regressão de 2026-11-12: Sumary (perfil Equipe, sem acesso
-- financeiro) ganhou a tela de Cirurgias (ROLE_ACCESS.equipe, fix anterior desta sessão),
-- mas a RLS de financial_entries só liberava INSERT de origem 'surgery' para o concierge.
-- Resultado real: "new row violates row-level security policy for table financial_entries"
-- ao salvar uma cirurgia com perfil Equipe.
--
-- Este script PROVA o bug (a seção 1 falha com a função antiga) e PROVA o fix (a seção 2
-- passa com a função corrigida) — a única mudança entre as duas é a função
-- financial_source_allowed_for_current_user ganhar 'equipe' na checagem de 'surgery',
-- igual ao que já existia para 'consultation'/'product_sale'/'product_purchase'.
--
-- Executar somente em banco local descartável e vazio:
--   createdb surgimetrics_finance_role_surgery_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_finance_role_surgery_test -f tests/postgres/financeRoleAccessSurgery.spec.sql
--   dropdb surgimetrics_finance_role_surgery_test

\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

-- Recorte mínimo e fiel do que access_control_schema.sql e financial_ledger_schema.sql
-- já têm em produção: clinics/clinic_members reais, data_owner_id() real, surgeries e
-- financial_entries reduzidas às colunas que a RLS em teste usa.
create table public.clinics(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id)
);
create table public.clinic_members(
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('admin','gestao','concierge','equipe'))
);
create table public.surgeries(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id)
);
create table public.financial_entries(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source_type text not null,
  source_id uuid not null
);
alter table public.financial_entries enable row level security;
-- No Supabase real o papel `authenticated` já tem privilégio de tabela amplo; aqui concedemos
-- à mão (RLS é a única coisa em teste — sem isto toda consulta cai em "permission denied"
-- antes mesmo de chegar na policy).
grant select, insert, update, delete on public.financial_entries to authenticated;
grant select on public.clinics, public.clinic_members, public.surgeries to authenticated;

create or replace function public.data_owner_id()
returns uuid language sql stable security definer as $$
  select coalesce(
    (select owner_id from public.clinics where owner_id = auth.uid() limit 1),
    (select c.owner_id from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id where cm.user_id = auth.uid() limit 1)
  )
$$;

create or replace function public.finance_role_can_manage()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    auth.uid() = public.data_owner_id()
    or exists (
      select 1 from public.clinic_members member join public.clinics clinic on clinic.id = member.clinic_id
      where member.user_id = auth.uid() and clinic.owner_id = public.data_owner_id() and member.role in ('admin', 'gestao')
    ),
    false
  )
$$;

-- Dados: Dra. Vitória (owner) e a cirurgia; Sumary como membro 'equipe' da clínica.
insert into auth.users values ('00000000-0000-0000-0000-000000000001'); -- Dra. Vitória
insert into auth.users values ('00000000-0000-0000-0000-000000000002'); -- Sumary
insert into public.clinics (id, owner_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');
insert into public.clinic_members (clinic_id, user_id, role) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'equipe');
insert into public.surgeries (id, user_id) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');

-- ===================================================================================
-- Seção 1 — função ANTIGA (só concierge pode inserir financial_entries de cirurgia):
-- deve FALHAR para Sumary (equipe), reproduzindo o bug relatado.
-- ===================================================================================
create or replace function public.financial_source_allowed_for_current_user(source_kind text, source_record_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  member_role text;
  owner_now uuid := public.data_owner_id();
begin
  if owner_now is null or auth.uid() is null then return false; end if;
  if public.finance_role_can_manage() then return true; end if;
  select member.role into member_role from public.clinic_members member join public.clinics clinic on clinic.id = member.clinic_id
    where member.user_id = auth.uid() and clinic.owner_id = owner_now limit 1;
  if source_kind = 'surgery' and member_role = 'concierge' then
    return exists (select 1 from public.surgeries source where source.id = source_record_id and source.user_id = owner_now);
  end if;
  return false;
end;
$$;

drop policy if exists "Financial entries role insert" on public.financial_entries;
create policy "Financial entries role insert" on public.financial_entries for insert to authenticated
  with check (user_id = public.data_owner_id() and public.financial_source_allowed_for_current_user(source_type, source_id));

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false); -- Sumary

do $$
begin
  begin
    insert into public.financial_entries (user_id, source_type, source_id)
      values ('00000000-0000-0000-0000-000000000001', 'surgery', '20000000-0000-0000-0000-000000000001');
    raise exception 'BUG NAO REPRODUZIDO: Sumary (equipe) conseguiu inserir com a função antiga — esperava falha de RLS';
  exception when insufficient_privilege then
    raise notice 'OK (bug reproduzido): Sumary (equipe) barrada pela RLS antiga, como no print do Felipe';
  end;
end $$;

reset role;

-- ===================================================================================
-- Seção 2 — função CORRIGIDA (equipe entra junto do concierge para 'surgery', igual já
-- valia para consultation/product_sale/product_purchase): deve PASSAR para Sumary.
-- ===================================================================================
create or replace function public.financial_source_allowed_for_current_user(source_kind text, source_record_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  member_role text;
  owner_now uuid := public.data_owner_id();
begin
  if owner_now is null or auth.uid() is null then return false; end if;
  if public.finance_role_can_manage() then return true; end if;
  select member.role into member_role from public.clinic_members member join public.clinics clinic on clinic.id = member.clinic_id
    where member.user_id = auth.uid() and clinic.owner_id = owner_now limit 1;
  if source_kind = 'surgery' and member_role in ('concierge', 'equipe') then
    return exists (select 1 from public.surgeries source where source.id = source_record_id and source.user_id = owner_now);
  end if;
  return false;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false); -- Sumary

do $$
begin
  insert into public.financial_entries (user_id, source_type, source_id)
    values ('00000000-0000-0000-0000-000000000001', 'surgery', '20000000-0000-0000-0000-000000000001');
  raise notice 'OK (fix comprovado): Sumary (equipe) agora consegue salvar o lançamento da cirurgia';
end $$;

reset role;

select 'PASSOU: bug reproduzido com a função antiga e corrigido com a função nova' as resultado;
