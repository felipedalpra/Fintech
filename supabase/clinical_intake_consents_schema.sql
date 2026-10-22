-- Fase 4.3: pre-anamnese publica e consentimentos versionados.
-- Executar depois de clinical_record_foundation_schema.sql,
-- clinical_anamnesis_cfm_schema.sql e clinical_anamnesis_review_fixes.sql.

begin;

create extension if not exists pgcrypto;

create table if not exists public.clinical_intake_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  family_id uuid not null default gen_random_uuid(),
  version integer not null check (version > 0),
  replaces_template_id uuid references public.clinical_intake_templates(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 160),
  description text check (description is null or length(description) <= 2000),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, family_id, version)
);

create table if not exists public.clinical_consent_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  family_id uuid not null default gen_random_uuid(),
  version integer not null check (version > 0),
  replaces_consent_id uuid references public.clinical_consent_templates(id) on delete restrict,
  consent_type text not null check (consent_type in ('tcle', 'privacy', 'image', 'procedure', 'other')),
  title text not null check (length(btrim(title)) between 1 and 200),
  content text not null check (length(btrim(content)) between 20 and 50000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  required boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, family_id, version)
);

create table if not exists public.clinical_intake_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  template_id uuid not null references public.clinical_intake_templates(id) on delete restrict,
  template_snapshot jsonb not null check (jsonb_typeof(template_snapshot) = 'object'),
  token_hash bytea not null unique,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'revoked')),
  expires_at timestamptz not null,
  opened_at timestamptz,
  submitted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint clinical_intake_request_expiry check (expires_at > created_at),
  constraint clinical_intake_request_terminal_state check (
    (status = 'pending' and submitted_at is null and revoked_at is null)
    or (status = 'submitted' and submitted_at is not null and revoked_at is null)
    or (status = 'revoked' and submitted_at is null and revoked_at is not null)
  )
);

create table if not exists public.clinical_intake_request_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null references public.clinical_intake_requests(id) on delete restrict,
  consent_template_id uuid not null references public.clinical_consent_templates(id) on delete restrict,
  consent_type text not null,
  title text not null,
  content text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  required boolean not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (request_id, consent_template_id)
);

create table if not exists public.clinical_intake_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  request_id uuid not null unique references public.clinical_intake_requests(id) on delete restrict,
  submission_request_id uuid not null,
  template_snapshot jsonb not null check (jsonb_typeof(template_snapshot) = 'object'),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  respondent_name text not null check (length(btrim(respondent_name)) between 2 and 200),
  declaration text not null,
  submitted_at timestamptz not null default timezone('utc', now()),
  unique (user_id, submission_request_id)
);

create table if not exists public.clinical_consent_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  request_id uuid not null references public.clinical_intake_requests(id) on delete restrict,
  submission_id uuid not null references public.clinical_intake_submissions(id) on delete restrict,
  consent_template_id uuid not null references public.clinical_consent_templates(id) on delete restrict,
  consent_type text not null,
  title text not null,
  content text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  respondent_name text not null,
  declaration text not null,
  accepted_at timestamptz not null default timezone('utc', now()),
  unique (submission_id, consent_template_id)
);

alter table public.clinical_intake_templates enable row level security;
alter table public.clinical_consent_templates enable row level security;
alter table public.clinical_intake_requests enable row level security;
alter table public.clinical_intake_request_consents enable row level security;
alter table public.clinical_intake_submissions enable row level security;
alter table public.clinical_consent_acceptances enable row level security;

do $$
declare
  table_name text;
  policy_row record;
begin
  foreach table_name in array array[
    'clinical_intake_templates', 'clinical_consent_templates', 'clinical_intake_requests',
    'clinical_intake_request_consents', 'clinical_intake_submissions', 'clinical_consent_acceptances'
  ] loop
    for policy_row in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, table_name);
    end loop;
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = public.data_owner_id() and public.has_clinical_access())',
      table_name || '_clinical_read', table_name
    );
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end $$;

-- The access token is intentionally write-only. Authenticated clients can inspect
-- invitation metadata, but cannot read the digest used to validate public links.
revoke select on public.clinical_intake_requests from authenticated;
grant select (
  id, user_id, patient_id, template_id, template_snapshot, status, expires_at,
  opened_at, submitted_at, revoked_at, created_by, created_at
) on public.clinical_intake_requests to authenticated;

