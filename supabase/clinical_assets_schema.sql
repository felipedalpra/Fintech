-- Fase 4.4: fotos e documentos clinicos privados.
-- Executar depois de clinical_record_foundation_schema.sql e clinical_intake_consents_schema.sql.

begin;

create extension if not exists pgcrypto;

create table if not exists public.clinical_assets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  asset_kind text not null check (asset_kind in ('clinical_photo', 'document')),
  stage text not null check (stage in ('before', 'after', 'neutral')),
  captured_on date not null,
  region text check (region is null or length(region) <= 120),
  procedure_name text check (procedure_name is null or length(procedure_name) <= 160),
  notes text check (notes is null or length(notes) <= 2000),
  bucket_id text not null default 'clinical-assets' check (bucket_id = 'clinical-assets'),
  object_path text not null unique,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  expected_mime_type text not null check (expected_mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  expected_file_size bigint not null check (expected_file_size between 1 and 20971520),
  observed_mime_type text,
  file_size bigint,
  client_sha256 text not null check (client_sha256 ~ '^[0-9a-f]{64}$'),
  consent_acceptance_id uuid references public.clinical_consent_acceptances(id) on delete restrict,
  status text not null default 'uploading' check (status in ('uploading', 'available', 'failed', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  failed_at timestamptz,
  archived_at timestamptz,
  constraint clinical_assets_kind_stage check (asset_kind = 'clinical_photo' or stage = 'neutral'),
  constraint clinical_assets_consent_kind check (consent_acceptance_id is null or asset_kind = 'clinical_photo'),
  constraint clinical_assets_status_dates check (
    (status = 'uploading' and completed_at is null and failed_at is null and archived_at is null)
    or (status = 'available' and completed_at is not null and failed_at is null and archived_at is null)
    or (status = 'failed' and completed_at is null and failed_at is not null and archived_at is null)
    or (status = 'archived' and completed_at is not null and failed_at is null and archived_at is not null)
  )
);

alter table public.clinical_assets enable row level security;

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'clinical_assets'
  loop
    execute format('drop policy if exists %I on public.clinical_assets', policy_row.policyname);
  end loop;
end $$;

create policy "Clinical assets authorized read"
on public.clinical_assets
for select to authenticated
using (user_id = public.data_owner_id() and public.has_clinical_access());

revoke insert, update, delete on public.clinical_assets from anon, authenticated;
grant select on public.clinical_assets to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinical-assets', 'clinical-assets', false, 20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "clinical-assets authorized insert" on storage.objects;
drop policy if exists "clinical-assets authorized select" on storage.objects;
drop policy if exists "clinical-assets authorized update" on storage.objects;
drop policy if exists "clinical-assets authorized delete" on storage.objects;

create policy "clinical-assets authorized insert"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'clinical-assets'
  and exists (
    select 1 from public.clinical_assets asset
    where asset.object_path = name
      and asset.user_id = public.data_owner_id()
      and asset.patient_id::text = (storage.foldername(name))[2]
      and asset.created_by = auth.uid()
      and asset.status = 'uploading'
      and public.has_clinical_access()
  )
);

create policy "clinical-assets authorized select"
on storage.objects
for select to authenticated
using (
  bucket_id = 'clinical-assets'
  and exists (
    select 1 from public.clinical_assets asset
    where asset.object_path = name
      and asset.user_id = public.data_owner_id()
      and asset.status in ('available', 'archived')
      and public.has_clinical_access()
  )
);

create or replace function public.protect_clinical_asset_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Ativos clinicos nao podem ser apagados.' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.patient_id is distinct from old.patient_id
    or new.created_by is distinct from old.created_by
    or new.asset_kind is distinct from old.asset_kind
    or new.stage is distinct from old.stage
    or new.captured_on is distinct from old.captured_on
    or new.region is distinct from old.region
    or new.procedure_name is distinct from old.procedure_name
    or new.notes is distinct from old.notes
    or new.bucket_id is distinct from old.bucket_id
    or new.object_path is distinct from old.object_path
    or new.file_name is distinct from old.file_name
    or new.expected_mime_type is distinct from old.expected_mime_type
    or new.expected_file_size is distinct from old.expected_file_size
    or new.client_sha256 is distinct from old.client_sha256
    or new.consent_acceptance_id is distinct from old.consent_acceptance_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Metadados de ativos clinicos sao imutaveis.' using errcode = '55000';
  end if;

  if old.status = 'uploading' and new.status = 'available' then
    if new.completed_at is null or new.file_size is null or new.observed_mime_type is null
      or new.failed_at is not null or new.archived_at is not null then
      raise exception 'Conclusao de upload invalida.' using errcode = '55000';
    end if;
  elsif old.status = 'uploading' and new.status = 'failed' then
    if new.failed_at is null or new.completed_at is not null or new.archived_at is not null then
      raise exception 'Falha de upload invalida.' using errcode = '55000';
    end if;
  elsif old.status = 'available' and new.status = 'archived' then
    if new.archived_at is null or new.completed_at is distinct from old.completed_at
      or new.file_size is distinct from old.file_size
      or new.observed_mime_type is distinct from old.observed_mime_type then
      raise exception 'Arquivamento invalido.' using errcode = '55000';
    end if;
  elsif old.status = 'archived' and new.status = 'available' then
    if new.archived_at is not null or new.completed_at is distinct from old.completed_at
      or new.file_size is distinct from old.file_size
      or new.observed_mime_type is distinct from old.observed_mime_type then
      raise exception 'Restauracao invalida.' using errcode = '55000';
    end if;
  else
    raise exception 'Transicao de ativo clinico invalida.' using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_clinical_assets_protect on public.clinical_assets;
create trigger trg_clinical_assets_protect
before update or delete on public.clinical_assets
for each row execute function public.protect_clinical_asset_mutation();

create or replace function public.create_clinical_asset_upload(
  p_patient_id uuid,
  p_asset_kind text,
  p_stage text,
  p_captured_on date,
  p_region text,
  p_procedure_name text,
  p_notes text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_client_sha256 text,
  p_consent_acceptance_id uuid default null
)
returns table(asset_id uuid, bucket_id text, object_path text)
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  owner_id uuid;
  next_id uuid := gen_random_uuid();
  extension text;
  next_path text;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  owner_id := public.data_owner_id();
  if not exists (select 1 from public.patients where id = p_patient_id and user_id = owner_id) then
    raise exception 'Paciente fora do escopo da clinica.' using errcode = '42501';
  end if;
  if p_asset_kind not in ('clinical_photo', 'document')
    or p_stage not in ('before', 'after', 'neutral')
    or (p_asset_kind = 'document' and p_stage <> 'neutral') then
    raise exception 'Tipo ou etapa do ativo invalido.' using errcode = '22023';
  end if;
  if p_captured_on is null or p_captured_on > current_date then
    raise exception 'Data do ativo invalida.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_file_name, ''))) not between 1 and 255
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    or p_file_size not between 1 and 20971520
    or coalesce(p_client_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Arquivo clinico invalido.' using errcode = '22023';
  end if;
  if (p_asset_kind = 'clinical_photo' and p_mime_type = 'application/pdf')
    or (p_asset_kind = 'document' and p_mime_type <> 'application/pdf') then
    raise exception 'O tipo do arquivo nao corresponde ao ativo.' using errcode = '22023';
  end if;
  if length(coalesce(p_region, '')) > 120 or length(coalesce(p_procedure_name, '')) > 160
    or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Metadados acima do limite permitido.' using errcode = '22023';
  end if;
  if p_consent_acceptance_id is not null and not exists (
    select 1 from public.clinical_consent_acceptances consent
    where consent.id = p_consent_acceptance_id
      and consent.user_id = owner_id
      and consent.patient_id = p_patient_id
      and consent.consent_type = 'image'
  ) then
    raise exception 'Aceite de imagem fora do escopo do paciente.' using errcode = '42501';
  end if;
  if p_asset_kind <> 'clinical_photo' and p_consent_acceptance_id is not null then
    raise exception 'Aceite de imagem so pode ser vinculado a foto clinica.' using errcode = '22023';
  end if;

  extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    else 'pdf'
  end;
  next_path := owner_id::text || '/' || p_patient_id::text || '/' || next_id::text || '/original.' || extension;

  insert into public.clinical_assets(
    id, user_id, patient_id, created_by, asset_kind, stage, captured_on,
    region, procedure_name, notes, object_path, file_name, expected_mime_type,
    expected_file_size, client_sha256, consent_acceptance_id
  ) values (
    next_id, owner_id, p_patient_id, auth.uid(), p_asset_kind, p_stage, p_captured_on,
    nullif(btrim(coalesce(p_region, '')), ''), nullif(btrim(coalesce(p_procedure_name, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), next_path, btrim(p_file_name), p_mime_type,
    p_file_size, p_client_sha256, p_consent_acceptance_id
  );
  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, p_patient_id, auth.uid(), 'create_clinical_asset_upload');
  return query select next_id, 'clinical-assets'::text, next_path;
end;
$$;

create or replace function public.complete_clinical_asset_upload(p_asset_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  target public.clinical_assets;
  object_metadata jsonb;
  observed_size bigint;
  observed_mime text;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  select * into target from public.clinical_assets
  where id = p_asset_id and user_id = public.data_owner_id() and created_by = auth.uid()
  for update;
  if target.id is null or target.status <> 'uploading' then
    raise exception 'Upload clinico indisponivel para conclusao.' using errcode = '22023';
  end if;
  select metadata into object_metadata from storage.objects
  where bucket_id = target.bucket_id and name = target.object_path;
  if object_metadata is null then
    raise exception 'O arquivo ainda nao foi recebido pelo Storage.' using errcode = '22023';
  end if;
  observed_size := nullif(object_metadata ->> 'size', '')::bigint;
  observed_mime := nullif(object_metadata ->> 'mimetype', '');
  if observed_size is distinct from target.expected_file_size or observed_mime is distinct from target.expected_mime_type then
    update public.clinical_assets set status = 'failed', failed_at = timezone('utc', now()) where id = target.id;
    insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
    values (target.user_id, target.patient_id, auth.uid(), 'fail_clinical_asset_upload');
    return false;
  end if;
  update public.clinical_assets set status = 'available', completed_at = timezone('utc', now()),
    file_size = observed_size, observed_mime_type = observed_mime where id = target.id;
  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (target.user_id, target.patient_id, auth.uid(), 'complete_clinical_asset_upload');
  return true;
end;
$$;

create or replace function public.fail_clinical_asset_upload(p_asset_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare target public.clinical_assets;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  select * into target from public.clinical_assets
  where id = p_asset_id and user_id = public.data_owner_id() and created_by = auth.uid() and status = 'uploading'
  for update;
  if target.id is null then return false; end if;
  update public.clinical_assets set status = 'failed', failed_at = timezone('utc', now()) where id = target.id;
  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (target.user_id, target.patient_id, auth.uid(), 'fail_clinical_asset_upload');
  return true;
end;
$$;

create or replace function public.set_clinical_asset_archived(p_asset_id uuid, p_archived boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare target public.clinical_assets;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  select * into target from public.clinical_assets
  where id = p_asset_id and user_id = public.data_owner_id()
    and status = case when p_archived then 'available' else 'archived' end
  for update;
  if target.id is null then return false; end if;
  update public.clinical_assets set
    status = case when p_archived then 'archived' else 'available' end,
    archived_at = case when p_archived then timezone('utc', now()) else null end
  where id = target.id;
  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (target.user_id, target.patient_id, auth.uid(), case when p_archived then 'archive_clinical_asset' else 'restore_clinical_asset' end);
  return true;
end;
$$;

create or replace function public.log_clinical_asset_access(p_asset_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare target public.clinical_assets;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  select * into target from public.clinical_assets
  where id = p_asset_id and user_id = public.data_owner_id() and status in ('available', 'archived');
  if target.id is null then raise exception 'Ativo clinico indisponivel.' using errcode = '42501'; end if;
  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (target.user_id, target.patient_id, auth.uid(), 'view_clinical_asset');
  return true;
end;
$$;

create or replace function public.log_clinical_asset_accesses(p_asset_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_asset_id uuid;
  logged_count integer := 0;
begin
  if cardinality(coalesce(p_asset_ids, array[]::uuid[])) > 200 then
    raise exception 'Limite de ativos por auditoria excedido.' using errcode = '22023';
  end if;
  foreach next_asset_id in array coalesce(p_asset_ids, array[]::uuid[]) loop
    if next_asset_id is null then
      raise exception 'Identificador de ativo invalido.' using errcode = '22023';
    end if;
    perform public.log_clinical_asset_access(next_asset_id);
    logged_count := logged_count + 1;
  end loop;
  return logged_count;
end;
$$;

alter table public.clinical_record_access_logs drop constraint if exists clinical_record_access_logs_action_check;
alter table public.clinical_record_access_logs add constraint clinical_record_access_logs_action_check check (action in (
  'view_record', 'create_record', 'create_addendum', 'create_anamnesis', 'create_document',
  'create_intake_request', 'view_intake_response', 'create_clinical_asset_upload',
  'complete_clinical_asset_upload', 'fail_clinical_asset_upload', 'archive_clinical_asset',
  'restore_clinical_asset', 'view_clinical_asset'
));

revoke all on function public.create_clinical_asset_upload(uuid, text, text, date, text, text, text, text, text, bigint, text, uuid) from public, anon;
revoke all on function public.complete_clinical_asset_upload(uuid) from public, anon;
revoke all on function public.fail_clinical_asset_upload(uuid) from public, anon;
revoke all on function public.set_clinical_asset_archived(uuid, boolean) from public, anon;
revoke all on function public.log_clinical_asset_access(uuid) from public, anon;
revoke all on function public.log_clinical_asset_accesses(uuid[]) from public, anon;
grant execute on function public.create_clinical_asset_upload(uuid, text, text, date, text, text, text, text, text, bigint, text, uuid) to authenticated;
grant execute on function public.complete_clinical_asset_upload(uuid) to authenticated;
grant execute on function public.fail_clinical_asset_upload(uuid) to authenticated;
grant execute on function public.set_clinical_asset_archived(uuid, boolean) to authenticated;
grant execute on function public.log_clinical_asset_access(uuid) to authenticated;
grant execute on function public.log_clinical_asset_accesses(uuid[]) to authenticated;

create index if not exists idx_clinical_assets_patient on public.clinical_assets(user_id, patient_id, captured_on desc, created_at desc);
create index if not exists idx_clinical_assets_consent on public.clinical_assets(consent_acceptance_id) where consent_acceptance_id is not null;

comment on table public.clinical_assets is
  'Indice imutavel de fotos e anexos clinicos privados. Arquivamento preserva o objeto original.';

commit;
