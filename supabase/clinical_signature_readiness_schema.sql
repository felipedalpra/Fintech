-- Fase 4.4: fundacao multiprovedor para assinatura clinica ICP-Brasil.
-- Executar depois de clinical_documents_schema.sql e clinical_documents_review_fixes.sql.
-- IMPORTANTE: certificado A1, chave privada e senha nunca devem ser gravados nestas tabelas.

begin;

create table if not exists public.clinical_signature_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  professional_user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  signing_mode text not null check (signing_mode in ('remote_icp_brasil', 'a1_vault')),
  credential_reference text not null check (
    credential_reference ~* '^(vault|kms|hsm|provider)://[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  professional_name text not null check (nullif(btrim(professional_name), '') is not null),
  professional_registration text not null check (nullif(btrim(professional_registration), '') is not null),
  professional_council text not null default 'CRM' check (nullif(btrim(professional_council), '') is not null),
  status text not null default 'pending' check (status in ('pending', 'active', 'error', 'expired', 'revoked')),
  certificate_subject text,
  certificate_serial text,
  certificate_issuer text,
  certificate_valid_from timestamptz,
  certificate_valid_until timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Compatibilidade com a primeira versão ainda não ativada da migration. Conexões
-- antigas sem snapshot profissional ou referência emitida pelo cofre são
-- preservadas, mas ficam bloqueadas até uma nova conexão ser criada.
drop trigger if exists trg_clinical_signature_connection_scope on public.clinical_signature_connections;
drop trigger if exists trg_clinical_signature_connection_updated on public.clinical_signature_connections;

alter table public.clinical_signature_connections
  add column if not exists professional_name text,
  add column if not exists professional_registration text,
  add column if not exists professional_council text default 'CRM',
  add column if not exists last_error_code text,
  add column if not exists last_error_message text;

update public.clinical_signature_connections
set professional_name = coalesce(nullif(btrim(professional_name), ''), 'Reconfiguração obrigatória'),
    professional_registration = coalesce(nullif(btrim(professional_registration), ''), 'PENDENTE'),
    professional_council = coalesce(nullif(btrim(professional_council), ''), 'CRM'),
    credential_reference = 'vault://' || id::text,
    status = 'error',
    last_error_code = 'credential_reconfiguration_required',
    last_error_message = 'Crie uma nova conexão para usar uma credencial emitida pelo cofre seguro.',
    updated_at = timezone('utc', now())
where nullif(btrim(professional_name), '') is null
   or nullif(btrim(professional_registration), '') is null
   or nullif(btrim(professional_council), '') is null
   or credential_reference !~* '^(vault|kms|hsm|provider)://[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

alter table public.clinical_signature_connections
  alter column professional_name set not null,
  alter column professional_registration set not null,
  alter column professional_council set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_signature_connections'::regclass
      and conname = 'clinical_signature_connections_safe_credential_reference'
  ) then
    alter table public.clinical_signature_connections
      add constraint clinical_signature_connections_safe_credential_reference
      check (credential_reference ~* '^(vault|kms|hsm|provider)://[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      not valid;
  end if;
end $$;

alter table public.clinical_signature_connections
  validate constraint clinical_signature_connections_safe_credential_reference;

comment on table public.clinical_signature_connections is
  'Metadados da conexao de assinatura por profissional. credential_reference aponta para segredo externo; nunca armazena PFX, chave privada ou senha.';
comment on column public.clinical_signature_connections.credential_reference is
  'Identificador opaco de credencial mantida em cofre/provedor externo. Nao inserir certificado, chave privada ou senha.';

create table if not exists public.clinical_document_signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  document_id uuid not null references public.clinical_documents(id) on delete restrict,
  requested_by uuid references auth.users(id) on delete set null,
  signer_user_id uuid not null references auth.users(id) on delete restrict,
  connection_id uuid not null references public.clinical_signature_connections(id) on delete restrict,
  request_id uuid not null,
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  provider_request_id text,
  status text not null default 'pending' check (status in ('pending', 'signed', 'failed', 'cancelled')),
  rendering_version text not null,
  document_payload_sha256 text not null check (document_payload_sha256 ~ '^[0-9a-f]{64}$'),
  signed_file_path text,
  signed_file_sha256 text check (signed_file_sha256 is null or signed_file_sha256 ~ '^[0-9a-f]{64}$'),
  signature_standard text check (signature_standard is null or signature_standard in ('PAdES-B-B', 'PAdES-B-T', 'PAdES-B-LT', 'PAdES-B-LTA')),
  certificate_subject text,
  certificate_serial text,
  certificate_issuer text,
  certificate_valid_from timestamptz,
  certificate_valid_until timestamptz,
  signed_at timestamptz,
  validation_url text,
  failure_code text,
  failure_message text,
  rule_version smallint not null default 2 check (rule_version in (1, 2)),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, document_id, request_id),
  constraint clinical_document_signatures_signed_evidence check (
    status <> 'signed'
    or (
      signed_file_path = 'clinical-signatures/' || user_id::text || '/' || document_id::text || '/' || id::text || '.pdf'
      and signed_file_sha256 is not null
      and signature_standard in ('PAdES-B-B', 'PAdES-B-T', 'PAdES-B-LT', 'PAdES-B-LTA')
      and nullif(btrim(certificate_subject), '') is not null
      and nullif(btrim(certificate_serial), '') is not null
      and nullif(btrim(certificate_issuer), '') is not null
      and certificate_valid_from is not null
      and certificate_valid_until is not null
      and certificate_valid_until > certificate_valid_from
      and signed_at is not null
      and signed_at between certificate_valid_from and certificate_valid_until
    )
  )
);