create or replace function public.validate_clinical_intake_definition(p_definition jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  field jsonb;
  field_id text;
  field_type text;
  seen_ids text[] := array[]::text[];
begin
  if jsonb_typeof(p_definition) <> 'object'
    or jsonb_typeof(p_definition -> 'fields') <> 'array'
    or jsonb_array_length(p_definition -> 'fields') not between 1 and 40 then
    return false;
  end if;

  for field in select value from jsonb_array_elements(p_definition -> 'fields') loop
    if jsonb_typeof(field) <> 'object' then return false; end if;
    field_id := field ->> 'id';
    field_type := field ->> 'type';
    if field_id is null or field_id !~ '^[a-z][a-z0-9_]{1,49}$' or field_id = any(seen_ids) then return false; end if;
    if length(btrim(coalesce(field ->> 'label', ''))) not between 1 and 160 then return false; end if;
    if field_type not in ('text', 'textarea', 'date', 'boolean', 'select', 'multiselect') then return false; end if;
    if field ? 'required' and jsonb_typeof(field -> 'required') <> 'boolean' then return false; end if;
    if field ? 'soap_field' and coalesce(field ->> 'soap_field', '') not in (
      '', 'chief_complaint', 'history_present_illness', 'personal_history', 'family_history', 'review_of_systems'
    ) then return false; end if;
    if field_type in ('select', 'multiselect') then
      if jsonb_typeof(field -> 'options') <> 'array'
        or jsonb_array_length(field -> 'options') not between 1 and 30 then return false; end if;
    end if;
    seen_ids := array_append(seen_ids, field_id);
  end loop;
  return true;
end;
$$;

create or replace function public.create_clinical_intake_template(
  p_title text,
  p_description text,
  p_definition jsonb,
  p_replaces_template_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid;
  next_id uuid;
  next_family uuid;
  next_version integer := 1;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 160
    or not public.validate_clinical_intake_definition(p_definition) then
    raise exception 'Titulo ou definicao do formulario invalidos.' using errcode = '22023';
  end if;
  owner_id := public.data_owner_id();
  if p_replaces_template_id is not null then
    select family_id, version + 1 into next_family, next_version
    from public.clinical_intake_templates
    where id = p_replaces_template_id and user_id = owner_id;
    if next_family is null then
      raise exception 'Modelo anterior fora do escopo da clinica.' using errcode = '42501';
    end if;
  else
    next_family := gen_random_uuid();
  end if;
  insert into public.clinical_intake_templates(
    user_id, family_id, version, replaces_template_id, title, description, definition, created_by
  ) values (
    owner_id, next_family, next_version, p_replaces_template_id, btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''), p_definition, auth.uid()
  ) returning id into next_id;
  return next_id;
end;
$$;

create or replace function public.create_clinical_consent_template(
  p_title text,
  p_content text,
  p_consent_type text default 'tcle',
  p_required boolean default true,
  p_replaces_consent_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid;
  next_id uuid;
  next_family uuid;
  next_version integer := 1;
  normalized_content text;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  normalized_content := btrim(coalesce(p_content, ''));
  if length(btrim(coalesce(p_title, ''))) not between 1 and 200
    or length(normalized_content) not between 20 and 50000
    or p_consent_type not in ('tcle', 'privacy', 'image', 'procedure', 'other') then
    raise exception 'Termo de consentimento invalido.' using errcode = '22023';
  end if;
  owner_id := public.data_owner_id();
  if p_replaces_consent_id is not null then
    select family_id, version + 1 into next_family, next_version
    from public.clinical_consent_templates
    where id = p_replaces_consent_id and user_id = owner_id;
    if next_family is null then
      raise exception 'Termo anterior fora do escopo da clinica.' using errcode = '42501';
    end if;
  else
    next_family := gen_random_uuid();
  end if;
  insert into public.clinical_consent_templates(
    user_id, family_id, version, replaces_consent_id, consent_type, title,
    content, content_sha256, required, created_by
  ) values (
    owner_id, next_family, next_version, p_replaces_consent_id, p_consent_type,
    btrim(p_title), normalized_content,
    encode(digest(convert_to(normalized_content, 'UTF8'), 'sha256'), 'hex'),
    coalesce(p_required, true), auth.uid()
  ) returning id into next_id;
  return next_id;
end;
$$;

create or replace function public.create_clinical_intake_request(
  p_patient_id uuid,
  p_template_id uuid,
  p_consent_ids uuid[] default array[]::uuid[],
  p_valid_days integer default 3
)
returns table(request_id uuid, access_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid;
  raw_token text;
  created_request public.clinical_intake_requests;
  selected_template public.clinical_intake_templates;
  consent_count integer;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  if p_valid_days not between 1 and 7 then
    raise exception 'A validade deve ficar entre 1 e 7 dias.' using errcode = '22023';
  end if;
  owner_id := public.data_owner_id();
  if not exists (select 1 from public.patients p where p.id = p_patient_id and p.user_id = owner_id) then
    raise exception 'Paciente fora do escopo da clinica.' using errcode = '42501';
  end if;
  select * into selected_template from public.clinical_intake_templates
  where id = p_template_id and user_id = owner_id;
  if selected_template.id is null then
    raise exception 'Modelo fora do escopo da clinica.' using errcode = '42501';
  end if;
  select count(*) into consent_count from public.clinical_consent_templates
  where user_id = owner_id and id = any(coalesce(p_consent_ids, array[]::uuid[]));
  if consent_count <> cardinality(coalesce(p_consent_ids, array[]::uuid[]))
    or consent_count <> (select count(distinct value) from unnest(coalesce(p_consent_ids, array[]::uuid[])) value) then
    raise exception 'Um ou mais termos sao invalidos ou repetidos.' using errcode = '22023';
  end if;

  raw_token := encode(gen_random_bytes(32), 'hex');
  insert into public.clinical_intake_requests(
    user_id, patient_id, template_id, template_snapshot, token_hash,
    expires_at, created_by
  ) values (
    owner_id, p_patient_id, selected_template.id,
    jsonb_build_object(
      'id', selected_template.id,
      'title', selected_template.title,
      'description', selected_template.description,
      'version', selected_template.version,
      'definition', selected_template.definition
    ),
    digest(convert_to(raw_token, 'UTF8'), 'sha256'),
    timezone('utc', now()) + make_interval(days => p_valid_days), auth.uid()
  ) returning * into created_request;

  insert into public.clinical_intake_request_consents(
    user_id, request_id, consent_template_id, consent_type, title,
    content, content_sha256, required
  )
  select owner_id, created_request.id, ct.id, ct.consent_type, ct.title,
    ct.content, ct.content_sha256, ct.required
  from public.clinical_consent_templates ct
  where ct.user_id = owner_id and ct.id = any(coalesce(p_consent_ids, array[]::uuid[]));

  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, p_patient_id, auth.uid(), 'create_intake_request');

  return query select created_request.id, raw_token, created_request.expires_at;
end;
$$;

create or replace function public.revoke_clinical_intake_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  update public.clinical_intake_requests
  set status = 'revoked', revoked_at = timezone('utc', now())
  where id = p_request_id and user_id = public.data_owner_id() and status = 'pending';
  return found;
end;
$$;

create or replace function public.get_public_clinical_intake(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_request public.clinical_intake_requests;
  clinic_label text;
  terms jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Link invalido ou indisponivel.' using errcode = '22023';
  end if;
  select * into target_request
  from public.clinical_intake_requests r
  where r.token_hash = digest(convert_to(p_token, 'UTF8'), 'sha256')
    and r.status = 'pending'
    and r.expires_at > timezone('utc', now());
  if target_request.id is null then
    raise exception 'Link invalido ou indisponivel.' using errcode = '22023';
  end if;
  update public.clinical_intake_requests
  set opened_at = coalesce(opened_at, timezone('utc', now()))
  where id = target_request.id;
  select coalesce(nullif(btrim(c.name), ''), 'Clínica') into clinic_label
  from public.clinics c where c.owner_id = target_request.user_id limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rc.consent_template_id,
    'type', rc.consent_type,
    'title', rc.title,
    'content', rc.content,
    'required', rc.required
  ) order by rc.created_at), '[]'::jsonb) into terms
  from public.clinical_intake_request_consents rc where rc.request_id = target_request.id;
  return jsonb_build_object(
    'clinicName', coalesce(clinic_label, 'Clínica'),
    'title', target_request.template_snapshot ->> 'title',
    'description', target_request.template_snapshot ->> 'description',
    'definition', target_request.template_snapshot -> 'definition',
    'consents', terms,
    'expiresAt', target_request.expires_at
  );
