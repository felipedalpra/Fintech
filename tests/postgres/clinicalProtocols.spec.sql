-- Executar somente em banco local descartável.
\set ON_ERROR_STOP on

do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.clinics(id uuid primary key,owner_id uuid not null references auth.users(id),clinical_professional_name text,clinical_professional_registration text,clinical_professional_council text default 'CRM');
create table public.clinic_members(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics(id),user_id uuid not null references auth.users(id),role text not null,clinical_access boolean not null default false,professional_name text,professional_registration text,professional_council text default 'CRM');
create table public.patients(id uuid primary key,user_id uuid not null references auth.users(id),active boolean not null default true);
create table public.clinical_record_access_logs(id bigint generated always as identity primary key,user_id uuid not null,patient_id uuid not null,actor_id uuid,action text not null);
create table public.clinical_anamneses(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),patient_id uuid not null references public.patients(id),created_by uuid references auth.users(id),request_id uuid,
  session_date date not null,chief_complaint text not null,history_present_illness text not null,personal_history text,family_history text,review_of_systems text,physical_exam text not null,diagnostic_hypotheses text not null,therapeutic_plan text not null,
  systolic_bp smallint,diastolic_bp smallint,temperature_c numeric,heart_rate smallint,respiratory_rate smallint,oxygen_saturation numeric,pain_score smallint,weight_kg numeric,height_cm numeric,
  author_name text not null,author_registration text not null,author_council text not null default 'CRM',recorded_at timestamptz not null default clock_timestamp(),unique(user_id,patient_id,request_id)
);
create or replace function public.data_owner_id() returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select c.owner_id from public.clinic_members cm join public.clinics c on c.id=cm.clinic_id where cm.user_id=auth.uid() limit 1),auth.uid())
$$;
create or replace function public.has_clinical_access() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid()=public.data_owner_id() or exists(select 1 from public.clinic_members cm join public.clinics c on c.id=cm.clinic_id where cm.user_id=auth.uid() and cm.clinical_access and c.owner_id=public.data_owner_id())
$$;
create or replace function public.clinical_author_identity() returns table(author_name text,author_registration text,author_council text) language sql stable security definer set search_path=public,pg_temp as $$
  select x.author_name,x.author_registration,x.author_council from (
    select c.clinical_professional_name author_name,c.clinical_professional_registration author_registration,c.clinical_professional_council author_council,1 priority from public.clinics c where c.owner_id=auth.uid()
    union all select cm.professional_name,cm.professional_registration,cm.professional_council,2 from public.clinic_members cm join public.clinics c on c.id=cm.clinic_id where cm.user_id=auth.uid() and cm.clinical_access
  ) x where x.author_name is not null and x.author_registration is not null order by priority limit 1
$$;
grant usage on schema public to authenticated;
grant select on public.patients,public.clinical_anamneses to authenticated;

\ir ../../supabase/clinical_protocols_schema.sql

insert into auth.users values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002'),('10000000-0000-4000-8000-000000000003'),('10000000-0000-4000-8000-000000000004');
insert into public.clinics values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Dra. Owner','111','CRM'),('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','Dra. Outra','444','CRM');
insert into public.clinic_members(clinic_id,user_id,role,clinical_access,professional_name,professional_registration) values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','admin',true,'Dra. Admin','222'),
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','equipe',true,'Dra. Equipe','333');
insert into public.patients values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',true);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false); set role authenticated;
select public.save_clinical_protocol(null,'40000000-0000-4000-8000-000000000001','{"name":"Mamoplastia","procedureName":"Mama","description":"Teste","indication":"Indicacao","objectives":"Objetivos","plannedTreatment":"Tratamento","guidance":"Orientacoes","anamnesisPrompts":[{"key":"tabagismo","label":"Tabagismo","required":true}],"examKit":["Hemograma"],"medicationFavorites":[],"photoRequirements":["Frente"],"returnSchedule":[{"days":7,"title":"Retorno","instructions":"Revisar"}]}'::jsonb)::text as protocol_id \gset
select set_config('test.protocol_id',:'protocol_id',false);

-- Repetição idempotente não duplica.
select public.save_clinical_protocol(null,'40000000-0000-4000-8000-000000000001','{"name":"Mamoplastia","procedureName":"Mama","description":"Teste","indication":"Indicacao","objectives":"Objetivos","plannedTreatment":"Tratamento","guidance":"Orientacoes","anamnesisPrompts":[{"key":"tabagismo","label":"Tabagismo","required":true}],"examKit":["Hemograma"],"medicationFavorites":[],"photoRequirements":["Frente"],"returnSchedule":[{"days":7,"title":"Retorno","instructions":"Revisar"}]}'::jsonb);
do $$ begin if (select count(*) from public.clinical_protocol_versions)<>1 then raise exception 'Protocolo duplicado'; end if; end $$;

-- Perfil clínico não administrador consulta, mas não altera.
reset role; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false); set role authenticated;
do $$ begin begin perform public.save_clinical_protocol(current_setting('test.protocol_id')::uuid,gen_random_uuid(),'{}'::jsonb); raise exception 'Equipe alterou protocolo'; exception when sqlstate '42501' then null; end; end $$;

-- Snapshot e respostas obrigatórias ficam na anamnese.
reset role; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false); set role authenticated;
select id::text version_id from public.clinical_protocol_versions limit 1 \gset
select public.create_clinical_anamnesis('30000000-0000-4000-8000-000000000001',current_date,jsonb_build_object('chief_complaint','Queixa','history_present_illness','Historia','physical_exam','Exame','diagnostic_hypotheses','Hipotese','therapeutic_plan','Plano','protocol_version_id',:'version_id','protocol_responses',jsonb_build_object('tabagismo','Nao')),'50000000-0000-4000-8000-000000000001');
do $$ begin if not exists(select 1 from public.clinical_anamneses where protocol_name='Mamoplastia' and protocol_snapshot->>'name'='Mamoplastia' and protocol_responses->>'tabagismo'='Nao') then raise exception 'Snapshot ausente'; end if; end $$;

-- Outra clínica não lê protocolos.
reset role; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false); set role authenticated;
do $$ begin if (select count(*) from public.clinical_protocols)<>0 then raise exception 'RLS vazou protocolo'; end if; end $$;

reset role;
\ir ../../supabase/clinical_protocols_schema.sql
select 'clinical protocols postgres tests passed' result;