drop trigger if exists trg_clinical_signature_scope on public.clinical_document_signatures;
drop trigger if exists trg_clinical_signature_attempt_protected on public.clinical_document_signatures;

alter table public.clinical_document_signatures
  add column if not exists signed_file_sha256 text,
  add column if not exists signature_standard text,
  add column if not exists certificate_subject text,
  add column if not exists certificate_serial text,
  add column if not exists certificate_issuer text,
  add column if not exists certificate_valid_from timestamptz,
  add column if not exists certificate_valid_until timestamptz,
  add column if not exists signed_at timestamptz,
  add column if not exists validation_url text,
  add column if not exists failure_code text,
  add column if not exists failure_message text,
  add column if not exists rule_version smallint;

-- Linhas anteriores a esta revisão permanecem sob a regra v1. Assim, duas
-- evidências históricas do mesmo documento não fazem o upgrade falhar; a
-- unicidade rigorosa vale somente para novas tentativas v2.
update public.clinical_document_signatures
set rule_version = 1
where rule_version is null;

alter table public.clinical_document_signatures
  alter column rule_version set default 2,
  alter column rule_version set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_document_signatures'::regclass
      and conname = 'clinical_document_signatures_rule_version_check'
  ) then
    alter table public.clinical_document_signatures
      add constraint clinical_document_signatures_rule_version_check
      check (rule_version in (1, 2)) not valid;
  end if;
end $$;

-- Uma tentativa pendente que apontava para credencial antiga insegura não pode
-- ser enviada novamente nem aceitar callback como se a identidade tivesse sido
-- validada. O registro é preservado e terminalizado com causa auditável.
update public.clinical_document_signatures signature
set status = 'failed',
    failure_code = coalesce(nullif(signature.failure_code, ''), 'credential_reconfiguration_required'),
    failure_message = coalesce(nullif(signature.failure_message, ''), 'Tentativa encerrada no upgrade: reconecte a credencial e solicite uma nova assinatura.'),
    updated_at = timezone('utc', now())
from public.clinical_signature_connections connection
where signature.connection_id = connection.id
  and signature.status = 'pending'
  and connection.status = 'error'
  and connection.last_error_code in ('credential_reconfiguration_required', 'duplicate_active_connections');

