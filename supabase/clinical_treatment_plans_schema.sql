-- Fase 4.5: planos terapeuticos, sessoes e retornos clinicos.
-- Executar depois de clinical_record_foundation_schema.sql e google_calendar_schema.sql.
-- A migration e aditiva, idempotente e nao altera registros clinicos existentes.

begin;

create extension if not exists pgcrypto;

create table if not exists public.clinical_treatment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, request_id)
);

create table if not exists public.clinical_treatment_plan_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  plan_id uuid not null references public.clinical_treatment_plans(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  title text not null check (length(btrim(title)) between 1 and 160),
  indication text not null check (length(btrim(indication)) between 1 and 5000),
  diagnostic_summary text check (diagnostic_summary is null or length(diagnostic_summary) <= 5000),
  objectives text not null check (length(btrim(objectives)) between 1 and 5000),
  planned_treatment text not null check (length(btrim(planned_treatment)) between 1 and 10000),
  guidance text not null check (length(btrim(guidance)) between 1 and 5000),
  expected_start_on date,
  review_on date,
  created_by uuid not null references auth.users(id) on delete restrict,
  author_name text not null,
  author_registration text not null,
  author_council text not null default 'CRM',
  request_id uuid not null,
  recorded_at timestamptz not null default timezone('utc', now()),
  unique (plan_id, version_number),
  unique (user_id, request_id),
  constraint treatment_plan_review_after_start check (
    review_on is null or expected_start_on is null or review_on >= expected_start_on
  )
);

create table if not exists public.clinical_treatment_plan_status_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  plan_id uuid not null references public.clinical_treatment_plans(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  status text not null check (status in ('active', 'completed', 'cancelled')),
  reason text check (reason is null or length(reason) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  author_name text not null,
  author_registration text not null,
  author_council text not null default 'CRM',
  request_id uuid not null,
  recorded_at timestamptz not null default timezone('utc', now()),
  unique (user_id, request_id)
);

create table if not exists public.clinical_treatment_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  plan_id uuid not null references public.clinical_treatment_plans(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  session_type text not null check (session_type in ('procedure', 'consultation', 'return', 'exam', 'other')),
  title text not null check (length(btrim(title)) between 1 and 160),
  instructions text check (instructions is null or length(instructions) <= 5000),
  created_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (plan_id, sequence_number),
  unique (user_id, request_id)
);

create table if not exists public.clinical_treatment_session_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null references public.clinical_treatment_sessions(id) on delete restrict,
  plan_id uuid not null references public.clinical_treatment_plans(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  status text not null check (status in ('planned', 'scheduled', 'rescheduled', 'cancelled', 'no_show', 'completed')),
  scheduled_start timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 5 and 1440),
  reason text check (reason is null or length(reason) <= 2000),
  consultation_id uuid references public.consultations(id) on delete restrict,
  medical_record_id uuid references public.medical_records(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  author_name text not null,
  author_registration text not null,
  author_council text not null default 'CRM',
  request_id uuid not null,
  recorded_at timestamptz not null default timezone('utc', now()),
  unique (user_id, request_id),
  constraint treatment_session_event_links check (
    (status = 'completed' and medical_record_id is not null)
    or (status <> 'completed' and medical_record_id is null)
  ),
  constraint treatment_session_schedule_required check (
    status not in ('scheduled', 'rescheduled') or scheduled_start is not null
  )
);

alter table public.medical_records
  add column if not exists care_occurred_at timestamptz,
  add column if not exists treatment_plan_id uuid references public.clinical_treatment_plans(id) on delete restrict,
  add column if not exists treatment_session_id uuid references public.clinical_treatment_sessions(id) on delete restrict;

create unique index if not exists idx_treatment_session_completed_once
  on public.clinical_treatment_session_events(session_id) where status = 'completed';
create unique index if not exists idx_treatment_session_consultation_once
  on public.clinical_treatment_session_events(consultation_id) where consultation_id is not null;
create index if not exists idx_treatment_plans_patient
  on public.clinical_treatment_plans(user_id, patient_id, created_at desc);
create index if not exists idx_treatment_versions_plan
  on public.clinical_treatment_plan_versions(plan_id, version_number desc);
create index if not exists idx_treatment_sessions_plan
  on public.clinical_treatment_sessions(plan_id, sequence_number);
create index if not exists idx_treatment_session_events_session
  on public.clinical_treatment_session_events(session_id, recorded_at, id);

alter table public.clinical_treatment_plans enable row level security;
alter table public.clinical_treatment_plan_versions enable row level security;
alter table public.clinical_treatment_plan_status_events enable row level security;
alter table public.clinical_treatment_sessions enable row level security;
alter table public.clinical_treatment_session_events enable row level security;

do $$
declare table_name text; policy_row record;
begin
  foreach table_name in array array[
    'clinical_treatment_plans', 'clinical_treatment_plan_versions',
    'clinical_treatment_plan_status_events', 'clinical_treatment_sessions',
    'clinical_treatment_session_events'
  ] loop
    for policy_row in select policyname from pg_policies where schemaname = 'public' and tablename = table_name loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, table_name);
    end loop;
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = public.data_owner_id() and public.has_clinical_access())',
      table_name || ' authorized read', table_name
    );
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end $$;

