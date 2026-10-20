-- Fase 4.3: pedidos de exames e receituarios simples imutaveis.
-- Executar depois de clinical_record_foundation_schema.sql.
-- Os documentos desta etapa sao preparados para impressao e assinatura manual.

begin;

create table if not exists public.clinical_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  document_type text not null check (document_type in ('exam_request', 'simple_prescription')),
  issue_date date not null,
  document_data jsonb not null check (jsonb_typeof(document_data) = 'object'),
  patient_name text not null,
  patient_cpf text,
  patient_address text,
  author_name text not null,
  author_registration text not null,
  author_council text not null default 'CRM',
  issuer_contact text not null,
  issuer_address text not null,
  clinic_name text,
  request_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, patient_id, request_id)
);

alter table public.clinical_documents enable row level security;

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'clinical_documents'
  loop
    execute format('drop policy if exists %I on public.clinical_documents', policy_row.policyname);
  end loop;
end $$;

create policy "Clinical documents authorized read"
on public.clinical_documents
for select to authenticated
using (user_id = public.data_owner_id() and public.has_clinical_access());

revoke insert, update, delete on public.clinical_documents from authenticated;
grant select on public.clinical_documents to authenticated;

drop trigger if exists trg_clinical_documents_immutable on public.clinical_documents;
create trigger trg_clinical_documents_immutable
before update or delete on public.clinical_documents
for each row execute function public.prevent_clinical_record_mutation();

alter table public.clinical_record_access_logs
  drop constraint if exists clinical_record_access_logs_action_check;
alter table public.clinical_record_access_logs
  add constraint clinical_record_access_logs_action_check
  check (action in ('view_record', 'create_record', 'create_addendum', 'create_anamnesis', 'create_document'));

