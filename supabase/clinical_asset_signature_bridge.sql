-- Permite assinar PDFs anexados ao prontuario usando o mesmo fluxo BRy dos
-- documentos emitidos. O PDF original continua em clinical_assets; a linha em
-- clinical_documents e somente o snapshot imutavel/auditavel da assinatura.
-- Executar depois de clinical_assets_schema.sql, clinical_documents_schema.sql
-- e clinical_signature_readiness_schema.sql.

begin;

alter table public.clinical_documents
  drop constraint if exists clinical_documents_document_type_check;

alter table public.clinical_documents
  add constraint clinical_documents_document_type_check
  check (document_type in ('exam_request', 'simple_prescription', 'uploaded_pdf'));

alter table public.clinical_documents
  add column if not exists source_asset_id uuid references public.clinical_assets(id) on delete restrict;

create unique index if not exists idx_clinical_documents_source_asset
  on public.clinical_documents(source_asset_id)
  where source_asset_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_documents'::regclass
      and conname = 'clinical_documents_uploaded_pdf_source'
  ) then
    alter table public.clinical_documents
      add constraint clinical_documents_uploaded_pdf_source
      check ((document_type = 'uploaded_pdf') = (source_asset_id is not null)) not valid;
  end if;
end $$;

alter table public.clinical_documents
  validate constraint clinical_documents_uploaded_pdf_source;

create or replace function public.prepare_clinical_asset_signature(p_asset_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid;
  target public.clinical_assets;
  resolved_patient record;
  resolved_author record;
  resolved_patient_address text;
  document_id uuid;
  payload jsonb;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;

  owner_id := public.data_owner_id();
  select * into target
  from public.clinical_assets asset
  where asset.id = p_asset_id
    and asset.user_id = owner_id
    and asset.created_by = auth.uid()
    and asset.asset_kind = 'document'
    and asset.expected_mime_type = 'application/pdf'
    and asset.observed_mime_type = 'application/pdf'
    and asset.status = 'available';

  if target.id is null then
    raise exception 'Somente o profissional que anexou um PDF disponivel pode envia-lo para assinatura.' using errcode = '42501';
  end if;

  select cd.id into document_id
  from public.clinical_documents cd
  where cd.user_id = owner_id and cd.source_asset_id = target.id;
  if document_id is not null then return document_id; end if;

  select p.full_name, p.cpf, p.address_street, p.address_number,
         p.address_complement, p.address_district, p.address_city,
         p.address_state, p.address_zip
    into resolved_patient
  from public.patients p
  where p.id = target.patient_id and p.user_id = owner_id and p.active is true;
  if resolved_patient.full_name is null then
    raise exception 'Paciente fora do escopo da clinica.' using errcode = '42501';
  end if;

  select * into resolved_author from public.clinical_author_identity();
  if resolved_author.author_name is null or resolved_author.author_registration is null then
    raise exception 'Identidade profissional nao configurada.' using errcode = '22023';
  end if;

  resolved_patient_address := nullif(concat_ws(' · ',
    nullif(concat_ws(', ', nullif(btrim(resolved_patient.address_street), ''), nullif(btrim(resolved_patient.address_number), '')), ''),
    nullif(btrim(resolved_patient.address_complement), ''),
    nullif(btrim(resolved_patient.address_district), ''),
    nullif(concat_ws(' / ', nullif(btrim(resolved_patient.address_city), ''), nullif(btrim(resolved_patient.address_state), '')), ''),
    case when nullif(btrim(resolved_patient.address_zip), '') is not null then 'CEP ' || btrim(resolved_patient.address_zip) end
  ), '');

  payload := jsonb_build_object(
    'source_asset_id', target.id,
    'file_name', target.file_name,
    'mime_type', target.observed_mime_type,
    'file_size', target.file_size,
    'sha256', target.client_sha256
  );

  insert into public.clinical_documents(
    user_id, patient_id, created_by, document_type, issue_date, document_data,
    patient_name, patient_cpf, patient_address, author_name,
    author_registration, author_council, issuer_contact, issuer_address,
    request_id, request_fingerprint, source_asset_id
  ) values (
    owner_id, target.patient_id, auth.uid(), 'uploaded_pdf', target.captured_on, payload,
    btrim(resolved_patient.full_name), nullif(btrim(resolved_patient.cpf), ''), resolved_patient_address,
    btrim(resolved_author.author_name), btrim(resolved_author.author_registration),
    coalesce(nullif(btrim(resolved_author.author_council), ''), 'CRM'),
    'Documento anexado ao prontuario', 'Documento anexado ao prontuario',
    target.id, md5(payload::text), target.id
  )
  on conflict (source_asset_id) where source_asset_id is not null do nothing
  returning id into document_id;

  if document_id is null then
    select cd.id into document_id from public.clinical_documents cd
    where cd.user_id = owner_id and cd.source_asset_id = target.id;
  end if;

  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, target.patient_id, auth.uid(), 'create_document');
  return document_id;
end;
$$;

revoke all on function public.prepare_clinical_asset_signature(uuid) from public;
grant execute on function public.prepare_clinical_asset_signature(uuid) to authenticated;

comment on column public.clinical_documents.source_asset_id is
  'PDF privado original que originou o snapshot imutavel enviado para assinatura.';
comment on function public.prepare_clinical_asset_signature(uuid) is
  'Cria de forma idempotente o snapshot de um PDF anexado para o fluxo BRy; somente o profissional que anexou o arquivo pode prepara-lo.';

commit;