create or replace function public.prevent_treatment_record_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Plano terapeutico e historico sao imutaveis; registre uma nova versao ou evento.' using errcode = '55000';
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'clinical_treatment_plans', 'clinical_treatment_plan_versions',
    'clinical_treatment_plan_status_events', 'clinical_treatment_sessions',
    'clinical_treatment_session_events'
  ] loop
    execute format('drop trigger if exists trg_%s_immutable on public.%I', table_name, table_name);
    execute format('create trigger trg_%s_immutable before update or delete on public.%I for each row execute function public.prevent_treatment_record_mutation()', table_name, table_name);
  end loop;
end $$;

create or replace function public.assert_clinical_treatment_author()
returns table(author_name text, author_registration text, author_council text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  return query select i.author_name, i.author_registration, coalesce(nullif(btrim(i.author_council), ''), 'CRM')
    from public.clinical_author_identity() i
    where upper(regexp_replace(coalesce(i.author_council, ''), '[^A-Za-z]', '', 'g')) = 'CRM'
      and nullif(btrim(i.author_name), '') is not null
      and nullif(btrim(i.author_registration), '') is not null;
  if not found then
    raise exception 'Configure nome e CRM do profissional antes de registrar o plano.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.create_clinical_treatment_plan(
  p_patient_id uuid, p_request_id uuid, p_title text, p_indication text,
  p_diagnostic_summary text, p_objectives text, p_planned_treatment text,
  p_guidance text, p_expected_start_on date, p_review_on date,
  p_sessions jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owner_id uuid := public.data_owner_id(); plan_id uuid; identity record; item jsonb;
  session_id uuid; session_request uuid; next_sequence integer := 0; initial_status text;
begin
  select * into identity from public.assert_clinical_treatment_author();
  if p_patient_id is null or p_request_id is null or nullif(btrim(p_title), '') is null
    or nullif(btrim(p_indication), '') is null or nullif(btrim(p_objectives), '') is null
    or nullif(btrim(p_planned_treatment), '') is null or nullif(btrim(p_guidance), '') is null then
    raise exception 'Paciente, titulo, indicacao, objetivos, tratamento e orientacoes sao obrigatorios.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.patients p where p.id = p_patient_id and p.user_id = owner_id and p.active) then
    raise exception 'Paciente fora do escopo da clinica.' using errcode = '42501';
  end if;
  select p.id into plan_id from public.clinical_treatment_plans p where p.user_id = owner_id and p.request_id = p_request_id;
  if plan_id is not null then return plan_id; end if;

  insert into public.clinical_treatment_plans(user_id, patient_id, created_by, request_id)
  values (owner_id, p_patient_id, auth.uid(), p_request_id) returning id into plan_id;
  insert into public.clinical_treatment_plan_versions(
    user_id, plan_id, patient_id, version_number, title, indication, diagnostic_summary,
    objectives, planned_treatment, guidance, expected_start_on, review_on, created_by,
    author_name, author_registration, author_council, request_id
  ) values (
    owner_id, plan_id, p_patient_id, 1, btrim(p_title), btrim(p_indication), nullif(btrim(p_diagnostic_summary), ''),
    btrim(p_objectives), btrim(p_planned_treatment), btrim(p_guidance), p_expected_start_on, p_review_on,
    auth.uid(), identity.author_name, identity.author_registration, identity.author_council, p_request_id
  );
  insert into public.clinical_treatment_plan_status_events(
    user_id, plan_id, patient_id, status, created_by, author_name, author_registration, author_council, request_id
  ) values (owner_id, plan_id, p_patient_id, 'active', auth.uid(), identity.author_name, identity.author_registration, identity.author_council, p_request_id);

  if jsonb_typeof(coalesce(p_sessions, '[]'::jsonb)) <> 'array' then
    raise exception 'Sessoes devem ser enviadas como lista.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) > 100 then
    raise exception 'Um plano pode iniciar com no maximo 100 sessoes.' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_sessions, '[]'::jsonb)) loop
    next_sequence := next_sequence + 1;
    session_request := coalesce(nullif(item->>'request_id', '')::uuid, gen_random_uuid());
    if nullif(btrim(item->>'title'), '') is null then
      raise exception 'Toda sessao precisa de titulo.' using errcode = '22023';
    end if;
    insert into public.clinical_treatment_sessions(
      user_id, plan_id, patient_id, sequence_number, session_type, title, instructions, created_by, request_id
    ) values (
      owner_id, plan_id, p_patient_id, next_sequence, coalesce(nullif(item->>'session_type', ''), 'procedure'),
      btrim(item->>'title'), nullif(btrim(item->>'instructions'), ''), auth.uid(), session_request
    ) returning id into session_id;
    initial_status := case when nullif(item->>'scheduled_start', '') is null then 'planned' else 'scheduled' end;
    insert into public.clinical_treatment_session_events(
      user_id, session_id, plan_id, patient_id, status, scheduled_start, duration_minutes,
      created_by, author_name, author_registration, author_council, request_id
    ) values (
      owner_id, session_id, plan_id, p_patient_id, initial_status,
      nullif(item->>'scheduled_start', '')::timestamptz, nullif(item->>'duration_minutes', '')::integer,
      auth.uid(), identity.author_name, identity.author_registration, identity.author_council, session_request
    );
  end loop;
  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, p_patient_id, auth.uid(), 'create_treatment_plan');
  return plan_id;
