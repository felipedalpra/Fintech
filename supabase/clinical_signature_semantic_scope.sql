-- Alinha a validacao transacional da assinatura com a comparacao semantica
-- usada pelo backend. Diferencas apenas de formatacao do CRM (por exemplo,
-- "CRM 12345" x "CRM-RS 12345") nao podem bloquear o mesmo profissional.
-- Autoria, usuario, clinica e numero do registro continuam obrigatoriamente
-- iguais; UFs informadas nos dois lados tambem precisam coincidir.

begin;

create or replace function public.clinical_signature_identity_text(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'))
$$;

create or replace function public.clinical_signature_council_text(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select upper(regexp_replace(coalesce(nullif(p_value, ''), 'CRM'), '[^A-Za-z]', '', 'g'))
$$;

create or replace function public.clinical_signature_registration_matches(p_left text, p_right text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  with parsed as (
    select
      regexp_replace(coalesce(p_left, ''), '[^0-9]', '', 'g') as left_number,
      regexp_replace(coalesce(p_right, ''), '[^0-9]', '', 'g') as right_number,
      (regexp_match(upper(coalesce(p_left, '')), '(^|[^A-Z])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)([^A-Z]|$)'))[2] as left_state,
      (regexp_match(upper(coalesce(p_right, '')), '(^|[^A-Z])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)([^A-Z]|$)'))[2] as right_state
  )
  select left_number <> ''
    and right_number <> ''
    and left_number = right_number
    and (left_state is null or right_state is null or left_state = right_state)
  from parsed
$$;

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
     or public.clinical_signature_identity_text(connection_professional_name)
        is distinct from public.clinical_signature_identity_text(document_author_name)
     or not public.clinical_signature_registration_matches(connection_professional_registration, document_author_registration)
     or public.clinical_signature_council_text(connection_professional_council)
        is distinct from public.clinical_signature_council_text(document_author_council) then
    raise exception 'Documento, clinica, autoria, signatario e conexao de assinatura nao pertencem ao mesmo escopo.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and (
     connection_status <> 'active'
     or (new.signer_user_id <> new.user_id and not exists (
       select 1 from public.clinic_members cm
       join public.clinics c on c.id = cm.clinic_id
       where c.owner_id = new.user_id and cm.user_id = new.signer_user_id and cm.clinical_access is true
     ))
     or (new.requested_by is not null and new.requested_by <> new.user_id and not exists (
       select 1 from public.clinic_members cm
       join public.clinics c on c.id = cm.clinic_id
       where c.owner_id = new.user_id and cm.user_id = new.requested_by and cm.clinical_access is true
     ))
     or exists (
       select 1 from public.clinical_document_signatures existing
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

revoke all on function public.clinical_signature_identity_text(text) from public, anon, authenticated;
revoke all on function public.clinical_signature_council_text(text) from public, anon, authenticated;
revoke all on function public.clinical_signature_registration_matches(text, text) from public, anon, authenticated;

commit;