end;
$$;

create or replace function public.submit_public_clinical_intake(
  p_token text,
  p_submission_request_id uuid,
  p_answers jsonb,
  p_respondent_name text,
  p_accepted_consent_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_request public.clinical_intake_requests;
  existing_submission uuid;
  created_submission uuid;
  field jsonb;
  field_id text;
  field_type text;
  answer jsonb;
  request_consent public.clinical_intake_request_consents;
  declared_name text;
  declaration_text text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_submission_request_id is null then
    raise exception 'Link invalido ou indisponivel.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 200000 then
    raise exception 'Respostas invalidas ou muito extensas.' using errcode = '22023';
  end if;
  declared_name := btrim(coalesce(p_respondent_name, ''));
  if length(declared_name) not between 2 and 200 then
    raise exception 'Informe o nome de quem esta respondendo.' using errcode = '22023';
  end if;

  select * into target_request
  from public.clinical_intake_requests r
  where r.token_hash = digest(convert_to(p_token, 'UTF8'), 'sha256')
  for update;
  if target_request.id is null then
    raise exception 'Link invalido ou indisponivel.' using errcode = '22023';
  end if;

  select s.id into existing_submission
  from public.clinical_intake_submissions s
  where s.user_id = target_request.user_id
    and s.submission_request_id = p_submission_request_id;
  if existing_submission is not null then
    return existing_submission;
  end if;
  if target_request.status <> 'pending' or target_request.expires_at <= timezone('utc', now()) then
    raise exception 'Link invalido ou indisponivel.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_answers) answer_key
    where not exists (
      select 1 from jsonb_array_elements(target_request.template_snapshot #> '{definition,fields}') f
      where f ->> 'id' = answer_key
    )
  ) then
    raise exception 'A resposta contem campos que nao pertencem ao formulario.' using errcode = '22023';
  end if;

  for field in select value from jsonb_array_elements(target_request.template_snapshot #> '{definition,fields}') loop
    field_id := field ->> 'id';
    field_type := field ->> 'type';
    answer := p_answers -> field_id;
    if coalesce((field ->> 'required')::boolean, false) and (
      answer is null or answer = 'null'::jsonb or answer = '""'::jsonb or answer = '[]'::jsonb
    ) then
      raise exception 'Preencha todos os campos obrigatorios.' using errcode = '22023';
    end if;
    if answer is null or answer = 'null'::jsonb then continue; end if;
    if field_type in ('text', 'textarea', 'date', 'select') and jsonb_typeof(answer) <> 'string' then
      raise exception 'Formato de resposta invalido.' using errcode = '22023';
    end if;
    if field_type = 'boolean' and jsonb_typeof(answer) <> 'boolean' then
      raise exception 'Formato de resposta invalido.' using errcode = '22023';
    end if;
    if field_type = 'multiselect' and jsonb_typeof(answer) <> 'array' then
      raise exception 'Formato de resposta invalido.' using errcode = '22023';
    end if;
    if octet_length(answer::text) > 20000 then
      raise exception 'Uma das respostas excede o limite permitido.' using errcode = '22023';
    end if;
    if field_type = 'select' and not exists (
      select 1 from jsonb_array_elements_text(field -> 'options') option_value
      where option_value = trim(both '"' from answer::text)
    ) then
      raise exception 'Opcao selecionada invalida.' using errcode = '22023';
    end if;
    if field_type = 'multiselect' and exists (
      select 1 from jsonb_array_elements_text(answer) selected_value
      where not exists (
        select 1 from jsonb_array_elements_text(field -> 'options') option_value
        where option_value = selected_value
      )
    ) then
      raise exception 'Opcao selecionada invalida.' using errcode = '22023';
    end if;
  end loop;

  for request_consent in
    select * from public.clinical_intake_request_consents where request_id = target_request.id
  loop
    if request_consent.required and not (request_consent.consent_template_id = any(coalesce(p_accepted_consent_ids, array[]::uuid[]))) then
      raise exception 'Aceite todos os termos obrigatorios.' using errcode = '22023';
    end if;
  end loop;

  declaration_text := 'Declaro que as respostas foram fornecidas por mim e que li e aceitei os termos selecionados.';
  insert into public.clinical_intake_submissions(
    user_id, patient_id, request_id, submission_request_id, template_snapshot,
    answers, respondent_name, declaration
  ) values (
    target_request.user_id, target_request.patient_id, target_request.id,
    p_submission_request_id, target_request.template_snapshot, p_answers,
    declared_name, declaration_text
  ) returning id into created_submission;

  insert into public.clinical_consent_acceptances(
    user_id, patient_id, request_id, submission_id, consent_template_id,
    consent_type, title, content, content_sha256, respondent_name, declaration
  )
  select target_request.user_id, target_request.patient_id, target_request.id,
    created_submission, rc.consent_template_id, rc.consent_type, rc.title,
    rc.content, rc.content_sha256, declared_name, declaration_text
  from public.clinical_intake_request_consents rc
  where rc.request_id = target_request.id
    and rc.consent_template_id = any(coalesce(p_accepted_consent_ids, array[]::uuid[]));

  update public.clinical_intake_requests
  set status = 'submitted', submitted_at = timezone('utc', now())
  where id = target_request.id;
  return created_submission;
end;
$$;

alter table public.clinical_record_access_logs
  drop constraint if exists clinical_record_access_logs_action_check;
alter table public.clinical_record_access_logs
  add constraint clinical_record_access_logs_action_check
  check (action in (
    'view_record', 'create_record', 'create_addendum', 'create_anamnesis',
    'create_document', 'create_intake_request', 'view_intake_response'
  ));

revoke all on function public.validate_clinical_intake_definition(jsonb) from public, anon, authenticated;
revoke all on function public.create_clinical_intake_template(text, text, jsonb, uuid) from public, anon;
revoke all on function public.create_clinical_consent_template(text, text, text, boolean, uuid) from public, anon;
revoke all on function public.create_clinical_intake_request(uuid, uuid, uuid[], integer) from public, anon;
revoke all on function public.revoke_clinical_intake_request(uuid) from public, anon;
revoke all on function public.get_public_clinical_intake(text) from public;
revoke all on function public.submit_public_clinical_intake(text, uuid, jsonb, text, uuid[]) from public;

grant execute on function public.create_clinical_intake_template(text, text, jsonb, uuid) to authenticated;
grant execute on function public.create_clinical_consent_template(text, text, text, boolean, uuid) to authenticated;
grant execute on function public.create_clinical_intake_request(uuid, uuid, uuid[], integer) to authenticated;
grant execute on function public.revoke_clinical_intake_request(uuid) to authenticated;
grant execute on function public.get_public_clinical_intake(text) to anon, authenticated;
grant execute on function public.submit_public_clinical_intake(text, uuid, jsonb, text, uuid[]) to anon, authenticated;

create index if not exists idx_clinical_intake_templates_clinic
  on public.clinical_intake_templates(user_id, created_at desc);
create index if not exists idx_clinical_consent_templates_clinic
  on public.clinical_consent_templates(user_id, created_at desc);
create index if not exists idx_clinical_intake_requests_patient
  on public.clinical_intake_requests(user_id, patient_id, created_at desc);
create index if not exists idx_clinical_intake_submissions_patient
  on public.clinical_intake_submissions(user_id, patient_id, submitted_at desc);
create index if not exists idx_clinical_consent_acceptances_patient
  on public.clinical_consent_acceptances(user_id, patient_id, accepted_at desc);

do $$
begin
  drop trigger if exists trg_clinical_intake_templates_immutable on public.clinical_intake_templates;
  create trigger trg_clinical_intake_templates_immutable before update or delete on public.clinical_intake_templates
    for each row execute function public.prevent_clinical_record_mutation();
  drop trigger if exists trg_clinical_consent_templates_immutable on public.clinical_consent_templates;
  create trigger trg_clinical_consent_templates_immutable before update or delete on public.clinical_consent_templates
    for each row execute function public.prevent_clinical_record_mutation();
  drop trigger if exists trg_clinical_intake_request_consents_immutable on public.clinical_intake_request_consents;
  create trigger trg_clinical_intake_request_consents_immutable before update or delete on public.clinical_intake_request_consents
    for each row execute function public.prevent_clinical_record_mutation();
  drop trigger if exists trg_clinical_intake_submissions_immutable on public.clinical_intake_submissions;
  create trigger trg_clinical_intake_submissions_immutable before update or delete on public.clinical_intake_submissions
    for each row execute function public.prevent_clinical_record_mutation();
  drop trigger if exists trg_clinical_consent_acceptances_immutable on public.clinical_consent_acceptances;
  create trigger trg_clinical_consent_acceptances_immutable before update or delete on public.clinical_consent_acceptances
    for each row execute function public.prevent_clinical_record_mutation();
end $$;

comment on table public.clinical_intake_submissions is
  'Declaracoes imutaveis preenchidas pelo paciente; nao possuem autoria profissional e nao sao anamnese SOAP assinada.';
comment on table public.clinical_consent_acceptances is
  'Evidencias imutaveis de aceite eletronico simples; nao representam assinatura qualificada ICP-Brasil.';

commit;