end;
$$;

create or replace function public.revise_clinical_treatment_plan(
  p_plan_id uuid, p_request_id uuid, p_title text, p_indication text,
  p_diagnostic_summary text, p_objectives text, p_planned_treatment text,
  p_guidance text, p_expected_start_on date, p_review_on date
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid := public.data_owner_id(); patient_id uuid; version_id uuid; next_version integer; identity record;
begin
  select * into identity from public.assert_clinical_treatment_author();
  select v.id into version_id from public.clinical_treatment_plan_versions v where v.user_id = owner_id and v.request_id = p_request_id;
  if version_id is not null then return version_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text, 0));
  select p.patient_id into patient_id from public.clinical_treatment_plans p where p.id = p_plan_id and p.user_id = owner_id;
  if patient_id is null then raise exception 'Plano fora do escopo.' using errcode = '42501'; end if;
  if (select e.status from public.clinical_treatment_plan_status_events e where e.plan_id = p_plan_id order by e.recorded_at desc, e.id desc limit 1) <> 'active' then
    raise exception 'Somente planos ativos podem receber nova versao.' using errcode = '22023';
  end if;
  if nullif(btrim(p_title), '') is null or nullif(btrim(p_indication), '') is null or nullif(btrim(p_objectives), '') is null
    or nullif(btrim(p_planned_treatment), '') is null or nullif(btrim(p_guidance), '') is null then
    raise exception 'Preencha os campos clinicos obrigatorios.' using errcode = '22023';
  end if;
  select coalesce(max(v.version_number), 0) + 1 into next_version from public.clinical_treatment_plan_versions v where v.plan_id = p_plan_id;
  insert into public.clinical_treatment_plan_versions(
    user_id, plan_id, patient_id, version_number, title, indication, diagnostic_summary, objectives,
    planned_treatment, guidance, expected_start_on, review_on, created_by, author_name,
    author_registration, author_council, request_id
  ) values (
    owner_id, p_plan_id, patient_id, next_version, btrim(p_title), btrim(p_indication), nullif(btrim(p_diagnostic_summary), ''),
    btrim(p_objectives), btrim(p_planned_treatment), btrim(p_guidance), p_expected_start_on, p_review_on,
    auth.uid(), identity.author_name, identity.author_registration, identity.author_council, p_request_id
  ) returning id into version_id;
  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, patient_id, auth.uid(), 'revise_treatment_plan');
  return version_id;
end;
$$;