-- NOT VALID mantém evidências legadas intactas durante upgrade, mas impõe os
-- guardrails a toda nova assinatura ou alteração a partir desta migration.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_document_signatures'::regclass
      and conname = 'clinical_document_signatures_strict_signed_evidence'
  ) then
    alter table public.clinical_document_signatures
      add constraint clinical_document_signatures_strict_signed_evidence check (
        status <> 'signed'
        or (
          signed_file_sha256 ~ '^[0-9a-f]{64}$'
          and signature_standard in ('PAdES-B-B', 'PAdES-B-T', 'PAdES-B-LT', 'PAdES-B-LTA')
          and nullif(btrim(certificate_subject), '') is not null
          and nullif(btrim(certificate_serial), '') is not null
          and nullif(btrim(certificate_issuer), '') is not null
          and certificate_valid_from is not null
          and certificate_valid_until > certificate_valid_from
          and signed_at between certificate_valid_from and certificate_valid_until
        )
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_document_signatures'::regclass
      and conname = 'clinical_document_signatures_signed_path_scope'
  ) then
    alter table public.clinical_document_signatures
      add constraint clinical_document_signatures_signed_path_scope check (
        status <> 'signed'
        or signed_file_path = 'clinical-signatures/' || user_id::text || '/' || document_id::text || '/' || id::text || '.pdf'
      ) not valid;
  end if;
end $$;

comment on table public.clinical_document_signatures is
  'Tentativas e evidencias de assinatura separadas do documento clinico imutavel. Estados terminais nao podem ser alterados ou apagados.';

drop index if exists public.uq_clinical_signature_provider_request;
create unique index uq_clinical_signature_provider_request
  on public.clinical_document_signatures(user_id, provider, provider_request_id)
  where provider_request_id is not null;
create index if not exists idx_clinical_document_signatures_document
  on public.clinical_document_signatures(user_id, document_id, created_at desc);
drop index if exists public.uq_clinical_document_signature_pending;
create unique index uq_clinical_document_signature_pending
  on public.clinical_document_signatures(user_id, document_id)
  where status = 'pending' and rule_version = 2;
drop index if exists public.uq_clinical_document_signature_signed;
create unique index uq_clinical_document_signature_signed
  on public.clinical_document_signatures(user_id, document_id)
  where status = 'signed' and rule_version = 2;
create index if not exists idx_clinical_signature_connections_professional
  on public.clinical_signature_connections(user_id, professional_user_id, status);

-- Remove qualquer UNIQUE permanente da versão anterior. A regra correta é o
-- índice parcial acima: conexões revogadas/expiradas são histórico e uma nova
-- conexão pode ser criada para o profissional.
do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.clinical_signature_connections'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%user_id%'
      and pg_get_constraintdef(oid) ilike '%professional_user_id%'
  loop
    execute format('alter table public.clinical_signature_connections drop constraint %I', constraint_row.conname);
  end loop;
end $$;

-- Se a versão anterior permitiu mais de um provedor ativo para o mesmo
-- profissional, todos são preservados e bloqueados para reconfiguração. Isso
-- evita escolher silenciosamente qual credencial poderia assinar.
with duplicated_active as (
  select user_id, professional_user_id
  from public.clinical_signature_connections
  where status in ('pending', 'active')
  group by user_id, professional_user_id
  having count(*) > 1
)
update public.clinical_signature_connections connection
set status = 'error',
    last_error_code = 'duplicate_active_connections',
    last_error_message = 'Crie uma nova conexão; múltiplas credenciais antigas foram bloqueadas por segurança.',
    updated_at = timezone('utc', now())
from duplicated_active duplicated
where connection.user_id = duplicated.user_id
  and connection.professional_user_id = duplicated.professional_user_id
  and connection.status in ('pending', 'active');

create unique index if not exists uq_clinical_signature_connection_active
  on public.clinical_signature_connections(user_id, professional_user_id)
  where status in ('pending', 'active');

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

create or replace function public.validate_clinical_signature_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  document_owner uuid;
  connection_owner uuid;
  connection_professional uuid;
  connection_provider text;
  connection_status text;
  connection_professional_name text;
  connection_professional_registration text;
  connection_professional_council text;
  document_created_by uuid;
  document_author_name text;
  document_author_registration text;
  document_author_council text;
