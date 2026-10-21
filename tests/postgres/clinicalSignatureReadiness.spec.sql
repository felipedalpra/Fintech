-- Executar somente em banco local descartavel e vazio:
--   createdb surgimetrics_signature_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_signature_test -f tests/postgres/clinicalSignatureReadiness.spec.sql

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key);

create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.clinics (
  id uuid primary key,
  owner_id uuid not null references auth.users(id)
);

create table public.clinic_members (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  clinical_access boolean not null default false
);

create table public.clinical_documents (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  patient_id uuid not null,
  created_by uuid references auth.users(id),
  author_name text not null,
  author_registration text not null,
  author_council text not null
);

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
      select 1 from public.clinic_members cm
      join public.clinics c on c.id = cm.clinic_id
      where cm.user_id = auth.uid() and cm.clinical_access is true and c.owner_id = public.data_owner_id()
    )
$$;

\ir ../../supabase/clinical_signature_readiness_schema.sql

insert into auth.users(id) values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000004');

insert into public.clinics(id, owner_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003');

insert into public.clinic_members(clinic_id, user_id, clinical_access) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', true),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', true);

insert into public.clinical_documents(id, user_id, patient_id, created_by, author_name, author_registration, author_council) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Dra. Membro', 'CRM-RS 200', 'CRM'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Dra. Proprietária', 'CRM-RS 100', 'CRM'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Dra. Membro', 'CRM-RS 200', 'CRM'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'Dra. Removida', 'CRM-RS 400', 'CRM'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'Dra. Outra Clínica', 'CRM-SP 300', 'CRM');

insert into public.clinical_signature_connections(
  id, user_id, professional_user_id, provider, signing_mode, credential_reference, status,
  professional_name, professional_registration, professional_council
) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'provedor', 'a1_vault', 'vault://50000000-0000-4000-8000-000000000001', 'active', 'Dra. Membro', 'CRM-RS 200', 'CRM'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'provedor', 'a1_vault', 'vault://50000000-0000-4000-8000-000000000002', 'active', 'Dra. Removida', 'CRM-RS 400', 'CRM'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'provedor', 'a1_vault', 'vault://50000000-0000-4000-8000-000000000003', 'active', 'Dra. Outra Clínica', 'CRM-SP 300', 'CRM');

-- Referência da credencial e modo de assinatura não podem ser trocados no mesmo registro.
do $$
begin
  begin
    update public.clinical_signature_connections
    set credential_reference = 'vault://50000000-0000-4000-8000-000000000099'
    where id = '50000000-0000-0000-0000-000000000001';
    raise exception 'Era esperado bloquear troca de credencial na mesma conexao.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- O mesmo profissional que emitiu o documento pode iniciar a tentativa.
insert into public.clinical_document_signatures(
  id, user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
  provider, provider_request_id, status, rendering_version, document_payload_sha256
) values (
  '60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001', 'provedor', 'provider-request-shared', 'pending', 'clinical-pdf-v1', repeat('a', 64)
);

-- Revogar a conexão depois do envio não pode impedir o callback terminal.
update public.clinical_signature_connections set status = 'revoked' where id = '50000000-0000-0000-0000-000000000001';
update public.clinical_document_signatures set status = 'failed', failure_code = 'provider_error' where id = '60000000-0000-0000-0000-000000000001';

-- Reconexão com o mesmo provedor deve ser possível após revogação.
insert into public.clinical_signature_connections(
  id, user_id, professional_user_id, provider, signing_mode, credential_reference, status,
  professional_name, professional_registration, professional_council
) values (
  '50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002', 'provedor', 'a1_vault', 'vault://50000000-0000-4000-8000-000000000004',
  'active', 'Dra. Membro', 'CRM-RS 200', 'CRM'
);

-- IDs do provedor podem se repetir em clínicas diferentes.
insert into public.clinical_document_signatures(
  id, user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
  provider, provider_request_id, status, rendering_version, document_payload_sha256
) values (
  '60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003',
  '70000000-0000-0000-0000-000000000002', 'provedor', 'provider-request-shared', 'pending', 'clinical-pdf-v1', repeat('b', 64)
);