create or replace function public.add_clinical_treatment_session(
  p_plan_id uuid, p_request_id uuid, p_session_type text, p_title text, p_instructions text,
  p_scheduled_start timestamptz, p_duration_minutes integer
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid := public.data_owner_id(); patient_id uuid; session_id uuid; next_sequence integer; identity record;
begin
  select * into identity from public.assert_clinical_treatment_author();
  select s.id into session_id from public.clinical_treatment_sessions s where s.user_id = owner_id and s.request_id = p_request_id;
  if session_id is not null then return session_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text, 0));
  select p.patient_id into patient_id from public.clinical_treatment_plans p where p.id = p_plan_id and p.user_id = owner_id;
  if patient_id is null then raise exception 'Plano fora do escopo.' using errcode = '42501'; end if;
  if (select e.status from public.clinical_treatment_plan_status_events e where e.plan_id = p_plan_id order by e.recorded_at desc, e.id desc limit 1) <> 'active' then
    raise exception 'Somente planos ativos podem receber novas sessoes.' using errcode = '22023';
  end if;
  if nullif(btrim(p_title), '') is null or p_session_type not in ('procedure', 'consultation', 'return', 'exam', 'other') then
    raise exception 'Tipo e titulo validos sao obrigatorios.' using errcode = '22023';
  end if;
  select coalesce(max(s.sequence_number), 0) + 1 into next_sequence from public.clinical_treatment_sessions s where s.plan_id = p_plan_id;
  insert into public.clinical_treatment_sessions(user_id, plan_id, patient_id, sequence_number, session_type, title, instructions, created_by, request_id)
  values (owner_id, p_plan_id, patient_id, next_sequence, p_session_type, btrim(p_title), nullif(btrim(p_instructions), ''), auth.uid(), p_request_id)
  returning id into session_id;
  insert into public.clinical_treatment_session_events(
    user_id, session_id, plan_id, patient_id, status, scheduled_start, duration_minutes,
    created_by, author_name, author_registration, author_council, request_id
  ) values (
    owner_id, session_id, p_plan_id, patient_id, case when p_scheduled_start is null then 'planned' else 'scheduled' end,
    p_scheduled_start, p_duration_minutes, auth.uid(), identity.author_name, identity.author_registration, identity.author_council, p_request_id
  );
  return session_id;
end;
$$;

