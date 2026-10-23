-- Fase 4.6: biblioteca versionada de protocolos clinicos por procedimento.
-- Executar depois de clinical_anamnesis_review_fixes.sql e clinical_treatment_plans_schema.sql.

begin;

create extension if not exists pgcrypto;

create table if not exists public.clinical_protocols (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.clinical_protocol_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  protocol_id uuid not null references public.clinical_protocols(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  name text not null check (length(btrim(name)) between 1 and 160),
  procedure_name text not null check (length(btrim(procedure_name)) between 1 and 160),
  description text check (description is null or length(description) <= 2000),
  indication text not null check (length(btrim(indication)) between 1 and 5000),
  objectives text not null check (length(btrim(objectives)) between 1 and 5000),
  planned_treatment text not null check (length(btrim(planned_treatment)) between 1 and 10000),
  guidance text not null check (length(btrim(guidance)) between 1 and 5000),
  anamnesis_prompts jsonb not null default '[]'::jsonb check (jsonb_typeof(anamnesis_prompts) = 'array'),
  exam_kit jsonb not null default '[]'::jsonb check (jsonb_typeof(exam_kit) = 'array'),
  medication_favorites jsonb not null default '[]'::jsonb check (jsonb_typeof(medication_favorites) = 'array'),
  photo_requirements jsonb not null default '[]'::jsonb check (jsonb_typeof(photo_requirements) = 'array'),
  return_schedule jsonb not null default '[]'::jsonb check (jsonb_typeof(return_schedule) = 'array'),
  created_by uuid not null references auth.users(id) on delete restrict,
  author_name text not null,
  author_registration text not null,
  author_council text not null default 'CRM',
  request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(protocol_id, version_number),
  unique(user_id, request_id)
);

create table if not exists public.clinical_protocol_status_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  protocol_id uuid not null references public.clinical_protocols(id) on delete restrict,
  status text not null check (status in ('active', 'archived')),
  reason text check (reason is null or length(reason) <= 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(user_id, request_id)
);

alter table public.clinical_anamneses
  add column if not exists protocol_id uuid references public.clinical_protocols(id) on delete restrict,
  add column if not exists protocol_version_id uuid references public.clinical_protocol_versions(id) on delete restrict,
  add column if not exists protocol_name text,
  add column if not exists protocol_snapshot jsonb,
  add column if not exists protocol_responses jsonb;

create index if not exists idx_clinical_protocol_versions_current on public.clinical_protocol_versions(protocol_id, version_number desc);
create index if not exists idx_clinical_protocol_status_current on public.clinical_protocol_status_events(protocol_id, recorded_at desc, id desc);
create index if not exists idx_clinical_protocols_owner on public.clinical_protocols(user_id, created_at desc);

create or replace function public.clinical_protocol_can_manage()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and public.has_clinical_access() and (
    auth.uid() = public.data_owner_id()
    or exists (
      select 1 from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
      where cm.user_id = auth.uid() and cm.role = 'admin' and cm.clinical_access is true
        and c.owner_id = public.data_owner_id()
    )
  )
$$;
revoke all on function public.clinical_protocol_can_manage() from public, anon;
grant execute on function public.clinical_protocol_can_manage() to authenticated;

alter table public.clinical_protocols enable row level security;
alter table public.clinical_protocol_versions enable row level security;
alter table public.clinical_protocol_status_events enable row level security;

do $$
declare t text; p text;
begin
  foreach t in array array['clinical_protocols','clinical_protocol_versions','clinical_protocol_status_events'] loop
    p := t || ' clinical read';
    execute format('drop policy if exists %I on public.%I', p, t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = public.data_owner_id() and public.has_clinical_access())', p, t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function public.prevent_clinical_protocol_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Protocolos clinicos sao versionados; registre nova versao ou evento.' using errcode = '55000';
end $$;

do $$
declare t text;
begin
  foreach t in array array['clinical_protocols','clinical_protocol_versions','clinical_protocol_status_events'] loop
    execute format('drop trigger if exists trg_%s_immutable on public.%I', t, t);
    execute format('create trigger trg_%s_immutable before update or delete on public.%I for each row execute function public.prevent_clinical_protocol_mutation()', t, t);
  end loop;
end $$;

create or replace function public.save_clinical_protocol(p_protocol_id uuid, p_request_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owner_id uuid := public.data_owner_id(); target_id uuid := p_protocol_id; next_version integer;
  identity record; existing public.clinical_protocol_versions%rowtype;
  v_name text := btrim(p_payload->>'name'); v_procedure text := btrim(p_payload->>'procedureName');
  v_description text := nullif(btrim(p_payload->>'description'), '');
  v_indication text := btrim(p_payload->>'indication'); v_objectives text := btrim(p_payload->>'objectives');
  v_treatment text := btrim(p_payload->>'plannedTreatment'); v_guidance text := btrim(p_payload->>'guidance');
  v_prompts jsonb := coalesce(p_payload->'anamnesisPrompts','[]'::jsonb);
  v_exams jsonb := coalesce(p_payload->'examKit','[]'::jsonb);
  v_medications jsonb := coalesce(p_payload->'medicationFavorites','[]'::jsonb);
  v_photos jsonb := coalesce(p_payload->'photoRequirements','[]'::jsonb);
  v_returns jsonb := coalesce(p_payload->'returnSchedule','[]'::jsonb);
begin
  if not public.clinical_protocol_can_manage() then raise exception 'Somente administradores clinicos podem alterar protocolos.' using errcode='42501'; end if;
  if p_request_id is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Requisicao e protocolo sao obrigatorios.' using errcode='22023'; end if;
  if v_name = '' or v_procedure = '' or v_indication = '' or v_objectives = '' or v_treatment = '' or v_guidance = '' then
    raise exception 'Nome, procedimento, indicacao, objetivos, tratamento e orientacoes sao obrigatorios.' using errcode='22023';
  end if;
  if length(v_name)>160 or length(v_procedure)>160 or length(coalesce(v_description,''))>2000 or length(v_indication)>5000
    or length(v_objectives)>5000 or length(v_treatment)>10000 or length(v_guidance)>5000 then raise exception 'Conteudo do protocolo excede o limite permitido.' using errcode='22023'; end if;
  if jsonb_typeof(v_prompts)<>'array' or jsonb_typeof(v_exams)<>'array' or jsonb_typeof(v_medications)<>'array'
    or jsonb_typeof(v_photos)<>'array' or jsonb_typeof(v_returns)<>'array' then raise exception 'Listas do protocolo sao invalidas.' using errcode='22023'; end if;
  if jsonb_array_length(v_prompts)>60 or jsonb_array_length(v_exams)>60 or jsonb_array_length(v_medications)>60
    or jsonb_array_length(v_photos)>60 or jsonb_array_length(v_returns)>60 then raise exception 'Cada lista aceita no maximo 60 itens.' using errcode='22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':protocol:' || coalesce(target_id::text,p_request_id::text), 17));
  select * into existing from public.clinical_protocol_versions where user_id=owner_id and request_id=p_request_id;
  if found then
    if existing.protocol_id is distinct from coalesce(target_id, existing.protocol_id) or existing.name<>v_name or existing.procedure_name<>v_procedure
      or existing.description is distinct from v_description or existing.indication<>v_indication or existing.objectives<>v_objectives
      or existing.planned_treatment<>v_treatment or existing.guidance<>v_guidance or existing.anamnesis_prompts<>v_prompts
      or existing.exam_kit<>v_exams or existing.medication_favorites<>v_medications or existing.photo_requirements<>v_photos or existing.return_schedule<>v_returns then
      raise exception 'Identificador de requisicao reutilizado com conteudo diferente.' using errcode='22023';
    end if;
    return existing.protocol_id;
  end if;

  select * into identity from public.clinical_author_identity();
  if identity.author_name is null or identity.author_registration is null then raise exception 'Configure nome e CRM antes de salvar protocolos.' using errcode='22023'; end if;
  if target_id is null then
    insert into public.clinical_protocols(user_id,created_by) values(owner_id,auth.uid()) returning id into target_id;
    next_version := 1;
  else
    if not exists(select 1 from public.clinical_protocols where id=target_id and user_id=owner_id) then raise exception 'Protocolo fora da clinica.' using errcode='42501'; end if;
    select coalesce(max(version_number),0)+1 into next_version from public.clinical_protocol_versions where protocol_id=target_id;
  end if;
  insert into public.clinical_protocol_versions(user_id,protocol_id,version_number,name,procedure_name,description,indication,objectives,planned_treatment,guidance,anamnesis_prompts,exam_kit,medication_favorites,photo_requirements,return_schedule,created_by,author_name,author_registration,author_council,request_id)
  values(owner_id,target_id,next_version,v_name,v_procedure,v_description,v_indication,v_objectives,v_treatment,v_guidance,v_prompts,v_exams,v_medications,v_photos,v_returns,auth.uid(),btrim(identity.author_name),btrim(identity.author_registration),coalesce(nullif(btrim(identity.author_council),''),'CRM'),p_request_id);
  if next_version=1 then insert into public.clinical_protocol_status_events(user_id,protocol_id,status,created_by,request_id) values(owner_id,target_id,'active',auth.uid(),p_request_id); end if;
  return target_id;
end $$;

create or replace function public.set_clinical_protocol_status(p_protocol_id uuid,p_request_id uuid,p_status text,p_reason text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=public.data_owner_id(); existing public.clinical_protocol_status_events%rowtype;
begin
  if not public.clinical_protocol_can_manage() then raise exception 'Somente administradores clinicos podem alterar protocolos.' using errcode='42501'; end if;
  if p_request_id is null or p_status not in ('active','archived') then raise exception 'Status invalido.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':protocol:' || p_protocol_id::text,17));
  select * into existing from public.clinical_protocol_status_events where user_id=owner_id and request_id=p_request_id;
  if found then
    if existing.protocol_id<>p_protocol_id or existing.status<>p_status or existing.reason is distinct from nullif(btrim(p_reason),'') then raise exception 'Identificador reutilizado com conteudo diferente.' using errcode='22023'; end if;
    return existing.id;
  end if;
  if not exists(select 1 from public.clinical_protocols where id=p_protocol_id and user_id=owner_id) then raise exception 'Protocolo fora da clinica.' using errcode='42501'; end if;
  insert into public.clinical_protocol_status_events(user_id,protocol_id,status,reason,created_by,request_id)
  values(owner_id,p_protocol_id,p_status,nullif(btrim(p_reason),''),auth.uid(),p_request_id) returning id into existing.id;
  return existing.id;
end $$;

drop function if exists public.create_clinical_anamnesis(uuid,date,jsonb,uuid);
create or replace function public.create_clinical_anamnesis(p_patient_id uuid,p_session_date date,p_anamnesis jsonb,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=public.data_owner_id(); anamnesis_id uuid; identity record; v_protocol public.clinical_protocol_versions%rowtype; prompt jsonb;
begin
  if auth.uid() is null or not public.has_clinical_access() then raise exception 'Acesso clinico nao autorizado.' using errcode='42501'; end if;
  if p_patient_id is null or p_session_date is null or p_request_id is null or jsonb_typeof(p_anamnesis)<>'object' then raise exception 'Paciente, data, conteudo e identificador sao obrigatorios.' using errcode='22023'; end if;
  if not exists(select 1 from public.patients where id=p_patient_id and user_id=owner_id) then raise exception 'Paciente fora da clinica.' using errcode='42501'; end if;
  select id into anamnesis_id from public.clinical_anamneses where user_id=owner_id and patient_id=p_patient_id and request_id=p_request_id;
  if anamnesis_id is not null then return anamnesis_id; end if;
  if nullif(btrim(p_anamnesis->>'chief_complaint'),'') is null or nullif(btrim(p_anamnesis->>'history_present_illness'),'') is null
    or nullif(btrim(p_anamnesis->>'physical_exam'),'') is null or nullif(btrim(p_anamnesis->>'diagnostic_hypotheses'),'') is null
    or nullif(btrim(p_anamnesis->>'therapeutic_plan'),'') is null then raise exception 'Campos SOAP obrigatorios ausentes.' using errcode='22023'; end if;
  if nullif(p_anamnesis->>'protocol_version_id','') is not null then
    select * into v_protocol from public.clinical_protocol_versions where id=(p_anamnesis->>'protocol_version_id')::uuid and user_id=owner_id;
    if not found then raise exception 'Versao de protocolo fora da clinica.' using errcode='42501'; end if;
    for prompt in select value from jsonb_array_elements(v_protocol.anamnesis_prompts) loop
      if coalesce((prompt->>'required')::boolean,false) and nullif(btrim((coalesce(p_anamnesis->'protocol_responses','{}'::jsonb))->>(prompt->>'key')),'') is null then
        raise exception 'Resposta obrigatoria do protocolo ausente: %', prompt->>'label' using errcode='22023';
      end if;
    end loop;
  end if;
  select * into identity from public.clinical_author_identity();
  if identity.author_name is null or identity.author_registration is null then raise exception 'Identidade profissional nao configurada.' using errcode='22023'; end if;
  insert into public.clinical_anamneses(user_id,patient_id,created_by,request_id,session_date,chief_complaint,history_present_illness,personal_history,family_history,review_of_systems,physical_exam,diagnostic_hypotheses,therapeutic_plan,systolic_bp,diastolic_bp,temperature_c,heart_rate,respiratory_rate,oxygen_saturation,pain_score,weight_kg,height_cm,author_name,author_registration,author_council,protocol_id,protocol_version_id,protocol_name,protocol_snapshot,protocol_responses)
  values(owner_id,p_patient_id,auth.uid(),p_request_id,p_session_date,btrim(p_anamnesis->>'chief_complaint'),btrim(p_anamnesis->>'history_present_illness'),nullif(btrim(p_anamnesis->>'personal_history'),''),nullif(btrim(p_anamnesis->>'family_history'),''),nullif(btrim(p_anamnesis->>'review_of_systems'),''),btrim(p_anamnesis->>'physical_exam'),btrim(p_anamnesis->>'diagnostic_hypotheses'),btrim(p_anamnesis->>'therapeutic_plan'),nullif(p_anamnesis->>'systolic_bp','')::smallint,nullif(p_anamnesis->>'diastolic_bp','')::smallint,nullif(p_anamnesis->>'temperature_c','')::numeric,nullif(p_anamnesis->>'heart_rate','')::smallint,nullif(p_anamnesis->>'respiratory_rate','')::smallint,nullif(p_anamnesis->>'oxygen_saturation','')::numeric,nullif(p_anamnesis->>'pain_score','')::smallint,nullif(p_anamnesis->>'weight_kg','')::numeric,nullif(p_anamnesis->>'height_cm','')::numeric,btrim(identity.author_name),btrim(identity.author_registration),coalesce(nullif(btrim(identity.author_council),''),'CRM'),v_protocol.protocol_id,v_protocol.id,v_protocol.name,to_jsonb(v_protocol)-array['user_id','created_by','request_id'],coalesce(p_anamnesis->'protocol_responses','{}'::jsonb)) returning id into anamnesis_id;
  insert into public.clinical_record_access_logs(user_id,patient_id,actor_id,action) values(owner_id,p_patient_id,auth.uid(),'create_anamnesis');
  return anamnesis_id;
end $$;

revoke all on function public.save_clinical_protocol(uuid,uuid,jsonb) from public,anon;
revoke all on function public.set_clinical_protocol_status(uuid,uuid,text,text) from public,anon;
revoke all on function public.create_clinical_anamnesis(uuid,date,jsonb,uuid) from public,anon;
grant execute on function public.save_clinical_protocol(uuid,uuid,jsonb) to authenticated;
grant execute on function public.set_clinical_protocol_status(uuid,uuid,text,text) to authenticated;
grant execute on function public.create_clinical_anamnesis(uuid,date,jsonb,uuid) to authenticated;

comment on table public.clinical_protocol_versions is 'Versoes imutaveis de protocolos clinicos. Aplicacao sempre exige revisao profissional.';
comment on column public.clinical_anamneses.protocol_snapshot is 'Snapshot do protocolo efetivamente revisado e usado no registro.';

commit;
