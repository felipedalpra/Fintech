-- Fase 4.4b: campos, bucket e politicas necessarios a integracao BRy Easy Sign.
-- Executar depois de clinical_signature_readiness_schema.sql.
-- Aditiva e idempotente: nao reescreve a migration anterior, que pode ja estar aplicada.
--
-- IMPORTANTE: nenhuma coluna aqui guarda token BRy, certificado A1/A3, chave
-- privada, senha ou link de assinatura. O token vive somente em variavel
-- server-side/cofre e o link individual nunca e persistido nem registrado.

begin;

-- ---------------------------------------------------------------------------
-- 1. Identificadores externos e estado real do envelope
-- ---------------------------------------------------------------------------
-- provider_request_id (ja existente) guarda o requestId do envelope BRy e ja
-- possui indice unico por (user_id, provider, provider_request_id). Os campos
-- abaixo completam o vinculo com documento e signatario dentro do envelope.
alter table public.clinical_document_signatures
  add column if not exists provider_document_id text,
  add column if not exists provider_signer_id text,
  add column if not exists provider_envelope_status text,
  add column if not exists provider_environment text,
  add column if not exists dispatch_state text,
  add column if not exists evidence_gap_code text,
  add column if not exists evidence_report_path text,
  add column if not exists evidence_report_sha256 text,
  add column if not exists rendered_pdf_sha256 text,
  add column if not exists reconciled_at timestamptz;

comment on column public.clinical_document_signatures.provider_document_id is
  'documentNonce do documento dentro do envelope BRy. Identificador externo opaco, nunca segredo.';
comment on column public.clinical_document_signatures.provider_signer_id is
  'signerNonce do signatario no envelope BRy. O link individual de assinatura NAO e persistido.';
comment on column public.clinical_document_signatures.provider_envelope_status is
  'Ultimo estado do envelope confirmado por consulta autenticada a BRy (nunca pelo webhook).';
comment on column public.clinical_document_signatures.dispatch_state is
  'reserved = tentativa criada sem chamar a BRy; sent = envelope confirmado; unknown = POST com resultado ambiguo (timeout), exige reconciliacao humana.';
comment on column public.clinical_document_signatures.evidence_gap_code is
  'Motivo auditavel de a tentativa nao poder virar signed apesar de concluida no provedor.';
comment on column public.clinical_document_signatures.rendered_pdf_sha256 is
  'SHA-256 do PDF deterministico enviado a BRy. Prova quais bytes foram submetidos a assinatura.';

-- Linhas anteriores a esta migration nao passaram por despacho BRy.
update public.clinical_document_signatures
set dispatch_state = case
      when provider_request_id is not null then 'sent'
      else 'reserved'
    end
where dispatch_state is null;

alter table public.clinical_document_signatures
  alter column dispatch_state set default 'reserved';

-- NOT VALID preserva historico legado e impoe a regra a toda nova gravacao.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_document_signatures'::regclass
      and conname = 'clinical_document_signatures_dispatch_state_check'
  ) then
    alter table public.clinical_document_signatures
      add constraint clinical_document_signatures_dispatch_state_check
      check (dispatch_state is null or dispatch_state in ('reserved', 'sent', 'unknown')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_document_signatures'::regclass
      and conname = 'clinical_document_signatures_provider_envelope_status_check'
  ) then
    alter table public.clinical_document_signatures
      add constraint clinical_document_signatures_provider_envelope_status_check
      check (
        provider_envelope_status is null
        or provider_envelope_status in ('DRAFT', 'CREATED', 'ONGOING', 'FINISHED', 'EXPIRED', 'DELETED')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_document_signatures'::regclass
      and conname = 'clinical_document_signatures_evidence_report_sha_check'
  ) then
    alter table public.clinical_document_signatures
      add constraint clinical_document_signatures_evidence_report_sha_check
      check (
        (evidence_report_sha256 is null or evidence_report_sha256 ~ '^[0-9a-f]{64}$')
        and (rendered_pdf_sha256 is null or rendered_pdf_sha256 ~ '^[0-9a-f]{64}$')
      ) not valid;
  end if;

  -- Um artefato baixado so pode existir junto do seu hash: caminho sem hash
  -- (ou hash sem caminho) permitiria exibir PDF sem integridade conferida.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_document_signatures'::regclass
      and conname = 'clinical_document_signatures_artifact_pairing_check'
  ) then
    alter table public.clinical_document_signatures
      add constraint clinical_document_signatures_artifact_pairing_check
      check (
        (signed_file_path is null) = (signed_file_sha256 is null)
        and (evidence_report_path is null) = (evidence_report_sha256 is null)
      ) not valid;
  end if;

  -- O caminho do artefato e sempre gerado pelo servidor no namespace da
  -- clinica/documento/tentativa, inclusive enquanto a tentativa esta pendente.
  -- Nenhum caminho devolvido pela BRy e aceito.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_document_signatures'::regclass
      and conname = 'clinical_document_signatures_artifact_scope_check'
  ) then
    alter table public.clinical_document_signatures
      add constraint clinical_document_signatures_artifact_scope_check
      check (
        (
          signed_file_path is null
          or signed_file_path = 'clinical-signatures/' || user_id::text || '/' || document_id::text || '/' || id::text || '.pdf'
        )
        and (
          evidence_report_path is null
          or evidence_report_path = 'clinical-signatures/' || user_id::text || '/' || document_id::text || '/' || id::text || '-report.pdf'
        )
      ) not valid;
  end if;
