-- Equipe autorizada no prontuario registra anamnese sem registro em conselho.
-- Executar depois de clinical_protocols_schema.sql.
--
-- DECISAO (Felipe, 04/11/2026): quem tem "Acesso ao prontuario clinico" marcado passa a registrar
-- tudo MENOS evolucao clinica e receituario, que continuam exigindo registro profissional por
-- serem atos medicos. Anamnese e coleta de informacao e nao precisa de assinatura profissional.
--
-- O que NAO muda: a autoria continua obrigatoria e nominal. Nenhum registro entra anonimo. A
-- diferenca fica gravada em `author_is_professional`, para quem ler o prontuario depois saber
-- que aquela anamnese nao foi assinada por profissional com registro.
--
-- `clinical_author_identity()` continua ESTRITA e intocada: evolucao, adendo, receita e protocolo
-- seguem exigindo nome + registro por ela.

begin;

-- Registro deixa de ser obrigatorio; o NOME continua sendo.
alter table public.clinical_anamneses
  alter column author_registration drop not null;
alter table public.clinical_anamneses
  add column if not exists author_is_professional boolean not null default true;

-- Identidade para registros que NAO sao ato medico assinado.
-- Prioridade: identidade profissional completa (se houver) > nome profissional informado >
-- e-mail do membro. Nunca devolve autor vazio: author_name e not null na tabela.
create or replace function public.clinical_author_identity_basic()
returns table(author_name text, author_registration text, author_council text, is_professional boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- A autoria e SEMPRE de quem escreveu. O nome da clinica so entra quando o proprio autor e a
  -- dona: cair no nome da profissional para um registro escrito pela equipe seria atribuicao
  -- falsa num documento legal -- o teste em PostgreSQL pegou exatamente isso.
  select
    coalesce(
      nullif(btrim(coalesce(strict_identity.author_name, '')), ''),
      nullif(btrim(coalesce(own_member.professional_name, '')), ''),
      nullif(btrim(coalesce(own_member.member_email, '')), ''),
      nullif(btrim(coalesce(own_clinic.clinical_professional_name, '')), ''),
      'Equipe da clinica'
    ) as author_name,
    nullif(btrim(coalesce(strict_identity.author_registration, '')), '') as author_registration,
    coalesce(
      nullif(btrim(coalesce(strict_identity.author_council, '')), ''),
      nullif(btrim(coalesce(own_member.professional_council, '')), ''),
      nullif(btrim(coalesce(own_clinic.clinical_professional_council, '')), ''),
      'CRM'
    ) as author_council,
    nullif(btrim(coalesce(strict_identity.author_registration, '')), '') is not null as is_professional
  from (select public.has_clinical_access() as allowed) gate
  left join lateral (
    select identity.author_name, identity.author_registration, identity.author_council
    from public.clinical_author_identity() identity
  ) strict_identity on true
  left join lateral (
    select cm.professional_name, cm.professional_council, cm.member_email
    from public.clinic_members cm
    join public.clinics c on c.id = cm.clinic_id
    where cm.user_id = auth.uid() and c.owner_id = public.data_owner_id()
    limit 1
  ) own_member on true
  left join lateral (
    select c.clinical_professional_name, c.clinical_professional_council
    from public.clinics c
    where c.owner_id = auth.uid()
    limit 1
  ) own_clinic on true
  where gate.allowed
$$;

revoke all on function public.clinical_author_identity_basic() from public, anon;
grant execute on function public.clinical_author_identity_basic() to authenticated;

-- Reaplicada a partir de clinical_protocols_schema.sql, trocando SOMENTE a resolucao de autoria.
create or replace function public.create_clinical_anamnesis(p_patient_id uuid,p_session_date date,p_anamnesis jsonb,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  owner_id uuid:=public.data_owner_id(); anamnesis_id uuid; identity record;
  existing public.clinical_anamneses%rowtype; v_protocol public.clinical_protocol_versions%rowtype; prompt jsonb;
begin
  if auth.uid() is null or not public.has_clinical_access() then raise exception 'Acesso clinico nao autorizado.' using errcode='42501'; end if;
  if p_patient_id is null or p_session_date is null or p_request_id is null or jsonb_typeof(p_anamnesis)<>'object' then raise exception 'Paciente, data, conteudo e identificador sao obrigatorios.' using errcode='22023'; end if;
  if not exists(select 1 from public.patients where id=p_patient_id and user_id=owner_id) then raise exception 'Paciente fora da clinica.' using errcode='42501'; end if;
  if nullif(btrim(p_anamnesis->>'chief_complaint'),'') is null or nullif(btrim(p_anamnesis->>'history_present_illness'),'') is null
    or nullif(btrim(p_anamnesis->>'physical_exam'),'') is null or nullif(btrim(p_anamnesis->>'diagnostic_hypotheses'),'') is null
    or nullif(btrim(p_anamnesis->>'therapeutic_plan'),'') is null then raise exception 'Campos SOAP obrigatorios ausentes.' using errcode='22023'; end if;
  if p_anamnesis ? 'protocol_responses' and coalesce(jsonb_typeof(p_anamnesis->'protocol_responses'),'null')<>'object' then
    raise exception 'Respostas do protocolo devem ser um objeto.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':anamnesis:' || p_request_id::text,17));
  select * into existing from public.clinical_anamneses
  where user_id=owner_id and request_id=p_request_id order by recorded_at,id limit 1;
  if found then
    if existing.patient_id is distinct from p_patient_id or existing.session_date is distinct from p_session_date
      or existing.chief_complaint is distinct from btrim(p_anamnesis->>'chief_complaint')
      or existing.history_present_illness is distinct from btrim(p_anamnesis->>'history_present_illness')
      or existing.personal_history is distinct from nullif(btrim(p_anamnesis->>'personal_history'),'')
      or existing.family_history is distinct from nullif(btrim(p_anamnesis->>'family_history'),'')
      or existing.review_of_systems is distinct from nullif(btrim(p_anamnesis->>'review_of_systems'),'')
      or existing.physical_exam is distinct from btrim(p_anamnesis->>'physical_exam')
      or existing.diagnostic_hypotheses is distinct from btrim(p_anamnesis->>'diagnostic_hypotheses')
      or existing.therapeutic_plan is distinct from btrim(p_anamnesis->>'therapeutic_plan')
      or existing.systolic_bp is distinct from nullif(p_anamnesis->>'systolic_bp','')::smallint
      or existing.diastolic_bp is distinct from nullif(p_anamnesis->>'diastolic_bp','')::smallint
      or existing.temperature_c is distinct from nullif(p_anamnesis->>'temperature_c','')::numeric
      or existing.heart_rate is distinct from nullif(p_anamnesis->>'heart_rate','')::smallint
      or existing.respiratory_rate is distinct from nullif(p_anamnesis->>'respiratory_rate','')::smallint
      or existing.oxygen_saturation is distinct from nullif(p_anamnesis->>'oxygen_saturation','')::numeric
      or existing.pain_score is distinct from nullif(p_anamnesis->>'pain_score','')::smallint
      or existing.weight_kg is distinct from nullif(p_anamnesis->>'weight_kg','')::numeric
      or existing.height_cm is distinct from nullif(p_anamnesis->>'height_cm','')::numeric
      or existing.protocol_version_id is distinct from nullif(p_anamnesis->>'protocol_version_id','')::uuid
      or coalesce(existing.protocol_responses,'{}'::jsonb) is distinct from coalesce(p_anamnesis->'protocol_responses','{}'::jsonb) then
      raise exception 'Identificador de requisicao reutilizado com conteudo diferente.' using errcode='22023';
    end if;
    return existing.id;
  end if;
  if nullif(p_anamnesis->>'protocol_version_id','') is not null then
    select * into v_protocol from public.clinical_protocol_versions where id=(p_anamnesis->>'protocol_version_id')::uuid and user_id=owner_id;
    if not found then raise exception 'Versao de protocolo fora da clinica.' using errcode='42501'; end if;
    if coalesce((select status from public.clinical_protocol_status_events where protocol_id=v_protocol.protocol_id and user_id=owner_id order by recorded_at desc,id desc limit 1),'archived')<>'active' then
      raise exception 'Protocolo arquivado nao pode ser aplicado a novos registros.' using errcode='22023';
    end if;
    for prompt in select value from jsonb_array_elements(v_protocol.anamnesis_prompts) loop
      if coalesce((prompt->>'required')::boolean,false) and nullif(btrim((coalesce(p_anamnesis->'protocol_responses','{}'::jsonb))->>(prompt->>'key')),'') is null then
        raise exception 'Resposta obrigatoria do protocolo ausente: %', prompt->>'label' using errcode='22023';
      end if;
    end loop;
  end if;
  -- Anamnese e COLETA de informacao, nao ato medico assinado: a equipe autorizada no prontuario
  -- registra sem precisar de registro em conselho. A autoria continua obrigatoria e nominal.
  select * into identity from public.clinical_author_identity_basic();
  if identity.author_name is null then raise exception 'Autor clinico nao identificado.' using errcode='22023'; end if;
  insert into public.clinical_anamneses(user_id,patient_id,created_by,request_id,session_date,chief_complaint,history_present_illness,personal_history,family_history,review_of_systems,physical_exam,diagnostic_hypotheses,therapeutic_plan,systolic_bp,diastolic_bp,temperature_c,heart_rate,respiratory_rate,oxygen_saturation,pain_score,weight_kg,height_cm,author_name,author_registration,author_council,author_is_professional,protocol_id,protocol_version_id,protocol_name,protocol_snapshot,protocol_responses)
  values(owner_id,p_patient_id,auth.uid(),p_request_id,p_session_date,btrim(p_anamnesis->>'chief_complaint'),btrim(p_anamnesis->>'history_present_illness'),nullif(btrim(p_anamnesis->>'personal_history'),''),nullif(btrim(p_anamnesis->>'family_history'),''),nullif(btrim(p_anamnesis->>'review_of_systems'),''),btrim(p_anamnesis->>'physical_exam'),btrim(p_anamnesis->>'diagnostic_hypotheses'),btrim(p_anamnesis->>'therapeutic_plan'),nullif(p_anamnesis->>'systolic_bp','')::smallint,nullif(p_anamnesis->>'diastolic_bp','')::smallint,nullif(p_anamnesis->>'temperature_c','')::numeric,nullif(p_anamnesis->>'heart_rate','')::smallint,nullif(p_anamnesis->>'respiratory_rate','')::smallint,nullif(p_anamnesis->>'oxygen_saturation','')::numeric,nullif(p_anamnesis->>'pain_score','')::smallint,nullif(p_anamnesis->>'weight_kg','')::numeric,nullif(p_anamnesis->>'height_cm','')::numeric,btrim(identity.author_name),nullif(btrim(coalesce(identity.author_registration,'')),''),coalesce(nullif(btrim(identity.author_council),''),'CRM'),coalesce(identity.is_professional,false),v_protocol.protocol_id,v_protocol.id,v_protocol.name,to_jsonb(v_protocol)-array['user_id','created_by','request_id'],coalesce(p_anamnesis->'protocol_responses','{}'::jsonb)) returning id into anamnesis_id;
  insert into public.clinical_record_access_logs(user_id,patient_id,actor_id,action) values(owner_id,p_patient_id,auth.uid(),'create_anamnesis');
  return anamnesis_id;
end $$;

commit;

-- Conferencia apos aplicar:
-- select proname from pg_proc where proname = 'clinical_author_identity_basic';
-- select is_nullable from information_schema.columns
--  where table_name = 'clinical_anamneses' and column_name = 'author_registration';
