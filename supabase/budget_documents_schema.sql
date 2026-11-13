-- Spec: docs/superpowers/plans/2026-11-13-biblioteca-orcamento-pdf.md
-- Biblioteca de orcamento PDF por paciente, versionada e imutavel. Reusa o padrao de
-- reserva-antes-do-upload de clinical_assets_schema.sql, mas SEM has_clinical_access(),
-- porque o Jonas (perfil Equipe/Concierge) precisa usar e nao tem acesso clinico.

begin;

create extension if not exists pgcrypto;

create table if not exists public.budget_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  version integer not null check (version >= 1),
  bucket_id text not null default 'budget-documents' check (bucket_id = 'budget-documents'),
  object_path text not null unique,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  expected_mime_type text not null default 'application/pdf' check (expected_mime_type = 'application/pdf'),
  expected_file_size bigint not null check (expected_file_size between 1 and 10485760),
  observed_mime_type text,
  file_size bigint,
  client_sha256 text not null check (client_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'uploading' check (status in ('uploading', 'available', 'failed', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  failed_at timestamptz,
  archived_at timestamptz,
  unique (user_id, patient_id, version)
);

alter table public.budget_documents enable row level security;

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'budget_documents'
  loop
    execute format('drop policy if exists %I on public.budget_documents', policy_row.policyname);
  end loop;
end $$;

-- Sem has_clinical_access(): qualquer membro da clinica (Admin/Gestao/Equipe) acessa,
-- igual ja vale para 'sales'/'patients'/'funnel' em src/lib/roleAccess.js.
create policy "Budget documents clinic read"
on public.budget_documents
for select to authenticated
using (user_id = public.data_owner_id());

revoke insert, update, delete on public.budget_documents from anon, authenticated;
grant select on public.budget_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('budget-documents', 'budget-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "budget-documents authorized insert" on storage.objects;
drop policy if exists "budget-documents authorized select" on storage.objects;

create policy "budget-documents authorized insert"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'budget-documents'
  and exists (
    select 1 from public.budget_documents doc
    where doc.object_path = name
      and doc.user_id = public.data_owner_id()
      and doc.created_by = auth.uid()
      and doc.status = 'uploading'
  )
);

create policy "budget-documents authorized select"
on storage.objects
for select to authenticated
using (
  bucket_id = 'budget-documents'
  and exists (
    select 1 from public.budget_documents doc
    where doc.object_path = name
      and doc.user_id = public.data_owner_id()
      and doc.status in ('available', 'archived')
  )
);

-- Imutavel: nenhuma versao e sobrescrita; so a transicao de status e permitida.
create or replace function public.protect_budget_document_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Orcamentos nao podem ser apagados.' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.patient_id is distinct from old.patient_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.created_by is distinct from old.created_by
    or new.version is distinct from old.version
    or new.bucket_id is distinct from old.bucket_id
    or new.object_path is distinct from old.object_path
    or new.file_name is distinct from old.file_name
    or new.expected_mime_type is distinct from old.expected_mime_type
    or new.expected_file_size is distinct from old.expected_file_size
    or new.client_sha256 is distinct from old.client_sha256
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Metadados do orcamento sao imutaveis.' using errcode = '55000';
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
    if new.archived_at is null then
      raise exception 'Arquivamento invalido.' using errcode = '55000';
    end if;
  elsif old.status = 'archived' and new.status = 'available' then
    if new.archived_at is not null then
      raise exception 'Restauracao invalida.' using errcode = '55000';
    end if;
  else
    raise exception 'Transicao de orcamento invalida.' using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_budget_documents_protect on public.budget_documents;
create trigger trg_budget_documents_protect
before update or delete on public.budget_documents
for each row execute function public.protect_budget_document_mutation();

create or replace function public.create_budget_document_upload(
  p_patient_id uuid,
  p_opportunity_id uuid,
  p_file_name text,
  p_file_size bigint,
  p_client_sha256 text
)
returns table(document_id uuid, bucket_id text, object_path text, version integer)
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  owner_id uuid;
  next_id uuid := gen_random_uuid();
  next_version integer;
  next_path text;
begin
  if auth.uid() is null then
    raise exception 'Nao autenticado.' using errcode = '42501';
  end if;
  owner_id := public.data_owner_id();
  if not exists (select 1 from public.patients where id = p_patient_id and user_id = owner_id) then
    raise exception 'Paciente fora do escopo da clinica.' using errcode = '42501';
  end if;
  if p_opportunity_id is not null and not exists (
    select 1 from public.opportunities where id = p_opportunity_id and user_id = owner_id and patient_id = p_patient_id
  ) then
    raise exception 'Oportunidade fora do escopo do paciente.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_file_name, ''))) not between 1 and 255 then
    raise exception 'Nome de arquivo invalido.' using errcode = '22023';
  end if;
  if p_file_size not between 1 and 10485760 then
    raise exception 'Arquivo deve ter entre 1 byte e 10 MB.' using errcode = '22023';
  end if;
  if coalesce(p_client_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash do arquivo invalido.' using errcode = '22023';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.budget_documents where user_id = owner_id and patient_id = p_patient_id;

  next_path := owner_id::text || '/' || p_patient_id::text || '/' || next_id::text || '/orcamento.pdf';

  insert into public.budget_documents(
    id, user_id, patient_id, opportunity_id, created_by, version,
    object_path, file_name, expected_file_size, client_sha256
  ) values (
    next_id, owner_id, p_patient_id, p_opportunity_id, auth.uid(), next_version,
    next_path, btrim(p_file_name), p_file_size, p_client_sha256
  );
  return query select next_id, 'budget-documents'::text, next_path, next_version;
end;
$$;

create or replace function public.complete_budget_document_upload(p_document_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  target public.budget_documents;
  object_metadata jsonb;
  observed_size bigint;
  observed_mime text;
begin
  if auth.uid() is null then
    raise exception 'Nao autenticado.' using errcode = '42501';
  end if;
  select * into target from public.budget_documents
  where id = p_document_id and user_id = public.data_owner_id() and created_by = auth.uid()
  for update;
  if target.id is null or target.status <> 'uploading' then
    raise exception 'Upload de orcamento indisponivel para conclusao.' using errcode = '22023';
  end if;
  select metadata into object_metadata from storage.objects
  where bucket_id = target.bucket_id and name = target.object_path;
  if object_metadata is null then
    raise exception 'O arquivo ainda nao foi recebido pelo Storage.' using errcode = '22023';
  end if;
  observed_size := nullif(object_metadata ->> 'size', '')::bigint;
  observed_mime := nullif(object_metadata ->> 'mimetype', '');
  if observed_size is distinct from target.expected_file_size or observed_mime is distinct from 'application/pdf' then
    update public.budget_documents set status = 'failed', failed_at = timezone('utc', now()) where id = target.id;
    return false;
  end if;
  update public.budget_documents set status = 'available', completed_at = timezone('utc', now()),
    file_size = observed_size, observed_mime_type = observed_mime where id = target.id;
  return true;
end;
$$;

create or replace function public.set_budget_document_archived(p_document_id uuid, p_archived boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare target public.budget_documents;
begin
  if auth.uid() is null then
    raise exception 'Nao autenticado.' using errcode = '42501';
  end if;
  select * into target from public.budget_documents
  where id = p_document_id and user_id = public.data_owner_id()
    and status = case when p_archived then 'available' else 'archived' end
  for update;
  if target.id is null then return false; end if;
  update public.budget_documents set
    status = case when p_archived then 'archived' else 'available' end,
    archived_at = case when p_archived then timezone('utc', now()) else null end
  where id = target.id;
  return true;
end;
$$;

revoke all on function public.create_budget_document_upload(uuid, uuid, text, bigint, text) from public, anon;
revoke all on function public.complete_budget_document_upload(uuid) from public, anon;
revoke all on function public.set_budget_document_archived(uuid, boolean) from public, anon;
grant execute on function public.create_budget_document_upload(uuid, uuid, text, bigint, text) to authenticated;
grant execute on function public.complete_budget_document_upload(uuid) to authenticated;
grant execute on function public.set_budget_document_archived(uuid, boolean) to authenticated;

-- "Arquivar" exige Admin/Gestao (a spec restringe quem pode esconder uma versao enviada por
-- engano); fica a cargo do app checar o papel antes de chamar set_budget_document_archived com
-- p_archived = true — a RPC em si nao distingue papel porque roleAccess.js e um controle de
-- frontend/app, nao uma tabela de papel consultavel aqui sem acoplar a outro schema.

create index if not exists idx_budget_documents_patient on public.budget_documents(user_id, patient_id, version desc);
create index if not exists idx_budget_documents_opportunity on public.budget_documents(opportunity_id) where opportunity_id is not null;

comment on table public.budget_documents is
  'Biblioteca de orcamento PDF por paciente, versionada e imutavel. Nao gera lancamento financeiro.';

commit;