end $$;

-- Reconciliacao idempotente: o webhook pode repetir, atrasar ou chegar fora de
-- ordem, mas um envelope BRy pertence a uma unica tentativa.
create index if not exists idx_clinical_signature_envelope_lookup
  on public.clinical_document_signatures(provider, provider_request_id)
  where provider_request_id is not null;

-- Tentativas que precisam de reconciliacao humana (resultado ambiguo) ou de
-- homologacao de evidencia ficam localizaveis sem varrer a tabela.
create index if not exists idx_clinical_signature_needs_attention
  on public.clinical_document_signatures(user_id, created_at desc)
  where status = 'pending' and (dispatch_state = 'unknown' or evidence_gap_code is not null);

-- ---------------------------------------------------------------------------
-- 2. Conexao: ambiente e modo solicitado a BRy
-- ---------------------------------------------------------------------------
-- O modo solicitado fica registrado para auditoria, mas NUNCA e usado como
-- evidencia do padrao de assinatura efetivamente aplicado.
alter table public.clinical_signature_connections
  add column if not exists provider_environment text,
  add column if not exists requested_signature_mode text,
  add column if not exists requested_signature_profile text;

comment on column public.clinical_signature_connections.requested_signature_mode is
  'Modo pedido a BRy (SIMPLE/ADVANCED/QUALIFIED). Registro de auditoria: nao comprova o padrao PAdES obtido.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_signature_connections'::regclass
      and conname = 'clinical_signature_connections_environment_check'
  ) then
    alter table public.clinical_signature_connections
      add constraint clinical_signature_connections_environment_check
      check (provider_environment is null or provider_environment in ('production', 'homologation')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_signature_connections'::regclass
      and conname = 'clinical_signature_connections_requested_mode_check'
  ) then
    alter table public.clinical_signature_connections
      add constraint clinical_signature_connections_requested_mode_check
      check (requested_signature_mode is null or requested_signature_mode in ('SIMPLE', 'ADVANCED', 'QUALIFIED')) not valid;
  end if;
end $$;

-- Ambiente e modo integram a identidade imutavel da conexao: trocar qualquer um
-- deles exige criar uma nova conexao, preservando o historico anterior.
create or replace function public.validate_clinical_signature_connection_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
       or new.professional_user_id is distinct from old.professional_user_id
       or new.provider is distinct from old.provider
       or new.professional_name is distinct from old.professional_name
       or new.professional_registration is distinct from old.professional_registration
       or new.professional_council is distinct from old.professional_council
       or new.signing_mode is distinct from old.signing_mode
       or new.credential_reference is distinct from old.credential_reference
       or new.provider_environment is distinct from old.provider_environment
       or new.requested_signature_mode is distinct from old.requested_signature_mode
       or new.requested_signature_profile is distinct from old.requested_signature_profile
       or new.created_at is distinct from old.created_at then
      raise exception 'A identidade da conexao de assinatura e imutavel.' using errcode = '42501';
    end if;
    if old.status = 'revoked' then
      raise exception 'Uma conexao de assinatura revogada e terminal.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.professional_user_id <> new.user_id and not exists (
    select 1
    from public.clinic_members cm
    join public.clinics c on c.id = cm.clinic_id
    where c.owner_id = new.user_id
      and cm.user_id = new.professional_user_id
      and cm.clinical_access is true
  ) then
    raise exception 'O profissional nao pertence ao escopo clinico da clinica.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clinical_signature_connection_scope on public.clinical_signature_connections;