-- Médico B não pode assinar documento emitido pela médica A.
do $$
begin
  begin
    insert into public.clinical_document_signatures(
      user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
      provider, status, rendering_version, document_payload_sha256
    ) values (
      '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
      '50000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000003',
      'provedor', 'pending', 'clinical-pdf-v1', repeat('c', 64)
    );
    raise exception 'Era esperado bloquear signatario diferente do autor.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Remover o profissional da clínica bloqueia novas assinaturas com a conexão antiga.
delete from public.clinic_members where user_id = '10000000-0000-0000-0000-000000000004';
do $$
begin
  begin
    insert into public.clinical_document_signatures(
      user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
      provider, status, rendering_version, document_payload_sha256
    ) values (
      '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004',
      '10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004',
      '50000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000004',
      'provedor', 'pending', 'clinical-pdf-v1', repeat('d', 64)
    );
    raise exception 'Era esperado bloquear profissional removido.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Evidência incompleta não pode virar assinatura concluída.
insert into public.clinical_document_signatures(
  id, user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
  provider, status, rendering_version, document_payload_sha256
) values (
  '60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000004',
  '70000000-0000-0000-0000-000000000005', 'provedor', 'pending', 'clinical-pdf-v1', repeat('e', 64)
);

do $$
begin
  begin
    update public.clinical_document_signatures
    set status = 'signed', signed_file_path = '', signed_file_sha256 = repeat('f', 64), signature_standard = 'PAdES-B-T',
        certificate_subject = '', certificate_serial = '', certificate_issuer = '',
        certificate_valid_from = '2026-01-01', certificate_valid_until = '2027-01-01', signed_at = '2026-10-21'
    where id = '60000000-0000-0000-0000-000000000003';
    raise exception 'Era esperado bloquear evidencia incompleta.';
  exception when check_violation then null;
  end;
end $$;

update public.clinical_document_signatures
set status = 'signed',
    signed_file_path = 'clinical-signatures/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000003/60000000-0000-0000-0000-000000000003.pdf',
    signed_file_sha256 = repeat('f', 64),
    signature_standard = 'PAdES-B-T',
    certificate_subject = 'CN=Dra. Membro',
    certificate_serial = 'serial-200',
    certificate_issuer = 'AC ICP-Brasil',
    certificate_valid_from = '2026-01-01',
    certificate_valid_until = '2027-01-01',
    signed_at = '2026-10-21'
where id = '60000000-0000-0000-0000-000000000003';

-- Documento já assinado não aceita nova tentativa.
do $$
begin
  begin
    insert into public.clinical_document_signatures(
      user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
      provider, status, rendering_version, document_payload_sha256
    ) values (
      '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
      '50000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000006',
      'provedor', 'pending', 'clinical-pdf-v1', repeat('e', 64)
    );
    raise exception 'Era esperado bloquear nova tentativa depois da assinatura.';
  exception when insufficient_privilege or unique_violation then null;
  end;
end $$;

-- RLS não permite que outra clínica veja evidências.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', false);
do $$
begin
  if (select count(*) from public.clinical_document_signatures where user_id = '10000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'RLS permitiu leitura cross-clinica.';
  end if;
end $$;
reset role;

-- A leitura de status funciona para o profissional, mas a referência do cofre não é selecionável.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
do $$
begin
  if (select count(id) from public.clinical_signature_connections) <> 2 then
    raise exception 'A leitura segura nao retornou as conexoes esperadas.';
  end if;
  begin
    execute 'select credential_reference from public.clinical_signature_connections limit 1';
    raise exception 'A referencia do cofre ficou exposta.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A migration completa deve poder ser reaplicada sem apagar conexões ou evidências.
\ir ../../supabase/clinical_signature_readiness_schema.sql

do $$
begin
  if (select count(*) from public.clinical_document_signatures) <> 3 then
    raise exception 'A reaplicacao da migration alterou as evidencias existentes.';
  end if;
end $$;

select 'clinical signature postgres tests passed' as result;

