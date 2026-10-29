-- Executar somente em banco local descartavel e vazio:
--   createdb surgimetrics_bry_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_bry_test -f tests/postgres/clinicalSignatureBry.spec.sql
--   dropdb surgimetrics_bry_test
--
-- Cobre: instalacao limpa, reaplicacao, upgrade sem apagar historico, RLS
-- cross-clinica, imutabilidade, unicidade/idempotencia, estados terminais e
-- politicas do Storage para a integracao BRy Easy Sign.

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key);

create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Stub minimo do Storage do Supabase.
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  unique (bucket_id, name)
);

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

-- ===========================================================================
-- 1. Instalacao limpa: fundacao + migration BRy
-- ===========================================================================
\ir ../../supabase/clinical_signature_readiness_schema.sql

insert into auth.users(id) values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003');

insert into public.clinics(id, owner_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003');

insert into public.clinic_members(clinic_id, user_id, clinical_access) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', true);

insert into public.clinical_documents(id, user_id, patient_id, created_by, author_name, author_registration, author_council) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Dra. Membro', 'CRM-RS 200', 'CRM'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Dra. Membro', 'CRM-RS 200', 'CRM'),
  ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'Dra. Outra', 'CRM-SP 300', 'CRM');

insert into public.clinical_signature_connections(
  id, user_id, professional_user_id, provider, signing_mode, credential_reference, status,
  professional_name, professional_registration, professional_council
) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'bry_easy_sign', 'remote_icp_brasil', 'vault://50000000-0000-4000-8000-000000000001', 'active', 'Dra. Membro', 'CRM-RS 200', 'CRM'),
  ('50000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'bry_easy_sign', 'remote_icp_brasil', 'vault://50000000-0000-4000-8000-000000000009', 'active', 'Dra. Outra', 'CRM-SP 300', 'CRM');

-- Tentativa legada criada ANTES da migration BRy, para provar que o upgrade
-- nao apaga nem reescreve historico.
insert into public.clinical_document_signatures(
  id, user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
  provider, provider_request_id, status, rendering_version, document_payload_sha256
) values (
  '60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001', 'bry_easy_sign', 'envelope-legado', 'pending',
  'clinical-pdf-v1', repeat('a', 64)
);

-- ===========================================================================
-- 2. Upgrade: aplica a migration BRy sobre dados existentes
-- ===========================================================================
\ir ../../supabase/clinical_signature_bry_schema.sql

do $$
declare legacy record;
begin
  select * into legacy from public.clinical_document_signatures
  where id = '60000000-0000-0000-0000-000000000001';

  if legacy is null then
    raise exception 'O upgrade apagou a tentativa legada.';
  end if;
  if legacy.rendering_version <> 'clinical-pdf-v1' then
    raise exception 'O upgrade reescreveu a versao de renderizacao do historico.';
  end if;
  if legacy.document_payload_sha256 <> repeat('a', 64) then
    raise exception 'O upgrade alterou o hash do envelope historico.';
  end if;
  -- Tentativa que ja tinha envelope e classificada como enviada.
  if legacy.dispatch_state <> 'sent' then
    raise exception 'dispatch_state do historico com envelope deveria ser sent, veio %', legacy.dispatch_state;
  end if;
end $$;

-- ===========================================================================
-- 3. Reaplicacao: a migration BRy e idempotente
-- ===========================================================================
\ir ../../supabase/clinical_signature_bry_schema.sql
\ir ../../supabase/clinical_signature_bry_schema.sql

do $$
begin
  if (select count(*) from public.clinical_document_signatures) <> 1 then
    raise exception 'A reaplicacao duplicou ou removeu tentativas.';
  end if;
  if (select count(*) from storage.buckets where id = 'clinical-signatures') <> 1 then
    raise exception 'A reaplicacao duplicou o bucket de assinaturas.';
  end if;
  if (select public from storage.buckets where id = 'clinical-signatures') then
    raise exception 'O bucket de assinaturas nao pode ser publico.';
  end if;
  if (select allowed_mime_types from storage.buckets where id = 'clinical-signatures') <> array['application/pdf'] then
    raise exception 'O bucket de assinaturas deve aceitar somente PDF.';
  end if;
end $$;

-- ===========================================================================
-- 4. Unicidade e idempotencia
-- ===========================================================================

-- Mesma chave idempotente (user_id, document_id, request_id) nao se repete.
do $$
begin
  begin
    insert into public.clinical_document_signatures(
      user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
      provider, status, rendering_version, document_payload_sha256
    ) values (
      '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
      '50000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
      'bry_easy_sign', 'pending', 'clinical-pdf-v2', repeat('b', 64)
    );
    raise exception 'Era esperado bloquear a mesma chave idempotente.';
  exception when unique_violation or insufficient_privilege then null;
  end;
end $$;

-- Documento com tentativa pendente nao aceita uma segunda tentativa.
do $$
begin
  begin
    insert into public.clinical_document_signatures(
      user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
      provider, status, rendering_version, document_payload_sha256
    ) values (
      '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
      '50000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002',
      'bry_easy_sign', 'pending', 'clinical-pdf-v2', repeat('b', 64)
    );
    raise exception 'Era esperado bloquear segunda tentativa pendente do mesmo documento.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- O mesmo envelope BRy nao pode ser vinculado a duas tentativas.
do $$
begin
  begin
    insert into public.clinical_document_signatures(
      user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
      provider, provider_request_id, status, rendering_version, document_payload_sha256
    ) values (
      '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
      '50000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000003',
      'bry_easy_sign', 'envelope-legado', 'pending', 'clinical-pdf-v2', repeat('b', 64)
    );
    raise exception 'Era esperado bloquear reuso do mesmo envelope BRy.';
  exception when unique_violation or insufficient_privilege then null;
  end;
end $$;

-- ===========================================================================
-- 5. Imutabilidade dos identificadores externos e do artefato
-- ===========================================================================

-- Envelope, documento, signatario e ambiente gravados nao podem ser reapontados.
update public.clinical_document_signatures
set provider_document_id = 'doc-1',
    provider_signer_id = 'signer-1',
    provider_environment = 'homologation',
    rendered_pdf_sha256 = repeat('c', 64)
where id = '60000000-0000-0000-0000-000000000001';

do $$
declare
  columns_to_test text[] := array['provider_request_id', 'provider_document_id', 'provider_signer_id', 'provider_environment', 'rendered_pdf_sha256'];
  target text;
begin
  foreach target in array columns_to_test loop
    begin
      execute format(
        'update public.clinical_document_signatures set %I = %L where id = %L',
        target,
        case target when 'rendered_pdf_sha256' then repeat('d', 64) when 'provider_environment' then 'production' else 'outro-valor' end,
        '60000000-0000-0000-0000-000000000001'
      );
      raise exception 'Era esperado bloquear a troca de %.', target;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- ===========================================================================
-- 6. `signed` exige evidencia completa e caminho no escopo da clinica
-- ===========================================================================

-- Sem evidencia nenhuma.
do $$
begin
  begin
    update public.clinical_document_signatures set status = 'signed'
    where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'Era esperado bloquear signed sem evidencia.';
  exception when check_violation then null;
  end;
end $$;

-- Com caminho fora do namespace da clinica/documento/tentativa.
do $$
begin
  begin
    update public.clinical_document_signatures
    set status = 'signed',
        signed_file_path = 'clinical-signatures/outra-clinica/x/y.pdf',
        signed_file_sha256 = repeat('e', 64),
        signature_standard = 'PAdES-B-T',
        certificate_subject = 'CN=Dra. Membro',
        certificate_serial = '0A1B',
        certificate_issuer = 'AC Exemplo',
        certificate_valid_from = '2026-01-01T00:00:00Z',
        certificate_valid_until = '2027-01-01T00:00:00Z',
        signed_at = '2026-10-28T12:00:00Z'
    where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'Era esperado bloquear caminho fora do escopo da clinica.';
  exception when check_violation then null;
  end;
end $$;

-- Com padrao de assinatura nao permitido.
do $$
begin
  begin
    update public.clinical_document_signatures
    set status = 'signed',
        signed_file_path = 'clinical-signatures/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001.pdf',
        signed_file_sha256 = repeat('e', 64),
        signature_standard = 'PAdES-INVENTADO',
        certificate_subject = 'CN=Dra. Membro',
        certificate_serial = '0A1B',
        certificate_issuer = 'AC Exemplo',
        certificate_valid_from = '2026-01-01T00:00:00Z',
        certificate_valid_until = '2027-01-01T00:00:00Z',
        signed_at = '2026-10-28T12:00:00Z'
    where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'Era esperado bloquear padrao de assinatura invalido.';
  exception when check_violation then null;
  end;
end $$;

-- Artefato sem hash (ou hash sem artefato) e recusado.
do $$
begin
  begin
    update public.clinical_document_signatures
    set signed_file_path = 'clinical-signatures/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001.pdf'
    where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'Era esperado exigir hash junto do artefato.';
  exception when check_violation then null;
  end;
end $$;

-- Guardar o artefato enquanto a tentativa segue pendente e permitido: e assim
-- que a evidencia pendente de homologacao e preservada sem declarar assinatura.
update public.clinical_document_signatures
set signed_file_path = 'clinical-signatures/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001.pdf',
    signed_file_sha256 = repeat('e', 64),
    evidence_report_path = 'clinical-signatures/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001-report.pdf',
    evidence_report_sha256 = repeat('f', 64),
    evidence_gap_code = 'verify_service_unavailable',
    provider_envelope_status = 'FINISHED'
where id = '60000000-0000-0000-0000-000000000001';

do $$
begin
  if (select status from public.clinical_document_signatures where id = '60000000-0000-0000-0000-000000000001') <> 'pending' then
    raise exception 'Guardar o artefato nao pode alterar o estado da tentativa.';
  end if;
end $$;

-- Estado do envelope precisa ser um dos documentados pela BRy.
do $$
begin
  begin
    update public.clinical_document_signatures set provider_envelope_status = 'INVENTADO'
    where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'Era esperado bloquear estado de envelope desconhecido.';
  exception when check_violation then null;
  end;
end $$;

-- dispatch_state so aceita os valores previstos.
do $$
begin
  begin
    update public.clinical_document_signatures set dispatch_state = 'qualquer'
    where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'Era esperado bloquear dispatch_state desconhecido.';
  exception when check_violation then null;
  end;
end $$;

-- ===========================================================================
-- 7. Estados terminais sao imutaveis e nao podem ser apagados
-- ===========================================================================
update public.clinical_document_signatures
set status = 'failed',
    failure_code = 'dispatch_result_unknown_abandoned',
    failure_message = 'Encerrada pelo profissional.'
where id = '60000000-0000-0000-0000-000000000001';

do $$
begin
  begin
    update public.clinical_document_signatures set provider_envelope_status = 'FINISHED'
    where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'Era esperado congelar a tentativa terminal.';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.clinical_document_signatures set status = 'pending'
    where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'Era esperado impedir reabrir a tentativa terminal.';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.clinical_document_signatures where id = '60000000-0000-0000-0000-000000000001';
    raise exception 'Era esperado impedir exclusao da tentativa.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Terminalizada, o documento aceita uma nova tentativa (nova tentativa apos falha).
insert into public.clinical_document_signatures(
  id, user_id, document_id, requested_by, signer_user_id, connection_id, request_id,
  provider, status, rendering_version, document_payload_sha256, dispatch_state, provider_environment
) values (
  '60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000004', 'bry_easy_sign', 'pending', 'clinical-pdf-v2',
  repeat('b', 64), 'reserved', 'homologation'
);

-- ===========================================================================
-- 8. Conexao: ambiente e modo pedido sao imutaveis
-- ===========================================================================
-- Ambiente e modo integram a identidade da conexao: sao definidos na criacao e
-- nunca editados. Trocar qualquer um deles exige uma NOVA conexao, o que
-- preserva o historico e impede downgrade silencioso de QUALIFIED.
insert into auth.users(id) values ('10000000-0000-0000-0000-000000000004');
insert into public.clinic_members(clinic_id, user_id, clinical_access) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', true);

insert into public.clinical_signature_connections(
  id, user_id, professional_user_id, provider, signing_mode, credential_reference, status,
  professional_name, professional_registration, professional_council,
  provider_environment, requested_signature_mode, requested_signature_profile
) values (
  '50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000004', 'bry_easy_sign', 'remote_icp_brasil',
  'vault://50000000-0000-4000-8000-000000000004', 'active',
  'Dra. Nova', 'CRM-RS 400', 'CRM', 'homologation', 'QUALIFIED', 'TIMESTAMP'
);

do $$
begin
  begin
    update public.clinical_signature_connections set provider_environment = 'production'
    where id = '50000000-0000-0000-0000-000000000004';
    raise exception 'Era esperado bloquear troca de ambiente na mesma conexao.';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.clinical_signature_connections set requested_signature_mode = 'ADVANCED'
    where id = '50000000-0000-0000-0000-000000000004';
    raise exception 'Era esperado bloquear troca de modo na mesma conexao (sem downgrade silencioso).';
  exception when insufficient_privilege then null;
  end;

  -- Valores fora do conjunto documentado pela BRy nao entram nem na criacao.
  begin
    insert into public.clinical_signature_connections(
      user_id, professional_user_id, provider, signing_mode, credential_reference, status,
      professional_name, professional_registration, professional_council,
      provider_environment, requested_signature_mode
    ) values (
      '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003',
      'bry_easy_sign', 'remote_icp_brasil', 'vault://50000000-0000-4000-8000-00000000000a', 'active',
      'Dra. Outra', 'CRM-SP 300', 'CRM', 'producao-caseira', 'INVENTADO'
    );
    raise exception 'Era esperado bloquear ambiente/modo desconhecidos.';
  exception when check_violation or unique_violation or insufficient_privilege then null;
  end;
end $$;

-- ===========================================================================
-- 9. RLS cross-clinica
-- ===========================================================================
insert into storage.objects(bucket_id, name) values
  ('clinical-signatures', 'clinical-signatures/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001.pdf');

alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
grant select on storage.objects to authenticated;
grant select on public.clinical_documents to authenticated;

-- Membro com acesso clinico ve as tentativas da propria clinica.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
do $$
begin
  if (select count(*) from public.clinical_document_signatures) < 1 then
    raise exception 'Membro com acesso clinico deveria ler as tentativas da clinica.';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'clinical-signatures') <> 1 then
    raise exception 'Membro com acesso clinico deveria abrir o artefato da propria clinica.';
  end if;
end $$;
reset role;

-- Profissional de outra clinica nao ve nada, nem a tentativa nem o objeto.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', false);
do $$
begin
  if (select count(*) from public.clinical_document_signatures) <> 0 then
    raise exception 'Vazamento cross-clinica nas tentativas de assinatura.';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'clinical-signatures') <> 0 then
    raise exception 'Vazamento cross-clinica no artefato assinado.';
  end if;
end $$;
reset role;

-- Usuario anonimo nao le nada.
set role anon;
do $$
begin
  begin
    if (select count(*) from public.clinical_document_signatures) <> 0 then
      raise exception 'anon nao pode ler tentativas de assinatura.';
    end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- O navegador nunca escreve: insert/update/delete seguem revogados.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
do $$
begin
  begin
    update public.clinical_document_signatures set failure_code = 'alterado-pelo-navegador'
    where id = '60000000-0000-0000-0000-000000000002';
    raise exception 'Era esperado recusar escrita direta do navegador.';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects(bucket_id, name) values ('clinical-signatures', 'invadido.pdf');
    raise exception 'Era esperado recusar upload direto do navegador no bucket de assinaturas.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'clinicalSignatureBry: todos os cenarios passaram' as resultado;