create trigger trg_clinical_signature_connection_scope
before insert or update on public.clinical_signature_connections
for each row execute function public.validate_clinical_signature_connection_scope();

-- ---------------------------------------------------------------------------
-- 3. Imutabilidade: identificadores externos nao podem ser reapontados
-- ---------------------------------------------------------------------------
-- Uma vez confirmado o envelope, reapontar a tentativa para outro envelope,
-- documento ou signatario permitiria importar evidencia de outro documento.
create or replace function public.protect_clinical_signature_attempt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Tentativas de assinatura clinica nao podem ser excluidas.' using errcode = '42501';
  end if;
  if old.status <> 'pending' then
    raise exception 'Uma tentativa de assinatura finalizada e imutavel.' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id
     or new.document_id is distinct from old.document_id
     or new.requested_by is distinct from old.requested_by
     or new.signer_user_id is distinct from old.signer_user_id
     or new.connection_id is distinct from old.connection_id
     or new.request_id is distinct from old.request_id
     or new.provider is distinct from old.provider
     or new.rule_version is distinct from old.rule_version
     or new.rendering_version is distinct from old.rendering_version
     or new.document_payload_sha256 is distinct from old.document_payload_sha256
     or new.created_at is distinct from old.created_at then
    raise exception 'A identidade e o conteudo da tentativa de assinatura sao imutaveis.' using errcode = '42501';
  end if;
  if old.provider_request_id is not null and new.provider_request_id is distinct from old.provider_request_id then
    raise exception 'O envelope do provedor vinculado a tentativa e imutavel.' using errcode = '42501';
  end if;
  if old.provider_document_id is not null and new.provider_document_id is distinct from old.provider_document_id then
    raise exception 'O documento do provedor vinculado a tentativa e imutavel.' using errcode = '42501';
  end if;
  if old.provider_signer_id is not null and new.provider_signer_id is distinct from old.provider_signer_id then
    raise exception 'O signatario do provedor vinculado a tentativa e imutavel.' using errcode = '42501';
  end if;
  if old.provider_environment is not null and new.provider_environment is distinct from old.provider_environment then
    raise exception 'O ambiente do provedor vinculado a tentativa e imutavel.' using errcode = '42501';
  end if;
  -- Um artefato ja persistido e conferido nao pode ser trocado por outro.
  if old.signed_file_sha256 is not null and new.signed_file_sha256 is distinct from old.signed_file_sha256 then
    raise exception 'O artefato assinado persistido e imutavel.' using errcode = '42501';
  end if;
  if old.rendered_pdf_sha256 is not null and new.rendered_pdf_sha256 is distinct from old.rendered_pdf_sha256 then
    raise exception 'O PDF submetido a assinatura e imutavel.' using errcode = '42501';
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_clinical_signature_attempt_protected on public.clinical_document_signatures;
create trigger trg_clinical_signature_attempt_protected
before update or delete on public.clinical_document_signatures
for each row execute function public.protect_clinical_signature_attempt();

-- ---------------------------------------------------------------------------
-- 4. Bucket privado do PDF assinado
-- ---------------------------------------------------------------------------
-- Escrita somente pela service role do backend. O navegador nunca recebe
-- politica de insert/update/delete, e a abertura passa por acao autenticada e
-- auditada que gera URL assinada curta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinical-signatures', 'clinical-signatures', false, 26214400, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "clinical-signatures authorized select" on storage.objects;
drop policy if exists "clinical-signatures authorized insert" on storage.objects;
drop policy if exists "clinical-signatures authorized update" on storage.objects;
drop policy if exists "clinical-signatures authorized delete" on storage.objects;

-- Leitura escopada por clinica tambem no Storage (defesa em profundidade), mesmo
-- que o caminho normal de abertura seja a acao autenticada no backend.
create policy "clinical-signatures authorized select"
on storage.objects
for select to authenticated
using (
  bucket_id = 'clinical-signatures'
  and public.has_clinical_access()
  and exists (
    select 1
    from public.clinical_document_signatures signature
    where name in (signature.signed_file_path, signature.evidence_report_path)
      and signature.user_id = public.data_owner_id()
  )
);

commit;