begin
  select cd.user_id, cd.created_by, cd.author_name, cd.author_registration, cd.author_council
    into document_owner, document_created_by, document_author_name, document_author_registration, document_author_council
  from public.clinical_documents cd
  where cd.id = new.document_id;

  select c.user_id, c.professional_user_id, c.provider, c.status,
         c.professional_name, c.professional_registration, c.professional_council
    into connection_owner, connection_professional, connection_provider, connection_status,
         connection_professional_name, connection_professional_registration, connection_professional_council
  from public.clinical_signature_connections c
  where c.id = new.connection_id;

  if document_owner is null or connection_owner is null
     or new.user_id is distinct from document_owner
     or new.user_id is distinct from connection_owner
     or new.signer_user_id is distinct from connection_professional
     or new.signer_user_id is distinct from document_created_by
     or new.provider is distinct from connection_provider
     or lower(btrim(connection_professional_name)) is distinct from lower(btrim(document_author_name))
     or lower(btrim(connection_professional_registration)) is distinct from lower(btrim(document_author_registration))
     or lower(btrim(connection_professional_council)) is distinct from lower(btrim(document_author_council)) then
    raise exception 'Documento, clinica, autoria, signatario e conexao de assinatura nao pertencem ao mesmo escopo.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and (
     connection_status <> 'active'
     or (new.signer_user_id <> new.user_id and not exists (
       select 1
       from public.clinic_members cm
       join public.clinics c on c.id = cm.clinic_id
       where c.owner_id = new.user_id
         and cm.user_id = new.signer_user_id
         and cm.clinical_access is true
     ))
     or (new.requested_by is not null and new.requested_by <> new.user_id and not exists (
       select 1
       from public.clinic_members cm
       join public.clinics c on c.id = cm.clinic_id
       where c.owner_id = new.user_id
         and cm.user_id = new.requested_by
         and cm.clinical_access is true
     ))
     or exists (
       select 1
       from public.clinical_document_signatures existing
       where existing.user_id = new.user_id
         and existing.document_id = new.document_id
         and existing.status in ('pending', 'signed')
     )
  ) then
    raise exception 'A conexao ou o profissional nao esta ativo, ou o documento ja possui tentativa pendente/assinatura valida.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clinical_signature_scope on public.clinical_document_signatures;
create trigger trg_clinical_signature_scope
before insert or update on public.clinical_document_signatures
for each row execute function public.validate_clinical_signature_scope();

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
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_clinical_signature_attempt_protected on public.clinical_document_signatures;
create trigger trg_clinical_signature_attempt_protected
before update or delete on public.clinical_document_signatures
for each row execute function public.protect_clinical_signature_attempt();

create or replace function public.touch_clinical_signature_connection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_clinical_signature_connection_updated on public.clinical_signature_connections;
create trigger trg_clinical_signature_connection_updated
before update on public.clinical_signature_connections
for each row execute function public.touch_clinical_signature_connection();

alter table public.clinical_signature_connections enable row level security;
alter table public.clinical_document_signatures enable row level security;

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'clinical_signature_connections'
  loop
    execute format('drop policy if exists %I on public.clinical_signature_connections', policy_row.policyname);
  end loop;
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'clinical_document_signatures'
  loop
    execute format('drop policy if exists %I on public.clinical_document_signatures', policy_row.policyname);
  end loop;
end $$;

create policy "Clinical signature connection owner read"
on public.clinical_signature_connections
for select to authenticated
using (
  user_id = public.data_owner_id()
  and (auth.uid() = user_id or auth.uid() = professional_user_id)
);

create policy "Clinical signature evidence authorized read"
on public.clinical_document_signatures
for select to authenticated
using (user_id = public.data_owner_id() and public.has_clinical_access());

revoke insert, update, delete on public.clinical_signature_connections from authenticated;
revoke insert, update, delete on public.clinical_document_signatures from authenticated;
revoke select on public.clinical_signature_connections from authenticated;
grant select (
  id, user_id, professional_user_id, provider, signing_mode, status,
  professional_name, professional_registration, professional_council,
  certificate_subject, certificate_serial, certificate_issuer,
  certificate_valid_from, certificate_valid_until,
  last_error_code, last_error_message, created_at, updated_at
) on public.clinical_signature_connections to authenticated;
grant select on public.clinical_document_signatures to authenticated;

commit;

