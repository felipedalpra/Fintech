-- Executar somente em banco local descartavel e vazio:
--   createdb surgimetrics_clinical_assets_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_clinical_assets_test -f tests/postgres/clinicalAssets.spec.sql

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create extension if not exists pgcrypto;
create schema auth;
create schema storage;

create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.clinics(id uuid primary key, owner_id uuid not null references auth.users(id), name text not null);
create table public.clinic_members(
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  clinical_access boolean not null default false
);
create table public.patients(id uuid primary key, user_id uuid not null references auth.users(id), full_name text not null);
create table public.clinical_consent_acceptances(
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  patient_id uuid not null references public.patients(id),
  consent_type text not null,
  title text not null,
  accepted_at timestamptz not null default timezone('utc', now()),
  respondent_name text not null
);
create table public.clinical_record_access_logs(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  patient_id uuid not null,
  actor_id uuid,
  action text not null
);

create table storage.buckets(
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects(
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  metadata jsonb
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text)
returns text[] language sql immutable
as $$ select string_to_array(name, '/') $$;

create or replace function public.data_owner_id()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select c.owner_id from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id where cm.user_id = auth.uid() limit 1),
    auth.uid()
  )
$$;
create or replace function public.has_clinical_access()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() = public.data_owner_id()
    or exists (
      select 1 from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
      where cm.user_id = auth.uid() and cm.clinical_access is true and c.owner_id = public.data_owner_id()
    )
$$;

grant usage on schema public, storage to authenticated;
grant select on public.patients, public.clinical_consent_acceptances to authenticated;
grant select, insert on storage.objects to authenticated;

\ir ../../supabase/clinical_assets_schema.sql

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');
insert into public.clinics(id, owner_id, name) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Clínica A'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'Clínica B');
insert into public.clinic_members(clinic_id, user_id, clinical_access) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', true);
insert into public.patients(id, user_id, full_name) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Paciente A'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'Paciente B');
insert into public.clinical_consent_acceptances(id, user_id, patient_id, consent_type, title, respondent_name) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'image', 'Uso de imagem A', 'Paciente A'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'image', 'Uso de imagem B', 'Paciente B');

-- Um membro clínico reserva o metadado antes de enviar o arquivo ao bucket privado.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select asset_id::text as asset_id, bucket_id, object_path
from public.create_clinical_asset_upload(
  '30000000-0000-4000-8000-000000000001', 'clinical_photo', 'before', current_date,
  'Abdômen', 'Abdominoplastia', 'Registro pré-operatório', 'antes.png', 'image/png', 68,
  repeat('a', 64), '40000000-0000-4000-8000-000000000001'
) \gset
select set_config('test.asset_id', :'asset_id', false);
select set_config('test.asset_path', :'object_path', false);

insert into storage.objects(bucket_id, name, metadata)
values (:'bucket_id', :'object_path', '{"size":68,"mimetype":"image/png"}'::jsonb);

select public.complete_clinical_asset_upload(:'asset_id'::uuid) as completed \gset
select set_config('test.asset_completed', :'completed', false);
do $$
begin
  if current_setting('test.asset_completed') <> 't' then raise exception 'Upload válido não foi concluído.'; end if;
  if (select status from public.clinical_assets where id = current_setting('test.asset_id')::uuid) <> 'available' then
    raise exception 'Ativo não ficou disponível.';
  end if;
end $$;

