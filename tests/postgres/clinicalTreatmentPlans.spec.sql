-- Executar somente em banco local descartável:
--   createdb surgimetrics_treatment_test
--   psql -v ON_ERROR_STOP=1 -d surgimetrics_treatment_test -f tests/postgres/clinicalTreatmentPlans.spec.sql

\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create extension if not exists pgcrypto;
create extension if not exists dblink;
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.clinics(
  id uuid primary key, owner_id uuid not null references auth.users(id),
  clinical_professional_name text, clinical_professional_registration text, clinical_professional_council text default 'CRM'
);
create table public.clinic_members(
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id), clinical_access boolean not null default false,
  professional_name text, professional_registration text, professional_council text default 'CRM'
);
create table public.patients(
  id uuid primary key, user_id uuid not null references auth.users(id), full_name text not null, active boolean not null default true
);
create table public.consultations(
  id uuid primary key, user_id uuid not null references auth.users(id), patient text,
  patient_id uuid references public.patients(id), date date, competence_date date, due_date date,
  start_time time, duration_minutes integer, consultation_type text, value numeric,
  payment_type text, invoice_issuance_percent numeric, payment_status text, forecast_payment_date date
);
create table public.medical_records(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  patient_id uuid not null references public.patients(id), created_by uuid references auth.users(id),
  session_date date not null, evolution_notes text not null, procedures_applied text, next_appointment_date date,
  professional_name text, author_name text, author_registration text, author_council text, authorship_source text,
  archived boolean not null default false, created_at timestamptz not null default timezone('utc', now())
);
create table public.clinical_record_access_logs(
  id bigint generated always as identity primary key, user_id uuid not null, patient_id uuid not null,
  actor_id uuid, action text not null, occurred_at timestamptz not null default timezone('utc', now())
);

create or replace function public.data_owner_id() returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.owner_id from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id where cm.user_id = auth.uid() limit 1), auth.uid())
$$;
create or replace function public.has_clinical_access() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() = public.data_owner_id() or exists (
    select 1 from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
    where cm.user_id = auth.uid() and cm.clinical_access and c.owner_id = public.data_owner_id()
  )
$$;
create or replace function public.clinical_author_identity()
returns table(author_name text, author_registration text, author_council text)
language sql stable security definer set search_path = public, pg_temp as $$
  select cm.professional_name, cm.professional_registration, cm.professional_council
  from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
  where cm.user_id = auth.uid() and cm.clinical_access and c.owner_id = public.data_owner_id() limit 1
$$;

grant usage on schema public to authenticated;
grant select on public.patients, public.consultations, public.medical_records to authenticated;

\ir ../../supabase/clinical_treatment_plans_schema.sql

insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');
insert into public.clinics(id, owner_id) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003');
insert into public.clinic_members(clinic_id, user_id, clinical_access, professional_name, professional_registration, professional_council)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', true, 'Dra. Teste', '12345', 'CRM');
insert into public.patients(id, user_id, full_name) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Paciente A'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'Paciente B');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select public.create_clinical_treatment_plan(
  '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  'Pós-operatório', 'Acompanhamento indicado', null, 'Recuperação segura', 'Retornos seriados',
  'Riscos e alternativas discutidos', current_date, current_date + 30,
  '[{"request_id":"50000000-0000-4000-8000-000000000001","session_type":"return","title":"Retorno em 7 dias","duration_minutes":30}]'::jsonb
)::text as plan_id \gset
select set_config('test.plan_id', :'plan_id', false);

-- A mesma requisição e o mesmo conteúdo são idempotentes e não duplicam plano, versão ou sessão.
select public.create_clinical_treatment_plan(
  '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  'Pós-operatório', 'Acompanhamento indicado', null, 'Recuperação segura', 'Retornos seriados',
  'Riscos e alternativas discutidos', current_date, current_date + 30,
  '[{"request_id":"50000000-0000-4000-8000-000000000001","session_type":"return","title":"Retorno em 7 dias","duration_minutes":30}]'::jsonb
);
do $$ begin
  if (select count(*) from public.clinical_treatment_plans) <> 1 then raise exception 'Plano duplicado.'; end if;
  if (select count(*) from public.clinical_treatment_plan_versions) <> 1 then raise exception 'Versão duplicada.'; end if;
  if (select count(*) from public.clinical_treatment_sessions) <> 1 then raise exception 'Sessão duplicada.'; end if;
end $$;

-- A mesma chave com conteúdo diferente é recusada em vez de devolver sucesso falso.
do $$ begin
  begin
    perform public.create_clinical_treatment_plan(
      '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
      'Conteúdo divergente', 'Acompanhamento indicado', null, 'Recuperação segura', 'Retornos seriados',
      'Riscos e alternativas discutidos', current_date, current_date + 30,
      '[{"request_id":"50000000-0000-4000-8000-000000000001","session_type":"return","title":"Retorno em 7 dias","duration_minutes":30}]'::jsonb
    );
    raise exception 'Era esperado rejeitar chave idempotente com conteúdo divergente.';
  exception when sqlstate '22023' then null; end;
end $$;

select id::text as session_id from public.clinical_treatment_sessions limit 1 \gset
select set_config('test.session_id', :'session_id', false);

