-- Fase 4.2: anamnese clinica versionada em formato SOAP.
-- Executar depois de clinical_record_foundation_schema.sql.
-- Estrutura baseada no conteudo minimo do prontuario definido pelas Resolucoes
-- CFM 1.638/2002 e 2.056/2013 e nos requisitos de PEP ambulatorial da SBIS.

begin;

create table if not exists public.clinical_anamneses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  session_date date not null,
  chief_complaint text not null check (length(btrim(chief_complaint)) between 1 and 20000),
  history_present_illness text not null check (length(btrim(history_present_illness)) between 1 and 20000),
  personal_history text check (personal_history is null or length(btrim(personal_history)) between 1 and 20000),
  family_history text check (family_history is null or length(btrim(family_history)) between 1 and 20000),
  review_of_systems text check (review_of_systems is null or length(btrim(review_of_systems)) between 1 and 20000),
  physical_exam text not null check (length(btrim(physical_exam)) between 1 and 20000),
  diagnostic_hypotheses text not null check (length(btrim(diagnostic_hypotheses)) between 1 and 20000),
  therapeutic_plan text not null check (length(btrim(therapeutic_plan)) between 1 and 20000),
  systolic_bp smallint check (systolic_bp is null or systolic_bp between 30 and 300),
  diastolic_bp smallint check (diastolic_bp is null or diastolic_bp between 20 and 200),
  temperature_c numeric(4,1) check (temperature_c is null or temperature_c between 25 and 45),
  heart_rate smallint check (heart_rate is null or heart_rate between 20 and 300),
  respiratory_rate smallint check (respiratory_rate is null or respiratory_rate between 4 and 100),
  oxygen_saturation numeric(5,2) check (oxygen_saturation is null or oxygen_saturation between 0 and 100),
  pain_score smallint check (pain_score is null or pain_score between 0 and 10),
  weight_kg numeric(6,2) check (weight_kg is null or weight_kg between 0.1 and 500),
  height_cm numeric(5,2) check (height_cm is null or height_cm between 20 and 250),
  author_name text not null,
  author_registration text not null,
  author_council text not null default 'CRM',
  authorship_source text not null default 'authenticated_user'
    check (authorship_source in ('authenticated_user')),
  recorded_at timestamptz not null default timezone('utc', now())
);

alter table public.clinical_anamneses enable row level security;

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'clinical_anamneses'
  loop
    execute format('drop policy if exists %I on public.clinical_anamneses', policy_row.policyname);
  end loop;
end $$;

create policy "Clinical anamneses authorized read"
on public.clinical_anamneses
for select to authenticated
using (user_id = public.data_owner_id() and public.has_clinical_access());

revoke insert, update, delete on public.clinical_anamneses from authenticated;
grant select on public.clinical_anamneses to authenticated;

drop trigger if exists trg_clinical_anamneses_immutable on public.clinical_anamneses;
create trigger trg_clinical_anamneses_immutable
before update or delete on public.clinical_anamneses
for each row execute function public.prevent_clinical_record_mutation();

-- A nova acao so pode nascer na RPC de escrita; a RPC publica de abertura continua
-- aceitando exclusivamente view_record.
alter table public.clinical_record_access_logs
  drop constraint if exists clinical_record_access_logs_action_check;
alter table public.clinical_record_access_logs
  add constraint clinical_record_access_logs_action_check
  check (action in ('view_record', 'create_record', 'create_addendum', 'create_anamnesis', 'create_document'));

