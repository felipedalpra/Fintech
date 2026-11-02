-- Executar somente em banco local descartavel e vazio:
--   createdb surgimetrics_whatsapp_rls_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_whatsapp_rls_test \
--     -f tests/postgres/whatsappRlsPerformance.spec.sql

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

create table public.clinics(
  id uuid primary key,
  owner_id uuid not null references auth.users(id)
);
create table public.clinic_members(
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  member_email text,
  role text not null
);

create or replace function public.data_owner_id()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select c.owner_id
     from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
     where cm.user_id = auth.uid()
     limit 1),
    (select c.owner_id from public.clinics c where c.owner_id = auth.uid() limit 1),
    auth.uid()
  )
$$;

create table public.whatsapp_numbers(
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  label text not null
);
create table public.whatsapp_messages(
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  whatsapp_number_id uuid references public.whatsapp_numbers(id),
  body text
);
alter table public.whatsapp_numbers enable row level security;
alter table public.whatsapp_messages enable row level security;
create publication supabase_realtime;

\ir ../../supabase/whatsapp_ownership_schema.sql
\ir ../../supabase/whatsapp_rls_performance.sql

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_messages'
  ) then raise exception 'whatsapp_messages nao entrou na publication realtime.'; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_numbers'
  ) then raise exception 'whatsapp_numbers nao entrou na publication realtime.'; end if;
end $$;

grant select, insert, update, delete on public.whatsapp_numbers to authenticated;
grant select on public.whatsapp_messages to authenticated;

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000004');
insert into public.clinics(id, owner_id) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id, user_id, member_email, role) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'admin@example.test', 'admin'),
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'responsavel@example.test', 'team'),
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'equipe@example.test', 'team');
insert into public.whatsapp_numbers(id, user_id, label, assigned_user_id) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Recepcao', '20000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Comercial', null);
insert into public.whatsapp_messages(id, user_id, whatsapp_number_id, body) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'atribuida'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'somente admin'),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', null, 'legada');

-- Owner e admin veem toda a clinica.
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
do $$ begin
  if (select count(*) from public.whatsapp_numbers) <> 2 then raise exception 'Owner perdeu acesso a numeros.'; end if;
  if (select count(*) from public.whatsapp_messages) <> 3 then raise exception 'Owner perdeu acesso a mensagens.'; end if;
end $$;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
do $$ begin
  if (select count(*) from public.whatsapp_numbers) <> 2 then raise exception 'Admin perdeu acesso a numeros.'; end if;
  if (select count(*) from public.whatsapp_messages) <> 3 then raise exception 'Admin perdeu acesso a mensagens.'; end if;
end $$;

-- Responsavel ve somente seu numero e as mensagens legadas preservadas.
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
do $$ begin
  if (select count(*) from public.whatsapp_numbers) <> 1 then raise exception 'Responsavel viu escopo incorreto de numeros.'; end if;
  if (select count(*) from public.whatsapp_messages) <> 2 then raise exception 'Responsavel viu escopo incorreto de mensagens.'; end if;
end $$;

-- Membro sem atribuicao nao ve numeros, mas ainda ve a linha legada sem numero por compatibilidade.
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000003';
do $$ begin
  if (select count(*) from public.whatsapp_numbers) <> 0 then raise exception 'Membro sem atribuicao viu numero.'; end if;
  if (select count(*) from public.whatsapp_messages) <> 1 then raise exception 'Compatibilidade da mensagem legada mudou.'; end if;
end $$;

-- Usuario fora da clinica nao ve nenhuma linha.
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000004';
do $$ begin
  if (select count(*) from public.whatsapp_numbers) <> 0 then raise exception 'Usuario externo viu numero.'; end if;
  if (select count(*) from public.whatsapp_messages) <> 0 then raise exception 'Usuario externo viu mensagem.'; end if;
end $$;
reset role;

-- Reatribuicao revoga o membro anterior e libera o novo sem alterar o historico.
update public.whatsapp_numbers
set assigned_user_id = '20000000-0000-4000-8000-000000000003'
where id = '40000000-0000-4000-8000-000000000001';

set role authenticated;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
do $$ begin
  if (select count(*) from public.whatsapp_numbers) <> 0 then raise exception 'Acesso antigo ao numero nao foi revogado.'; end if;
  if (select count(*) from public.whatsapp_messages) <> 1 then raise exception 'Acesso antigo ao historico nao foi revogado.'; end if;
end $$;
set request.jwt.claim.sub = '20000000-0000-4000-8000-000000000003';
do $$ begin
  if (select count(*) from public.whatsapp_numbers) <> 1 then raise exception 'Novo responsavel nao recebeu o numero.'; end if;
  if (select count(*) from public.whatsapp_messages) <> 2 then raise exception 'Novo responsavel nao recebeu o historico.'; end if;
end $$;
reset role;

-- Anonimo nao recebe privilegio de leitura.
set role anon;
do $$
begin
  begin
    perform count(*) from public.whatsapp_messages;
    raise exception 'Anonimo conseguiu consultar mensagens.';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

select 'whatsapp rls performance ok' as result;
