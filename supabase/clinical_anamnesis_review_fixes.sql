-- Correcao posterior a clinical_anamnesis_cfm_schema.sql.
-- Adiciona idempotencia a assinatura da anamnese sem alterar registros existentes.

begin;

alter table public.clinical_anamneses
  add column if not exists request_id uuid;

create unique index if not exists idx_clinical_anamneses_request
  on public.clinical_anamneses(user_id, patient_id, request_id);

drop function if exists public.create_clinical_anamnesis(uuid, date, jsonb);

create or replace function public.create_clinical_anamnesis(
  p_patient_id uuid,
  p_session_date date,
  p_anamnesis jsonb,
  p_request_id uuid
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
  if p_patient_id is null or p_session_date is null or p_request_id is null then
    raise exception 'Paciente, data e identificador da assinatura sao obrigatorios.' using errcode = '22023';
  end if;

  owner_id := public.data_owner_id();
  if not exists (
    select 1 from public.patients p where p.id = p_patient_id and p.user_id = owner_id
  ) then
    raise exception 'Paciente fora do escopo da clinica.' using errcode = '42501';
  end if;

  -- Uma repeticao da mesma tentativa retorna o registro ja criado. Isso cobre duplo
  -- clique, timeout de rede e nova chamada depois de uma resposta perdida.
  select ca.id into anamnesis_id
  from public.clinical_anamneses ca
  where ca.user_id = owner_id
    and ca.patient_id = p_patient_id
    and ca.request_id = p_request_id;
  if anamnesis_id is not null then
    return anamnesis_id;
  end if;

  if coalesce(jsonb_typeof(p_anamnesis), 'null') <> 'object' then
    raise exception 'O conteudo da anamnese e obrigatorio.' using errcode = '22023';
  end if;
  if nullif(btrim(p_anamnesis ->> 'chief_complaint'), '') is null
    or nullif(btrim(p_anamnesis ->> 'history_present_illness'), '') is null
    or nullif(btrim(p_anamnesis ->> 'physical_exam'), '') is null
    or nullif(btrim(p_anamnesis ->> 'diagnostic_hypotheses'), '') is null
    or nullif(btrim(p_anamnesis ->> 'therapeutic_plan'), '') is null then
    raise exception 'Queixa, historia atual, exame fisico, avaliacao e plano sao obrigatorios.' using errcode = '22023';
  end if;

  select identity.author_name, identity.author_registration, identity.author_council
    into resolved_author_name, resolved_author_registration, resolved_author_council
  from public.clinical_author_identity() identity;
  if resolved_author_name is null or resolved_author_registration is null then
    raise exception 'Identidade profissional nao configurada.' using errcode = '22023';
  end if;

  insert into public.clinical_anamneses (
    user_id, patient_id, created_by, request_id, session_date,
    chief_complaint, history_present_illness, personal_history, family_history,
    review_of_systems, physical_exam, diagnostic_hypotheses, therapeutic_plan,
    systolic_bp, diastolic_bp, temperature_c, heart_rate, respiratory_rate,
    oxygen_saturation, pain_score, weight_kg, height_cm,
    author_name, author_registration, author_council
  ) values (
    owner_id, p_patient_id, auth.uid(), p_request_id, p_session_date,
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
  )
  on conflict (user_id, patient_id, request_id) do nothing
  returning id into anamnesis_id;

  if anamnesis_id is null then
    select ca.id into anamnesis_id
    from public.clinical_anamneses ca
    where ca.user_id = owner_id
      and ca.patient_id = p_patient_id
      and ca.request_id = p_request_id;
    return anamnesis_id;
  end if;

  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, p_patient_id, auth.uid(), 'create_anamnesis');

  return anamnesis_id;
end;
$$;

revoke all on function public.create_clinical_anamnesis(uuid, date, jsonb, uuid) from public;
grant execute on function public.create_clinical_anamnesis(uuid, date, jsonb, uuid) to authenticated;

comment on column public.clinical_anamneses.request_id is
  'Identificador idempotente gerado pelo cliente para uma tentativa de assinatura.';

commit;