create or replace function public.create_clinical_anamnesis(
  p_patient_id uuid,
  p_session_date date,
  p_anamnesis jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid;
  anamnesis_id uuid;
  resolved_author_name text;
  resolved_author_registration text;
  resolved_author_council text;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  if p_patient_id is null or p_session_date is null or coalesce(jsonb_typeof(p_anamnesis), 'null') <> 'object' then
    raise exception 'Paciente, data e conteudo da anamnese sao obrigatorios.' using errcode = '22023';
  end if;
  if nullif(btrim(p_anamnesis ->> 'chief_complaint'), '') is null
    or nullif(btrim(p_anamnesis ->> 'history_present_illness'), '') is null
    or nullif(btrim(p_anamnesis ->> 'physical_exam'), '') is null
    or nullif(btrim(p_anamnesis ->> 'diagnostic_hypotheses'), '') is null
    or nullif(btrim(p_anamnesis ->> 'therapeutic_plan'), '') is null then
    raise exception 'Queixa, historia atual, exame fisico, avaliacao e plano sao obrigatorios.' using errcode = '22023';
  end if;

  owner_id := public.data_owner_id();
  if not exists (
    select 1 from public.patients p where p.id = p_patient_id and p.user_id = owner_id
  ) then
    raise exception 'Paciente fora do escopo da clinica.' using errcode = '42501';
  end if;

  select identity.author_name, identity.author_registration, identity.author_council
    into resolved_author_name, resolved_author_registration, resolved_author_council
  from public.clinical_author_identity() identity;
  if resolved_author_name is null or resolved_author_registration is null then
    raise exception 'Identidade profissional nao configurada.' using errcode = '22023';
  end if;

  insert into public.clinical_anamneses (
    user_id, patient_id, created_by, session_date,
    chief_complaint, history_present_illness, personal_history, family_history,
    review_of_systems, physical_exam, diagnostic_hypotheses, therapeutic_plan,
    systolic_bp, diastolic_bp, temperature_c, heart_rate, respiratory_rate,
    oxygen_saturation, pain_score, weight_kg, height_cm,
    author_name, author_registration, author_council
  ) values (
    owner_id, p_patient_id, auth.uid(), p_session_date,
    btrim(p_anamnesis ->> 'chief_complaint'),
    btrim(p_anamnesis ->> 'history_present_illness'),
    nullif(btrim(p_anamnesis ->> 'personal_history'), ''),
    nullif(btrim(p_anamnesis ->> 'family_history'), ''),
    nullif(btrim(p_anamnesis ->> 'review_of_systems'), ''),
    btrim(p_anamnesis ->> 'physical_exam'),
    btrim(p_anamnesis ->> 'diagnostic_hypotheses'),
    btrim(p_anamnesis ->> 'therapeutic_plan'),
    nullif(p_anamnesis ->> 'systolic_bp', '')::smallint,
    nullif(p_anamnesis ->> 'diastolic_bp', '')::smallint,
    nullif(p_anamnesis ->> 'temperature_c', '')::numeric,
    nullif(p_anamnesis ->> 'heart_rate', '')::smallint,
    nullif(p_anamnesis ->> 'respiratory_rate', '')::smallint,
    nullif(p_anamnesis ->> 'oxygen_saturation', '')::numeric,
    nullif(p_anamnesis ->> 'pain_score', '')::smallint,
    nullif(p_anamnesis ->> 'weight_kg', '')::numeric,
    nullif(p_anamnesis ->> 'height_cm', '')::numeric,
    btrim(resolved_author_name), btrim(resolved_author_registration),
    coalesce(nullif(btrim(resolved_author_council), ''), 'CRM')
  ) returning id into anamnesis_id;

  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, p_patient_id, auth.uid(), 'create_anamnesis');

  return anamnesis_id;
end;
$$;

revoke all on function public.create_clinical_anamnesis(uuid, date, jsonb) from public;
grant execute on function public.create_clinical_anamnesis(uuid, date, jsonb) to authenticated;

create index if not exists idx_clinical_anamneses_patient
  on public.clinical_anamneses(user_id, patient_id, recorded_at desc);

do $$
begin
  if to_regprocedure('public.log_record_change()') is not null then
    drop trigger if exists trg_record_audit on public.clinical_anamneses;
    create trigger trg_record_audit
      after insert or update or delete on public.clinical_anamneses
      for each row execute function public.log_record_change();
  end if;
end $$;

comment on table public.clinical_anamneses is
  'Versoes imutaveis de anamnese SOAP com autoria profissional e sinais vitais estruturados.';

commit;