-- Agenda e evento clínico são sincronizados na mesma transação e usam a sessão como identidade canônica.
select public.sync_clinical_treatment_session_schedule(
  :'session_id', '55000000-0000-4000-8000-000000000001', 'scheduled',
  '2026-10-23 17:30:00+00', 45, 'Vinculada à agenda.', true
);
do $$ begin
  if not exists (
    select 1 from public.consultations
    where id = current_setting('test.session_id')::uuid and patient_id = '30000000-0000-4000-8000-000000000001'
      and date = date '2026-10-23' and start_time = time '14:30' and duration_minutes = 45
  ) then raise exception 'Sincronização não criou a consulta canônica esperada.'; end if;
  if not exists (
    select 1 from public.clinical_treatment_session_events
    where session_id = current_setting('test.session_id')::uuid
      and consultation_id = current_setting('test.session_id')::uuid and status = 'scheduled'
  ) then raise exception 'Sincronização não registrou o vínculo clínico.'; end if;
end $$;

select public.sync_clinical_treatment_session_schedule(
  :'session_id', '55000000-0000-4000-8000-000000000002', 'rescheduled',
  '2026-10-24 18:00:00+00', 60, 'Reagendada.', true
);
do $$ begin
  if (select count(*) from public.consultations where id = current_setting('test.session_id')::uuid) <> 1 then
    raise exception 'Reagendamento duplicou a consulta.';
  end if;
  if not exists (select 1 from public.consultations where id = current_setting('test.session_id')::uuid and date = date '2026-10-24' and start_time = time '15:00' and duration_minutes = 60) then
    raise exception 'Reagendamento não atualizou a consulta canônica.';
  end if;
end $$;

select public.add_clinical_treatment_session(
  :'plan_id', '56000000-0000-4000-8000-000000000001', 'return', 'Retorno cancelável', null,
  '2026-10-26 17:00:00+00', 30
)::text as cancel_session_id \gset
select set_config('test.cancel_session_id', :'cancel_session_id', false);
select public.sync_clinical_treatment_session_schedule(
  :'cancel_session_id', '56000000-0000-4000-8000-000000000002', 'scheduled',
  '2026-10-26 17:00:00+00', 30, 'Vinculada à agenda.', true
);
select public.sync_clinical_treatment_session_schedule(
  :'cancel_session_id', '56000000-0000-4000-8000-000000000003', 'cancelled',
  null, 30, 'Paciente solicitou cancelamento.', true
);
do $$ begin
  if not exists (
    select 1 from public.consultations
    where id = current_setting('test.cancel_session_id')::uuid and payment_status = 'cancelado'
  ) then raise exception 'Cancelamento não atualizou a consulta canônica.'; end if;
end $$;

-- Uma transação iniciada antes, mas concluída depois, deve permanecer como o estado mais recente.
-- O teste reproduz a ultrapassagem que quebraria com recorded_at default now().
create or replace function public.test_delayed_treatment_completion(p_session_id uuid)
returns uuid language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
  perform pg_sleep(1);
  return public.complete_clinical_treatment_session(
    p_session_id, '60000000-0000-4000-8000-000000000001', clock_timestamp(),
    'Paciente evoluiu sem intercorrências.', 'Curativo e orientações realizados.', current_date + 7
  );
end;
$$;
reset role;
select dblink_connect('treatment_race', 'dbname=' || current_database());
select dblink_send_query(
  'treatment_race',
  format('select public.test_delayed_treatment_completion(%L::uuid)', :'session_id')
);
set role authenticated;
select pg_sleep(0.2);
select public.sync_clinical_treatment_session_schedule(
  :'session_id', '55000000-0000-4000-8000-000000000003', 'rescheduled',
  '2026-10-25 19:00:00+00', 60, 'Reagendamento concorrente.', true
);
reset role;
select test_delayed_treatment_completion::text as record_id
from dblink_get_result('treatment_race') as result(test_delayed_treatment_completion uuid) \gset
select dblink_disconnect('treatment_race');
set role authenticated;
select set_config('test.record_id', :'record_id', false);
do $$ begin
  if not exists (
    select 1 from public.medical_records
    where id = current_setting('test.record_id')::uuid
      and treatment_plan_id = current_setting('test.plan_id')::uuid
      and treatment_session_id = current_setting('test.session_id')::uuid
      and care_occurred_at is not null
  ) then raise exception 'Conclusão não criou evolução canônica vinculada.'; end if;
  if (select count(*) from public.clinical_treatment_session_events where status = 'completed') <> 1 then
    raise exception 'Evento de conclusão ausente.';
  end if;
  if (
    select e.status from public.clinical_treatment_session_events e
    where e.session_id = current_setting('test.session_id')::uuid
    order by e.recorded_at desc, e.id desc limit 1
  ) <> 'completed' then raise exception 'Concorrência deixou evento antigo como estado atual.'; end if;
end $$;

do $$ begin
  begin
    update public.clinical_treatment_plan_versions set title = 'Mutado';
    raise exception 'Era esperado revogar update direto.';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.clinical_treatment_sessions;
    raise exception 'Era esperado revogar delete direto.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- O gatilho também protege contra mutação acidental pelo executor da migration.
do $$ begin
  begin
    update public.clinical_treatment_plan_versions set title = 'Mutado';
    raise exception 'Era esperado bloquear mutação append-only.';
  exception when sqlstate '55000' then null; end;
end $$;

-- Outra clínica não lê o plano.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$ begin
  if (select count(*) from public.clinical_treatment_plans) <> 0 then raise exception 'RLS expôs plano cross-clínica.'; end if;
end $$;
reset role;

-- Reaplicação preserva dados e histórico.
\ir ../../supabase/clinical_treatment_plans_schema.sql
do $$ begin
  if (select count(*) from public.clinical_treatment_plans) <> 1 then raise exception 'Reaplicação alterou planos.'; end if;
  if (select count(*) from public.medical_records where treatment_session_id is not null) <> 1 then raise exception 'Reaplicação alterou evolução.'; end if;
end $$;

select 'clinical treatment plans postgres tests passed' as result;