-- Metadado incompleto do Storage falha fechado; não fica disponível por inferência do MIME esperado.
select asset_id::text as bad_asset_id, bucket_id as bad_bucket_id, object_path as bad_object_path
from public.create_clinical_asset_upload(
  '30000000-0000-4000-8000-000000000001', 'document', 'neutral', current_date,
  null, 'Laudo', null, 'laudo.pdf', 'application/pdf', 10, repeat('c', 64), null
) \gset
insert into storage.objects(bucket_id, name, metadata)
values (:'bad_bucket_id', :'bad_object_path', '{"size":10}'::jsonb);
select public.complete_clinical_asset_upload(:'bad_asset_id'::uuid) as bad_completed \gset
select set_config('test.bad_asset_id', :'bad_asset_id', false);
select set_config('test.bad_completed', :'bad_completed', false);
do $$
begin
  if current_setting('test.bad_completed') <> 'f' then raise exception 'Era esperado rejeitar objeto sem MIME observado.'; end if;
  if (select status from public.clinical_assets where id = current_setting('test.bad_asset_id')::uuid) <> 'failed' then
    raise exception 'Objeto inválido não ficou bloqueado.';
  end if;
end $$;

-- Aceite de outra clínica/paciente nunca pode ser associado à foto.
do $$
begin
  begin
    perform public.create_clinical_asset_upload(
      '30000000-0000-4000-8000-000000000001', 'clinical_photo', 'after', current_date,
      null, null, null, 'depois.png', 'image/png', 68, repeat('b', 64),
      '40000000-0000-4000-8000-000000000002'
    );
    raise exception 'Era esperado bloquear aceite fora do paciente.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Arquivar não remove o objeto e pode ser revertido.
select public.set_clinical_asset_archived(:'asset_id'::uuid, true);
do $$
begin
  if (select status from public.clinical_assets where id = current_setting('test.asset_id')::uuid) <> 'archived' then raise exception 'Arquivamento falhou.'; end if;
  if (select count(*) from storage.objects where name = current_setting('test.asset_path')) <> 1 then raise exception 'Arquivamento apagou o objeto.'; end if;
end $$;
select public.set_clinical_asset_archived(:'asset_id'::uuid, false);
select public.log_clinical_asset_access(:'asset_id'::uuid);
select public.log_clinical_asset_accesses(array[:'asset_id'::uuid]);

-- O frontend não possui UPDATE/DELETE direto mesmo dentro da clínica.
do $$
begin
  begin
    update public.clinical_assets set notes = 'Mutado' where id = current_setting('test.asset_id')::uuid;
    raise exception 'Era esperado revogar update direto.';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.clinical_assets where id = current_setting('test.asset_id')::uuid;
    raise exception 'Era esperado revogar delete direto.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Mesmo o executor da migration não consegue alterar metadados nem apagar o histórico por engano.
do $$
begin
  begin
    update public.clinical_assets set file_name = 'outro.png' where id = current_setting('test.asset_id')::uuid;
    raise exception 'Era esperado bloquear mutação de metadado.';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.clinical_assets where id = current_setting('test.asset_id')::uuid;
    raise exception 'Era esperado bloquear delete físico.';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- Outra clínica não enxerga índice, objeto privado nem pode auditá-lo.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$
begin
  if (select count(*) from public.clinical_assets) <> 0 then raise exception 'RLS expôs ativo cross-clínica.'; end if;
  if (select count(*) from storage.objects) <> 0 then raise exception 'RLS expôs objeto cross-clínica.'; end if;
  begin
    perform public.log_clinical_asset_access(current_setting('test.asset_id')::uuid);
    raise exception 'Era esperado bloquear auditoria cross-clínica.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Reaplicar preserva índice, objeto e histórico de auditoria.
\ir ../../supabase/clinical_assets_schema.sql
do $$
begin
  if (select count(*) from public.clinical_assets where id = current_setting('test.asset_id')::uuid and status = 'available') <> 1 then
    raise exception 'Reaplicação alterou o ativo.';
  end if;
  if (select count(*) from storage.objects where name = current_setting('test.asset_path')) <> 1 then raise exception 'Reaplicação alterou o objeto.'; end if;
  if (select count(*) from public.clinical_record_access_logs where action = 'view_clinical_asset') <> 2 then
    raise exception 'Auditoria do acesso não foi preservada.';
  end if;
end $$;

select 'clinical assets postgres tests passed' as result;
