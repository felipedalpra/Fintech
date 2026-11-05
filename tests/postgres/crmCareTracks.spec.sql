-- Executar somente em banco local descartavel e vazio:
--   createdb surgi_tracks_test
--   psql -v ON_ERROR_STOP=1 -d surgi_tracks_test -f tests/postgres/crmCareTracks.spec.sql
\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001');
create or replace function auth.uid() returns uuid language sql stable
as $$ select '10000000-0000-4000-8000-000000000001'::uuid $$;
create or replace function public.data_owner_id() returns uuid language sql stable
as $$ select '10000000-0000-4000-8000-000000000001'::uuid $$;

create table public.procedures(id uuid primary key default gen_random_uuid(), user_id uuid, name text);
create table public.patients(id uuid primary key default gen_random_uuid(), full_name text);
create table public.opportunities(id uuid primary key default gen_random_uuid(), title text);
create table public.surgeries(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  procedure_id uuid references public.procedures(id),
  patient text not null,
  patient_id uuid references public.patients(id),
  date date not null
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  title text not null, due_date date, due_time time,
  task_type text not null default 'outro',
  status text not null default 'pendente' check (status in ('pendente','feita')),
  outcome text, assigned_user_id uuid, created_by uuid, done_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

\ir ../../supabase/crm_care_tracks.sql
-- Reaplicar a migration nao pode falhar nem duplicar objeto.
\ir ../../supabase/crm_care_tracks.sql

insert into public.patients(id, full_name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Katia Z Martins');
insert into public.procedures(id, user_id, name) values ('bbbbbbbb-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Mamoplastia');

-- Trilha da clinica: D-7, D+1, D+30. Definida por ELA, nao pelo codigo.
insert into public.care_tracks(id, user_id, name) values
  ('cccccccc-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Pos-operatorio padrao');
insert into public.care_track_steps(user_id, track_id, offset_days, title, task_type, sort_order) values
  ('10000000-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', -7,  'Conferir exames pre-op', 'exames', 1),
  ('10000000-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',  1,  'Como passou a noite',   'whatsapp', 2),
  ('10000000-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', 30,  'Retorno D+30',          'retorno', 3);

-- ---------------------------------------------------------------------------
-- 1. Cirurgia futura gera a esteira inteira, com as datas ancoradas.
-- ---------------------------------------------------------------------------
do $$
declare v_surgery uuid; v_date date := current_date + 20;
begin
  insert into public.surgeries(user_id, patient, patient_id, procedure_id, date)
  values ('10000000-0000-4000-8000-000000000001', 'Katia Z Martins', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', v_date)
  returning id into v_surgery;

  if (select count(*) from public.care_track_runs where anchor_id = v_surgery) <> 3 then
    raise exception 'A esteira nao gerou os 3 passos: %', (select count(*) from public.care_track_runs where anchor_id = v_surgery);
  end if;
  if not exists (select 1 from public.tasks where title like 'Conferir exames pre-op%' and due_date = v_date - 7 and task_type = 'exames') then
    raise exception 'O passo D-7 nao ancorou na data da cirurgia.';
  end if;
  if not exists (select 1 from public.tasks where title like 'Retorno D+30%' and due_date = v_date + 30) then
    raise exception 'O passo D+30 nao ancorou na data da cirurgia.';
  end if;
  -- O nome do paciente entra no titulo: a fila precisa dizer de quem e a tarefa.
  if not exists (select 1 from public.tasks where title = 'Como passou a noite · Katia Z Martins') then
    raise exception 'O titulo da tarefa nao identificou o paciente.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. IDEMPOTENTE: regravar a cirurgia nao duplica tarefa.
-- ---------------------------------------------------------------------------
do $$
declare v_surgery uuid; v_antes integer;
begin
  select id into v_surgery from public.surgeries limit 1;
  select count(*) into v_antes from public.tasks;
  -- O autosave regrava a mesma cirurgia varias vezes por sessao.
  update public.surgeries set patient_id = patient_id where id = v_surgery;
  update public.surgeries set procedure_id = procedure_id where id = v_surgery;
  if (select count(*) from public.tasks) <> v_antes then
    raise exception 'Regravar a cirurgia duplicou tarefas: % -> %', v_antes, (select count(*) from public.tasks);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Mudar a data REAGENDA o que esta pendente e NAO toca o que ja foi feito.
-- ---------------------------------------------------------------------------
do $$
declare v_surgery uuid; v_nova date; v_feita uuid;
begin
  select id into v_surgery from public.surgeries limit 1;
  select task_id into v_feita from public.care_track_runs r
  join public.tasks t on t.id = r.task_id where t.title like 'Retorno D+30%' limit 1;
  update public.tasks set status = 'feita', done_at = now(), due_date = '2020-01-01' where id = v_feita;

  v_nova := current_date + 40;
  update public.surgeries set date = v_nova where id = v_surgery;

  if not exists (select 1 from public.tasks where title like 'Conferir exames pre-op%' and due_date = v_nova - 7) then
    raise exception 'A tarefa pendente nao acompanhou a nova data da cirurgia.';
  end if;
  if (select due_date from public.tasks where id = v_feita) <> '2020-01-01' then
    raise exception 'Tarefa JA CONCLUIDA foi reescrita pela mudanca de data.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. NAO RETROATIVO: cirurgia antiga nao despeja tarefas vencidas na fila.
-- ---------------------------------------------------------------------------
do $$
declare v_surgery uuid; v_antes integer;
begin
  select count(*) into v_antes from public.tasks;
  insert into public.surgeries(user_id, patient, date)
  values ('10000000-0000-4000-8000-000000000001', 'Paciente antigo', current_date - 365)
  returning id into v_surgery;

  if (select count(*) from public.care_track_runs where anchor_id = v_surgery) <> 0 then
    raise exception 'Cirurgia de um ano atras gerou tarefas retroativas.';
  end if;
  if (select count(*) from public.tasks) <> v_antes then
    raise exception 'Cirurgia antiga criou tarefa.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Trilha por procedimento so alcanca o procedimento dela.
-- ---------------------------------------------------------------------------
do $$
declare v_surgery uuid; v_outro uuid;
begin
  insert into public.procedures(id, user_id, name) values ('bbbbbbbb-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Rinoplastia');
  insert into public.care_tracks(id, user_id, name, procedure_id)
  values ('cccccccc-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'So rinoplastia', 'bbbbbbbb-0000-4000-8000-000000000002');
  insert into public.care_track_steps(user_id, track_id, offset_days, title)
  values ('10000000-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', 2, 'Checar nariz');

  insert into public.surgeries(user_id, patient, procedure_id, date)
  values ('10000000-0000-4000-8000-000000000001', 'Outra paciente', 'bbbbbbbb-0000-4000-8000-000000000001', current_date + 10)
  returning id into v_outro;

  if exists (select 1 from public.tasks t join public.care_track_runs r on r.task_id = t.id
             where r.anchor_id = v_outro and t.title like 'Checar nariz%') then
    raise exception 'Trilha de rinoplastia vazou para uma mamoplastia.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Trilha desativada para de gerar, sem apagar o que ja existe.
-- ---------------------------------------------------------------------------
do $$
declare v_surgery uuid; v_antes integer;
begin
  update public.care_tracks set active = false where id = 'cccccccc-0000-4000-8000-000000000001';
  select count(*) into v_antes from public.tasks;
  insert into public.surgeries(user_id, patient, procedure_id, date)
  values ('10000000-0000-4000-8000-000000000001', 'Depois de desativar', 'bbbbbbbb-0000-4000-8000-000000000001', current_date + 15)
  returning id into v_surgery;
  if (select count(*) from public.care_track_runs where anchor_id = v_surgery) <> 0 then
    raise exception 'Trilha desativada continuou gerando tarefa.';
  end if;
  if (select count(*) from public.tasks) < v_antes then
    raise exception 'Desativar a trilha apagou tarefas existentes.';
  end if;
end $$;

select 'crmCareTracks: OK' as resultado;