create or replace function public.create_clinical_document(
  p_patient_id uuid,
  p_document_type text,
  p_issue_date date,
  p_document_data jsonb,
  p_request_id uuid,
  p_issuer_contact text,
  p_issuer_address text,
  p_clinic_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid;
  document_id uuid;
  resolved_author_name text;
  resolved_author_registration text;
  resolved_author_council text;
  resolved_patient record;
  resolved_patient_address text;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  if p_patient_id is null or p_issue_date is null or p_request_id is null then
    raise exception 'Paciente, data e identificador da emissao sao obrigatorios.' using errcode = '22023';
  end if;
  if p_document_type not in ('exam_request', 'simple_prescription') then
    raise exception 'Tipo de documento clinico invalido.' using errcode = '22023';
  end if;
  if p_document_data is null or jsonb_typeof(p_document_data) <> 'object' or length(p_document_data::text) > 30000 then
    raise exception 'Conteudo do documento invalido ou acima do limite.' using errcode = '22023';
  end if;
  if nullif(btrim(p_issuer_contact), '') is null or length(btrim(p_issuer_contact)) > 500
     or nullif(btrim(p_issuer_address), '') is null or length(btrim(p_issuer_address)) > 1000 then
    raise exception 'Contato e endereco profissional sao obrigatorios.' using errcode = '22023';
  end if;
  if p_clinic_name is not null and length(btrim(p_clinic_name)) > 500 then
    raise exception 'Nome da clinica excede o limite permitido.' using errcode = '22001';
  end if;
  if p_document_type = 'exam_request' then
    if jsonb_typeof(p_document_data->'exams') <> 'array' then
      raise exception 'A lista de exames e obrigatoria.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_document_data->'exams') not between 1 and 30 or exists (
      select 1
      from jsonb_array_elements(p_document_data->'exams') exam(value)
      where jsonb_typeof(exam.value) <> 'string'
         or length(btrim(exam.value #>> '{}')) not between 1 and 200
    ) then
      raise exception 'Informe entre 1 e 30 exames validos.' using errcode = '22023';
    end if;
  end if;
  if p_document_type = 'simple_prescription' then
    if jsonb_typeof(p_document_data->'items') <> 'array' then
      raise exception 'A lista de medicamentos e obrigatoria.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_document_data->'items') not between 1 and 20
       or p_document_data->>'simple_prescription_confirmed' is distinct from 'true'
       or exists (
      select 1
      from jsonb_array_elements(p_document_data->'items') item(value)
      where jsonb_typeof(item.value) <> 'object'
         or nullif(btrim(item.value->>'medication'), '') is null
         or length(btrim(item.value->>'medication')) > 300
         or nullif(btrim(item.value->>'directions'), '') is null
         or length(btrim(item.value->>'directions')) > 2000
         or length(coalesce(item.value->>'presentation', '')) > 500
         or length(coalesce(item.value->>'quantity', '')) > 300
    ) then
      raise exception 'Receituario simples invalido ou sem confirmacao sanitaria.' using errcode = '22023';
    end if;
  end if;

  owner_id := public.data_owner_id();

  select cd.id into document_id
  from public.clinical_documents cd
  where cd.user_id = owner_id
    and cd.patient_id = p_patient_id
    and cd.request_id = p_request_id;
  if document_id is not null then return document_id; end if;

  select p.full_name, p.cpf, p.address_street, p.address_number, p.address_complement,
         p.address_district, p.address_city, p.address_state, p.address_zip
    into resolved_patient
  from public.patients p
  where p.id = p_patient_id and p.user_id = owner_id and p.active is true;
  if resolved_patient.full_name is null then
    raise exception 'Paciente fora do escopo da clinica.' using errcode = '42501';
  end if;

  resolved_patient_address := nullif(concat_ws(' · ',
    nullif(concat_ws(', ', nullif(btrim(resolved_patient.address_street), ''), nullif(btrim(resolved_patient.address_number), '')), ''),
    nullif(btrim(resolved_patient.address_complement), ''),
    nullif(btrim(resolved_patient.address_district), ''),
    nullif(concat_ws(' / ', nullif(btrim(resolved_patient.address_city), ''), nullif(btrim(resolved_patient.address_state), '')), ''),
    case when nullif(btrim(resolved_patient.address_zip), '') is not null then 'CEP ' || btrim(resolved_patient.address_zip) end
  ), '');
  if p_document_type = 'simple_prescription' and resolved_patient_address is null then
    raise exception 'Endereco residencial do paciente e obrigatorio para receita.' using errcode = '22023';
  end if;

  select identity.author_name, identity.author_registration, identity.author_council
    into resolved_author_name, resolved_author_registration, resolved_author_council
  from public.clinical_author_identity() identity;
  if resolved_author_name is null or resolved_author_registration is null then
    raise exception 'Identidade profissional nao configurada.' using errcode = '22023';
  end if;

  insert into public.clinical_documents (
    user_id, patient_id, created_by, document_type, issue_date, document_data,
    patient_name, patient_cpf, patient_address,
    author_name, author_registration, author_council,
    issuer_contact, issuer_address, clinic_name, request_id
  ) values (
    owner_id, p_patient_id, auth.uid(), p_document_type, p_issue_date, p_document_data,
    btrim(resolved_patient.full_name), nullif(btrim(resolved_patient.cpf), ''), resolved_patient_address,
    btrim(resolved_author_name), btrim(resolved_author_registration), coalesce(nullif(btrim(resolved_author_council), ''), 'CRM'),
    btrim(p_issuer_contact), btrim(p_issuer_address), nullif(btrim(p_clinic_name), ''), p_request_id
  )
  on conflict (user_id, patient_id, request_id) do nothing
  returning id into document_id;

  if document_id is null then
    select cd.id into document_id
    from public.clinical_documents cd
    where cd.user_id = owner_id and cd.patient_id = p_patient_id and cd.request_id = p_request_id;
    return document_id;
  end if;

  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, p_patient_id, auth.uid(), 'create_document');
  return document_id;
end;
$$;

revoke all on function public.create_clinical_document(uuid, text, date, jsonb, uuid, text, text, text) from public;
grant execute on function public.create_clinical_document(uuid, text, date, jsonb, uuid, text, text, text) to authenticated;

create index if not exists idx_clinical_documents_patient
  on public.clinical_documents(user_id, patient_id, created_at desc);

do $$
begin
  if to_regprocedure('public.log_record_change()') is not null then
    drop trigger if exists trg_record_audit on public.clinical_documents;
    create trigger trg_record_audit
      after insert or update or delete on public.clinical_documents
      for each row execute function public.log_record_change();
  end if;
end $$;

comment on table public.clinical_documents is
  'Pedidos de exames e receituarios simples imutaveis, preparados para impressao e assinatura manual.';

commit;