create or replace function public.record_clinical_treatment_session_event(
  p_session_id uuid, p_request_id uuid, p_status text, p_scheduled_start timestamptz,
  p_duration_minutes integer, p_reason text, p_consultation_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid := public.data_owner_id(); session_row record; event_id uuid; identity record; consultation_valid boolean;
begin
  select * into identity from public.assert_clinical_treatment_author();
  select e.id into event_id from public.clinical_treatment_session_events e where e.user_id = owner_id and e.request_id = p_request_id;
  if event_id is not null then return event_id; end if;
  select s.* into session_row from public.clinical_treatment_sessions s where s.id = p_session_id and s.user_id = owner_id;
  if session_row.id is null then raise exception 'Sessao fora do escopo.' using errcode = '42501'; end if;
  if (select e.status from public.clinical_treatment_plan_status_events e where e.plan_id = session_row.plan_id order by e.recorded_at desc, e.id desc limit 1) <> 'active' then
    raise exception 'O plano esta encerrado.' using errcode = '22023';
  end if;
  if (select e.status from public.clinical_treatment_session_events e where e.session_id = p_session_id order by e.recorded_at desc, e.id desc limit 1) = 'completed' then
    raise exception 'Sessao concluida nao pode receber novos eventos.' using errcode = '22023';
  end if;
  if p_status not in ('planned', 'scheduled', 'rescheduled', 'cancelled', 'no_show') then
    raise exception 'Estado de sessao invalido.' using errcode = '22023';
  end if;
  if p_status in ('scheduled', 'rescheduled') and p_scheduled_start is null then
    raise exception 'Data e hora sao obrigatorias para agendar.' using errcode = '22023';
  end if;
  if p_status in ('cancelled', 'no_show') and nullif(btrim(p_reason), '') is null then
    raise exception 'Informe o motivo para preservar o historico clinico.' using errcode = '22023';
  end if;
  if p_consultation_id is not null then
    select exists(select 1 from public.consultations c where c.id = p_consultation_id and c.user_id = owner_id and c.patient_id = session_row.patient_id)
      into consultation_valid;
    if not consultation_valid then raise exception 'Consulta fora do plano ou da clinica.' using errcode = '42501'; end if;
  end if;
  insert into public.clinical_treatment_session_events(
    user_id, session_id, plan_id, patient_id, status, scheduled_start, duration_minutes, reason, consultation_id,
    created_by, author_name, author_registration, author_council, request_id
  ) values (
    owner_id, p_session_id, session_row.plan_id, session_row.patient_id, p_status, p_scheduled_start,
    p_duration_minutes, nullif(btrim(p_reason), ''), p_consultation_id, auth.uid(), identity.author_name,
    identity.author_registration, identity.author_council, p_request_id
  ) returning id into event_id;
  return event_id;
end;
$$;

create or replace function public.complete_clinical_treatment_session(
  p_session_id uuid, p_request_id uuid, p_care_occurred_at timestamptz,
  p_evolution_notes text, p_procedures_applied text, p_next_appointment_date date
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid := public.data_owner_id(); session_row record; record_id uuid; identity record;
begin
  select * into identity from public.assert_clinical_treatment_author();
  select e.medical_record_id into record_id from public.clinical_treatment_session_events e
    where e.user_id = owner_id and e.request_id = p_request_id and e.status = 'completed';
  if record_id is not null then return record_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  select s.* into session_row from public.clinical_treatment_sessions s where s.id = p_session_id and s.user_id = owner_id;
  if session_row.id is null then raise exception 'Sessao fora do escopo.' using errcode = '42501'; end if;
  if (select e.status from public.clinical_treatment_plan_status_events e where e.plan_id = session_row.plan_id order by e.recorded_at desc, e.id desc limit 1) <> 'active' then
    raise exception 'O plano esta encerrado.' using errcode = '22023';
  end if;
  if exists(select 1 from public.clinical_treatment_session_events e where e.session_id = p_session_id and e.status = 'completed') then
    raise exception 'Sessao ja concluida.' using errcode = '23505';
  end if;
  if (select e.status from public.clinical_treatment_session_events e where e.session_id = p_session_id order by e.recorded_at desc, e.id desc limit 1) not in ('planned', 'scheduled', 'rescheduled') then
    raise exception 'A sessao precisa estar planejada ou agendada para ser concluida.' using errcode = '22023';
  end if;
  if p_care_occurred_at is null or nullif(btrim(p_evolution_notes), '') is null or nullif(btrim(p_procedures_applied), '') is null then
    raise exception 'Data/hora, evolucao e conduta realizada sao obrigatorias.' using errcode = '22023';
  end if;
  if p_care_occurred_at > now() + interval '5 minutes' then
    raise exception 'A data/hora do atendimento nao pode estar no futuro.' using errcode = '22023';
  end if;
  insert into public.medical_records(
    user_id, patient_id, created_by, session_date, care_occurred_at, evolution_notes, procedures_applied,
    next_appointment_date, professional_name, author_name, author_registration, author_council,
    authorship_source, treatment_plan_id, treatment_session_id
  ) values (
    owner_id, session_row.patient_id, auth.uid(), (p_care_occurred_at at time zone 'America/Sao_Paulo')::date,
    p_care_occurred_at, btrim(p_evolution_notes), btrim(p_procedures_applied), p_next_appointment_date,
    identity.author_name, identity.author_name, identity.author_registration, identity.author_council,
    'authenticated_user', session_row.plan_id, p_session_id
  ) returning id into record_id;
  insert into public.clinical_treatment_session_events(
    user_id, session_id, plan_id, patient_id, status, medical_record_id, created_by,
    author_name, author_registration, author_council, request_id
  ) values (
    owner_id, p_session_id, session_row.plan_id, session_row.patient_id, 'completed', record_id, auth.uid(),
    identity.author_name, identity.author_registration, identity.author_council, p_request_id
  );
  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, session_row.patient_id, auth.uid(), 'complete_treatment_session');
  return record_id;
end;
$$;

create or replace function public.close_clinical_treatment_plan(
  p_plan_id uuid, p_request_id uuid, p_status text, p_reason text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid := public.data_owner_id(); patient_id uuid; event_id uuid; identity record;
begin
  select * into identity from public.assert_clinical_treatment_author();
  select e.id into event_id from public.clinical_treatment_plan_status_events e where e.user_id = owner_id and e.request_id = p_request_id;
  if event_id is not null then return event_id; end if;
  select p.patient_id into patient_id from public.clinical_treatment_plans p where p.id = p_plan_id and p.user_id = owner_id;
  if patient_id is null then raise exception 'Plano fora do escopo.' using errcode = '42501'; end if;
  if (select e.status from public.clinical_treatment_plan_status_events e where e.plan_id = p_plan_id order by e.recorded_at desc, e.id desc limit 1) <> 'active' then
    raise exception 'O plano ja esta encerrado.' using errcode = '22023';
  end if;
  if p_status not in ('completed', 'cancelled') or nullif(btrim(p_reason), '') is null then
    raise exception 'Estado final e justificativa sao obrigatorios.' using errcode = '22023';
  end if;
  if p_status = 'completed' and exists (
    select 1
    from public.clinical_treatment_sessions s
    left join lateral (
      select e.status from public.clinical_treatment_session_events e
      where e.session_id = s.id order by e.recorded_at desc, e.id desc limit 1
    ) latest on true
    where s.plan_id = p_plan_id and coalesce(latest.status, 'planned') not in ('completed', 'cancelled', 'no_show')
  ) then
    raise exception 'Conclua ou registre a ocorrencia das sessoes pendentes antes de concluir o plano.' using errcode = '22023';
  end if;
  insert into public.clinical_treatment_plan_status_events(
    user_id, plan_id, patient_id, status, reason, created_by, author_name, author_registration, author_council, request_id
  ) values (
    owner_id, p_plan_id, patient_id, p_status, btrim(p_reason), auth.uid(), identity.author_name,
    identity.author_registration, identity.author_council, p_request_id
  ) returning id into event_id;
  return event_id;
end;
$$;

alter table public.clinical_record_access_logs drop constraint if exists clinical_record_access_logs_action_check;
alter table public.clinical_record_access_logs add constraint clinical_record_access_logs_action_check check (action in (
  'view_record', 'create_record', 'create_addendum', 'create_anamnesis', 'create_document',
  'create_intake_request', 'view_intake_response', 'create_clinical_asset_upload',
  'complete_clinical_asset_upload', 'fail_clinical_asset_upload', 'archive_clinical_asset',
  'restore_clinical_asset', 'view_clinical_asset', 'create_treatment_plan',
  'revise_treatment_plan', 'complete_treatment_session'
));

revoke all on function public.assert_clinical_treatment_author() from public, anon, authenticated;
revoke all on function public.create_clinical_treatment_plan(uuid, uuid, text, text, text, text, text, text, date, date, jsonb) from public, anon;
revoke all on function public.revise_clinical_treatment_plan(uuid, uuid, text, text, text, text, text, text, date, date) from public, anon;
revoke all on function public.add_clinical_treatment_session(uuid, uuid, text, text, text, timestamptz, integer) from public, anon;
revoke all on function public.record_clinical_treatment_session_event(uuid, uuid, text, timestamptz, integer, text, uuid) from public, anon;
revoke all on function public.complete_clinical_treatment_session(uuid, uuid, timestamptz, text, text, date) from public, anon;
revoke all on function public.close_clinical_treatment_plan(uuid, uuid, text, text) from public, anon;
grant execute on function public.create_clinical_treatment_plan(uuid, uuid, text, text, text, text, text, text, date, date, jsonb) to authenticated;
grant execute on function public.revise_clinical_treatment_plan(uuid, uuid, text, text, text, text, text, text, date, date) to authenticated;
grant execute on function public.add_clinical_treatment_session(uuid, uuid, text, text, text, timestamptz, integer) to authenticated;
grant execute on function public.record_clinical_treatment_session_event(uuid, uuid, text, timestamptz, integer, text, uuid) to authenticated;
grant execute on function public.complete_clinical_treatment_session(uuid, uuid, timestamptz, text, text, date) to authenticated;
grant execute on function public.close_clinical_treatment_plan(uuid, uuid, text, text) to authenticated;

comment on table public.clinical_treatment_plan_versions is 'Versoes imutaveis do plano terapeutico; correcoes exigem nova versao.';
comment on table public.clinical_treatment_session_events is 'Linha do tempo append-only de cada sessao, inclusive agenda e conclusao vinculada ao prontuario.';
comment on column public.medical_records.care_occurred_at is 'Data e hora efetiva do atendimento, preservada para registro cronologico.';

commit;
